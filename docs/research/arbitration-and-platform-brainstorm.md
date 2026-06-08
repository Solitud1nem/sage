# Arbitration & Platform — brainstorm log

> Sibling к [`arbitration-and-platform-2026-06-04.md`](./arbitration-and-platform-2026-06-04.md) (концепт-снимок).
> Этот файл — **живой журнал решений** по брейншторму. Не ADR, не финальное решение, не план.
> Накапливается между сессиями, чтобы не пересобирать брейншторм с нуля.

Каждый блок ниже растёт по мере прохождения сессий. Когда решение готово стать формальным — переезжает в ADR или в IDEAS.md.

---

## Decisions log

### 2026-06-04 — структурные решения после первого брейншторма

- **Концепт-документ переехал в репо** → `docs/research/arbitration-and-platform-2026-06-04.md`.
- **Sage-as-platform = надстройка, не pivot.** Текущая v2 (`TaskEscrow` без admin) продолжает обслуживать «чистый» escrow case. Платформа = **второй слой** для тех, кому нужен суд (новый контракт с arbiter).
- **Profile of trust сдвигается с «нет admin» на «Sage может назначать суд».** Категория доверия — модель eBay / PayPal / Upwork (прозрачный рефери), не Compound / Uniswap (trustless). Это **называется честно** в материалах.
- **Раздел 8 концепт-документа → ADR-0017** (не ADR-0008 как ошибочно предложил концепт — `0008` уже занят positioning ADR). Контрактные решения не зависят от платформенной концепции и могут оформляться сразу.
- **Раздел 3–7 концепт-документа → amendment к ADR-0008**, не новый ADR. Положение Sage расширяется, не отменяется. (Решение Alex, 2026-06-04.)
- **Smallest first step = M11.1 (ADR-0017 + TaskEscrowV2).** Без `resolveDispute` платформа = «приходите, мы можем заморозить ваши деньги если поспорите». Без этого ничего другого не имеет смысла.

### 2026-06-08 — ADR landing

- **ADR-0008 amendment landed** (extension with arbitration layer). Status: Accepted; extended 2026-06-04.
- **ADR-0017 promoted Proposed → Accepted.** Contract decisions for `TaskEscrowV2` formalized: `resolveDispute(onlyArbiter)`, storage-based arbiter, `Refunded` reachable, split outcomes, versioned `:v2` salt. v2.0 contract stays canonical for trustless cases; v3.0 is opt-in arbitration layer.
- **ADR index updated** (`docs/adr/README.md`) with both status changes.
- **M11.1 Phase 1+2 shipped.** Contract `TaskEscrowV2.sol` + `ITaskEscrowV2.sol` + 35 Foundry tests (112/112 across suite, fuzz 256 runs on amount conservation). Slither clean vs v1 baseline. SDK: `TaskClientV2` interface in core, `createTaskEscrowV2Client` factory in adapter-evm, ABI extracted. Commit `3ba7d9c`.
- **M11.1 Phase 3 shipped.** `DeployV2.s.sol` + runbook + `.env.example` extension. Dry-run on Sepolia fork clean. Commit `6c452da`.
- **M11.1.9 — Sepolia deploy LIVE.** `TaskEscrowV2` deployed at `0x61c585630B32eee0b8c00306047c301B56419a81` on Base Sepolia (84532). Tx `0xdfa206…624b`, block 42567609, gas 1.72M (~$0.00003 at 0.006 gwei). Constructor args: USDC `0x036CbD…3DCF7e`, owner = arbiter = sponsor `0x6D8a…0376d`. Basescan verify ✅. Salt `0x6d8a…0376d 00 e1b74c…3c7` (deployer + chain-agnostic flag + entropy). Different from v1 sepolia address (`0x12aeF3…3E1e`) — confirms `:v2` salt rotation worked.
- **M11.1.10 — Live smoke clean.** Six `cast call` reads on Sepolia return expected values: owner / arbiter = sponsor, pendingOwner = 0x0, USDC = Base Sepolia Circle, GRACE_PERIOD = 300, nextTaskId = 0. Full lifecycle smoke (createTask → dispute → resolveDispute(Split)) deferred to frontend integration in M11.1.13 — the contract logic is exhaustively covered by 35 Foundry tests including fuzz, the deploy itself is the on-chain confirmation we wanted from M11.1.10.
- **M11.1.12 — Mainnet deploy LIVE.** `TaskEscrowV2` at **the same address as Sepolia** — `0x61c585630B32eee0b8c00306047c301B56419a81` — on Base mainnet (8453). Tx `0x9d5131…ed6d`, block 47057463, gas 1.72M (~$0.00003 at 0.006 gwei). Constructor: mainnet USDC `0x833589fCD…02913`, owner = arbiter = sponsor `0x6D8a…0376d`. Basescan verified ✅. **ADR-0001 invariant held**: same deployer + same `:v2` salt → identical address on Base + Base Sepolia despite chain-specific immutables (USDC differs). All 6 mainnet `cast call` reads return expected values.

