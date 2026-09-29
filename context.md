# Contexte — Assistant FAQ ESSEC (résumé de la conversation)

> Ce fichier résume le travail réalisé dans la conversation, pour pouvoir
> reprendre le projet plus tard (ou dans une autre session) sans tout relire.
> Aucun fichier de **code** n'a été modifié durant cette conversation ; seuls des
> documents de **documentation** ont été créés.

## Le projet

**Assistant FAQ ESSEC** — dépôt `chatbot-agent`, situé sur le Mac de l'utilisateur
dans `~/Documents/github/chatbot-agent` (remote Git : `git@github.com:B00300558/chatbot-agent.git`,
branche `main`).

Application web : un étudiant pose une question, l'application interroge la FAQ
officielle ESSEC (Elasticsearch, index `myessec_faq`), reclasse les articles, fait
rédiger une réponse par une IA **uniquement** à partir des extraits trouvés, puis
affiche la réponse + jusqu'à 3 liens sources. Si rien de pertinent, elle répond
« Information non trouvée » plutôt que d'inventer.

Pile technique : Node.js ≥ 18 **sans dépendance** (modules natifs), frontend
HTML/CSS/JS (charte ESSEC, Roboto), Docker + Docker Compose, tests avec Playwright.

## État réel du code (constaté)

- Le code sur disque est la version **multi-fournisseurs** d'IA, avec priorité
  **Databricks → Gemini → Anthropic** (fichier `server.js`).
- `MAX_SOURCES=3` et `SCORE_MIN=3` sont présents et conformes.
- Arbre de travail Git **propre**, à jour avec `origin/main`. Les documents créés
  ci-dessous apparaissent comme fichiers non suivis (`??`).
- Un verrou `.git/index.lock` traînait (opération Git interrompue) ; la suppression
  n'est pas autorisée depuis cette session — à retirer manuellement si besoin.

## Ce que l'utilisateur a demandé (fil de la conversation)

1. **Explorer le projet** et générer trois documents en français, lisibles par un
   non-codeur : `spec.md`, `ARCHITECTURE.md`, `tasks.md`. Ne pas modifier le code ;
   signaler ce qui n'a pas pu être déterminé.
2. **Distinguer** clairement, dans les documents, les demandes de l'utilisateur de
   mes propres recommandations.
3. **Ajouter un visuel** des technologies en tête de `ARCHITECTURE.md`.
4. **Convertir** les documents en **`.docx`**.
5. **Séparer les spécifications** en deux catégories : celles issues des demandes
   de l'utilisateur, et celles que j'ai déduites comme nécessaires.
6. Structurer tout cela, ne jamais mélanger les deux catégories, et ajouter un
   **tableau récapitulatif** (colonnes : Spécification, Catégorie, Type, Priorité,
   Justification).
7. Reprendre la **formulation et la structure du premier `spec.md`** (scénarios
   « étant donné / quand / alors ») comme modèle, appliqué au spec en deux
   catégories.
8. **Créer ce `context.md`** résumant la conversation.

## Demandes fonctionnelles exprimées par l'utilisateur (specs « Catégorie 1 »)

- **D1** — Fournisseur d'IA **unique : Databricks** (retirer Gemini et Anthropic).
  → ✔️ **Réalisé le 29/09/2026** (voir mise à jour en fin de fichier).
