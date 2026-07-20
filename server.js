// =============================================================
//  Assistant FAQ ESSEC  -  Backend / proxy Elasticsearch + RAG Claude
// -------------------------------------------------------------
//  ZERO DEPENDANCE : uniquement les modules natifs de Node.js
//  (aucun npm install requis, Node >= 18).
//
//  Chaine :
//   1. Recoit la question (POST /api/ask)
//   2. Interroge Elasticsearch (index myessec_faq) -> candidats FAQ
//   3. Re-classe les candidats en donnant plus de poids au TITRE
//      et aux passages en GRAS (<strong>/<b>) de l'article
//   4. Demande a Claude de REDIGER une reponse ancree UNIQUEMENT
//      dans ces articles, en repondant a l'objectif de la question,
//      et d'indiquer quels articles sont reellement pertinents
//   5. Renvoie la reponse construite + AU PLUS 3 sources (0 si rien)
//
//  Sans cle Anthropic -> synthese sans IA, recentree sur la question.
//  Les cles API restent cote serveur, jamais envoyees au navigateur.
// =============================================================

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ---- Mini chargeur de fichier .env ----
function loadEnv() {
  const envPath = path.join(__dirname, '.env');
  if (!fs.existsSync(envPath)) return;
  for (const raw of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) val = val.slice(1, -1);
    if (!(key in process.env)) process.env[key] = val;
  }
}
loadEnv();

// ---- Configuration ----
const ELK_URL = process.env.ELK_URL || 'https://myelk.essec.fr/myessec_faq/_search';
const ELK_API_KEY = process.env.ELK_API_KEY || '';
const PORT = Number(process.env.PORT) || 3000;
const CANDIDATES = Number(process.env.CANDIDATES) || 10;   // candidats recuperes pour le re-ranking
const MAX_SOURCES = Number(process.env.MAX_SOURCES) || 3;  // articles affiches au maximum

// --- Fournisseur LLM : Databricks (endpoint interne) > Gemini (gratuit) > Anthropic ---
const DATABRICKS_URL = process.env.DATABRICKS_URL || '';       // ex: https://adb-xxxx.azuredatabricks.net/serving-endpoints/databricks-claude-sonnet-4-5/invocations
const DATABRICKS_TOKEN = process.env.DATABRICKS_TOKEN || '';   // token d'acces Databricks (dapi...)
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-3.5-flash';
const GEMINI_URL = process.env.GEMINI_URL || 'https://generativelanguage.googleapis.com/v1beta';
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || '';
const ANTHROPIC_MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-5';
const ANTHROPIC_URL = process.env.ANTHROPIC_URL || 'https://api.anthropic.com/v1/messages';
const SCORE_MIN = Number(process.env.SCORE_MIN) || 3;  // note minimale (1-5) pour afficher la reponse
const SYNTH_MIN_COVERAGE = Number(process.env.SYNTH_MIN_COVERAGE) || 0.5; // mode sans IA : part minimale des mots de la question retrouves dans l'article
const LLM_PROVIDER = (DATABRICKS_URL && DATABRICKS_TOKEN) ? 'databricks'
  : GEMINI_API_KEY ? 'gemini'
  : ANTHROPIC_API_KEY ? 'anthropic'
  : null;
const LLM_MODEL = LLM_PROVIDER === 'databricks' ? (DATABRICKS_URL.match(/serving-endpoints\/([^/]+)/)?.[1] || 'databricks-endpoint')
  : LLM_PROVIDER === 'gemini' ? GEMINI_MODEL
  : ANTHROPIC_MODEL;
const RAG_ENABLED = String(process.env.RAG_ENABLED ?? 'true').toLowerCase() === 'true' && Boolean(LLM_PROVIDER);

if (String(process.env.ELK_INSECURE).toLowerCase() === 'true') {
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
  console.warn('[WARN] ELK_INSECURE=true : verification du certificat TLS desactivee.');
}
if (!ELK_API_KEY) console.warn('[WARN] ELK_API_KEY vide : renseigne ta cle Elasticsearch dans .env.');
if (!LLM_PROVIDER) console.warn('[WARN] Aucune cle LLM (DATABRICKS_URL+TOKEN, GEMINI_API_KEY ou ANTHROPIC_API_KEY) : bascule sur la synthese sans IA.');