**Next: M11.1.11 + M11.1.13 — drain v2 mainnet + orchestrator cutover.** Brief orchestrator pause window (~5-10 min) while in-flight composite runs terminate, then `chains/base.ts` `taskEscrow` address switches to `0x61c5…9a81`, adapter-evm rebuilt, Fly orchestrator + workers restarted. Then M11.1.14 frontend Pages redeploy + M11.1.15 changelog / KB / git tag `v3.0.0`.

**Reachable across environments (post-deploy):**
- v3.0 (arbitration-aware): `0x61c585630B32eee0b8c00306047c301B56419a81` on Base mainnet + Base Sepolia.
- v2.0 (canonical for in-flight): `0x12aeF3529b8404709125b727bA3Db40cD5453E1e` on Base mainnet + Base Sepolia (will deprecate from SDK after drain).

### 2026-06-08 (later) — M11.1 fully shipped (v3.0.0 tag)

- **Cutover landed.** `chains/base.ts` (both adapter-evm + apps/web) → `0x61c5…9a81`. Fly orchestrator + workers redeployed (image v15, rolling). Cloudflare Pages deploy `8b7d0e60`. No drain window required — `activeDemoRuns=0` pre-cutover.
- **CHANGELOG entry shipped** (2026-06-08 — TaskEscrowV2 LIVE). Explicit out-of-scope list documents what's NOT in M11.1 (AgentRegistry V2, council, appeal, indexer, Arc V3).
- **Tag `v3.0.0` created + pushed.** Annotated tag on the CHANGELOG commit `0d92996` references the deploy txs + contract address.
- **All 15 sub-tasks closed:** M11.1.1 contract → M11.1.7 SDK tests → M11.1.8 deploy script → M11.1.9 Sepolia → M11.1.10 smoke → M11.1.11 drain (no-op) → M11.1.12 mainnet → M11.1.13 cutover → M11.1.14 frontend → M11.1.15 release docs + tag.

**Next milestone: M11.2 — AgentRegistry V2 (capability + endpoint + price).** Demo-agents (own 4) register first; foreign agents in M11.3.

### 2026-06-08 (M11.2 close) — AgentRegistryV2 LIVE (v3.1.0 tag)

- **Contract:** `0x8df78599868Ec740C26F0eb0b660519b166cDd9e` on Base mainnet + Sepolia (same address — ADR-0001 invariant under registry-owner-only constructor). Owner = sponsor. Verified on both.
- **Demo workers registered on mainnet:** 4/4 via `RegisterDemoAgents.s.sol` — capability + 0.001 USDC flat price each. agentCount = 4.
- **SDK + types:** `RegistryCapability`, `AgentRecordV2`, `AgentClientV2`, `createAgentRegistryV2Client`. v1 `AgentClient` preserved for legacy.
- **Chain config:** new optional `agentRegistryV2` field added to `chains/base.ts` (both adapter-evm + apps/web). v1 `agentRegistry` unchanged — registries are parallel by design (v1/v2 signatures differ on `registerAgent`).
- **Cloudflare Pages:** deploy `8757ee0c`. **Fly orchestrator NOT redeployed** — no current consumer reads the registry; first consumer ships with M11.3 plan-editor.
- **Tests:** 149/149 Foundry (37 new V2 registry, 256-run fuzz). 30/30 adapter-evm SDK. Slither zero findings on V2 registry.
- **Tag:** `v3.1.0` on CHANGELOG commit.
- **Verification fallback noted:** Basescan auto-verify failed on mainnet (CREATE3 quirk); manual `forge verify-contract` with explicit `--constructor-args` worked second try. Same fallback that helped TaskEscrowV2.

