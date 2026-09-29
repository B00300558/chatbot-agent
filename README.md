# Assistant FAQ ESSEC

Application web qui permet aux étudiants de poser une question et d'obtenir une
**réponse rédigée** (par Claude Sonnet 4.5, servi par l'endpoint **Databricks** interne ESSEC) à partir de la FAQ officielle
ESSEC indexée dans Elasticsearch (index `myessec_faq`), suivie des **liens vers
les articles correspondants**.

- **Backend** : Node.js natif, **zéro dépendance** (aucun `npm install`), Node ≥ 18.
- **Frontend** : une page HTML/CSS/JS autonome (`public/index.html`), interface de type chat, en français, **aux couleurs de la charte ESSEC** (bleu `#1da1e0`, typographie Roboto, logo écusson).
- **RAG fidèle** : après la recherche Elasticsearch, le LLM Databricks rédige une réponse ancrée **uniquement** dans les articles trouvés, en répondant à l'**intention exacte** de la question. Si les extraits traitent d'un sujet proche mais ne répondent pas précisément à ce qui est demandé (ex. un « comment » sans la procédure), l'app affiche « Information non trouvée » plutôt que de répondre à côté. Elle n'invente jamais.
- **Identité visuelle officielle** : header aux couleurs ESSEC (bleu `#1da1e0`) avec le **vrai logo ESSEC** (SVG vectoriel officiel récupéré depuis essec.edu), typographie Roboto.
- **Recherche pondérée** : re-ranking côté serveur donnant plus de poids au **titre** et aux **passages en gras** (`<strong>`) des articles.
- **Sources limitées** : au maximum **3 articles** affichés (moins, voire aucun si rien de pertinent).
- **Garde-fou de qualité** : le LLM s'attribue une note de 1 à 5 ; la réponse n'est affichée que si la note est ≥ `SCORE_MIN` (3).
- **Disponibilité de l'IA visible** : un bouton dans l'en-tête indique si l'API Databricks répond (vert = disponible, rouge = indisponible, gris = non configurée) ; cliquer relance la vérification.
- **Journal d'audit** : `logs/journal.log` trace les actions des utilisateurs, les connexions aux interfaces externes et les modifications du code.
- **Sécurité** : les secrets (clé Elasticsearch **et** token Databricks) restent **côté serveur**, jamais exposés au navigateur.

## Architecture

```
Navigateur (étudiant)
      │  POST /api/ask { question }
      ▼
server.js
   ├─ 1. Elasticsearch  myessec_faq/_search   (title^3, content, fuzzy)
   │        ◄── candidats FAQ ──
   ├─ 2. Re-ranking  (bonus TITRE + GRAS, nettoyage "Last update")
   ├─ 3. Databricks (Claude Sonnet 4.5)  ── rédige une réponse ancrée dans les articles
   │        + s'auto-note (1-5) + choisit les sources pertinentes (≤ 3, ou 0)
   │        ◄── {found, score, answer, sources} ──
   ▼
Interface :  RÉPONSE construite  +  ARTICLES CORRESPONDANTS (≤ 3 liens)
```

Si `DATABRICKS_URL` ou `DATABRICKS_TOKEN` n'est pas configuré, l'application bascule automatiquement
sur une **synthèse sans IA** (le meilleur extrait, nettoyé) : elle reste
fonctionnelle sans dépendance externe.

## Lancer en local (Node, le plus simple)

1. Créer le fichier `.env` et y renseigner les clés :

   ```bash
   cp .env.example .env
   # éditer .env : ELK_API_KEY (obligatoire), DATABRICKS_URL et DATABRICKS_TOKEN (pour le RAG)
   ```

2. Démarrer :

   ```bash
   npm start        # ou : node server.js
   ```

3. Ouvrir http://localhost:3000

> Test sans les vraies API : `node test-rag.mjs` lance un faux Elasticsearch et
> un faux Databricks, valide toute la chaîne (y compris `/api/llm-status`) et,
> si Playwright est installé, génère une capture d'écran.

## Déployer avec Docker

```bash
cp .env.example .env      # renseigner les clés
docker compose up --build -d
```

Puis http://localhost:3000 — pour arrêter : `docker compose down`.
Le journal d'audit est conservé sur la machine hôte dans `./logs/`.

> Sans Compose : `docker build -t essec-faq . && docker run -p 3000:3000 --env-file .env essec-faq`

## Configuration (.env)

| Variable            | Rôle                                                       | Défaut |
|---------------------|------------------------------------------------------------|--------|
| `ELK_URL`           | Endpoint `_search` de l'index FAQ                          | `…/myessec_faq/_search` |
| `ELK_API_KEY`       | Clé API Elasticsearch (**secrète, côté serveur**)         | — |
| `ELK_INSECURE`      | `true` si certificat TLS auto-signé côté ELK               | `false` |
| `CANDIDATES`        | Nombre de candidats récupérés dans ES avant re-ranking     | `10` |
| `MAX_SOURCES`       | Nombre d'articles affichés au maximum (0 si rien de pertinent) | `3` |
| `DATABRICKS_URL`    | Endpoint Databricks `…/serving-endpoints/<nom>/invocations`. Vide = sans IA. | — |
| `DATABRICKS_TOKEN`  | Token d'accès Databricks (**secret, côté serveur**). Vide = sans IA. | — |
| `SCORE_MIN`         | Note minimale (1-5) que le LLM doit s'attribuer pour afficher sa réponse | `3` |
| `SYNTH_MIN_COVERAGE`| Mode sans IA : part minimale (0-1) des mots de la question retrouvés dans l'article | `0.5` |
| `RAG_ENABLED`       | `false` force le mode sans IA même si Databricks est configuré | `true` |
| `LOG_DIR`           | Dossier du journal d'audit | `./logs` |
| `PORT`              | Port du serveur web                                        | `3000` |

## Points d'accès HTTP

| Méthode | Chemin            | Rôle |
|---------|-------------------|------|
| `POST`  | `/api/ask`        | Pose une question `{ "question": "…" }` → réponse + sources |
| `GET`   | `/api/health`     | État du serveur (configuration, fournisseur, modèle, nombre de sources) |
| `POST`  | `/api/track`      | Événement d'interface pour le journal (`clic_source`) |
| `GET`   | `/api/llm-status` | Disponibilité réelle de l'API Databricks (appel de test d'1 jeton, résultat gardé 30 s) : `etat` = `disponible` / `indisponible` / `timeout` / `non_configure` |