// -------------------------------------------------------------
//  Nettoyage HTML / entites
// -------------------------------------------------------------
const NAMED_ENTITIES = {
  nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'",
  eacute: 'é', egrave: 'è', ecirc: 'ê', agrave: 'à', acirc: 'â',
  ugrave: 'ù', ucirc: 'û', icirc: 'î', ocirc: 'ô', ccedil: 'ç',
  euml: 'ë', iuml: 'ï', uuml: 'ü', laquo: '«', raquo: '»',
  hellip: '…', rsquo: '’', lsquo: '‘', ldquo: '“', rdquo: '”',
  deg: '°', euro: '€', mdash: '—', ndash: '–', oelig: 'œ'
};
function safeCodePoint(cp) { try { return String.fromCodePoint(cp); } catch { return ''; } }
function decodeEntities(str) {
  return str
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => safeCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => safeCodePoint(parseInt(d, 10)))
    .replace(/&([a-zA-Z]+);/g, (m, name) => (name in NAMED_ENTITIES ? NAMED_ENTITIES[name] : m));
}
function htmlToPlainText(html) {
  if (!html) return '';
  let out = String(html)
    .replace(/<\s*(script|style)[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi, '')
    .replace(/<\s*br\s*\/?\s*>/gi, '\n')
    .replace(/<\s*\/\s*(p|div|li|h[1-6]|tr)\s*>/gi, '\n')
    .replace(/<[^>]+>/g, '');
  out = decodeEntities(out);
  return out.replace(/\r/g, '').replace(/[ \t]+/g, ' ').replace(/ *\n */g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

// Supprime la mention "Last update" / "Derniere mise a jour" (+ eventuelle date)
// systematiquement placee en tete du contenu.
function stripLastUpdate(text) {
  if (!text) return '';
  return text
    .replace(/^\s*(last\s*update|derni[eè]re?\s+mise\s+[àa]\s+jour)\b\s*[:\-–]?\s*/i, '')
    .replace(/^\s*\d{1,2}[\/.\-]\d{1,2}[\/.\-]\d{2,4}(\s+\d{1,2}[:h]\d{2})?\s*[:\-–]?\s*/i, '')
    .trimStart();
}

function extractCategories(faqCategory) {
  if (!Array.isArray(faqCategory)) return [];
  return faqCategory
    .map((c) => c?.label?.fr || c?.label?.en || (typeof c === 'string' ? c : null))
    .filter(Boolean);
}

// Extrait le texte des passages en gras (<strong> / <b>) du HTML brut.
function extractBoldText(html) {
  if (!html) return '';
  const parts = [];
  const re = /<(strong|b)\b[^>]*>([\s\S]*?)<\/\1>/gi;
  let m;
  while ((m = re.exec(html)) !== null) parts.push(htmlToPlainText(m[2]));
  return parts.join(' ');
}

// -------------------------------------------------------------
//  Normalisation texte pour le re-ranking (sans accents, sans mots vides)
// -------------------------------------------------------------
const STOPWORDS = new Set(('le la les un une des du de d l au aux et ou a à en dans sur pour par avec sans ' +
  'que qui quoi quel quelle quels quelles comment ou où est sont etre être mon ma mes ton ta tes son sa ses ' +
  'votre vos notre nos ce cet cette ces je tu il elle nous vous ils elles on se sa si ne pas plus tres très ' +
  'puis alors donc car comme quand y').split(/\s+/));
function normalize(s) {
  return String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}
function terms(s) {
  return normalize(s).split(/[^a-z0-9]+/).filter((w) => w.length > 2 && !STOPWORDS.has(w));
}

// -------------------------------------------------------------
//  Recherche Elasticsearch (title^3, content, fuzzy) -> candidats
// -------------------------------------------------------------
function buildQuery(question) {
  return {
    size: CANDIDATES,
    query: {
      multi_match: {
        query: question,
        fields: ['title^3', 'content'],
        type: 'best_fields',
        fuzziness: 'AUTO',
        operator: 'or'
      }
    }
  };
}

async function searchFaq(question) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  try {
    const elkRes = await fetch(ELK_URL, {
      method: 'POST',
      headers: { 'Authorization': `ApiKey ${ELK_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(buildQuery(question)),
      signal: controller.signal
    });
    if (!elkRes.ok) {
      const detail = await elkRes.text().catch(() => '');
      const err = new Error(`ELK ${elkRes.status}`); err.elkStatus = elkRes.status; err.detail = detail.slice(0, 300);
      throw err;
    }
    const data = await elkRes.json();
    const hits = data?.hits?.hits || [];
    return hits.map((hit) => {
      const src = hit._source || {};
      const rawContent = src.content || '';
      return {
        id: hit._id,
        esScore: hit._score || 0,
        title: htmlToPlainText(src.title || '').trim() || 'Sans titre',
        text: stripLastUpdate(htmlToPlainText(rawContent)),
        bold: extractBoldText(rawContent),
        url: typeof src.url === 'string' ? src.url : '',
        categories: extractCategories(src.faq_category)
      };
    });
  } finally {
    clearTimeout(timeout);
  }
}

// -------------------------------------------------------------
//  Re-ranking : score ES normalise + bonus TITRE (fort) + GRAS (moyen)
// -------------------------------------------------------------
function rerank(question, candidates) {
  if (!candidates.length) return [];
  const qTerms = terms(question);
  const qSet = new Set(qTerms);
  const maxEs = Math.max(...candidates.map((c) => c.esScore), 1e-9);

  const scored = candidates.map((c) => {
    const titleSet = new Set(terms(c.title));
    const boldSet = new Set(terms(c.bold));
    const bodySet = new Set(terms(c.text));
    let titleHits = 0, boldHits = 0, bodyHits = 0;
    for (const t of qSet) {
      if (titleSet.has(t)) titleHits++;
      if (boldSet.has(t)) boldHits++;
      if (bodySet.has(t)) bodyHits++;
    }
    const denom = qSet.size || 1;
    const esNorm = c.esScore / maxEs;                 // 0..1
    const titleFrac = titleHits / denom;              // 0..1  (poids fort)
    const boldFrac = boldHits / denom;                // 0..1  (poids moyen)
    const bodyFrac = bodyHits / denom;                // 0..1  (poids faible)
    const score = esNorm * 1.0 + titleFrac * 2.5 + boldFrac * 1.2 + bodyFrac * 0.5;
    return { ...c, rerankScore: score, titleFrac, boldFrac, bodyFrac };
  });

  scored.sort((a, b) => b.rerankScore - a.rerankScore);
  return scored;
}

// -------------------------------------------------------------
//  RAG : le LLM redige la reponse + choisit les sources pertinentes
// -------------------------------------------------------------
const SYSTEM_PROMPT = [
  "Tu es l'assistant FAQ officiel de l'ESSEC Business School qui aide les etudiants.",
  "Tu reponds EXCLUSIVEMENT a partir des extraits de FAQ fournis. Aucune connaissance exterieure, aucune invention. Regle absolue.",
  "",
  "ETAPE 1 - INTENTION : identifie ce que demande vraiment la question (un 'comment' attend une procedure ; 'ou' un lieu/lien ; 'quand' une date ; 'qui' un contact).",
  "",
  "ETAPE 2 - REDACTION : redige un brouillon de reponse en francais, clair et concis (2 a 6 phrases, ou une courte liste pour une procedure), en repondant a l'intention exacte, uniquement a partir des extraits.",
  "",
  "ETAPE 3 - RELECTURE ET SOURCAGE (obligatoire) : relis ta reponse phrase par phrase. Pour CHAQUE affirmation, verifie qu'elle est explicitement justifiee par un extrait precis. SUPPRIME toute phrase qui n'est pas directement sourcee par un extrait. Dans 'sources', mets uniquement les numeros des extraits qui justifient reellement ce qui reste, du plus au moins pertinent, 3 maximum.",
  "",
  "ETAPE 4 - AUTO-NOTE 'score' de 1 a 5 : evalue a quel point ta reponse finale repond a l'intention EXACTE de la question ET est entierement soutenue par les extraits.",
  "  5 = repond exactement a la question, chaque element est explicitement dans les extraits.",
  "  3 = repond correctement mais partiellement, ou avec une marge d'interpretation.",
  "  1-2 = les extraits ne repondent pas vraiment a ce qui est demande (sujet proche mais pas la reponse), ou reponse peu soutenue.",
  "",
  "DECISION :",
  "- Si score >= 3 : \"found\": true, et 'answer' = ta reponse relue et entierement sourcee.",
  "- Si score < 3 : \"found\": false, 'sources': [], et 'answer' = un message court et poli disant que tu n'as pas trouve la reponse a cette question precise dans la FAQ et invitant a reformuler ou contacter le service concerne. N'expose AUCUN contenu tangentiel.",
  "- En cas de doute, baisse la note et ne reponds pas. Mieux vaut dire qu'on ne sait pas que repondre a cote.",
  "- Aucune URL dans 'answer' (les sources sont affichees a part).",
  "",
  "FORMAT DE SORTIE : reponds STRICTEMENT avec un unique objet JSON valide, sans texte avant ni apres, de la forme :",
  '{"found": true|false, "score": 1-5, "answer": "...", "sources": [1, 2]}'
].join('\n');

const NOT_FOUND_MSG = "Je n'ai pas trouve la reponse a cette question precise dans la FAQ. Essayez de reformuler, ou contactez directement le service concerne.";

function buildRagUserMessage(question, articles) {
  const extraits = articles.map((a, i) => {
    const cats = a.categories.length ? ` [Categorie : ${a.categories.join(', ')}]` : '';
    return `Extrait ${i + 1} : ${a.title}${cats}\n${a.text.slice(0, 1500)}`;
  }).join('\n\n');
  return `QUESTION DE L'ETUDIANT :\n"${question}"\n\nEXTRAITS DE LA FAQ ESSEC (les seules sources autorisees) :\n\n${extraits}\n\nRedige la reponse en respectant strictement les regles et le format JSON.`;
}

function parseClaudeJson(text) {
  if (!text) return null;
  let t = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
  const start = t.indexOf('{'), end = t.lastIndexOf('}');
  if (start === -1 || end === -1 || end < start) return null;
  try { return JSON.parse(t.slice(start, end + 1)); } catch { return null; }
}

async function generateAnswerWithClaude(question, articles) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000);
  try {
    const res = await fetch(ANTHROPIC_URL, {
      method: 'POST',
      headers: { 'x-api-key': ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({
        model: ANTHROPIC_MODEL,
        max_tokens: 800,
        temperature: 0.1,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: buildRagUserMessage(question, articles) }]
      }),
      signal: controller.signal
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      const err = new Error(`Anthropic ${res.status}`); err.detail = detail.slice(0, 300); throw err;
    }
    const data = await res.json();
    const text = (data?.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim();
    return parseClaudeJson(text) || { found: true, score: SCORE_MIN, answer: text, sources: null };
  } finally {
    clearTimeout(timeout);
  }
}

// Gemini (Google AI Studio, palier gratuit)
async function generateAnswerWithGemini(question, articles) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000);
  try {
    const res = await fetch(`${GEMINI_URL}/models/${GEMINI_MODEL}:generateContent`, {
      method: 'POST',
      headers: { 'x-goog-api-key': GEMINI_API_KEY, 'content-type': 'application/json' },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: SYSTEM_PROMPT }] },
        contents: [{ role: 'user', parts: [{ text: buildRagUserMessage(question, articles) }] }],
        generationConfig: { temperature: 0.1, maxOutputTokens: 800, responseMimeType: 'application/json' }
      }),
      signal: controller.signal
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      const err = new Error(`Gemini ${res.status}`); err.detail = detail.slice(0, 300); throw err;
    }
    const data = await res.json();
    const text = (data?.candidates?.[0]?.content?.parts || []).map((p) => p.text || '').join('\n').trim();
    return parseClaudeJson(text) || { found: true, score: SCORE_MIN, answer: text, sources: null };
  } finally {
    clearTimeout(timeout);
  }
}

