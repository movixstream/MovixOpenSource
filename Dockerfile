# syntax=docker/dockerfile:1.19

# ==============================================================
# Stage 1 — Builder : install all deps + Vite production build
# ==============================================================
FROM node:22-alpine AS builder
WORKDIR /app

# Le lockfile racine inclut le workspace server : son manifeste doit être dans
# la même couche que les manifestes racine pour que npm ci reste reproductible.
COPY package.json package-lock.json ./
COPY server/package.json ./server/package.json
RUN --mount=type=cache,id=movix-npm-builder,target=/root/.npm,sharing=locked \
    npm ci --prefer-offline --no-audit --no-fund

# Variables publiques intégrées au bundle Vite. Les valeurs sensibles du
# backend doivent rester des variables runtime et ne doivent pas être ajoutées
# à cette liste.
ARG VITE_MAIN_API
ARG VITE_BACKUP_API
ARG VITE_TMDB_API_KEY
ARG VITE_SITE_URL
ARG VITE_WATCHPARTY_API
ARG VITE_PROXIES_EMBED_API
ARG VITE_TURNSTILE_SITE_KEY
ARG VITE_TURNSTILE_INVISIBLE_SITEKEY
# Paires Turnstile supplémentaires (src/utils/turnstileKeys.ts) : groupes 2 et
# 3 déclarés ici, à compléter sur le même modèle jusqu'à 10 si besoin.
ARG VITE_TURNSTILE_DOMAINS_2
ARG VITE_TURNSTILE_SITE_KEY_2
ARG VITE_TURNSTILE_INVISIBLE_SITEKEY_2
ARG VITE_TURNSTILE_DOMAINS_3
ARG VITE_TURNSTILE_SITE_KEY_3
ARG VITE_TURNSTILE_INVISIBLE_SITEKEY_3
ARG VITE_VAPID_PUBLIC_KEY
ARG VITE_SUPPORT_TELEGRAM_URL
ARG VITE_APP_BUILD_ID
ARG VITE_ANALYTICS_PROVIDER=none
ARG VITE_GA_MEASUREMENT_ID
ARG VITE_PLAUSIBLE_DOMAIN
ARG VITE_PLAUSIBLE_HOST
ARG VITE_PLAUSIBLE_SCRIPT_PATH
ARG VITE_PLAUSIBLE_API_PATH
ARG VITE_AD_DIRECT_URLS_ADULT
ARG VITE_AD_DIRECT_URL_SFW
ARG VITE_AD_SCRIPT_SRC
ARG VITE_SWIFTFLUX_AD_URL
ARG VITE_DEFAULT_MIRRORS=movix.health
ARG VITE_MIRRORS_CONFIG_URL=https://rentry.co/movix
ARG VITE_GLITCHTIP_DSN
ARG GLITCHTIP_URL
ARG GLITCHTIP_ORG
ARG GLITCHTIP_PROJECT
ARG COMMIT_REF

