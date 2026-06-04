# Architecture Overview

> **Статус:** живой документ. Описывает то, что задеплоено и работает на момент M9.7.2 (2026-04-29). Источник истины для незафиксированных решений — это `../adr/`.

Sage v2.0 — chain-agnostic task-escrow протокол для AI-агентов. EVM-first (Base primary), не-EVM (Solana, NEAR) — v3+. Простые pay-per-call делегируются x402 (ADR-0003); Sage — про многошаговые задачи с lifecycle, deadlines и USDC-расчётами по факту.

## Слои

```
┌─────────────────────────────────────────────────────────────────┐
│  Browser (sage-protocol.pages.dev)                              │
│    Next.js 15 static export + Tailwind v4 + wagmi + ConnectKit  │
│    Watch-live (SSE) + Try-with-wallet (EIP-2612 permit)         │
└──────────────────┬──────────────────────────┬───────────────────┘
                   │                          │
       (POST /api/demo/start)         (eth_* RPC reads)
                   │                          │
┌──────────────────▼──────────────────────────▼───────────────────┐
│  Cloudflare Worker (sage-gateway.a-t-somnia.workers.dev)        │
│    /api/demo/*  → passthrough на Fly + D1 rate-limit (3/IP/day) │
│    /api/rpc     → Alchemy proxy с hidden ALCHEMY_KEY            │
│    /health      → orchestrator passthrough                      │
└──────────────────┬──────────────────────────┬───────────────────┘
                   │                          │
       (HTTP + SSE)                       (Alchemy)
                   │                          │
┌──────────────────▼─────────────┐  ┌─────────▼────────────────────┐
│  Fly.io: sage-demo-agents      │  │  Base mainnet (chain 8453)   │
│    orchestrator x2 HA + 2 std  │  │    AgentRegistry (anchor)    │
│    summarizer + translator     │  │    TaskEscrow                │
│    vision + sentiment          │  │    USDC (Circle)             │
│    SSE channels (5min TTL)     │  │                              │
└──────────────────┬─────────────┘  └──────────────────────────────┘
                   │
              (on-chain reads + writes via @sage/adapter-evm)
                   │
                   ▼
              Base mainnet (выше)

Code layers (TypeScript / Solidity):
┌─────────────────────────────────────────────────────────────────┐
│  apps/                                                          │
│    web/             — Next.js frontend                          │
│    worker-gateway/  — Cloudflare Worker (RPC + demo proxy)     │
│    demo-agents/     — TS reference agents: orch + 4 workers    │
├─────────────────────────────────────────────────────────────────┤
│  packages/                                                      │
│    adapter-evm/     — viem-based EVM client + ABIs + chains/    │
│    core/            — chain-agnostic types + interfaces (0 deps)│
│    contracts/       — Solidity (Foundry) — escrow + registry    │
└─────────────────────────────────────────────────────────────────┘
```

**Принципы разделения:**
- `@sage/core` — нулевые runtime-deps, абсолютно chain-agnostic. Не импортирует viem/ethers/anchor.
- `@sage/adapter-evm` — peer-dep viem 2.x, реализует core-интерфейсы для EVM.
- `apps/*` — потребители SDK; не часть SDK-поверхности.
- В v3 рядом с `adapter-evm` появится `adapter-solana` без перестановок в core.

## Chains

| Chain | Chain ID | Status | RPC | Explorer | AgentRegistry | TaskEscrow |
|-------|----------|--------|-----|----------|---------------|------------|
| Base | 8453 | **Live** (deployed 2026-04-22) | https://mainnet.base.org (через Worker proxy) | https://basescan.org | `0x5e95F92FeEb4D46249DC3525C58596856029c661` | `0x12aeF3529b8404709125b727bA3Db40cD5453E1e` |
| Base Sepolia | 84532 | Live (testnet) | https://sepolia.base.org | https://sepolia.basescan.org | `0x5e95F92FeEb4D46249DC3525C58596856029c661` | `0x12aeF3529b8404709125b727bA3Db40cD5453E1e` |
| Arbitrum | 42161 | v2.1 (planned) | — | — | — | — |
| OP | 10 | v2.1 (planned) | — | — | — | — |
| BNB | 56 | v2.1 (planned) | — | — | — | — |
| Solana | — | v3+ (planned) | — | — | — | — |
| NEAR | — | v3+ (planned) | — | — | — | — |