// Databricks Model Serving (endpoint interne, format OpenAI chat completions)
async function generateAnswerWithDatabricks(question, articles) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000);
  try {
    const res = await fetch(DATABRICKS_URL, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${DATABRICKS_TOKEN}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: buildRagUserMessage(question, articles) }
        ],
        max_tokens: 800,
        temperature: 0.1
      }),
      signal: controller.signal
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      const err = new Error(`Databricks ${res.status}`); err.detail = detail.slice(0, 300); throw err;
    }
    const data = await res.json();
    let content = data?.choices?.[0]?.message?.content ?? '';
    if (Array.isArray(content)) content = content.map((c) => c?.text || '').join('\n'); // certains endpoints renvoient des blocs
    const text = String(content).trim();
    return parseClaudeJson(text) || { found: true, score: SCORE_MIN, answer: text, sources: null };
  } finally {
    clearTimeout(timeout);
  }
}

// Dispatcher selon le fournisseur configure
function generateAnswer(question, articles) {
  if (LLM_PROVIDER === 'databricks') return generateAnswerWithDatabricks(question, articles);
  if (LLM_PROVIDER === 'gemini') return generateAnswerWithGemini(question, articles);
  return generateAnswerWithClaude(question, articles);
}

// -------------------------------------------------------------
//  Repli sans IA : synthese RECENTREE SUR LA QUESTION
//  (on garde les phrases de l'article qui recoupent le plus la question)
// -------------------------------------------------------------
// Part des mots de la question retrouves dans l'article (titre + gras + corps).
// Sert de garde-fou au mode sans IA : trop faible -> "Information non trouvee".
function questionCoverage(question, article) {
  const q = [...new Set(terms(question))];
  if (!q.length || !article) return 0;
  const hay = new Set([...terms(article.title), ...terms(article.bold), ...terms(article.text)]);
  let hit = 0; for (const t of q) if (hay.has(t)) hit++;
  return hit / q.length;
}

