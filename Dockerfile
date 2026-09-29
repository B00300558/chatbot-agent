# Contexte "gitdir" : le dossier .git, fourni par docker-compose.yml
# (additional_contexts). Vide si l'image est construite sans lui.
FROM scratch AS gitdir

# Lit le dernier commit pour le journal d'audit (le conteneur n'a pas de .git)
FROM node:20-alpine AS buildinfo
RUN apk add --no-cache git
RUN --mount=type=bind,from=gitdir,target=/src/.git \
    git -c safe.directory='*' -C /src log -1 --format='%h|%an|%aI|%s' > /build-info.txt 2>/dev/null \
    || : > /build-info.txt

# Image legere : Node.js Alpine. Aucune dependance npm a installer.
FROM node:20-alpine

# Securite : ne pas tourner en root
WORKDIR /app

# On copie uniquement ce qui est necessaire a l'execution
COPY package.json ./
COPY server.js ./
COPY journal.js ./
COPY public ./public
COPY --from=buildinfo /build-info.txt ./build-info.txt

# Fichiers lisibles par "node" quels que soient les droits sur la machine hote,
# et dossier du journal d'audit accessible en ecriture
RUN chmod -R a+rX /app && mkdir -p /app/logs && chown node:node /app/logs

# L'utilisateur "node" existe deja dans l'image officielle
USER node

ENV PORT=3000
# Etat du code suivi separement de l'environnement local (journal d'audit)
ENV APP_ENV=docker
EXPOSE 3000

# Petit healthcheck sur l'endpoint /api/health (en-tete X-Healthcheck :
# ces appels automatiques ne sont pas inscrits dans le journal d'audit)
HEALTHCHECK --interval=30s --timeout=4s --start-period=5s --retries=3 \
  CMD node -e "fetch('http://localhost:'+ (process.env.PORT||3000) +'/api/health',{headers:{'X-Healthcheck':'docker'}}).then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server.js"]