Адреса контрактов идентичны на Base mainnet и Base Sepolia — детерминистичный CREATE3 deploy через CreateX (ADR-0001). На v2.1-сетях будут те же адреса.

**Anchor chain pattern:** `AgentRegistry` живёт **только на Base** (ADR-0002). На spoke-сетях (Arbitrum/OP/BNB) деплоится только `TaskEscrow` — registry-проверка является ответственностью SDK, а не контракта.

## Money flow

Сценарий: клиент-EOA создаёт многошаговую задачу для агента-EOA с USDC-escrow.

```
Client                          TaskEscrow                          Executor
  │                                │                                  │
  ├─ signPermit (off-chain) ──────►│                                  │
  │                                │                                  │
  ├─ createTask(executor, deadline,│                                  │
  │     amount, specUri, permit) ─►│ USDC.permit() ─► USDC ─► transferFrom
  │                                │ status=Created                   │
  │                                │ ◄────────────── TaskCreated event│
  │                                │                                  │
  │                                │◄──── acceptTask ─────────────────┤
  │                                │ status=Accepted                  │
  │                                │ ─────────────► TaskAccepted ─────┤
  │                                │                                  │
  │                                │◄─── completeTask(resultUri) ─────┤
  │                                │ status=Completed, completedAt=now│
  │                                │ ─────────────► TaskCompleted ────┤
  │                                │                                  │
  ├─ approvePayment ──────────────►│ USDC ─► transferTo(executor) ────┤
  │                                │ status=Paid (terminal)           │
  │                                │                                  │
  └────────────────────────────────┴──────────────────────────────────┘
```

**Альтернативные исходы:**

- **claimAutoRelease** (executor → Paid). После `completedAt + GRACE_PERIOD` (300s) executor может сам забрать оплату, если клиент не диспутнул. Защита от молчаливого клиента.
- **disputeTask** (client → Disputed terminal-frozen). До истечения grace period клиент отменяет auto-release; средства висят до off-chain резолюции (нет on-chain механизма).
- **refundExpired** (anyone → Expired terminal). Если deadline прошёл, а статус Created/Accepted — любой может вернуть USDC клиенту. Anyone-callable снимает риск зависания при офлайн-клиенте.

**Settlement currency:** USDC-only (ADR-0004). Per-chain immutable USDC-адрес в TaskEscrow constructor. Multi-token — v2.1+ через отдельный `TaskEscrowMultiToken`.

**Approval mechanism:** EIP-2612 permit встроен в `createTask` (single-tx UX). Permit обёрнут в `try/catch` — если уже использован или allowance достаточен, не реверт. Подпись формируется в SDK через `viem.signTypedData`.

Подробности контрактов: см. [`contracts.md`](./contracts.md).

## Frontend topology

**Pages → Worker → Fly → Base.** Все слои опционально-публичные, ключи в backend-only слоях.

| Слой | URL | Что делает | Что внутри |
|---|---|---|---|
| Pages | `https://sage-protocol.pages.dev` | Static frontend (Next.js export) | Home + `/demo` (Watch-live + Try-wallet) + `/docs` + `/changelog` |
| Worker | `https://sage-gateway.a-t-somnia.workers.dev` | API gateway | `/api/rpc` (Alchemy proxy), `/api/demo/*` (Fly passthrough), `/health`, D1 rate-limit |
| Fly | `https://sage-demo-agents.fly.dev` | Orchestrator backend | `POST /api/demo/start`, `GET /api/demo/stream/:id` (SSE), `GET /health` |
| Base mainnet | (RPC через Worker) | On-chain truth | TaskEscrow + AgentRegistry + USDC |

**Security boundaries:**
- `ALCHEMY_KEY` — только в Cloudflare Worker secret. Не в frontend bundle.
- `OPENAI_API_KEY`, agent private keys, `SPONSOR_*` — только в Fly secrets. Не наружу.
- User wallet keys — никогда не покидают browser; signing локально через ConnectKit/wagmi.
- CORS allow-list через `ALLOWED_ORIGINS` env в Worker.
- Rate-limit: 3 sponsored runs / IP / UTC-day (D1-counter, ключ `demo_start:<ip>:<day>`).

## Demo-agents flow

Orchestrator диспатчит каждый incoming run по полю `mode`: `pipeline` (2 стадии — summarize → translate), `sentiment` (1 стадия, на вход text), `vision` (1 стадия, на вход image URL). Каждый агент — отдельный Node-процесс на Fly, подписан на `TaskCreated` события через `publicClient.watchContractEvent` и фильтрует по полю `executor == self.address`.

