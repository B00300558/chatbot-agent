# Spécifications — Assistant FAQ ESSEC

> Ce document décrit **ce que fait** l'application, en langage courant, sous forme
> de scénarios « étant donné / quand / alors ». Il ne contient pas de code.
> Les spécifications sont réparties en **deux catégories strictement séparées** :
> la **Catégorie 1** regroupe ce qui provient **directement de vos demandes**
> (formulées dans cette conversation) ; la **Catégorie 2** regroupe ce que **j'ai
> proposé ou déduit** comme nécessaire au bon fonctionnement. Les deux ne sont
> jamais mélangées, et un **tableau récapitulatif** figure à la fin.

## En une phrase

Une page web où un étudiant pose une question, et l'application lui renvoie une
**réponse rédigée** à partir de la FAQ officielle ESSEC (indexée dans
Elasticsearch), accompagnée des **liens vers les articles** qui justifient cette
réponse. Si la FAQ ne répond pas vraiment à la question, l'application le dit
plutôt que d'inventer.

## Qui utilise l'application

- **L'étudiant** : pose des questions, lit les réponses et clique sur les
  articles sources. Il n'a rien à installer, juste un navigateur.
- **L'administrateur / l'exploitant** : configure les clés d'accès (Elasticsearch
  et intelligence artificielle) dans un fichier de configuration, puis démarre
  le serveur. Ce rôle n'apparaît pas dans l'interface.

---

# Catégorie 1 — Spécifications issues directement de vos demandes

> Uniquement les besoins que **vous avez explicitement exprimés**, formulés en
> scénarios. Sans complément ni interprétation. Chaque scénario est rattaché à
> la demande correspondante.

### D1. Fournisseur d'intelligence artificielle unique : Databricks

**Étant donné** la configuration du serveur,
**quand** un fournisseur d'IA doit être choisi,
**alors** l'application utilise **uniquement** l'endpoint Databricks interne ESSEC
(Claude Sonnet 4.5) et ne propose **ni Gemini ni Anthropic**.

> Rattachement — votre demande : « je veux garder que databricks et supprime le
> reste ».

### D2. Bouton indiquant la disponibilité de l'API Databricks

**Étant donné** un utilisateur devant l'interface,
**quand** la page est affichée,
**alors** un **bouton** indique si l'API Databricks est disponible.

> Rattachement — votre demande : « affiche moi un bouton qui affiche si le api
> databricks et dispo ».

### D3. Nombre d'articles affichés limité (moins, voire 0 si rien de pertinent)

**Étant donné** une réponse,
**quand** les sources sont affichées,
**alors** l'application n'en montre **jamais plus de 3**, et **aucune** si rien
n'est réellement pertinent.

> Rattachement — votre demande : « MAX_SOURCES=3 » / « Nombre d'articles affichés
> au maximum (moins, voire 0 si rien de pertinent) ».

### D4. Note minimale que le LLM doit s'attribuer

**Étant donné** une réponse produite par le LLM,
**quand** le LLM s'attribue une note de fiabilité de 1 à 5,
**alors** la réponse n'est affichée que si la note est **≥ 3**.

> Rattachement — votre demande : « SCORE_MIN=3 » / « Note minimale (1-5) que le
> LLM doit s'attribuer pour que sa reponse soit affichée ».

### D5. Endpoint Databricks (jeton côté serveur) et repli sans IA

**Étant donné** l'endpoint Databricks (Claude Sonnet 4.5) et son jeton gardé côté
serveur,
**quand** ils sont renseignés, **alors** c'est Databricks qui rédige la réponse ;
**quand** rien n'est renseigné, **alors** l'application bascule sur la **synthèse
sans IA**.

> Rattachement — votre demande : la configuration fournie (DATABRICKS_URL,
> DATABRICKS_TOKEN) et « Si rien n'est renseigné, l'app bascule sur la synthese
> sans IA ».

---

# Catégorie 2 — Spécifications que j'ai proposées ou déduites

> **Aucun de ces éléments ne provient directement de vos demandes.** Je les ai
> **déduits du code existant** ou **recommandés** comme nécessaires au bon
> fonctionnement. Ils sont formulés dans le même style que la Catégorie 1.

