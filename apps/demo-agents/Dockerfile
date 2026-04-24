# syntax=docker/dockerfile:1.7
# Multistage build for Sage demo-agents (Node 20 slim).
#
# Used by both docker-compose (local) and Fly.io (production). Fly.toml routes
# to different process entrypoints via its [processes] table.

# ── Stage 1: install deps + build TS ────────────────────────────────
FROM node:20-slim AS builder
WORKDIR /repo

RUN corepack enable

# Copy only manifests first for cache friendliness.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/core/package.json ./packages/core/
COPY packages/adapter-evm/package.json ./packages/adapter-evm/
COPY apps/demo-agents/package.json ./apps/demo-agents/

RUN pnpm install --frozen-lockfile

# Copy source and build each workspace package in dependency order.
COPY packages/core ./packages/core
COPY packages/adapter-evm ./packages/adapter-evm
COPY apps/demo-agents ./apps/demo-agents

RUN pnpm --filter @sage/core build \
 && pnpm --filter @sage/adapter-evm build \
 && pnpm --filter @sage/demo-agents build

# Prune to production dependencies only; emit standalone /opt/app.
RUN pnpm --filter @sage/demo-agents deploy --prod /opt/app

# ── Stage 2: slim runtime ───────────────────────────────────────────
FROM node:20-slim AS runtime
WORKDIR /opt/app
ENV NODE_ENV=production

COPY --from=builder /opt/app ./

RUN useradd -m -u 10001 sage && chown -R sage:sage /opt/app
USER sage

EXPOSE 3000 3001 3002

# Default CMD: orchestrator. docker-compose.yml + fly.toml override per service.
CMD ["node", "dist/orchestrator/server.js"]
