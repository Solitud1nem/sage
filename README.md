# Sage

**Chain-agnostic task-escrow protocol for AI agents.** EVM-first, non-EVM-ready. Pay-per-call делегируется стандарту **x402**; Sage фокусируется на task-level escrow — многошаговые задачи с lifecycle, deadlines и расчётами по факту, где x402 недостаточен.

**Статус:** v2.0 live on Base mainnet + Sepolia (contracts deployed 2026-04-22 Sepolia / 2026-04-24 mainnet). Полный stack — frontend на Cloudflare Pages, RPC gateway на Cloudflare Worker, demo agents на Fly.io — публично доступен. 3-mode demo (Pipeline / Sentiment / Vision) e2e на Base mainnet. См. `CHANGELOG.md`.

**История:** Sage — это v2 проекта, который начинался как [AgentPay](../AgentsPay/) (LitVM-only). В апреле 2026 ребрендирован и пивотнут на chain-agnostic multi-chain архитектуру.

## Live

- **Frontend:** [https://sage-protocol.pages.dev](https://sage-protocol.pages.dev) — landing + `/demo` (3-mode interactive) + `/docs` (9 sub-pages)
- **RPC gateway:** `https://sage-gateway.a-t-somnia.workers.dev` — `/api/rpc` (Alchemy proxy) + `/api/demo/*` passthrough + 3/IP/UTC-day rate limit
- **Demo agents:** `https://sage-demo-agents.fly.dev` — 5 machines (orchestrator ×2 HA + summarizer + translator + sentiment + vision)
- **Public repo:** [github.com/Solitud1nem/sage](https://github.com/Solitud1nem/sage)
- **Contracts on Base mainnet + Base Sepolia (same addresses via CREATE3):**
  - `AgentRegistry`: `0x5e95F92FeEb4D46249DC3525C58596856029c661`
  - `TaskEscrow`: `0x12aeF3529b8404709125b727bA3Db40cD5453E1e`

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
  demo-agents/      Reference agents (Orchestrator, Summarizer, Translator, Sentiment, Vision)
docs/
  adr/              Architecture Decision Records (0001–0006)
  architecture/     Living architecture overview
  runbooks/         Operational runbooks (Base mainnet, Fly.io, Cloudflare)
```

## Deploy

Full operational runbooks live under `docs/runbooks/`:

- `deploy-base-mainnet.md` — Foundry + CreateX + CREATE3
- `deploy-cloudflare-worker.md` — `sage-gateway` Worker (RPC proxy + rate limit)
- `deploy-demo-agents-flyio.md` — multi-process Fly.io app (orchestrator + 4 agents)
- `deploy-frontend-cloudflare-pages.md` — `@sage/web` static export → Cloudflare Pages
- `local-dev-setup.md` — bootstrap per-role wallets for local demo runs

## Документы

- `CLAUDE.md` — entry point для AI-ассистентов (начни отсюда, если ты Claude)
- `AGENTS.md` — кодстандарт, запреты, коммит-конвенции
- `PRD.md` — что строим в v2.0 и зачем
- `PLANNING.md` — техническое устройство (архитектура, компоненты)
- `TASKS.md` — очередь задач, по которой работаем
- `CHANGELOG.md` — append-only хронология решений и релизов
- `GOTCHAS.md` — production-уроки (один раз обожглись, больше не хотим)
- `docs/architecture/overview.md` — живая архитектурная карта
- `docs/adr/` — принятые архитектурные решения
- `docs/runbooks/` — операционные инструкции (deploy, миграции)

## Related

- KB dossier: `D:\knowledge\projects\project-sage.md` (кросс-сессионная память)
- Архив v1: `D:\AgentsPay\` (read-only reference)