### R1. Poser une question et obtenir une réponse sourcée

**Étant donné** un étudiant sur la page d'accueil,
**quand** il saisit une question claire dont la réponse se trouve dans la FAQ et
l'envoie,
**alors** l'application affiche une réponse rédigée en français (2 à 6 phrases,
ou une courte liste pour une procédure) suivie d'un bloc « Articles
correspondants » (nombre limité selon **D3**).

### R2. Reconnaître qu'une question n'a pas de réponse dans la FAQ

**Étant donné** un étudiant,
**quand** il pose une question dont le sujet n'est pas couvert par la FAQ (ou
seulement un sujet proche, sans la vraie réponse),
**alors** l'application affiche « Information non trouvée » avec une invitation à
reformuler ou à contacter le service concerné, et **n'affiche aucun article**.

### R3. Suggestions de questions au démarrage

**Étant donné** un étudiant qui arrive sur la page,
**quand** la page se charge,
**alors** quatre exemples de questions cliquables sont proposés ; cliquer sur
l'un d'eux lance directement la recherche.

### R4. Recherche et classement des articles en faveur des plus pertinents

**Étant donné** une question,
**quand** l'application interroge Elasticsearch (index `myessec_faq`),
**alors** elle récupère plusieurs candidats (10 par défaut) puis les **reclasse**
en donnant plus de poids aux articles dont le **titre** et les **passages en
gras** correspondent aux mots de la question.

### R5. Garde-fou de qualité : l'IA se note elle-même

**Étant donné** une réponse produite par l'IA,
**quand** l'IA s'auto-évalue et cite ses sources,
**alors** la réponse n'est affichée que si la note atteint le seuil défini en
**D4** et si au moins un article est cité ; sinon « Information non trouvée ».
*(Le mécanisme est déduit du code ; la valeur du seuil vient de votre demande D4.)*

### R6. Une panne de l'IA ne produit jamais de réponse non vérifiée

**Étant donné** un fournisseur d'IA configuré,
**quand** l'appel à l'IA échoue (erreur, délai dépassé),
**alors** l'application affiche « Information non trouvée » — elle ne montre
**jamais** un brouillon non relu ni une synthèse brute à la place.

### R7. Une panne de la base FAQ est signalée proprement

**Étant donné** la base de recherche Elasticsearch,
**quand** elle est injoignable ou trop lente (au-delà de 10 secondes),
**alors** l'application affiche un message d'erreur clair, sans planter.

### R8. Questions invalides refusées

**Étant donné** le champ de saisie,
**quand** la question est vide, **alors** rien n'est envoyé ;
**quand** elle dépasse 500 caractères, **alors** le serveur la refuse ;
**quand** la clé Elasticsearch n'est pas configurée, **alors** le serveur répond
que l'application n'est pas configurée.

### R9. Détail du repli sans IA (algorithme)

**Étant donné** le mode sans IA (activé par **D5**),
**quand** aucune IA n'est disponible,
**alors** l'application assemble les phrases de l'article le plus pertinent qui
recoupent la question, avec un **seuil minimal de pertinence** en dessous duquel
elle répond « Information non trouvée ».

### R10. Réponses lisibles et nettoyées

**Étant donné** des articles FAQ stockés en HTML,
**quand** ils sont préparés pour l'affichage et pour l'IA,
**alors** l'application retire les balises HTML, décode les caractères spéciaux
(accents, « € », guillemets…) et **supprime la mention « Last update / Dernière
mise à jour »** en tête des articles.

### R11. Mise en forme de la réponse

**Étant donné** une réponse rédigée,
**quand** elle est affichée,
**alors** les listes (à puces ou numérotées) et les passages en **gras** sont
correctement rendus ; les liens ne sont pas affichés dans le texte (les sources
sont présentées séparément).

### R12. Vérification de l'état du serveur

**Étant donné** un outil de supervision (ou Docker),
**quand** il interroge l'adresse `/api/health`,
**alors** le serveur répond s'il est configuré, quel fournisseur d'IA est actif,
quel modèle est utilisé et combien de sources maximum sont affichées.

