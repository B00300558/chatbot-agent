// =============================================================
//  Journal d'audit  -  Assistant FAQ ESSEC
// -------------------------------------------------------------
//  ZERO DEPENDANCE : uniquement les modules natifs de Node.js.
//
//  Enregistre dans logs/journal.log (une ligne JSON par evenement) :
//   - action_utilisateur : qui a fait quoi (question posee, visite
//     de page, consultation d'etat), avec identifiant de session + IP
//   - modification_code  : tout changement des fichiers du code
//     detecte au demarrage (empreinte SHA-256), avec le dernier
//     commit Git si disponible
//   - connexion_interface : chaque connexion aux interfaces externes
//     (elasticsearch, databricks) et son etat
//     (ok / erreur / timeout), statut HTTP et duree
//   - demarrage_serveur  : chaque demarrage de l'application
//
//  Format : NDJSON (une ligne = un evenement JSON), lisible avec
//  n'importe quel outil (tail -f, jq, import tableur...).
// =============================================================

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LOG_DIR = path.join(__dirname, 'logs');
const LOG_FILE = path.join(LOG_DIR, 'journal.log');
const STATE_FILE = path.join(LOG_DIR, 'code-state.json');

try { fs.mkdirSync(LOG_DIR, { recursive: true }); } catch { /* ignore */ }

// ---- Ecriture d'un evenement (une ligne JSON, ajoutee en fin de fichier) ----
function write(event) {
  const line = JSON.stringify({ horodatage: new Date().toISOString(), ...event });
  try {
    fs.appendFileSync(LOG_FILE, line + '\n');
  } catch (err) {
    // Le journal ne doit jamais faire tomber l'application.
    console.error('[journal] Ecriture impossible :', err?.message);
  }
}

// -------------------------------------------------------------
//  1) Actions des utilisateurs (qui a fait quoi ?)
// -------------------------------------------------------------
//  ctx = { uid, ip } fourni par server.js (cookie de session + adresse IP).
export function logAction(ctx, action, details = {}) {
  write({
    type: 'action_utilisateur',
    utilisateur: { id: ctx?.uid || null, ip: ctx?.ip || null },
    action,
    ...details
  });
}

// -------------------------------------------------------------
//  2) Connexions aux interfaces externes et leur etat
// -------------------------------------------------------------
export function logConnection(cible, etat, details = {}) {
  write({ type: 'connexion_interface', cible, etat, ...details });
}

//  Remplacant de fetch() qui journalise chaque connexion :
//  cible = 'elasticsearch' | 'databricks'
//  etat  = 'ok' (2xx) | 'erreur' (statut HTTP != 2xx ou erreur reseau) | 'timeout'
export async function loggedFetch(cible, url, options) {
  const t0 = Date.now();
  try {
    const res = await fetch(url, options);
    logConnection(cible, res.ok ? 'ok' : 'erreur', { statutHttp: res.status, dureeMs: Date.now() - t0 });
    return res;
  } catch (err) {
    const etat = err?.name === 'AbortError' ? 'timeout' : 'erreur';
    logConnection(cible, etat, { message: err?.message || String(err), dureeMs: Date.now() - t0 });
    throw err;
  }
}

// -------------------------------------------------------------
//  3) Modifications apportees au code de l'application
// -------------------------------------------------------------
//  A chaque demarrage : empreinte SHA-256 de chaque fichier du code,
//  comparaison avec l'etat precedent (logs/code-state.json), et
//  journalisation des fichiers ajoutes / modifies / supprimes.
//  Le dernier commit Git (auteur, date, message) est joint si possible.

const CODE_ROOT_FILES = ['server.js', 'journal.js', 'package.json', 'Dockerfile', 'docker-compose.yml', 'test-rag.mjs', '.env.example'];

function listCodeFiles() {
  const files = [];
  for (const f of CODE_ROOT_FILES) if (fs.existsSync(path.join(__dirname, f))) files.push(f);
  const pub = path.join(__dirname, 'public');
  try {
    for (const f of fs.readdirSync(pub)) {
      if (fs.statSync(path.join(pub, f)).isFile()) files.push(path.posix.join('public', f));
    }
  } catch { /* pas de dossier public */ }
  return files;
}

function hashFile(rel) {
  const buf = fs.readFileSync(path.join(__dirname, rel));
  return crypto.createHash('sha256').update(buf).digest('hex').slice(0, 16);
}

function gitInfo() {
  try {
    const out = execSync('git log -1 --format=%h|%an|%aI|%s', {
      cwd: __dirname, stdio: ['ignore', 'pipe', 'ignore'], timeout: 3000
    }).toString().trim();
    const [commit, auteur, date, ...msg] = out.split('|');
    return { commit, auteur, date, message: msg.join('|') };
  } catch {
    return null; // pas de Git disponible (ex : conteneur Docker sans .git)
  }
}

export function checkCodeChanges() {
  const etatActuel = {};
  for (const f of listCodeFiles()) {
    try { etatActuel[f] = hashFile(f); } catch { /* fichier illisible : ignore */ }
  }

  let precedent = null;
  try { precedent = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); } catch { /* premier demarrage */ }

  const git = gitInfo();

  if (precedent && typeof precedent === 'object') {
    const modifies = [], ajoutes = [], supprimes = [];
    for (const [f, h] of Object.entries(etatActuel)) {
      if (!(f in precedent)) ajoutes.push(f);
      else if (precedent[f] !== h) modifies.push(f);
    }
    for (const f of Object.keys(precedent)) if (!(f in etatActuel)) supprimes.push(f);
    if (modifies.length || ajoutes.length || supprimes.length) {
      write({ type: 'modification_code', fichiersModifies: modifies, fichiersAjoutes: ajoutes, fichiersSupprimes: supprimes, git });
    }
  }

  try { fs.writeFileSync(STATE_FILE, JSON.stringify(etatActuel, null, 2)); } catch { /* ignore */ }
  return { git, nbFichiersSuivis: Object.keys(etatActuel).length };
}

// -------------------------------------------------------------
//  4) Demarrage du serveur
// -------------------------------------------------------------
export function logServerStart(details = {}) {
  write({ type: 'demarrage_serveur', ...details });
}

export const JOURNAL_FILE = LOG_FILE;
