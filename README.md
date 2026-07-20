# Assistant FAQ ESSEC

Application web qui permet aux étudiants de poser une question et d'obtenir une
**réponse rédigée** (par Claude, l'IA d'Anthropic) à partir de la FAQ officielle
ESSEC indexée dans Elasticsearch (index `myessec_faq`), suivie des **liens vers
les articles correspondants**.

- **Backend** : Node.js natif, **zéro dépendance** (aucun `npm install`), Node ≥ 18.
- **Frontend** : une page HTML/CSS/JS autonome (`public/index.html`), interface de type chat, en français, **aux couleurs de la charte ESSEC** (bleu `#1da1e0`, typographie Roboto, logo écusson).
- **RAG fidèle** : après la recherche Elasticsearch, Claude rédige une réponse ancrée **uniquement** dans les articles trouvés, en répondant à l'**intention exacte** de la question. Si les extraits traitent d'un sujet proche mais ne répondent pas précisément à ce qui est demandé (ex. un « comment » sans la procédure), l'app affiche « Information non trouvée » plutôt que de répondre à côté. Elle n'invente jamais.
- **Identité visuelle officielle** : header aux couleurs ESSEC (bleu `#1da1e0`) avec le **vrai logo ESSEC** (SVG vectoriel officiel récupéré depuis essec.edu), typographie Roboto.
- **Recherche pondérée** : re-ranking côté serveur donnant plus de poids au **titre** et aux **passages en gras** (`<strong>`) des articles.
- **Sources limitées** : au maximum **3 articles** affichés (moins, voire aucun si rien de pertinent).
- **Sécurité** : les clés API (Elasticsearch **et** Anthropic) restent **côté serveur**, jamais exposées au navigateur.

## Architecture

```
Navigateur (étudiant)
      │  POST /api/ask { question }
      ▼
server.js
   ├─ 1. Elasticsearch  myessec_faq/_search   (title^3, content, fuzzy)
   │        ◄── candidats FAQ ──
   ├─ 2. Re-ranking  (bonus TITRE + GRAS, nettoyage "Last update")
   ├─ 3. Claude (API Anthropic)  ── rédige une réponse ancrée dans les articles
   │        + choisit les sources réellement pertinentes (≤ 3, ou 0)
   │        ◄── {found, answer, sources} ──
   ▼
Interface :  RÉPONSE construite  +  ARTICLES CORRESPONDANTS (≤ 3 liens)
```

Si aucune clé Anthropic n'est configurée, l'application bascule automatiquement
sur une **synthèse sans IA** (le meilleur extrait, nettoyé) : elle reste
fonctionnelle sans dépendance externe.

## Lancer en local (Node, le plus simple)

1. Créer le fichier `.env` et y renseigner les clés :

   ```bash
   cp .env.example .env
   # éditer .env : ELK_API_KEY (obligatoire) et ANTHROPIC_API_KEY (pour le RAG)
   ```

2. Démarrer :

   ```bash
   npm start        # ou : node server.js
   ```

3. Ouvrir http://localhost:3000

> Test sans les vraies API : `node test-rag.mjs` lance un faux Elasticsearch et
> un faux Anthropic, valide toute la chaîne et génère des captures d'écran.

## Déployer avec Docker

```bash
cp .env.example .env      # renseigner les clés
docker compose up --build -d
```

Puis http://localhost:3000 — pour arrêter : `docker compose down`.

> Sans Compose : `docker build -t essec-faq . && docker run -p 3000:3000 --env-file .env essec-faq`

## Configuration (.env)

| Variable            | Rôle                                                       | Défaut |
|---------------------|------------------------------------------------------------|--------|
| `ELK_URL`           | Endpoint `_search` de l'index FAQ                          | `…/myessec_faq/_search` |
| `ELK_API_KEY`       | Clé API Elasticsearch (**secrète, côté serveur**)         | — |
| `ELK_INSECURE`      | `true` si certificat TLS auto-signé côté ELK               | `false` |
| `CANDIDATES`        | Nombre de candidats récupérés dans ES avant re-ranking     | `10` |
| `MAX_SOURCES`       | Nombre d'articles affichés au maximum (0 si rien de pertinent) | `3` |
| `ANTHROPIC_API_KEY` | Clé API Anthropic pour la réponse rédigée. Vide = sans IA. | — |
| `ANTHROPIC_MODEL`   | Modèle Claude. **Un modèle Sonnet améliore nettement la fidélité** (meilleur jugement « puis-je répondre ou non »). | `claude-3-5-haiku-latest` |
| `RAG_ENABLED`       | `false` force le mode sans IA même si une clé est présente | `true` |
| `PORT`              | Port du serveur web                                        | `3000` |

## Conformité à la charte graphique ESSEC

L'interface applique la charte digitale : couleur principale bleu `#1da1e0`,
secondaires (bleu foncé `#3b57a1`…), typographie **Roboto**, logo **noir en haut
à gauche**, tagline « Enlighten. Lead. Change. ».

> Le logo affiché est le **logo officiel ESSEC** (SVG vectoriel récupéré depuis essec.edu),
> en blanc sur le header bleu ESSEC.

## Sécurité — avant la mise en production

- **Régénérer** la clé Elasticsearch partagée en clair pendant le développement ; ne la mettre que dans `.env` (déjà dans `.gitignore`, jamais sur Git).
- Restreindre la clé Elasticsearch en **lecture seule** sur l'index FAQ.
- Surveiller la consommation de l'API Anthropic (le RAG appelle Claude à chaque question) ; envisager un cache des réponses fréquentes et une **limitation de débit** sur `/api/ask`.
- Servir en HTTPS, et si besoin placer l'app derrière le **SSO ESSEC** pour la réserver aux étudiants.

## Données & RGPD

Le mode RAG envoie la question de l'étudiant et les extraits FAQ pertinents à
l'API Anthropic. Vérifiez que cet usage est conforme à votre politique de
traitement des données. Le mode « sans IA » (sans clé Anthropic) garde en
revanche tout le traitement en interne.

## Aller plus loin

- **Recherche élargie** : l'alias `formation` regroupe `syllabus`, `myessec_faq` et `agenda` ; changer l'index dans `ELK_URL` permet de chercher au-delà de la FAQ.
- **Streaming** de la réponse (affichage au fil de l'eau) pour une meilleure réactivité perçue.
- **Historique de conversation** pour des questions de suivi.
