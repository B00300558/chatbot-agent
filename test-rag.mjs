// Test RAG v3 : re-ranking, fidelite (found), cap 3 sources, strip "Last update".
import http from 'node:http';
import { spawn } from 'node:child_process';
import pw from '/home/claude/.npm-global/lib/node_modules/playwright/index.js';
const { chromium } = pw;

// --- Faux Elasticsearch : 5 articles, dont un avec "Last update" + gras,
//     et un article "piege" faiblement pertinent. ---
const fakeElk = http.createServer((req, res) => {
  let b = ''; req.on('data', c => b += c);
  req.on('end', () => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ hits: { total: { value: 5 }, hits: [
      // score ES fort mais hors-sujet (piege)
      { _id:'x', _score:12, _source:{ title:'Vie associative sur le campus',
        content:'Last update Les associations etudiantes animent la vie du campus toute l annee.',
        url:'https://my.essec.fr/faq/assos', faq_category:[{label:{fr:'Vie de campus'}}] } },
      // score ES moyen mais TITRE + GRAS contiennent "certificat scolarite" -> doit remonter 1er
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

// --- Faux Anthropic : lit les extraits recus, repond en JSON. ---
let firstExtraitTitle = null, sawLastUpdate = false;
const fakeAnthropic = http.createServer((req, res) => {
  let b = ''; req.on('data', c => b += c);
  req.on('end', () => {
    const payload = JSON.parse(b);
    const userMsg = payload.messages[0].content;
    // On ne capture que pour la requete "certificat" (garde sur la QUESTION, pas les extraits).
    const questionPart = userMsg.split('EXTRAITS')[0];
    if (/certificat/i.test(questionPart)) {
      const m = userMsg.match(/Extrait 1 : (.+)/); if (m) firstExtraitTitle = m[1].split(' [')[0].trim();
      if (/last update/i.test(userMsg)) sawLastUpdate = true; // doit rester false : deja nettoye cote serveur
    }
    const notFound = /piscine|inexistant/i.test(userMsg);
    const body = notFound
      ? { found:false, answer:"Je n'ai pas trouve cette information dans la FAQ. Contactez le service concerne.", sources:[] }
      : { found:true, answer:"Pour obtenir votre certificat de scolarite :\n\n1. Connectez-vous a **MyESSEC**\n2. Ouvrez la rubrique **Scolarite**\n\nLe document est delivre sous 48 heures ouvrees.", sources:[1,2,3,4] };
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ content: [{ type:'text', text: JSON.stringify(body) }] }));
  });
});
await new Promise(r => fakeAnthropic.listen(9991, r));

const srv = spawn('node', ['server.js'], { cwd: process.cwd(), env: { ...process.env,
  ELK_URL:'http://localhost:9990/_search', ELK_API_KEY:'elk',
  ANTHROPIC_URL:'http://localhost:9991/v1/messages', ANTHROPIC_API_KEY:'sk-test',
  PORT:'3212', MAX_SOURCES:'3' }, stdio:'inherit' });
await new Promise(r => setTimeout(r, 800));

let allOk = true;
const ask = (q) => fetch('http://localhost:3212/api/ask', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ question:q }) }).then(r => r.json());
try {
  const data = await ask('certificat de scolarité');
  console.log('\n[test] reponse normale =>\n' + JSON.stringify(data, null, 2));
  const nf = await ask('ou est la piscine ?');
  console.log('\n[test] reponse non trouvee =>\n' + JSON.stringify(nf, null, 2));

  const checks = [
    ['re-ranking : titre/gras remonte "Certificat de scolarité" en 1er', firstExtraitTitle === 'Certificat de scolarité'],
    ['"Last update" retire des extraits envoyes a Claude', sawLastUpdate === false],
    ['"Last update" absent des excerpts affiches', !/last update/i.test(JSON.stringify(data.sources))],
    ['AU PLUS 3 sources affichees', data.sources.length === 3],
    ['found = true', data.found === true],
    ['reponse contient une liste numerotee', /1\.\s/.test(data.answer)],
    ['cas non trouve : found = false', nf.found === false],
    ['cas non trouve : AUCUNE source', Array.isArray(nf.sources) && nf.sources.length === 0],
    ['cas non trouve : message honnete', /pas trouve/i.test(nf.answer)]
  ];
  console.log('\n[test] Verifications :');
  for (const [n, ok] of checks) { console.log(`   ${ok ? '✅' : '❌'} ${n}`); if (!ok) allOk = false; }

  // Verifie que le logo officiel est bien servi
  const logoRes = await fetch('http://localhost:3212/logo-essec.svg');
  checks.push(['logo officiel servi (svg 200)', logoRes.ok && (logoRes.headers.get('content-type')||'').includes('svg')]);
  console.log(`   ${logoRes.ok ? '✅' : '❌'} logo officiel servi (svg 200)`);

  // Capture UI : 1) reponse normale (header bleu + logo)  2) cas non trouve
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const page = await browser.newPage({ viewport: { width: 900, height: 1050 }, deviceScaleFactor: 2 });
  await page.goto('http://localhost:3212'); await page.waitForTimeout(600);
  await page.fill('#q', 'Comment obtenir mon certificat de scolarité ?');
  await page.click('#send');
  await page.waitForSelector('.answer-card', { timeout: 6000 });
  await page.waitForTimeout(700);
  await page.screenshot({ path: 'apercu-reponse.png', fullPage: true });

  await page.fill('#q', 'ou est la piscine ?');
  await page.click('#send');
  await page.waitForSelector('.answer-card.notfound', { timeout: 6000 });
  await page.waitForTimeout(500);
  await page.screenshot({ path: 'apercu-nontrouve.png', fullPage: true });
  await browser.close();

  console.log(allOk ? '\n=== TOUS LES TESTS PASSENT ===' : '\n=== ECHEC ===');
} catch (e) { console.error('[test] ERREUR', e); allOk = false; }
finally { srv.kill(); fakeElk.close(); fakeAnthropic.close(); process.exit(allOk ? 0 : 1); }
