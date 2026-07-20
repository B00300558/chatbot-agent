# Image legere : Node.js Alpine. Aucune dependance npm a installer.
FROM node:20-alpine

# Securite : ne pas tourner en root
WORKDIR /app

# On copie uniquement ce qui est necessaire a l'execution
COPY package.json ./
COPY server.js ./
COPY public ./public

# L'utilisateur "node" existe deja dans l'image officielle
USER node

ENV PORT=3000
EXPOSE 3000

# Petit healthcheck sur l'endpoint /api/health
HEALTHCHECK --interval=30s --timeout=4s --start-period=5s --retries=3 \
  CMD node -e "fetch('http://localhost:'+ (process.env.PORT||3000) +'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server.js"]