```
User /demo
  │
  ├─ POST /api/demo/start { mode, text? | imageUrl? } ──► Orchestrator (Fly)
  │                                                          │
  │                                                          │  switch (mode):
  │                                                          │
  │                                                          ├─ pipeline:
  │                                                          │   Stage 1 (summarize) → Summarizer
  │                                                          │   Stage 2 (translate) → Translator
  │                                                          │     spec = stage 1 result
  │                                                          │
  │                                                          ├─ sentiment:
  │                                                          │   Stage (sentiment) → Sentiment
  │                                                          │
  │                                                          ├─ vision:
  │                                                          │   Stage (vision) → Vision
  │                                                          │
  │                                                          └─ done event → SSE stream
  │
  │   Каждая стадия (везде одинаковый primitive):
  │     sage.tasks.createTask(executor, …, specUri)
  │       ───► TaskCreated event
  │           Worker (другой Fly process):
  │             filter executor = self
  │             acceptTask
  │             OpenAI call (summarize / translate / sentiment / vision-describe)
  │             completeTask(resultUri = data:text/plain,…)
  │       ◄─── TaskCompleted (orchestrator polls getTask)
  │     approvePayment + waitForReceipt
  │
  └─ EventSource /api/demo/stream/:id ◄── (run_started / stage_started / task_created /
                                            task_accepted / task_completed / task_paid / done)
```

**Соглашения:**
- Все агенты общаются только через on-chain events (никакого HTTP друг с другом). Один разделяемый source of truth.
- Result encoding: `data:text/plain,{encodeURIComponent(result)}`. `data:` URI выбран ради синхронной демонстрации без off-chain storage; в проде вместо него будет IPFS/Arweave/HTTP URL.
- Между write'ами от одного EOA — обязательный `await waitForTransactionReceipt` (см. GOTCHA про nonce-гонку).
- Сейчас demo-агенты **не зарегистрированы** в `AgentRegistry` — TaskEscrow не требует регистрации, для UI-discoverability можно дорегистрировать позже.

Подробности паттерна добавления агентов: см. секцию «Безопасные точки расширения» в выходе прединвентаризации (или прямые файлы в `apps/demo-agents/src/`).

## ADR index

| # | Title | Что закрывает |
|---|---|---|
| [0001](../adr/0001-deterministic-addresses.md) | Deterministic contract addresses via CreateX + CREATE3 | Один адрес на всех EVM-сетях, salt `sage:<component>:v<N>` |
| [0002](../adr/0002-agent-identity.md) | Base-anchored registry + EAS + single EOA, no spoke registries | Identity-модель, anchor-chain pattern |
| [0003](../adr/0003-x402-as-pay-per-call-transport.md) | x402 as primary transport for pay-per-call | Разделение pay-per-call vs task-escrow; отказ от собственного `InferenceMarket` |
| [0004](../adr/0004-settlement-usdc-permit.md) | USDC-only settlement + EIP-2612 permit | Single token, single-tx UX |
| [0005](../adr/0005-monorepo-foundry-viem.md) | pnpm monorepo + Foundry + viem | Стек контрактов и SDK |
| [0006](../adr/0006-web-integration-topology.md) | Web frontend integration topology | Pages + Worker + Fly + Alchemy + PostHog |

**Открытые JIT-оси:** A5 (escrow semantics — applied via code, формальный ADR pending), A6 (upgradability — все immutable), A7 (indexer — direct watchContractEvent, Ponder в v2.0.5), A9 (gas abstraction — paymaster в v2.1), A10 (non-EVM — chain-agnostic spec в core).

## Связанные документы

- [`contracts.md`](./contracts.md) — детальный разбор `AgentRegistry` и `TaskEscrow`.
- [`security-checklist.md`](./security-checklist.md) — security review чек-лист.
- [`slither-review.md`](./slither-review.md) — результаты статического анализа.
- [`x402-client-choice.md`](./x402-client-choice.md) — выбор x402-клиента.
- [`../adr/`](../adr/) — все ADR.
- [`../runbooks/`](../runbooks/) — операционные инструкции (deploy на Base, Cloudflare, Fly).
- [`../../GOTCHAS.md`](../../GOTCHAS.md) — past burns.
- [`../../CHANGELOG.md`](../../CHANGELOG.md) — хронология решений и релизов.

---

_Документ живой — обновляется после каждого accepted ADR и после significant deployment changes._
