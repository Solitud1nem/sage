# CHANGELOG.md

Хронология значимых решений, ребрендов, релизов Sage.

Формат: обратная хронология (свежее сверху). Для каждой записи — дата, категория, короткое описание.

Категории: `rebrand` | `decision` | `release` | `adr` | `chain` | `scope`.

---

## 2026-04-23

- `adr` **ADR-0006 Accepted** — web frontend integration topology. Static export on Cloudflare Pages + Alchemy RPC behind Cloudflare Worker proxy + Fly.io for demo-agents + PostHog analytics + $20 USDC sponsor wallet для Watch-live mode with 3/IP/day rate limit.
- `milestone` **INTEGRATION.md** written at `apps/web/INTEGRATION.md` with milestones M-INT.1 through M-INT.8 (10–12 days solo).
- `extract` Claude Design artifacts pulled into repo: `apps/web/styles/tokens.css` (6.4 kB, locked tokens) + `apps/web/design-reference/{Home,demo,wallet-modal,design-system}.txt` with full component specs.
- `milestone` **M-INT.1 complete** — `apps/web/` scaffolded. Next.js 15 App Router + Tailwind v4 + wagmi v2 + viem v2 + ConnectKit + @tanstack/react-query + PostHog (lazy after consent) + Sentry hooks. Layout shell (nav + footer) with ConnectKit button, Home hero rendering against real Base-mainnet addresses in read-only mode, `/demo` placeholder. Chain config at `chains/base.ts` (mainnet + Sepolia), wagmi config at `lib/wagmi.ts`, tokens.css mapped into Tailwind v4 via `@theme` block in `globals.css`.
- `milestone` **M-INT.2 complete** — read-only on-chain + full Home sections. `useLiveTxStream` hook (viem `getLogs` for 10k-block history + `watchContractEvent` for tail), formatted TxRow with opacity-stepped rows (1 → 0.6), empty/loading/error states. Four Home sections now live with real anchors: `#how-it-works` (4 StepCards with cyan/purple/pink/green accents per lifecycle stage), `#integrate` (3-tab code block: client.ts / agent.ts / contract.sol using real `@sage/adapter-evm` API), `#live` (LiveStream panel subscribing to `TaskCreated/Accepted/Completed/Paid/Disputed/Expired`), Demo CTA. Event ABIs parsed at build via `parseAbi` in `lib/abi/task-escrow-events.ts`.
- `milestone` **M-INT.3 complete** — wallet-connect polish + docs/changelog placeholders. `/docs` page with four real-link cards (Basescan contracts, ADRs, PRD+PLANNING, INTEGRATION.md). `/changelog` page with highlight timeline. wagmi connectors updated: Coinbase Wallet accepts both Smart Wallet and regular (preference 'all'), MetaMask + WalletConnect get dApp metadata for modal headers. Nav `/docs` and footer `/changelog` links no longer 404.
- `milestone` **M-INT.4 complete** — SSE endpoints + Fly.io deploy config for orchestrator. `SseChannel` + `SseRegistry` primitives with ping-every-15s keep-alive, buffer replay for late-connecting clients, 5-min retention after close. Orchestrator server rewritten: `POST /api/demo/start` → returns `{ demoRunId, streamUrl }`, `GET /api/demo/stream/:id` → keep-alive SSE stream of lifecycle events, `/health` shows active-run counter, legacy `/process` kept for curl. `demo-run.ts` decomposes the two-stage (summarize → translate) orchestration into labelled `stage_started/task_created/task_accepted/task_completed/task_paid/done` events. Env validation via hand-rolled zod-style guards. Multistage Dockerfile (pnpm 9 → builder → slim runtime, non-root user), `fly.toml` with three processes (orchestrator public / summarizer+translator internal only) on shared-cpu-1x 512mb. Deploy runbook at `docs/runbooks/deploy-demo-agents-flyio.md`.
- `milestone` **M-INT.5 complete** — `/demo` page drives live task lifecycle via SSE. `useDemoStream` hook: POST /api/demo/start → EventSource → dispatches `run_started/stage_started/task_created/task_accepted/task_completed/task_paid/done/error` into reducer-style DemoState (status, currentStage, per-step status, tx-by-step, accumulated txHashes, event log, final result). Five components: `TaskInput` (Watch live / Try with wallet toggle — wallet mode stubbed for M-INT.6), `StepTracker` (4 nodes, waiting-dashed → active-pulsing-ring → complete-filled-check with Basescan tx link each), `EventLog` (mono scroll with color-coded event names, auto-scroll to newest), `ResultPanel` (reveal animation, summary + translation side-by-side, metrics row for duration/USDC/tx-count, tx-hash chips), `ErrorPanel` (troubleshooting copy + retry). `demo-reveal` keyframe added to globals.css. Stage-aware status chip: idle → "summarizing · 1/2" → "translating · 2/2" → settled.
- `milestone` **M-INT.6 complete** — Try with wallet mode (BYO-wallet flow). EIP-2612 USDC permit signing via `viem.signTypedData` (domain "USD Coin" v2, 15-min permit window), TaskEscrow write ABI for `createTask` + `approvePayment` + `getTask`, `useWalletDemo` hook runs both stages sequentially: connect wallet → sign permit → writeContract createTask → poll TaskAccepted/Completed from chain → writeContract approvePayment → repeat for translate. Hook exports same DemoState shape as SSE hook so StepTracker/EventLog/ResultPanel stay mode-agnostic. `TaskInput` updated: wallet mode shows real USDC balance (`useReadContract`) with insufficient-balance warning, Connect-wallet CTA when disconnected, "Run with my wallet →" CTA when ready. 4 signatures per full run (2 permits + 2 approves) with auto-continue between stages. Demo page swaps hooks on mode switch with state reset. Next: M-INT.7 (anti-abuse + sponsor safety).