- **D2** — **Bouton** affichant la disponibilité de l'API Databricks.
  → ✔️ **Réalisé le 29/09/2026** (`/api/llm-status` + bouton dans l'en-tête).
- **D3** — Maximum **3 articles** affichés, 0 si rien de pertinent (`MAX_SOURCES=3`).
  → ✔️ présent.
- **D4** — Note minimale **3** que le LLM doit s'attribuer (`SCORE_MIN=3`).
  → ✔️ présent.
- **D5** — Endpoint **Databricks** (Claude Sonnet 4.5), jeton côté serveur, avec
  **repli sur la synthèse sans IA** si rien n'est configuré. → ✔️ présent.
- Remarque : l'utilisateur a précisé que le token Databricks partagé est **un faux
  token**.

## Documents produits (livrés et déposés dans le projet)

Tous en français, en `.md` et `.docx` :

- **`spec.md` / `spec.docx`** — spécifications. Version finale : format
  « scénarios » du premier fichier, réorganisé en **deux catégories** (D1–D5 =
  demandes utilisateur ; R1–R23 = déductions/recommandations), avec un **tableau
  récapitulatif** (page paysage, code couleur bleu = demande, gris = reco).
- **`ARCHITECTURE.md` / `ARCHITECTURE.docx`** — architecture. Débute par un
  **visuel des technologies** (`tech-stack.svg`, intégré en image dans le `.docx`).
  Contient : entrée, données et contexte, modèle et outils, sortie, validation
  humaine, puis chaque fichier et ce qu'il décide. Encadré de recommandations en
  fin de document.
- **`tasks.md` / `tasks.docx`** — briques faites / en cours / à venir, chaque
  piste « à venir » étiquetée par provenance (projet vs recommandation Claude).
- **`tech-stack.svg`** — visuel des technologies (et `tech-stack.png` généré pour
  l'intégration Word).

Convention de séparation appliquée partout : légende « Comment lire ce document »,
et encadrés « 💡 Recommandations de Claude (non demandées) » nettement distincts du
contenu factuel.

## Incohérences relevées dans le projet (mes constats)

- **`README.md`** décrit encore une version « Anthropic uniquement » — en retard
  sur le code (qui gère Databricks/Gemini/Anthropic).
- **`docker-compose.yml`** ne transmet que les variables `ANTHROPIC_*` : en Docker,
  l'app **n'utiliserait pas Databricks**.
- Modèle Anthropic par défaut incohérent : `claude-sonnet-5` (code) vs
  `claude-3-5-haiku-latest` (Docker).
- Le parcours Anthropic n'est pas couvert par les tests.

## Ce qui n'a pas pu être déterminé

- Validité des vrais accès (Elasticsearch, Databricks) — non testable ici.
- Structure réelle de l'index FAQ — déduite du code.
- Existence réelle des modèles `gemini-3.5-flash` et `claude-sonnet-5`.
- Le cahier des charges initial de l'utilisateur (non fourni) : le partage
  Catégorie 1 / Catégorie 2 se fonde uniquement sur les messages de cette
  conversation.

## Pistes / prochaines étapes possibles

- **Combler les écarts D1 et D2** dans le code : retirer Gemini et Anthropic, et
  ajouter le bouton de disponibilité de l'API Databricks (relié à un contrôle
  `/api/llm-status` ou équivalent).
- **Aligner la documentation** (`README.md`, `docker-compose.yml`, `.env.example`)
  sur le code (priorité Databricks).
- Homogénéiser `ARCHITECTURE` et `tasks` sur le style « scénarios » du spec.
- Pousser les documents (et d'éventuelles corrections) sur GitHub — via le
  navigateur, faute de connecteur GitHub (pushes non effectués à ce jour).

## Mise à jour du 29/09/2026 — D1, D2 et alignement réalisés

- Les 3 commits (documentation, journal d'audit, correctif Docker) ont été
  **poussés** sur `origin/main` (clé SSH `~/Documents/cle ssh /oussalouh`,
  chargée dans le trousseau macOS).
- **D1 réalisé** : Gemini et Anthropic retirés de `server.js` ; Databricks est
  le seul fournisseur, avec repli sur la synthèse sans IA.
- **D2 réalisé** : bouton dans l'en-tête de `public/index.html`, relié au nouvel
  endpoint `GET /api/llm-status` (vrai appel Databricks d'1 jeton, délai 8 s,
  résultat gardé 30 s, journalisé ; le token n'est jamais renvoyé).
- **R17 réalisé** : `docker-compose.yml` transmet `DATABRICKS_URL`,
  `DATABRICKS_TOKEN`, `SCORE_MIN`, `SYNTH_MIN_COVERAGE` ; `README.md` réécrit.
- **Tests** : `test-rag.mjs` réécrit sur le faux Databricks (18 vérifications,
  toutes au vert) ; Playwright devient facultatif (absent sur le Mac).
- Les `.docx` n'ont **pas** été régénérés (choix de l'utilisateur).
- Reste ouvert : page d'administration du journal (nécessite une protection
  d'accès), validation sur le vrai endpoint Databricks.