**Next milestone: M11.3 — onboard first foreign agent via registry-driven discovery.** Plan-editor / classifier reads V2 registry by capability → picks executor → spawns task to a non-Sage-hosted worker. This is where the platform angle becomes operationally visible.

### 2026-06-08 (M11.3 close) — Registry-driven executor discovery live (v3.2.0 tag)

- **Classifier reads V2 registry** on every `/api/demo/composite/classify` call. For each sub-task: stem-match `type` → canonical capability → cheapest active agent → set `executor_address` + `estimated_cost_units` from registry price. Sub-tasks unmatched fall through to frontend env-var resolver as before.
- **Live smoke verified.** Brief `"Translate … then summarize …"` against `sage-demo-agents.fly.dev` returned both sub-tasks with registry-derived executor addresses (Translator `0xa61b…`, Summarizer `0x0DA5…`) and 1000-unit registry prices. **No hardcoded mapping in the path.**
- **Architecture:** lookup happens orchestrator-side. SDK helper `listActiveAgentsV2` (adapter-evm) + pure resolver helpers (`apps/demo-agents/src/parent/registry-resolver.ts`). Classifier accepts a `resolveExecutor` callback in `ParentEnv` — keeps `classify.ts` chain-agnostic. Frontend `resolveExecutorByType` remains as a fallback for now.
- **Tests:** 200/200 workspace-wide; 16 new resolver-helper tests including a foreign-agent-undercuts-demo case.
- **Tag:** `v3.2.0` on CHANGELOG commit.
- **Stub foreign-agent decision:** none registered. The substrate stands on the 4 demos discovered via registry; a real foreign agent gets onboarded when we go public-outreach.

**Next milestone candidates** (one of these next session, depending on direction):
- **M11.4 — off-chain council v1.** Single LLM-judge resolves disputes via the arbiter EOA. Connects ADR-0017 substrate to actual on-chain `resolveDispute` calls.
- **M11.3.X — frontend stops needing its env-var resolver.** Remove the fallback after we trust the orchestrator path. Mostly cleanup.
- **M11.6 — indexer (axis A7).** Aggregates TaskPaid / TaskDisputed / TaskResolved / Refunded into a reputation surface. Unblocks plan-editor showing executor reputation alongside price.
- **Real foreign-agent onboarding template** — a self-registering worker stub that operators can fork. Light-touch but needs design.

### 2026-06-08 (M11.3.X close) — env-var executor fallback removed; orchestrator sole authority

- **Decision:** clean removal (not a thin-fallback variant). Frontend `resolveExecutorByType` / `isKnownWorker` / `KNOWN_WORKER_ADDRESSES` deleted from `use-composite-demo.ts`. Executor selection is exclusively orchestrator-side via `AgentRegistryV2`.
- **Found two non-cosmetic things during scoping** (this was NOT a one-liner delete):
  1. The old `isKnownWorker` gate only trusted the 4 demo-worker env addresses → a registry-resolved **foreign** agent failed the gate and got silently re-routed to a demo worker, *defeating M11.3's whole point*. Removal closes that.
  2. `isKnownWorker` also defended against the LLM echoing a brief's recipient address into `executor_address`. So pure deletion would reopen that hole. Fix: orchestrator `classifyBrief` now **always strips** the LLM-emitted `executor_address` before registry resolution — the model never designates the executor. Invariant holds even on chains with no resolver (Arc).
