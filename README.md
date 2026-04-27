# Sage

**Chain-agnostic task-escrow protocol for AI agents.** EVM-first, non-EVM-ready. Pay-per-call делегируется стандарту **x402**; Sage фокусируется на task-level escrow — многошаговые задачи с lifecycle, deadlines и расчётами по факту, где x402 недостаточен.

**Статус:** v2.0 live on Base mainnet + Sepolia (deployed 2026-04-22). Web frontend code-complete, deployment pending. См. `CHANGELOG.md`.

**История:** Sage — это v2 проекта, который начинался как [AgentPay](../AgentsPay/) (LitVM-only). В апреле 2026 ребрендирован и пивотнут на chain-agnostic multi-chain архитектуру.

## Quick start

Prerequisites: Node.js ≥ 20, [pnpm](https://pnpm.io/) 9.x, [Foundry](https://book.getfoundry.sh/).

```bash
# Install dependencies
pnpm install

# Build all TS packages
pnpm -r build

# Run SDK tests
pnpm -r test --filter='!@sage/contracts'

# Run contract tests (requires Foundry)
cd packages/contracts
forge build
forge test -vvv
```

## Project structure

```
packages/
  core/             @sage/core — chain-agnostic types & interfaces (0 deps)
  adapter-evm/      @sage/adapter-evm — viem-based EVM client
  contracts/        Solidity (Foundry) — AgentRegistry + TaskEscrow
apps/
  web/              Next.js 15 landing + interactive demo (Cloudflare Pages)
  worker-gateway/   Cloudflare Worker — RPC proxy + D1 rate limit
  demo-agents/      Reference agents (Orchestrator, Summarizer, Translator)
docs/
  adr/              Architecture Decision Records (0001–0006)
  architecture/     Living architecture overview
  runbooks/         Operational runbooks (Base mainnet, Fly.io, Cloudflare)
```

## Deploy

Full operational runbooks live under `docs/runbooks/`:

- `deploy-base-mainnet.md` — Foundry + CreateX + CREATE3
- `deploy-cloudflare-worker.md` — `sage-gateway` Worker (RPC proxy + rate limit)
- `deploy-demo-agents-flyio.md` — 3 Docker services (orchestrator / summarizer / translator)
- `deploy-frontend-cloudflare-pages.md` — `@sage/web` static export → Cloudflare Pages
- `local-dev-setup.md` — bootstrap per-role wallets for local demo runs

## Документы

- `CLAUDE.md` — entry point для AI-ассистентов (начни отсюда, если ты Claude)
- `AGENTS.md` — кодстандарт, запреты, коммит-конвенции
- `docs/architecture/overview.md` — живая архитектурная карта
- `docs/adr/` — принятые архитектурные решения
- `docs/runbooks/` — операционные инструкции (deploy, миграции)

## Related

- KB dossier: `D:\knowledge\projects\project-sage.md` (кросс-сессионная память)
- Архив v1: `D:\AgentsPay\` (read-only reference)