function synthesizeWithoutAI(question, article) {
  if (!article) return null;
  const qSet = new Set(terms(question));
  const clean = article.text.replace(/\s+/g, ' ').trim();
  const sentences = clean.match(/[^.!?]+[.!?]+/g) || (clean ? [clean] : []);
  const scored = sentences.map((s, idx) => {
    const sTerms = terms(s);
    let hits = 0; for (const t of sTerms) if (qSet.has(t)) hits++;
    return { s: s.trim(), idx, hits };
  });
  const relevant = scored.filter((x) => x.hits > 0).sort((a, b) => b.hits - a.hits || a.idx - b.idx);
  let picked = relevant.length ? relevant.slice(0, 4).sort((a, b) => a.idx - b.idx) : scored.slice(0, 2);
  let out = '';
  for (const p of picked) { if ((out + ' ' + p.s).length > 650) break; out += (out ? ' ' : '') + p.s; }
  return out.trim() || clean.slice(0, 650);
}

// -------------------------------------------------------------
//  Handler /api/ask
// -------------------------------------------------------------
function toSource(a) {
  return { title: a.title, url: a.url, categories: a.categories, excerpt: a.text.replace(/\s+/g, ' ').slice(0, 180) };
}

async function handleAsk(body, res) {
  const question = (body?.question || '').toString().trim();
  if (!question) return sendJson(res, 400, { error: 'Question vide.' });
  if (question.length > 500) return sendJson(res, 400, { error: 'Question trop longue (500 caracteres max).' });
  if (!ELK_API_KEY) return sendJson(res, 500, { error: "Le serveur n'est pas configure : cle API Elasticsearch manquante." });

  // 1) Recherche + re-ranking
  let ranked;
  try {
    const candidates = await searchFaq(question);
    ranked = rerank(question, candidates);
  } catch (err) {
    const aborted = err?.name === 'AbortError';
    console.error('[ELK] Erreur :', err?.message, err?.detail || '');
    return sendJson(res, aborted ? 504 : 502, {
      error: aborted ? "Le service FAQ met trop de temps a repondre. Reessayez dans un instant."
                     : "Erreur lors de la connexion a la base FAQ."
    });
  }

  if (!ranked.length) {
    return sendJson(res, 200, { question, answer: null, mode: 'empty', sources: [] });
  }

  // On soumet au RAG les meilleurs candidats (au plus MAX_SOURCES + un peu de marge).
  const shortlist = ranked.slice(0, Math.max(MAX_SOURCES + 2, 5));

  // 2) Reponse construite
  if (RAG_ENABLED) {
    try {
      const out = await generateAnswer(question, shortlist);
      const score = Number(out.score);
      const scoreVal = Number.isFinite(score) ? score : null;
      // Refus si le LLM dit found:false OU si son auto-note est < SCORE_MIN
      const found = out.found !== false && (!Number.isFinite(score) || score >= SCORE_MIN);
      if (!found) {
        return sendJson(res, 200, { question, answer: NOT_FOUND_MSG, mode: 'claude', found: false, score: scoreVal, sources: [] });
      }
      // Sources reellement citees par le LLM (dedupe, cap MAX_SOURCES)
      let sources = [];
      if (Array.isArray(out.sources)) {
        const seen = new Set();
        for (const n of out.sources) {
          const i = Number(n) - 1;
          if (Number.isInteger(i) && i >= 0 && i < shortlist.length && !seen.has(i)) { seen.add(i); sources.push(toSource(shortlist[i])); }
          if (sources.length >= MAX_SOURCES) break;
        }
      } else {
        sources = shortlist.slice(0, MAX_SOURCES).map(toSource);
      }
      // Rien n'est source -> on ne montre pas de reponse
      if (!sources.length) {
        return sendJson(res, 200, { question, answer: NOT_FOUND_MSG, mode: 'claude', found: false, score: scoreVal, sources: [] });
      }
      return sendJson(res, 200, { question, answer: out.answer || null, mode: 'claude', found: true, score: scoreVal, sources });
    } catch (err) {
      // Echec de l'appel LLM : on ne montre JAMAIS une reponse non verifiee.
      console.error(`[${LLM_PROVIDER}] Erreur LLM :`, err?.message, err?.detail || '');
      return sendJson(res, 200, { question, answer: NOT_FOUND_MSG, mode: 'error', found: false, sources: [] });
    }
  }

  // 3) Mode sans IA : extrait du meilleur article, avec garde-fou de pertinence.
  const coverage = questionCoverage(question, shortlist[0]);
  if (coverage < SYNTH_MIN_COVERAGE) {
    return sendJson(res, 200, { question, answer: NOT_FOUND_MSG, mode: 'synthese', found: false, sources: [] });
  }
  const answer = synthesizeWithoutAI(question, shortlist[0]);
  return sendJson(res, 200, { question, answer, mode: 'synthese', found: true, sources: shortlist.slice(0, MAX_SOURCES).map(toSource) });
}