- **Arc consequence accepted (Alex, 2026-06-08):** Arc has no V2 registry → Arc composite now needs manual executor assignment in the plan-editor. Documented in CHANGELOG + GOTCHAS + arc-bridge memory. Base = clean registry-only path. Parity returns with a V2 registry on Arc.
- **Tests:** 5 new in `classify-llm.test.ts`. demo-agents 147/147; web typecheck clean.
- **Shipped same session:** deployed Fly Base+Arc + Pages (`3ad05ed5`), committed + pushed (`c30a4f9`). Orchestrator-side smokes green (registry executors, LLM-echo strip, high-stakes strip, Arc unassigned).

### 2026-06-08 (MVP framing + M11.7 close) — path to MVP defined; faithful content delivery shipped

- **MVP target fixed (Alex):** показуемое демо — работа своих **и чужих** агентов, диспут + апелляция (human-ответ = стаб), декомпозиция, **полезные** решения подзадач. Карта 5 столбов → состояние составлена; критический путь и атомарные задачи занесены в `TASKS.md` секция **Milestone 11 — Path to MVP** (блоки 11.7 content / 11.4 council+dispute-raise / 11.5 appeal / 11.8 foreign-agent template).
- **Honest re-prioritization:** content-delivery (был отложен в BACKLOG утром) выдернут обратно на №1 — он load-bearing для столба «полезные выводы».
- **M11.7 SHIPPED.** ADR-0018 (Accepted): конверт `{parent, spec, source?, inputs?}` — `spec`=инструкция, `source`=бриф дословно (root), `inputs`=upstream-результаты (dependent). Codec (parent+worker) + plan-runner `buildContent` + 4 воркера (material-aware, под approval) + 20 тестов (166/166). Deployed Fly Base+Arc, health 200, фронт не трогали.
- **Известная находка-первопричина:** classifier режет исходник в короткий `spec` (904→103 симв); теперь воркер получает полный payload через `source`/`inputs`, объём не ломает.
- **Deferred (ADR-0018):** крупные payload'ы инлайнятся on-chain (storage-gas) — переход на content-addressed off-chain + хеш когда перерастёт.
- **Pending verification:** живой браузерный e2e >1KB перевод + 2-шаговая цепочка (unit-уровень зелёный).

**Next по плану MVP:** 11.4 — off-chain council v1 + dispute-raise trigger (столб 5).

---

## Open questions (по приоритету)

### Blocking сейчас

- **Split-формула.** Без частичного расчёта `resolveDispute` бинарен (Paid / Refunded), но реальные споры часто partial. Blocking для ADR-0017. _Открыто._
- **Vector axis schema.** Один из «техника / творчество» vs «проверяемые / оценочные». Это поле в `Plan` / `SubTask`, влияет на classifier + executor selection. Точный набор векторов можно стартовать с одного (`verifiable`), расширять JIT. Но **сам факт поля** — blocking для классификатора v2. _Открыто._

### JIT (по мере столкновения)

- Состав совета — стартовать с **1 LLM-судья + апелляция к человеку**.
- Алгоритм агрегации голосов — зависит от состава.
- Стоимость судейства — Sage платит сама себе на старте (раздел 5 концепта).
- Прецедентная память — start zero-precedent, накапливать с первого вердикта. Формат хранения определим к M11.5.

### Не было в концепт-документе, всплыло в брейншторме

- Как пользователь **находит** чужого агента? UI registry-explorer? Off-chain catalog? Парсинг events? _Открыто, скорее всего UI + индексер (см. ось A7)._
- Что нужно агенту чтобы стать «Sage agent»? Регистрация в `AgentRegistry` v2 + endpoint URI + capability spec. _Раскрывается в M11.2._
- Endpoint format — HTTP-only, on-chain event subscription, оба? _Открыто. Текущие 4 worker'а используют on-chain events (watch TaskCreated). Чужим агентам это может быть тяжело — HTTP push в registry может быть проще._

---

## Out of scope (явно отсечено)

Этот список — защита scope от drift'а в «и ещё бы сделать». Если кто-то возвращается к этим темам — нужна явная переоценка с обоснованием.

