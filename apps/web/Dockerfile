# Build depuis la racine du monorepo : docker build -f apps/web/Dockerfile .
FROM node:22-alpine AS base
RUN corepack enable
WORKDIR /app

FROM base AS build
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/web/package.json apps/web/
RUN pnpm install --frozen-lockfile --filter web
COPY apps/web apps/web
# Variables astro:env « public » : figées dans le bundle AU BUILD (pas lues au runtime).
# Les secrets (access: "secret") restent lus au démarrage du conteneur.
ARG DIRECTUS_PUBLIC_URL
ARG PUBLIC_TURNSTILE_SITE_KEY
RUN pnpm --filter web build

FROM base AS deps
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/web/package.json apps/web/
RUN pnpm install --frozen-lockfile --prod --filter web

FROM node:22-alpine AS runtime
WORKDIR /app/apps/web
ENV NODE_ENV=production HOST=0.0.0.0 PORT=4321
COPY --from=deps /app/node_modules /app/node_modules
COPY --from=deps /app/apps/web/node_modules ./node_modules
COPY --from=build /app/apps/web/dist ./dist
USER node
EXPOSE 4321
CMD ["node", "dist/server/entry.mjs"]