// -------------------------------------------------------------
//  HTTP + fichiers statiques
// -------------------------------------------------------------
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon'
};
function sendJson(res, status, obj) { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(obj)); }
function serveStatic(req, res) {
  const urlPath = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  const rel = urlPath === '/' ? '/index.html' : urlPath;
  const safe = path.normalize(rel).replace(/^(\.\.[/\\])+/, '');
  const filePath = path.join(__dirname, 'public', safe);
  if (!filePath.startsWith(path.join(__dirname, 'public'))) { res.writeHead(403); return res.end('Forbidden'); }
  fs.readFile(filePath, (err, content) => {
    if (err) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); return res.end('Page introuvable'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream' });
    res.end(content);
  });
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '', size = 0;
    req.on('data', (chunk) => { size += chunk.length; if (size > 32 * 1024) { reject(new Error('Body too large')); req.destroy(); return; } data += chunk; });
    req.on('end', () => { if (!data) return resolve({}); try { resolve(JSON.parse(data)); } catch { reject(new Error('Invalid JSON')); } });
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  const { pathname } = new URL(req.url, 'http://x');
  if (req.method === 'GET' && pathname === '/api/health') {
    return sendJson(res, 200, { ok: true, elkConfigured: Boolean(ELK_API_KEY), ragEnabled: RAG_ENABLED, provider: RAG_ENABLED ? LLM_PROVIDER : null, model: RAG_ENABLED ? LLM_MODEL : null, maxSources: MAX_SOURCES });
  }
  if (req.method === 'POST' && pathname === '/api/ask') {
    try { return handleAsk(await readBody(req), res); } catch { return sendJson(res, 400, { error: 'Requete invalide.' }); }
  }
  if (req.method === 'GET') return serveStatic(req, res);
  res.writeHead(405, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end('Methode non autorisee');
});

server.listen(PORT, () => {
  console.log(`\n  Assistant FAQ ESSEC demarre`);
  console.log(`  -> Interface : http://localhost:${PORT}`);
  console.log(`  -> Index ELK : ${ELK_URL}  (cle ${ELK_API_KEY ? 'OK' : 'MANQUANTE'})`);
  console.log(`  -> RAG LLM   : ${RAG_ENABLED ? `active (${LLM_PROVIDER} / ${LLM_MODEL})` : 'desactive (synthese sans IA)'}`);
  console.log(`  -> Sources   : ${MAX_SOURCES} maximum\n`);
});