## 2026-04-22 (continued — coding session)

- `release` **v2.0 code complete.** All 8 milestones (M1–M8) implemented in a single coding session:
  - M1: pnpm monorepo scaffolded (core, adapter-evm, contracts, demo-agents)
  - M2: AgentRegistry + TaskEscrow — 100% test coverage, 74 tests (unit + integration + fuzz + invariant)
  - M3: CreateX deploy scripts + Base Sepolia deployment
  - M4: Full SDK `@sage/adapter-evm` — createSageClient, agent/task operations, event subscriptions
  - M5: x402 integration via @x402/fetch + payDirect escape-hatch
  - M6: Demo agents (Orchestrator, Summarizer, Translator) with OpenAI + mock fallback
  - M7: Security review — Slither clean, 600k invariant calls, security checklist
  - M8: Mainnet runbook ready
- `chain` **Base Sepolia deployed.** AgentRegistry: `0x5e95f92feeb4d46249dc3525c58596856029c661`, TaskEscrow: `0x12aef3529b8404709125b727ba3db40cd5453e1e`
- `milestone` **Mainnet deploy pending** — requires funded deployer on Base mainnet. Runbook ready at `docs/runbooks/deploy-base-mainnet.md`.

## 2026-04-22 (planning)

- `adr` **ADR-0004 Accepted** — settlement currency v2.0: USDC-only + EIP-2612 permit. Multi-token whitelist рассмотрен, отклонён для v2.0 из-за disproportionate cost; отложен в v2.1 через отдельный ADR и, вероятно, отдельный `TaskEscrowMultiToken` (новая соль CREATE3).
- `adr` **ADR-0005 Accepted** — repo structure: pnpm monorepo + Foundry + viem. Структура `packages/{core, adapter-evm, contracts, indexer}` + `apps/{demo-agents}`. v1 Hardhat-тесты не портируются (greenfield v2).
- `milestone` **Все blocking-оси закрыты** (A1, A2, A3, A4, A8). JIT-оси остаются (A5, A6, A7, A9, A10) с дефолтами.
- `sdd` **Planning завершён.** Сгенерированы `PRD.md`, `PLANNING.md`, `TASKS.md` (43 атомарных задачи в 8 milestones). AGENTS.md обновлён session-workflow секцией.
- `milestone` **Готовы к коду.** Следующая рабочая сессия = M1.1 из TASKS.md.

## 2026-04-21

- `rebrand` **AgentPay → Sage.** Проект пивотнут с LitVM-only на chain-agnostic multi-chain. Новый workspace: `D:\Sage\`. v1 в `D:\AgentsPay\` — archived reference.
- `scope` **EVM-first, non-EVM extensibility.** v2.0–v2.x — только EVM-сети (Base primary, затем Arbitrum/OP/BNB). Solana/NEAR — v3+.
- `decision` **x402 принят как транспорт pay-per-call.** `InferenceMarket.sol` из v1 — deprecated. Sage фокусируется на task-level escrow.
- `decision` **LitVM Builders Program submission отменён** в исходной форме. LitVM может стать одной из поддерживаемых сетей как opt-in adapter.
- `scaffolding` Создана базовая структура `D:\Sage\`: README, CLAUDE.md, AGENTS.md, IDEAS/GOTCHAS/BACKLOG, docs/{adr,architecture,runbooks}. KB-dossier `project-sage` создан; `project-agentpay` помечен archived.
- `adr` **ADR-0001 Accepted** — deterministic contract addresses через CreateX + CREATE3 + versioned salt. Единый адрес `AgentRegistry` / `TaskEscrow` на Base, Arbitrum, OP, BNB. zkSync / Polygon zkEVM исключены из same-address-набора в v2.
- `adr` **ADR-0002 Accepted** — agent identity: anchor-registry на Base + EAS-аттестации для профиля + single EOA на всех EVM + spoke-chains без registry (только TaskEscrow).
- `adr` **ADR-0003 Accepted** — x402 как единственный транспорт для pay-per-call; `InferenceMarket.sol` из v1 окончательно deprecated и не переносится. Sage-контракты фокусируются только на task-level escrow. Формализация ранее принятого D5.

## 2026-04-20 (v1, archived)

- `release` AgentPay v1 код завершён: 46 contract tests + 21 SDK tests, все 22 TASKS закрыты. Deploy на LiteForge testnet отложен.

## 2026-04-10 (v1, archived)

- `init` AgentPay v1 начат как LitVM-native протокол для Builders Program. См. `D:\knowledge\projects\project-agentpay.md` (archived).
