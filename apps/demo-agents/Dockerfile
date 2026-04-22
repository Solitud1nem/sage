FROM node:20-slim AS base
RUN corepack enable

WORKDIR /app
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY packages/core/package.json packages/core/
COPY packages/adapter-evm/package.json packages/adapter-evm/
COPY apps/demo-agents/package.json apps/demo-agents/

RUN pnpm install --frozen-lockfile

COPY . .
RUN pnpm -r build

FROM node:20-slim AS runner
WORKDIR /app
COPY --from=base /app .

# Override CMD per service in docker-compose.yml
CMD ["echo", "Specify a command in docker-compose.yml"]
