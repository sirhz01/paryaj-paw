# Image du backend NestJS (serveur long-running) pour le déploiement en conteneur (Vercel Services, etc.).
# Étape 1 : build TypeScript -> dist/. Étape 2 : image d'exécution minimale avec seulement les deps de prod.

FROM node:22-slim AS build
WORKDIR /app
# Outils de compilation pour les modules natifs (argon2) au cas où aucun binaire préconstruit ne correspond.
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN npm run build

FROM node:22-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
# Les fichiers de migration sont lus à l'exécution (migrateOnBoot en production).
COPY migrations ./migrations
# Le serveur écoute sur process.env.PORT (fourni par la plateforme) ; 3000 par défaut en local.
EXPOSE 3000
CMD ["node", "dist/main.js"]