### R13. Sécurité des clés

**Étant donné** les clés d'accès (Elasticsearch et IA),
**quand** l'application fonctionne,
**alors** ces clés restent **côté serveur** et ne sont **jamais** envoyées au
navigateur de l'étudiant.

### R14. Identité visuelle ESSEC

**Étant donné** l'interface,
**quand** l'étudiant l'ouvre,
**alors** elle applique la charte ESSEC : bandeau bleu `#1da1e0`, logo officiel
ESSEC, typographie Roboto, tagline « Enlighten. Lead. Change. », et s'adapte au
mobile.

## Recommandations complémentaires (bonnes pratiques, corrections, sécurité)

> Ces points ne se prêtent pas à un scénario d'usage : ce sont des choix
> techniques déjà présents dans le code ou des **recommandations** de ma part
> (certaines reprises de la section « Sécurité » du `README.md`).

- **R15 — Zéro dépendance externe** *(Architecture)* : le serveur n'utilise que
  les modules natifs de Node.js (≥ 18) ; aucun `npm install`.
- **R16 — Délais d'attente maîtrisés** *(Technique)* : 10 s pour Elasticsearch,
  30 s pour l'IA, taille de requête limitée.
- **R17 — Aligner la documentation et le déploiement sur le code** *(Bonnes
  pratiques)* : `README.md`, `docker-compose.yml` et `.env.example` (Docker ne
  transmet pas Databricks aujourd'hui).
- **R18 — Uniformiser et vérifier les modèles** *(Technique)*.
- **R19 — Compléter la couverture de tests** *(Technique)* : ajouter un test du
  parcours Anthropic.
- **R20 — Régénérer et restreindre la clé Elasticsearch** *(Sécurité)*.
- **R21 — Servir l'application en HTTPS** *(Sécurité)*.
- **R22 — Limitation de débit sur `/api/ask`** *(Exploitation)*.
- **R23 — Vérifier la conformité RGPD** *(Sécurité)* : en mode IA, la question et
  les extraits sont envoyés à un service externe (sauf via l'endpoint interne
  Databricks).

---

## Hors périmètre (ce que l'application ne fait pas)

Ces points sont **volontairement absents** du code actuel. Ils sont listés ici
pour éviter les malentendus ; certains sont évoqués comme pistes futures dans
`tasks.md`.

- **Pas d'authentification / pas de SSO ESSEC** : n'importe qui ayant l'adresse
  du site peut poser une question.
- **Pas d'historique ni de questions de suivi** : chaque question est traitée
  isolément.
- **Pas d'affichage progressif (streaming)** : la réponse s'affiche d'un bloc.
- **Pas de cache des réponses** ni de **limitation de débit** (voir R22).
- **Recherche limitée à un seul index** (par défaut `myessec_faq`).
- **Français uniquement** côté rédaction.

---

## Points à vérifier / non déterminés

Éléments que l'exploration du code seul ne permet pas de confirmer :

- **Validité des vrais accès** : impossible de vérifier ici que les vraies URL et
  clés (Elasticsearch, Databricks) fonctionnent.
- **Structure réelle de l'index FAQ** : les champs `title`, `content`, `url` et
  `faq_category` sont déduits du code, pas vérifiés contre la vraie base.
- **Noms de modèles d'IA** : `gemini-3.5-flash` et `claude-sonnet-5` n'ont pas pu
  être vérifiés comme des identifiants réellement existants.
- **Écart entre vos demandes et le code** : D1 (Databricks unique) et D2 (bouton
  de disponibilité) ne sont pas encore présents dans le code actuel.
- **Votre cahier des charges initial** : non disponible ; le partage Catégorie 1
  / Catégorie 2 se fonde uniquement sur vos messages de cette conversation.

---

## Tableau récapitulatif

| Spécification | Catégorie | Type | Priorité estimée | Justification |
|---|---|---|---|---|
| Fournisseur d'IA unique : Databricks (D1) | Demande utilisateur | Technique | Haute | Demandé (« garder que Databricks ») ; actuellement en écart : Gemini/Anthropic encore présents. |
| Bouton de disponibilité de l'API Databricks (D2) | Demande utilisateur | UX | Moyenne | Demandé ; absent du code (visible seulement via `/api/health`). |
| Max 3 articles affichés, 0 si rien (D3) | Demande utilisateur | Fonctionnel | Haute | Demandé (`MAX_SOURCES=3`) ; présent et conforme. |
| Note minimale du LLM = 3 (D4) | Demande utilisateur | Fonctionnel | Haute | Demandé (`SCORE_MIN=3`) ; garde-fou de qualité, présent. |
| Endpoint Databricks + repli sans IA (D5) | Demande utilisateur | Architecture | Critique | Demandé ; cœur de la génération de réponse ; présent. |
| Poser une question / réponse sourcée (R1) | Recommandation IA | Fonctionnel | Critique | Finalité de l'application ; déduit du code. |
| Réponse « non trouvée » honnête (R2) | Recommandation IA | Fonctionnel | Haute | Évite les réponses inventées ; confiance utilisateur. |
| Suggestions au démarrage (R3) | Recommandation IA | UX | Basse | Confort d'usage ; déduit du code. |
| Recherche + reclassement pondéré (R4) | Recommandation IA | Fonctionnel | Critique | Sans recherche, pas de réponse ; déduit du code. |
| Auto-évaluation du modèle (R5) | Recommandation IA | Fonctionnel | Haute | Applique le seuil D4 ; mécanisme déduit du code. |
| Aucune réponse non vérifiée si panne IA (R6) | Recommandation IA | Sécurité | Haute | Fiabilité : jamais de contenu non sourcé. |
| Panne base FAQ gérée proprement (R7) | Recommandation IA | Exploitation | Moyenne | Robustesse ; pas de plantage. |
| Refus des questions invalides (R8) | Recommandation IA | Technique | Moyenne | Robustesse des entrées ; déduit du code. |
| Algorithme du repli sans IA (R9) | Recommandation IA | Technique | Moyenne | Fonctionne sans service d'IA ; déduit du code. |
| Nettoyage HTML + « Last update » (R10) | Recommandation IA | Technique | Moyenne | Lisibilité des extraits ; déduit du code. |
| Mise en forme de la réponse (R11) | Recommandation IA | UX | Basse | Lisibilité ; déduit du code. |
| Point `/api/health` (R12) | Recommandation IA | Exploitation | Moyenne | Supervision / Docker ; déduit du code. |
| Clés gardées côté serveur (R13) | Recommandation IA | Sécurité | Critique | Ne jamais exposer les clés au navigateur. |
| Identité visuelle ESSEC (R14) | Recommandation IA | UX | Moyenne | Cohérence de marque ; déduit du code. |
| Zéro dépendance (Node natif) (R15) | Recommandation IA | Architecture | Moyenne | Déploiement simplifié ; choix du code. |
| Délais d'attente maîtrisés (R16) | Recommandation IA | Technique | Moyenne | Évite les blocages ; déduit du code. |
| Aligner README/docker-compose/.env (R17) | Recommandation IA | Bonnes pratiques | Haute | Docker ne transmet pas Databricks → risque de mauvaise config. |
| Uniformiser / vérifier les modèles (R18) | Recommandation IA | Technique | Moyenne | Valeurs par défaut incohérentes ; noms à valider. |
| Test du parcours Anthropic (R19) | Recommandation IA | Technique | Basse | Couverture de test manquante. |
| Régénérer / restreindre la clé Elasticsearch (R20) | Recommandation IA | Sécurité | Haute | Bonne pratique avant production (source README). |
| Servir en HTTPS (R21) | Recommandation IA | Sécurité | Haute | Confidentialité en production (source README). |
| Limitation de débit sur `/api/ask` (R22) | Recommandation IA | Exploitation | Moyenne | Anti-abus et maîtrise des coûts d'IA (source README). |
| Conformité RGPD des données envoyées à l'IA (R23) | Recommandation IA | Sécurité | Haute | Données envoyées à un service externe (source README). |
