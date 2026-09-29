// Test RAG v5 : Databricks (fournisseur unique), auto-note, erreurs LLM -> non trouve,
// mode sans IA avec garde-fou, endpoint /api/llm-status.
import http from 'node:http';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Playwright (capture d'ecran) est facultatif : si absent, seuls les tests d'API tournent.
let chromium = null;
for (const mod of ['/home/claude/.npm-global/lib/node_modules/playwright/index.js', 'playwright']) {
  try { const m = await import(mod); chromium = m.default?.chromium || m.chromium; if (chromium) break; } catch { /* essai suivant */ }
}

// --- Faux Elasticsearch : 5 articles, dont un piege hors-sujet a fort score. ---
const fakeElk = http.createServer((req, res) => {
  let b = ''; req.on('data', c => b += c);
  req.on('end', () => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ hits: { total: { value: 5 }, hits: [
      { _id:'x', _score:12, _source:{ title:'Vie associative sur le campus',
        content:'Last update Les associations etudiantes animent la vie du campus toute l annee.',
        url:'https://my.essec.fr/faq/assos', faq_category:[{label:{fr:'Vie de campus'}}] } },
      { _id:'c', _score:6, _source:{ title:'Certificat de scolarit&eacute;',
        content:'<p>Last update Pour votre <strong>certificat de scolarite</strong>, rendez-vous sur <strong>MyESSEC</strong>, rubrique Scolarite.</p>',
        url:'https://my.essec.fr/faq/certificat', faq_category:[{label:{fr:'Scolarité'}}] } },
      { _id:'d', _score:5, _source:{ title:'D&eacute;lai de d&eacute;livrance',
        content:'Le d&eacute;lai est de 48&nbsp;heures ouvr&eacute;es.',
        url:'https://my.essec.fr/faq/delais', faq_category:[{label:{fr:'Administration'}}] } },
      { _id:'e', _score:4, _source:{ title:'Attestation employeur',
        content:'Une attestation peut etre demandee au service scolarite.',
        url:'https://my.essec.fr/faq/attestation', faq_category:[{label:{fr:'Scolarité'}}] } },
      { _id:'f', _score:3, _source:{ title:'Carte etudiante',
        content:'La carte etudiante se retire a l accueil.',
        url:'https://my.essec.fr/faq/carte', faq_category:[{label:{fr:'Vie de campus'}}] } }
    ]}}));
  });
});
await new Promise(r => fakeElk.listen(9990, r));

// --- Faux Databricks : format OpenAI chat completions. ---
// Les URL commencant par /down simulent un endpoint en panne (503).
let firstExtraitTitle = null, sawLastUpdate = false, sawSystemPrompt = false, pingCount = 0;
const fakeDbx = http.createServer((req, res) => {
  let b = ''; req.on('data', c => b += c);
  req.on('end', () => {
    if (req.url.startsWith('/down')) { res.writeHead(503); return res.end('{"error":"endpoint arrete"}'); }
    if (req.headers.authorization !== 'Bearer dapi-test') { res.writeHead(401); return res.end('{"error":"token"}'); }
    const payload = JSON.parse(b);
    // Verification de disponibilite (bouton de l'interface) : 1 jeton, pas de prompt systeme.
    if (payload.max_tokens === 1 && payload.messages?.[0]?.content === 'ping') {
      pingCount++;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ choices: [{ message: { role:'assistant', content:'p' } }] }));
    }
    if ((payload.messages?.[0]?.content || '').includes('AUTO-NOTE')) sawSystemPrompt = true;
    const userMsg = payload.messages?.[1]?.content || '';
    const questionPart = userMsg.split('EXTRAITS')[0];
    if (/certificat/i.test(questionPart) && !/vague/i.test(questionPart)) {
      const m = userMsg.match(/Extrait 1 : (.+)/); if (m) firstExtraitTitle = m[1].split(' [')[0].trim();
      if (/last update/i.test(userMsg)) sawLastUpdate = true;
    }
    if (/panne500/i.test(questionPart)) { res.writeHead(500); return res.end('{"error":"boom"}'); }
    const notFound = /piscine|inexistant/i.test(userMsg);
    const lowScore = /vague|approximatif/i.test(questionPart);
    let out;
    if (notFound) out = { found:false, score:1, answer:"Je n'ai pas trouve cette information dans la FAQ. Contactez le service concerne.", sources:[] };
    else if (lowScore) out = { found:true, score:2, answer:"Reponse peu sure basee sur un sujet proche.", sources:[1] };
    else out = { found:true, score:5, answer:"Pour obtenir votre certificat de scolarite :\n\n1. Connectez-vous a **MyESSEC**\n2. Ouvrez la rubrique **Scolarite**\n\nLe document est delivre sous 48 heures ouvrees.", sources:[1,2,3,4] };
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ choices: [{ message: { role:'assistant', content: JSON.stringify(out) } }] }));
  });
});
await new Promise(r => fakeDbx.listen(9993, r));