ENV VITE_MAIN_API=$VITE_MAIN_API \
    VITE_BACKUP_API=$VITE_BACKUP_API \
    VITE_TMDB_API_KEY=$VITE_TMDB_API_KEY \
    VITE_SITE_URL=$VITE_SITE_URL \
    VITE_WATCHPARTY_API=$VITE_WATCHPARTY_API \
    VITE_PROXIES_EMBED_API=$VITE_PROXIES_EMBED_API \
    VITE_TURNSTILE_SITE_KEY=$VITE_TURNSTILE_SITE_KEY \
    VITE_TURNSTILE_INVISIBLE_SITEKEY=$VITE_TURNSTILE_INVISIBLE_SITEKEY \
    VITE_TURNSTILE_DOMAINS_2=$VITE_TURNSTILE_DOMAINS_2 \
    VITE_TURNSTILE_SITE_KEY_2=$VITE_TURNSTILE_SITE_KEY_2 \
    VITE_TURNSTILE_INVISIBLE_SITEKEY_2=$VITE_TURNSTILE_INVISIBLE_SITEKEY_2 \
    VITE_TURNSTILE_DOMAINS_3=$VITE_TURNSTILE_DOMAINS_3 \
    VITE_TURNSTILE_SITE_KEY_3=$VITE_TURNSTILE_SITE_KEY_3 \
    VITE_TURNSTILE_INVISIBLE_SITEKEY_3=$VITE_TURNSTILE_INVISIBLE_SITEKEY_3 \
    VITE_VAPID_PUBLIC_KEY=$VITE_VAPID_PUBLIC_KEY \
    VITE_SUPPORT_TELEGRAM_URL=$VITE_SUPPORT_TELEGRAM_URL \
    VITE_APP_BUILD_ID=$VITE_APP_BUILD_ID \
    VITE_ANALYTICS_PROVIDER=$VITE_ANALYTICS_PROVIDER \
    VITE_GA_MEASUREMENT_ID=$VITE_GA_MEASUREMENT_ID \
    VITE_PLAUSIBLE_DOMAIN=$VITE_PLAUSIBLE_DOMAIN \
    VITE_PLAUSIBLE_HOST=$VITE_PLAUSIBLE_HOST \
    VITE_PLAUSIBLE_SCRIPT_PATH=$VITE_PLAUSIBLE_SCRIPT_PATH \
    VITE_PLAUSIBLE_API_PATH=$VITE_PLAUSIBLE_API_PATH \
    VITE_AD_DIRECT_URLS_ADULT=$VITE_AD_DIRECT_URLS_ADULT \
    VITE_AD_DIRECT_URL_SFW=$VITE_AD_DIRECT_URL_SFW \
    VITE_AD_SCRIPT_SRC=$VITE_AD_SCRIPT_SRC \
    VITE_SWIFTFLUX_AD_URL=$VITE_SWIFTFLUX_AD_URL \
    VITE_DEFAULT_MIRRORS=$VITE_DEFAULT_MIRRORS \
    VITE_MIRRORS_CONFIG_URL=$VITE_MIRRORS_CONFIG_URL \
    VITE_GLITCHTIP_DSN=$VITE_GLITCHTIP_DSN \
    GLITCHTIP_URL=$GLITCHTIP_URL \
    GLITCHTIP_ORG=$GLITCHTIP_ORG \
    GLITCHTIP_PROJECT=$GLITCHTIP_PROJECT \
    COMMIT_REF=$COMMIT_REF

# Les avatars sont servis tels quels : ils rejoignent uniquement l'image finale.
# Un changement de ces images ne doit pas invalider la compilation Vite.
COPY --exclude=public/avatars --exclude=public/avatars/** . .

# `glitchtip_auth_token` est facultatif. S'il est fourni comme secret BuildKit,
# il n'est enregistré ni dans l'historique ni dans les variables de l'image.
RUN --mount=type=cache,id=movix-vite,target=/app/node_modules/.cache \
    --mount=type=secret,id=glitchtip_auth_token,required=false \
    if [ -f /run/secrets/glitchtip_auth_token ]; then \
      export GLITCHTIP_AUTH_TOKEN="$(cat /run/secrets/glitchtip_auth_token)"; \
    fi; \
    npm run build:coolify

# ==============================================================
# Stage 2 — Production dependencies : Hono workspace only
# ==============================================================
FROM node:22-alpine AS production-dependencies
WORKDIR /app
COPY package.json package-lock.json ./
COPY server/package.json ./server/package.json
RUN --mount=type=cache,id=movix-npm-runner,target=/root/.npm,sharing=locked \
    npm ci --omit=dev --workspace=server --include-workspace-root=false \
    --prefer-offline --no-audit --no-fund

# ==============================================================
# Stage 3 — Runner : static assets + strict runtime allowlist
# ==============================================================
FROM node:22-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production \
    PORT=3001 \
    ASSET_HISTORY_DIR=/app/asset-history

COPY --from=production-dependencies --chown=node:node /app/node_modules ./node_modules
# UID/GID de l'utilisateur node dans l'image officielle, sans résolution de nom.
COPY --link --from=builder --chown=1000:1000 /app/dist ./dist
# Conserve `type: module` pour le helper ESM situé hors du workspace server.
COPY --from=builder --chown=node:node /app/package.json ./package.json
COPY --from=builder --chown=node:node /app/server/package.json ./server/package.json
COPY --from=builder --chown=node:node /app/server/index.js ./server/index.js
COPY --from=builder --chown=node:node /app/server/gracefulShutdown.js ./server/gracefulShutdown.js
COPY --from=builder --chown=node:node /app/server/asset-history.mjs ./server/asset-history.mjs
COPY --from=builder --chown=node:node /app/functions/_lib/socialPreview.js ./functions/_lib/socialPreview.js
RUN mkdir -p /app/asset-history && chown node:node /app/asset-history

# Couche indépendante du JavaScript, réutilisable quand il change : les avatars
# restent à /avatars/ sans être dupliqués dans dist pendant la compilation.
COPY --link --chown=1000:1000 public/avatars/ ./dist/avatars/

EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --start-interval=1s --retries=3 \
    CMD wget -qO- http://127.0.0.1:${PORT}/health || exit 1

USER node

CMD ["node", "server/index.js"]