## Journal d'audit

Chaque événement est ajouté en une ligne JSON dans `logs/journal.log`
(dossier exclu de Git, partagé avec le conteneur Docker) :

| `type` | Contenu |
|---|---|
| `action_utilisateur` | Qui (IP + cookie de session `faq_uid`) a fait quoi : `visite_page`, `question` (texte, `origine` suggestion/saisie, trouvé, note, sources, durée), `clic_source`, `consultation_etat`, `consultation_etat_llm`, `requete_invalide`, `methode_refusee`, `page_introuvable`, `acces_refuse` |
| `connexion_interface` | Chaque appel à Elasticsearch ou Databricks : état (`ok` / `erreur` / `timeout`), statut HTTP, durée |
| `modification_code` | Fichiers modifiés / ajoutés / supprimés depuis le démarrage précédent, avec le dernier commit Git (inscrit dans l'image au build en Docker) |
| `demarrage_serveur` | Chaque démarrage, avec l'`environnement` (`local` ou `docker`) |

Une action et les connexions qu'elle déclenche partagent le même numéro
`requete`. Le healthcheck Docker (en-tête `X-Healthcheck: docker`) n'est pas
journalisé. `LOG_DIR` permet d'écrire le journal ailleurs (utilisé par les tests).

```bash
tail -f logs/journal.log                                   # en direct
jq -c 'select(.action=="question")' logs/journal.log       # questions posées
jq -c 'select(.requete=="<numero>")' logs/journal.log      # une action et ses connexions
```

## Conformité à la charte graphique ESSEC

L'interface applique la charte digitale : couleur principale bleu `#1da1e0`,
secondaires (bleu foncé `#3b57a1`…), typographie **Roboto**, logo **noir en haut
à gauche**, tagline « Enlighten. Lead. Change. ».

> Le logo affiché est le **logo officiel ESSEC** (SVG vectoriel récupéré depuis essec.edu),
> en blanc sur le header bleu ESSEC.

## Sécurité — avant la mise en production

- **Régénérer** la clé Elasticsearch partagée en clair pendant le développement ; ne la mettre que dans `.env` (déjà dans `.gitignore`, jamais sur Git).
- Restreindre la clé Elasticsearch en **lecture seule** sur l'index FAQ.
- Surveiller la consommation de l'endpoint Databricks (le RAG l'appelle à chaque question) ; envisager un cache des réponses fréquentes et une **limitation de débit** sur `/api/ask`.
- Servir en HTTPS, et si besoin placer l'app derrière le **SSO ESSEC** pour la réserver aux étudiants.

## Données & RGPD

Le mode RAG envoie la question de l'étudiant et les extraits FAQ pertinents à
l'endpoint Databricks interne ESSEC. Vérifiez que cet usage est conforme à votre
politique de traitement des données. Le journal d'audit contient des adresses IP
et les questions posées : définir une durée de conservation. Le mode « sans IA »
garde tout le traitement dans l'application.

## Aller plus loin

- **Recherche élargie** : l'alias `formation` regroupe `syllabus`, `myessec_faq` et `agenda` ; changer l'index dans `ELK_URL` permet de chercher au-delà de la FAQ.
- **Streaming** de la réponse (affichage au fil de l'eau) pour une meilleure réactivité perçue.
- **Historique de conversation** pour des questions de suivi.