const DBX_OK = 'http://localhost:9993/serving-endpoints/databricks-claude-sonnet-4-5/invocations';
const DBX_DOWN = 'http://localhost:9993/down/serving-endpoints/databricks-claude-sonnet-4-5/invocations';
// Journal d'audit des tests dans un dossier temporaire (le vrai logs/journal.log n'est pas touche).
const LOG_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'faq-journal-'));
const readJournal = () => fs.readFileSync(path.join(LOG_DIR, 'journal.log'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
const baseEnv = { ...process.env, ELK_URL:'http://localhost:9990/_search', ELK_API_KEY:'elk', MAX_SOURCES:'3', LOG_DIR };
// --- Serveur 1 : RAG Databricks ---
const srv = spawn('node', ['server.js'], { cwd: process.cwd(), env: { ...baseEnv,
  DATABRICKS_URL: DBX_OK, DATABRICKS_TOKEN:'dapi-test', PORT:'3212' }, stdio:'inherit' });
// --- Serveur 2 : mode sans IA (Databricks non configure) ---
const srv2 = spawn('node', ['server.js'], { cwd: process.cwd(), env: { ...baseEnv,
  DATABRICKS_URL:'', DATABRICKS_TOKEN:'', PORT:'3213' }, stdio:'ignore' });
// --- Serveur 3 : Databricks configure mais en panne ---
const srv3 = spawn('node', ['server.js'], { cwd: process.cwd(), env: { ...baseEnv,
  DATABRICKS_URL: DBX_DOWN, DATABRICKS_TOKEN:'dapi-test', PORT:'3214' }, stdio:'ignore' });
await new Promise(r => setTimeout(r, 900));

let allOk = true;
const ask = (port, q) => fetch(`http://localhost:${port}/api/ask`, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ question:q }) }).then(r => r.json());
try {
  const health = await fetch('http://localhost:3212/api/health').then(r=>r.json());
  const data = await ask(3212, 'certificat de scolarité');
  const nf   = await ask(3212, 'ou est la piscine ?');
  const low  = await ask(3212, 'question vague sur le certificat');
  const err5 = await ask(3212, 'panne500');
  const sOk  = await ask(3213, 'certificat de scolarité');       // sans IA, article pertinent
  const sKo  = await ask(3213, 'comment reserver la piscine olympique ?'); // sans IA, hors sujet
  const noLlmHealth = await fetch('http://localhost:3213/api/health').then(r=>r.json());
  const downAsk = await ask(3214, 'certificat de scolarité');    // Databricks en panne
  // /api/llm-status : disponible (2 appels -> 1 seul ping grace au cache), non configure, en panne
  const st1 = await fetch('http://localhost:3212/api/llm-status').then(r=>r.json());
  const st2 = await fetch('http://localhost:3212/api/llm-status').then(r=>r.json());
  const stNone = await fetch('http://localhost:3213/api/llm-status').then(r=>r.json());
  const stDown = await fetch('http://localhost:3214/api/llm-status').then(r=>r.json());
  // Journal d'audit : evenements supplementaires puis lecture du fichier
  const suggestion = await fetch('http://localhost:3212/api/ask', { method:'POST', body: JSON.stringify({ question:'certificat de scolarité', origine:'suggestion' }) }).then(r => r.json());
  const trackStatus = await fetch('http://localhost:3212/api/track', { method:'POST', body: JSON.stringify({ event:'clic_source', url:'https://my.essec.fr/faq/certificat', title:'Certificat de scolarité', question:'certificat' }) }).then(r => r.status);
  const trackBad = await fetch('http://localhost:3212/api/track', { method:'POST', body: JSON.stringify({ event:'autre' }) }).then(r => r.status);
  const badJson = await fetch('http://localhost:3212/api/ask', { method:'POST', body:'{pas du json' }).then(r => r.status);
  const refused = await fetch('http://localhost:3212/api/ask', { method:'DELETE' }).then(r => r.status);
  const malformed = await fetch('http://localhost:3212/%E0%A4%A').then(r => r.status);
  await fetch('http://localhost:3212/api/health', { headers: { 'X-Healthcheck':'docker' } });
  await new Promise(r => setTimeout(r, 200));
  const journal = readJournal();
  const qEvt = journal.find(e => e.action === 'question' && e.origine === 'suggestion');
  const qConn = journal.filter(e => e.type === 'connexion_interface' && qEvt && e.requete === qEvt.requete).map(e => e.cible).sort().join(',');
  console.log('[test] health =>', JSON.stringify(health));
  console.log('[test] llm-status =>', JSON.stringify(st1));
  console.log('[test] normale => found=%s score=%s sources=%d', data.found, data.score, data.sources.length);
  console.log('[test] sans IA pertinent =>', JSON.stringify(sOk).slice(0,160));
  console.log('[test] sans IA hors sujet =>', JSON.stringify(sKo).slice(0,160));

  const checks = [
    ['health : provider databricks + modele detecte', health.provider === 'databricks' && health.model === 'databricks-claude-sonnet-4-5'],
    ['prompt systeme (AUTO-NOTE) transmis a Databricks', sawSystemPrompt],
    ['re-ranking : titre/gras remonte "Certificat de scolarité" en 1er', firstExtraitTitle === 'Certificat de scolarité'],
    ['"Last update" retire des extraits envoyes au LLM', sawLastUpdate === false],
    ['AU PLUS 3 sources affichees', data.sources.length === 3],
    ['reponse valide : found=true, score=5', data.found === true && data.score === 5],
    ['cas non trouve : found=false, 0 source', nf.found === false && nf.sources.length === 0],
    ['auto-note < 3 : refusee, 0 source', low.found === false && low.sources.length === 0],
    ['erreur API LLM : "non trouve" (jamais de synthese brute)', err5.found === false && err5.mode === 'error' && err5.sources.length === 0],
    ['Databricks en panne : "non trouve", 0 source', downAsk.found === false && downAsk.mode === 'error' && downAsk.sources.length === 0],
    ['sans IA + article pertinent : repond', sOk.found === true && sOk.mode === 'synthese' && sOk.sources.length > 0],
    ['sans IA + hors sujet : "non trouve"', sKo.found === false && sKo.mode === 'synthese' && sKo.sources.length === 0],
    ['sans IA : aucun fournisseur annonce', noLlmHealth.provider === null && noLlmHealth.ragEnabled === false],
    ['llm-status : disponible', st1.etat === 'disponible' && st1.available === true && st1.statutHttp === 200],
    ['llm-status : cache 30 s (1 seul appel reel pour 2 demandes)', pingCount === 1 && st2.checkedAt === st1.checkedAt],
    ['llm-status : non configure', stNone.etat === 'non_configure' && stNone.configured === false],
    ['llm-status : en panne -> indisponible (503)', stDown.etat === 'indisponible' && stDown.available === false && stDown.statutHttp === 503],
    ['llm-status : jeton jamais renvoye au navigateur', !JSON.stringify([st1, stNone, stDown]).includes('dapi-test')],
    ['journal : question avec origine "suggestion"', suggestion.found === true && Boolean(qEvt)],
    ['journal : la question et ses connexions partagent le meme numero de requete', qConn === 'databricks,elasticsearch'],
    ['journal : clic sur une source enregistre', trackStatus === 204 && journal.some(e => e.action === 'clic_source' && e.titre === 'Certificat de scolarité')],
    ['journal : evenement inconnu refuse et enregistre', trackBad === 400 && journal.some(e => e.action === 'requete_invalide' && e.page === '/api/track')],
    ['journal : JSON invalide enregistre', badJson === 400 && journal.some(e => e.action === 'requete_invalide' && e.erreur === 'Invalid JSON')],
    ['journal : methode refusee enregistree', refused === 405 && journal.some(e => e.action === 'methode_refusee')],
    ['journal : URL malformee -> 400 sans plantage', malformed === 400 && journal.some(e => e.erreur === 'URI malformed')],
    ['journal : healthcheck Docker non enregistre', journal.filter(e => e.action === 'consultation_etat').length === 2],
    ['journal : demarrages en environnement "local"', journal.filter(e => e.type === 'demarrage_serveur' && e.environnement === 'local').length === 3]
  ];
  console.log('\n[test] Verifications :');
  for (const [n, ok] of checks) { console.log(`   ${ok ? '✅' : '❌'} ${n}`); if (!ok) allOk = false; }

  // Capture UI rapide (reponse normale) - seulement si Playwright est installe
  if (chromium) {
  const exe = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
  const browser = await chromium.launch(fs.existsSync(exe) ? { executablePath: exe } : {});
  const page = await browser.newPage({ viewport: { width: 900, height: 1050 }, deviceScaleFactor: 2 });
  await page.goto('http://localhost:3212'); await page.waitForTimeout(500);
  await page.fill('#q', 'Comment obtenir mon certificat de scolarité ?');
  await page.click('#send');
  await page.waitForSelector('.answer-card', { timeout: 6000 });
  await page.waitForTimeout(600);
  await page.screenshot({ path: 'apercu-reponse.png', fullPage: true });
  await browser.close();
  } else console.log('\n[test] Playwright absent : capture d\'ecran ignoree.');

  console.log(allOk ? '\n=== TOUS LES TESTS PASSENT ===' : '\n=== ECHEC ===');
} catch (e) { console.error('[test] ERREUR', e); allOk = false; }
finally { srv.kill(); srv2.kill(); srv3.kill(); fakeElk.close(); fakeDbx.close(); fs.rmSync(LOG_DIR, { recursive: true, force: true }); process.exit(allOk ? 0 : 1); }
