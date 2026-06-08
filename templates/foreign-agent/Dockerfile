# syntax=docker/dockerfile:1.7
# Foreign agent — Node 20 slim, monorepo build context (run from repo root).
# This is what the Sage team's reference instance ships; a third-party fork
# would build the standalone package against published @sage/* once available.

# ── Stage 1: install deps + build TS ────────────────────────────────
FROM node:20-slim AS builder
WORKDIR /repo

RUN corepack enable

# Manifests first for cache friendliness.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/core/package.json ./packages/core/
COPY packages/adapter-evm/package.json ./packages/adapter-evm/
COPY templates/foreign-agent/package.json ./templates/foreign-agent/

RUN pnpm install --frozen-lockfile

# Sources, built in dependency order.
COPY packages/core ./packages/core
COPY packages/adapter-evm ./packages/adapter-evm
COPY templates/foreign-agent ./templates/foreign-agent

RUN pnpm --filter @sage/core build \
 && pnpm --filter @sage/adapter-evm build \
 && pnpm --filter @sage/foreign-agent-template build

RUN pnpm --filter @sage/foreign-agent-template deploy --prod /opt/app

# ── Stage 2: slim runtime ───────────────────────────────────────────
FROM node:20-slim AS runtime
WORKDIR /opt/app
ENV NODE_ENV=production

COPY --from=builder /opt/app ./

RUN useradd -m -u 10001 sage && chown -R sage:sage /opt/app
USER sage

EXPOSE 3010

CMD ["node", "dist/index.js"]
