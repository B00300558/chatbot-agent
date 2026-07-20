// Test RAG v4 : Gemini, auto-note, erreurs LLM -> non trouve, mode sans IA avec garde-fou.
import http from 'node:http';
import { spawn } from 'node:child_process';
import pw from '/home/claude/.npm-global/lib/node_modules/playwright/index.js';
const { chromium } = pw;

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

// --- Faux Gemini : lit contents[0].parts[0].text, repond au format Gemini. ---
let firstExtraitTitle = null, sawLastUpdate = false, sawSystemPrompt = false;
const fakeGemini = http.createServer((req, res) => {
  let b = ''; req.on('data', c => b += c);
  req.on('end', () => {
    const payload = JSON.parse(b);
    const userMsg = payload.contents?.[0]?.parts?.[0]?.text || '';
    if (payload.system_instruction?.parts?.[0]?.text?.includes('AUTO-NOTE')) sawSystemPrompt = true;
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
    res.end(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(out) }] } }] }));
  });
});
await new Promise(r => fakeGemini.listen(9992, r));

// --- Faux Databricks : format OpenAI chat completions. ---
let dbxSawSystem = false;
const fakeDbx = http.createServer((req, res) => {
  let b = ''; req.on('data', c => b += c);
  req.on('end', () => {
    const payload = JSON.parse(b);
    if ((payload.messages?.[0]?.content || '').includes('AUTO-NOTE')) dbxSawSystem = true;
    const userMsg = payload.messages?.[1]?.content || '';
    const out = /piscine/i.test(userMsg)
      ? { found:false, score:1, answer:"Je n'ai pas trouve cette information dans la FAQ.", sources:[] }
      : { found:true, score:5, answer:"Pour obtenir votre certificat : connectez-vous a **MyESSEC**, rubrique **Scolarite**.", sources:[1] };
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ choices: [{ message: { role:'assistant', content: JSON.stringify(out) } }] }));
  });
});
await new Promise(r => fakeDbx.listen(9993, r));

// --- Serveur 1 : RAG Gemini ---
const srv = spawn('node', ['server.js'], { cwd: process.cwd(), env: { ...process.env,
  ELK_URL:'http://localhost:9990/_search', ELK_API_KEY:'elk',
  GEMINI_URL:'http://localhost:9992', GEMINI_API_KEY:'test-key', GEMINI_MODEL:'gemini-3.5-flash',
  DATABRICKS_URL:'', DATABRICKS_TOKEN:'', ANTHROPIC_API_KEY:'', PORT:'3212', MAX_SOURCES:'3' }, stdio:'inherit' });
// --- Serveur 2 : mode sans IA (aucune cle LLM) ---
const srv2 = spawn('node', ['server.js'], { cwd: process.cwd(), env: { ...process.env,
  ELK_URL:'http://localhost:9990/_search', ELK_API_KEY:'elk',
  DATABRICKS_URL:'', DATABRICKS_TOKEN:'', GEMINI_API_KEY:'', ANTHROPIC_API_KEY:'', PORT:'3213' }, stdio:'ignore' });
// --- Serveur 3 : RAG Databricks (prioritaire) ---
const srv3 = spawn('node', ['server.js'], { cwd: process.cwd(), env: { ...process.env,
  ELK_URL:'http://localhost:9990/_search', ELK_API_KEY:'elk',
  DATABRICKS_URL:'http://localhost:9993/serving-endpoints/databricks-claude-sonnet-4-5/invocations',
  DATABRICKS_TOKEN:'dapi-test', GEMINI_API_KEY:'', ANTHROPIC_API_KEY:'', PORT:'3214' }, stdio:'ignore' });
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
  const dbxHealth = await fetch('http://localhost:3214/api/health').then(r=>r.json());
  const dbxOk = await ask(3214, 'certificat de scolarité');      // via Databricks
  const dbxKo = await ask(3214, 'ou est la piscine ?');
  console.log('[test] health =>', JSON.stringify(health));
  console.log('[test] normale => found=%s score=%s sources=%d', data.found, data.score, data.sources.length);
  console.log('[test] sans IA pertinent =>', JSON.stringify(sOk).slice(0,160));
  console.log('[test] sans IA hors sujet =>', JSON.stringify(sKo).slice(0,160));

  const checks = [
    ['health : provider gemini + bon modele', health.provider === 'gemini' && health.model === 'gemini-3.5-flash'],
    ['prompt systeme (AUTO-NOTE) transmis a Gemini', sawSystemPrompt],
    ['re-ranking : titre/gras remonte "Certificat de scolarité" en 1er', firstExtraitTitle === 'Certificat de scolarité'],
    ['"Last update" retire des extraits envoyes au LLM', sawLastUpdate === false],
    ['AU PLUS 3 sources affichees', data.sources.length === 3],
    ['reponse valide : found=true, score=5', data.found === true && data.score === 5],
    ['cas non trouve : found=false, 0 source', nf.found === false && nf.sources.length === 0],
    ['auto-note < 3 : refusee, 0 source', low.found === false && low.sources.length === 0],
    ['erreur API LLM : "non trouve" (jamais de synthese brute)', err5.found === false && err5.mode === 'error' && err5.sources.length === 0],
    ['sans IA + article pertinent : repond', sOk.found === true && sOk.mode === 'synthese' && sOk.sources.length > 0],
    ['sans IA + hors sujet : "non trouve"', sKo.found === false && sKo.mode === 'synthese' && sKo.sources.length === 0],
    ['databricks : provider + modele detectes', dbxHealth.provider === 'databricks' && dbxHealth.model === 'databricks-claude-sonnet-4-5'],
    ['databricks : prompt systeme transmis', dbxSawSystem],
    ['databricks : reponse valide', dbxOk.found === true && dbxOk.score === 5 && dbxOk.sources.length === 1],
    ['databricks : non trouve honnete', dbxKo.found === false && dbxKo.sources.length === 0]
  ];
  console.log('\n[test] Verifications :');
  for (const [n, ok] of checks) { console.log(`   ${ok ? '✅' : '❌'} ${n}`); if (!ok) allOk = false; }

  // Capture UI rapide (reponse normale)
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const page = await browser.newPage({ viewport: { width: 900, height: 1050 }, deviceScaleFactor: 2 });
  await page.goto('http://localhost:3212'); await page.waitForTimeout(500);
  await page.fill('#q', 'Comment obtenir mon certificat de scolarité ?');
  await page.click('#send');
  await page.waitForSelector('.answer-card', { timeout: 6000 });
  await page.waitForTimeout(600);
  await page.screenshot({ path: 'apercu-reponse.png', fullPage: true });
  await browser.close();

  console.log(allOk ? '\n=== TOUS LES TESTS PASSENT ===' : '\n=== ECHEC ===');
} catch (e) { console.error('[test] ERREUR', e); allOk = false; }
finally { srv.kill(); srv2.kill(); srv3.kill(); fakeElk.close(); fakeGemini.close(); fakeDbx.close(); process.exit(allOk ? 0 : 1); }