- ✘ Token / staking / Sybil-protection для судей — судьи наши, проблема исчезает (раздел 5 концепта).
- ✘ Cross-chain dispute coordination — v3+ (уже в `BACKLOG.md`).
- ✘ Decentralized judges (DAO of arbiters) — Sage = центральный арбитр. Децентрализация = v4+ если вообще.
- ✘ Slashing агентов — достаточно reputation из events + dispute rate.
- ✘ Continuous payments / streaming payments — отложено в `BACKLOG.md`.
- ✘ UUPS upgradability для arbiter — раздел 8 решил storage + setArbiter под Ownable, не proxy.
- ✘ Spec / Result format standardization beyond `data URI` envelope — отложить до момента когда чужие агенты начнут спорить о формате.
- ✘ Off-chain plan storage в IPFS — план в orchestrator runtime + reconstruct из events. Пересмотр при необходимости.

---

## Roadmap snapshot

> Черновая последовательность milestones. Сроков нет, порядок — да.

| # | Что | Status |
|---|---|---|
| **M11.1** | ADR-0017 + `TaskEscrowV2`. `resolveDispute`, `setArbiter` под `Ownable`, `Refunded` достижим, split-формула, single Sage-EOA arbiter. Deploy Sepolia → mainnet. БЕЗ council, БЕЗ платформенной концепции — техническая основа. | _planned_ |
| **M11.2** | `AgentRegistry V2`. Capability + endpoint + price. Demo-agents (наши 4) регистрируются. UI plan-editor читает из registry. | _planned_ |
| **M11.3** | Onboard первого foreign agent. Хостится не нами, удовлетворяет одной capability, picked by classifier. End-to-end composite с чужим агентом на Sepolia. — **первое демо платформенного концепта.** | _planned_ |
| **M11.4** | Off-chain council v1. 1 LLM-судья выносит вердикт, Sage-EOA вызывает `resolveDispute`. Прозрачность через trace decomposition вердикта. | _planned_ |
| **M11.5** | Appeal path + precedent memory. Human-in-loop апелляция, поправки в precedent storage. | _planned_ |
| **M11.6** | Indexer (ось A7) + reputation surface в UI. Аггрегация `TaskPaid`/`TaskDisputed` history per agent. | _planned_ |

**M11.1 unlocks всё остальное** — без resolveDispute платформа бессмысленна.

---

## Inventory — что уже есть в коде

> Утверждение раздела 3 концепта: «всё спит, нужно разбудить». Реально — частично.

| Кусок | Status | Что нужно доделать |
|---|---|---|
| `AgentRegistry` | Identity anchor на Base. Демо-агенты **не зарегистрированы**. | Schema change под discovery (capability / endpoint / price / status). Новый контракт = M11.2. |
| `specUri` / `resultUri` envelope | `data:application/json,{parent, spec}` для composite (ADR-0007) | Стандартизация JSON schema — off-chain spec, не контракт. Отложено до момента, когда реально потребуется. |
| Reputation events | `TaskPaid` / `TaskDisputed` пишутся | Indexer (ось A7) → M11.6. |
| Composition engine | Plan-runner + classifier + 4 наши workers | Расширение под чужих executors → M11.2-M11.3. Stem-matcher → capability-matcher. |
| Multi-chain | Anchor на Base (ADR-0002). Arc как sibling (ADR-0014/0015/0016). | Усиливается с платформой: registry per chain, identity якорится на Base. Соответствует существующим ADR. |
| Совет судей | **Нет ничего** | M11.4. Полностью new infra. |

---

## Ссылки

- [`arbitration-and-platform-2026-06-04.md`](./arbitration-and-platform-2026-06-04.md) — концепт-снимок.
- [`observable-decomposition.md`](./observable-decomposition.md) — ось decomposition, ADR-0007.
- [`../adr/0007-observable-decomposition.md`](../adr/0007-observable-decomposition.md) — формальное решение.
- [`../adr/0008-sage-angle-position.md`](../adr/0008-sage-angle-position.md) — текущее положение Sage, ожидает amendment по платформенной концепции.
- [`../../IDEAS.md`](../../IDEAS.md) — parking lot для незрелых идей.
- [`../../BACKLOG.md`](../../BACKLOG.md) — feature parking lot, scoped.
