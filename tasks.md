# Tâches — Assistant FAQ ESSEC

> État des « briques » du projet, en langage courant : ce qui est **fait**, ce
> qui est **en cours**, et ce qui reste **à venir**. Établi à partir du code
> réellement présent (branche `main`, arbre de travail propre, à jour avec le
> dépôt distant `origin/main`).

> **Comment lire ce document**
> - **✅ Faites** et **🟡 En cours** décrivent l'état factuel du code (demandé).
> - Dans **🔴 À venir**, chaque piste est étiquetée par sa **provenance** :
>   - *(source : projet)* = idée déjà écrite dans le projet (notice `README.md`) ;
>   - *(💡 Claude)* = **ma recommandation personnelle, non demandée**.
> - La section **« Ce que je n'ai pas pu déterminer »** répond à votre consigne
>   « signale ce que tu n'as pas pu déterminer ».

## ✅ Briques faites

- **Recherche dans la FAQ** : interrogation d'Elasticsearch avec priorité au
  titre et tolérance aux fautes de frappe.
- **Reclassement « maison »** : réordonnancement des résultats en faveur des
  articles dont le titre et les passages en gras collent à la question.
- **Nettoyage des articles** : suppression des balises HTML, décodage des
  accents et symboles, retrait de la mention « Last update ».
- **Réponse rédigée par IA (RAG)** : l'IA rédige à partir des seuls extraits
  fournis, choisit les articles à citer et s'auto-évalue.
- **Fournisseur d'IA unique : Databricks** (endpoint interne ESSEC, Claude
  Sonnet 4.5) — Gemini et Anthropic retirés du code (demande D1).
- **Bouton de disponibilité de l'API Databricks** dans l'en-tête (vert /
  rouge / gris), relié à `/api/llm-status` qui fait un vrai appel de test
  d'1 jeton, gardé en cache 30 s (demande D2).
- **Journal d'audit** (`logs/journal.log`) : actions des utilisateurs,
  connexions aux interfaces externes, modifications du code, démarrages.
- **Garde-fous de fiabilité** : réponse écartée si l'auto-note est < 3, si aucune
  source n'est citée, ou en cas de panne de l'IA (jamais de réponse inventée).
- **Mode sans IA (repli)** : synthèse à partir du meilleur article, avec un
  seuil minimal de pertinence, quand aucune IA n'est configurée.
- **Limite du nombre de sources** : au plus 3 articles affichés, 0 si rien de
  pertinent (réglable).
- **Gestion des erreurs et des cas limites** : question vide, question trop longue
  (> 500 caractères), base injoignable, délai dépassé, serveur non configuré.
- **Interface web complète** aux couleurs ESSEC : champ de question, suggestions
  cliquables, animation de chargement, mise en forme des listes et du gras,
  affichage des sources, messages d'erreur, logo officiel, adaptation mobile.
- **Point de contrôle de santé** `/api/health` (utile pour la supervision et
  Docker).
- **Sécurité des clés** : toutes les clés restent côté serveur ; le fichier
  `.env` est exclu de Git.
- **Banc d'essai automatisé** (`test-rag.mjs`) : valide la chaîne complète avec
  de faux services (Elasticsearch, Databricks) et des questions pièges, y
  compris les trois états du bouton de disponibilité.
- **Empaquetage Docker** : `Dockerfile` + `docker-compose.yml` (transmet
  `DATABRICKS_URL` / `DATABRICKS_TOKEN`) + vérification de santé intégrée +
  journal persisté dans `./logs`.
- **Zéro dépendance externe** : fonctionne avec Node.js seul (≥ 18).

## 🟡 En cours / partiel

*(État factuel : la brique existe mais n'est pas complètement aboutie.)*

- **Validation sur les vrais accès** : la chaîne Databricks est testée avec de
  faux services ; reste à la valider avec le vrai endpoint et un vrai token.

## 🔴 À venir

*(Chaque ligne indique sa provenance : idée déjà présente dans le projet, ou
recommandation de ma part.)*

### Fonctionnalités et améliorations
- **Page d'administration du journal d'audit** *(source : recommandation
  Claude)* : consulter `logs/journal.log` depuis l'interface — nécessite d'abord
  une protection d'accès (le journal contient des adresses IP).
- **Authentification / SSO ESSEC** *(source : projet, `README.md`)* : réserver
  l'accès aux étudiants.
- **Historique de conversation** *(source : projet, `README.md`)* : permettre des
  questions de suivi.
- **Affichage progressif (streaming)** de la réponse *(source : projet,
  `README.md`)*.
- **Cache des réponses fréquentes** et **limitation de débit** sur `/api/ask`
  *(source : projet, `README.md`)*.
- **Recherche élargie** au-delà du seul index `myessec_faq` (syllabus, agenda…)
  *(source : projet, `README.md`)*.

### Sécurité avant mise en production
*(source : projet, section « Sécurité » du `README.md`)*
- **Régénérer / restreindre** la clé Elasticsearch (lecture seule sur l'index
  FAQ).
- **Servir en HTTPS** et surveiller la consommation de l'API d'IA.
- **Vérifier la conformité RGPD** : en mode IA, la question et les extraits sont
  envoyés à un service externe (sauf via l'endpoint interne Databricks). Le mode
  sans IA garde tout en interne.

---

> ## 💡 Recommandations de Claude (non demandées)
>
> *Cette section n'a pas été demandée. Ce sont les **corrections que je suggère**
> après avoir relevé des incohérences entre le code et sa documentation (détail
> factuel dans l'encadré équivalent de `ARCHITECTURE.md`). À prendre ou à
> laisser ; aucune ne touche au moteur de l'application.*
>
> - ✔️ *Fait* — **`README.md`** mis à jour (Databricks seul, `SCORE_MIN`,
>   `SYNTH_MIN_COVERAGE`, `/api/llm-status`, journal d'audit).
> - ✔️ *Fait* — **`docker-compose.yml`** transmet `DATABRICKS_URL`,
>   `DATABRICKS_TOKEN`, `SCORE_MIN` et `SYNTH_MIN_COVERAGE`.
> - *Sans objet* — modèle Anthropic par défaut et test du parcours Anthropic :
>   Anthropic et Gemini ont été retirés (D1).
> - **Définir une durée de conservation** du journal d'audit (IP + questions
>   posées : données personnelles au sens du RGPD).

---

## Ce que je n'ai pas pu déterminer

*(Section demandée : « signale ce que tu n'as pas pu déterminer ». Limites de
l'exploration, pas des recommandations.)*

- Impossible de confirmer, depuis le code seul, que les **vrais accès**
  (Elasticsearch, Databricks) sont valides et opérationnels.
- La **structure réelle de l'index FAQ** est supposée d'après le code, non
  vérifiée contre la vraie base.
- L'**historique Git** n'a pas été audité en profondeur pour d'éventuels secrets
  commis par le passé ; le fichier `.env.example` actuel ne contient que des
  valeurs d'exemple à remplacer.
