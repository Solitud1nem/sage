# Code review 2026-06-09 — полный реестр находок

Полная ревизия кодовой базы (SDK + контракты, demo-agents backend, worker-gateway + foreign-agent template, web frontend) четырьмя параллельными ревью-агентами. Этот файл — канонический реестр: что найдено, что исправлено (волна 1), что отложено в волны 2/3 (таски — `TASKS.md`, секция CR).

Статусы: ✅ исправлено (волна 1) · 🔲 открыто (волна 2/3) · ⏸ отложено (protected-файл / нужно решение Alex).

---

## Волна 1 — исправлено в этой сессии (money-critical)

### ✅ H1. Drain спонсорского кошелька через `composite/execute` без аутентификации

`POST /api/demo/composite/execute` принимал полностью клиентский `Plan`: произвольный `executor_address` и произвольный `estimated_cost_units` (валидация — только «неотрицательное число»), без потолка суммы и без лимита числа сабтасков. `plan-runner` эскроуил указанную сумму из кошелька спонсора и в non-review режиме авто-апрувил выплату. Floor-guard (1 USDC) проверялся только на старте run'а — один запуск мог вынести весь остаток на адрес атакующего. Усугублялось A1 (см. ниже): gateway rate-limit покрывал только `/api/demo/start`, а Fly-приложение доступно напрямую.

**Фикс:**
- `apps/demo-agents/src/shared/env.ts` — новые env-потолки: `MAX_SUBTASK_UNITS` (default 500_000 = 0.5 USDC), `MAX_PLAN_SUBTASKS` (default 8), `MAX_PLAN_TOTAL_UNITS` (default 2_000_000 = 2 USDC).
- `apps/demo-agents/src/orchestrator/server.ts` — `checkPlanCaps()` после `parsePlanFromBody`: счёт сабтасков, per-subtask и total потолки, `estimated_cost_units > 0` (раньше «0» проходил парсер и падал уже после 202). Дефолты выбраны с запасом над выводом классификатора (≤0.2 USDC/сабтаск, ≤0.5 USDC/план в моках/практике).
- Executor-адрес сознательно **не** ограничен registry/known-set: «Custom address» — рабочая фича PlanEditor и permissionless-угол платформы; ущерб ограничен потолками сумм.

### ✅ A1. Composite-endpoints шли мимо rate-limit'а; Fly-приложение обходило gateway

Gateway rate-limit'ил только `POST /api/demo/start`; `composite/classify` (OpenAI spend), `composite/execute` и `composite/retry-subtask` (escrow + gas) форвардились без лимита. Кроме того, `sage-demo-agents.fly.dev` доступен напрямую — у orchestrator'а не было ни auth, ни своего лимита.

**Фикс:**
- `apps/worker-gateway/src/orchestrator-proxy.ts` — `RATE_LIMITED_POSTS`: `start`, `composite/classify`, `composite/execute`, `composite/retry-subtask` — общий daily-bucket `demo_start`. `review-decision` сознательно не лимитирован: он резолвит паузу, уже «оплаченную» залимитированным execute; отказ стрэндил бы легитимный run.
- Shared-secret hop: gateway добавляет заголовок `x-sage-gateway` (Worker secret `SAGE_GATEWAY_KEY`), orchestrator при выставленном `DEMO_GATEWAY_KEY` отклоняет state-changing POST'ы без него (401). Opt-in с обеих сторон → порядок rollout'а секретов не важен. Паттерн — зеркало существующего `SAGE_BACKEND_KEY` на `/api/rpc`.
- `apps/demo-agents/src/orchestrator/server.ts` — guard на `POST /api/demo/start | /process | /api/demo/composite/*`; GET (health, SSE streams) открыты.

**⚠️ Деплой-зависимость:** фикс становится активным только после (1) `wrangler secret put SAGE_GATEWAY_KEY`, (2) `fly secrets set DEMO_GATEWAY_KEY=<то же>` на Base и Arc apps, (3) deploy Worker + Fly. До этого поведение прежнее (без enforcement), ничего не ломается.

### ✅ H2. `cancel` на review-гейте выплачивал деньги executor'у

`/retry-subtask` (`retry|cancel`) и `/review-decision` (`approve|dispute`) резолвили одну и ту же нетипизированную паузу в `run-registry`. Review-гейт в `plan-runner` обрабатывал только `kind === 'dispute'` — все остальные kind'ы, включая `retry` и `cancel`, проваливались в `approvePayment`. Пока run стоял на ревью, `POST /retry-subtask {action:'cancel'}` с тем же runId/subId выплачивал средства executor'у — противоположно намерению пользователя. Симметрично, `approve`/`dispute` на dispute-retry паузе трактовались как cancel.

**Фикс:**
- `apps/demo-agents/src/parent/run-registry.ts` — `PauseGate = 'dispute-retry' | 'review'` в `PausedRun`; `awaitUserDecision` принимает gate; `resolveUserDecision` возвращает `'wrong-gate'` для kind'а чужого гейта (пауза остаётся открытой). `timeout` (внутренний, от таймера) допустим на любом гейте.
- `apps/demo-agents/src/parent/plan-runner.ts` — call-sites передают gate; review-гейт дополнительно держит defensive backstop: платёж только на `approve | timeout`, иначе `PlanError`.
- `apps/demo-agents/src/orchestrator/server.ts` — оба endpoint'а маппят `'wrong-gate'` → 409 с указанием правильного endpoint'а.
- Тесты: `test/parent/run-registry.test.ts` — wrong-gate в обе стороны + approve/dispute на review-гейте.

### ✅ H3 (частично). Receipts не проверялись на `reverted` в денежных путях

`waitForTransactionReceipt` вызывался, но `receipt.status` игнорировался. Замайненный-но-revert'нутый `approvePayment` / `disputeTask` / `resolveDispute` рапортовался как успех: ложные `subtask_paid` / `subtask_dispute_resolved` SSE-события и аналитика, а для `resolveDispute` — task застревал в `Disputed` с залоченными USDC. Воркеры (`*/agent.ts`) делали это правильно; M11-код — нет.

**Фикс:**
- `apps/demo-agents/src/parent/plan-runner.ts` — `waitReceiptOrThrow()`; оба approvePayment-пути ждут и проверяют receipt **до** эмита `subtask_paid` (раньше эмит шёл до wait'а).
- `apps/demo-agents/src/parent/dispute-flow.ts` — обе receipt-проверки (`disputeTask`, `resolveDispute`) с throw на revert → честный `plan_failed`.
- Тест: reverted approvePayment → `plan_failed`, без `subtask_paid` (`plan-runner.dispute.test.ts`).
- ⏸ **Остаток:** `demo-run.ts:224` (3-mode flow) — тот же паттерн, но файл под правилом «не менять» (`apps/demo-agents/CLAUDE.md`). Риск ниже (fixed-amount задачи на своих воркеров). → таск CR.10.

**Верификация волны 1:** build ок, `tsc --noEmit` чистый (demo-agents + worker-gateway), 188/188 тестов (было 184, добавлено 4).

---

## Волна 2 — частично закрыта (robustness / funds-stranding / template)

> ✅ CR.1 (B1–B5), CR.4 (M3), CR.6 (A2) исправлены и (где есть live-surface) задеплоены 2026-06-09 — см. CHANGELOG «волна 2». Остаются CR.2, CR.3, CR.5, A2-остаток ниже.

### ✅ B1–B5. Foreign-agent template guards (CR.1, High) — исправлено

`templates/foreign-agent/src/index.ts` — poll-loop принимал любую `Created`-задачу на свой адрес без guard'ов. Исправлено:
- `rejectReason()` перед accept (бесплатно — `amount`/`deadline` уже в руках из poll'а): skip при `amount < MIN_TASK_UNITS` (default = PRICE_UNITS) и `deadline <= now + MIN_DEADLINE_MARGIN_S` (120).
- `MAX_MATERIAL_CHARS` (100k) — усечение payload'а перед handler'ом.
- B2 `BOOT_SCAN_BACK` (200) — scan-back от head на boot (offline-задачи не black-hole'ятся; executor+Created фильтр обеспечивает идемпотентность).
- B3 `executeWithRetry` (`HANDLER_RETRIES`=2) — retry handler'а на transient-фейле.
- B4 receipt-check на `completeTask` (revert → task остаётся Accepted для retry/deadline).
- B5 `inFlight` flag + drain (25s) в `pauseOnShutdown` — shutdown между accept и complete больше не стрэндит эскроу.
- README: секции «runtime serves anything routed to your address» + «Deploying your fork» (B7/B8).
- ⏸ Живого инстанса нет (parked) — деплоить нечего; вступит в силу при поднятии M11.8.2.

### 🔲 M4. Summarizer/translator падают на OpenAI error-ответах, стрэндя эскроу (Medium)

`src/summarizer/agent.ts:59-60`, `src/translator/agent.ts:64-65` — нет проверки `res.ok` / `data.error`; на 429/5xx `data.choices[0]` бросает TypeError, catch только логирует — task навсегда в `Accepted`, plan-runner таймаутится, эскроу застревает. Vision/sentiment уже делают правильно (`data.error` + `data.choices?.[0]`) — портировать паттерн. **Protected-файлы** — таск CR.2 в TASKS.md и есть требуемый явный таск.

### 🔲 M2+M1. Застрявшие эскроу не возвращаются; dispute-retry плодит двойной эскроу (Medium)

- M2: при таймауте `pollUntilCompleted` или упавшем approve план фейлится, а USDC лежат в Created/Accepted задаче — никто не зовёт refund/expiry (`refundExpired` в кодовой базе не вызывается вообще). Минимум: логировать orphaned taskIds в `plan_failed` payload; лучше — best-effort refund по deadline.
- M1: `plan-runner.ts` retry-путь после `DisputedError` создаёт новый `createTask`, не разрулив старый `Disputed` (его USDC залочены навсегда). Сегодня low-reachability (диспутить может только client EOA = сам orchestrator), но путь прошит до публичного endpoint'а.

### ✅ M3. Council prompt-injection (CR.4, Medium) — исправлено, задеплоено

`src/parent/council.ts` — `spec`/`result`/`reason` шли в сообщение судьи сырыми. Исправлено: `fenceSection()` оборачивает каждую секцию в `===== BEGIN <label> (untrusted) =====` … `===== END =====` с санитизацией forged-делимитеров (`=====` в контенте → `= = =`), плюс SECURITY-блок в SYSTEM_PROMPT (секции — untrusted data, не выполнять инструкции внутри, только system-сообщение авторитетно). +2 теста. Задеплоено Fly Base+Arc.

### 🔲 Web-H1. Упавший review-POST молча съедает промпт (High для UX, не для денег)

`apps/web/hooks/use-composite-demo.ts:387-436` — `submitReview` оптимистично чистит `awaitingReviewSubId` до fetch'а; при ошибке промпт исчезает, `state.error` не рендерится (ErrorPanel только при `status==='error'`), пользователь не может ре-решить. Фикс: восстановить `awaitingReviewSubId` в catch + inline error-banner при `error && status==='executing'`. То же для `retry`.

### ✅/⏸ A2. `/api/rpc` — method-фильтр (CR.6, Medium) — частично исправлено, задеплоено

`apps/worker-gateway/src/rpc-proxy.ts` — форвардил любой JSON-RPC метод. Исправлено: `checkRpcMethods()` отклоняет billable-семейства по префиксам (`alchemy_`/`trace_`/`debug_`/`erigon_`/`parity_`). **Выбран denylist вместо allowlist'а** (как предлагал ревью) ради MVP-safety: viem issues версионно-широкий набор `eth_*` (fee-estimation, filter-семейство за `watchContractEvent`, несколько вызовов в `waitForTransactionReceipt`) — пропущенный метод молча сломал бы demo; вектор злоупотребления — именно metered enhanced-API. Задеплоено Worker, смоук 5/5. ⏸ **Остаток:** Origin-спуфинг (auth по заголовку) и отсутствие per-IP лимита на `/api/rpc` сохраняются сознательно — per-IP daily counter сломал бы легитимный высокочастотный RPC (один run = десятки `eth_call`); auth-гейт + method-denylist приняты как достаточные controls для прототипа.

### 🔲 B2–B5. Foreign-agent template: устойчивость (Medium)

- B2 `index.ts:205` — курсор стартует с текущего head: задачи, созданные пока агент офлайн, навсегда теряются (эскроу клиента залочен до deadline). Сканировать окно назад или персистить курсор.
- B3 `index.ts:189-191` — упавший handler после accept не ретраится; task застревает в `Accepted`.
- B4 `index.ts:190-191` — `completeTask` без receipt-проверки (у `acceptTask` она есть).
- B5 `index.ts:151-165` — shutdown между accept и complete бросает задачу; нужен drain in-flight.

---

## Волна 3 — открыто (гигиена / drift / мелочь)

### SDK (`packages/`)

- 🔲 `adapter-evm/task-escrow.ts:227` + `task-escrow-v2.ts:262` — `STATUS_MAP[...] ?? TaskStatus.Created`: неизвестный on-chain статус молча маппится в активный `Created` (класс ошибки «cutover ≠ address swap»). Должен throw.
- 🔲 `adapter-evm/events.ts` — все 8 `watchContractEvent` без `onError` (viem молча глотает transport-ошибки) и без управления `pollingInterval` (наследуется 4s default клиента — против правила ≥10s для потребителей библиотеки).
- 🔲 `adapter-evm/index.ts:10-25` — `TaskStatus` (runtime enum) реэкспортирован под `export type` — value-import у потребителя падает на build.
- 🔲 `core/interfaces/task-client.ts:55` + `contracts/src/interfaces/ITaskEscrow.sol:127` — док-комментарий `refundExpired → Refunded`, фактически → `Expired` (+ в v1-интерфейсе мёртвое событие `TaskRefunded`, никогда не эмитится).
- 🔲 `adapter-evm/task-escrow.ts:140` — поиск `TaskCreated` в receipt без фильтра по `address` контракта.
- 🔲 `adapter-evm/client.ts:76-78` (unsound cast + мёртвая ветка x402-стаба), `x402.ts:85` (безусловный `response.json()`), `pay-direct.ts` (док-дрейф «with permit»), `agent-registry-v2.ts:46-67` (`listActiveAgentsV2` может вернуть > maxAgents), дублированный `signPermit` с hardcoded EIP-712 `version: '2'` (вынести + EIP-5267 fallback), `adapter-arc/chain.ts` vs `adapter-evm/chains/arc.ts` — `name: 'Arc'` vs `'arc-testnet'` при заявленном «mirror».

### Web (`apps/web/`)

- 🔲 ABI-mirror отстал от V3: `lib/abi/task-escrow.ts` без `Split = 7` и `executorShare`; `task-escrow-events.ts` без `TaskResolved` → live-tx-фид никогда не покажет арбитражные исходы. `use-wallet-demo.ts:323` `status >= Completed` трактует Disputed/Refunded/Expired/Split как успех.
- 🔲 `/docs/patterns` (page.tsx:51-53) публично учит `escrowAddress`-ternary анти-паттерну из GOTCHAS, подписанному как «actual production agent» — в реальном коде он давно выпилен. Обновить сэмпл.
- 🔲 `use-demo-stream.ts` / `use-wallet-demo.ts` — нет generation-token'а: stale run может влить события/стейт в сброшенный UI; `reset()`+`start()` реанимирует отменённый wallet-run (wallet-mode сейчас скрыт в UI). `use-wallet-demo.ts:227,275` — `writeContract` с `chain: null` отключает chain-id валидацию.
- 🔲 Два `any` (`use-wallet-demo.ts:214`, `lib/posthog.ts:54` — второй заодно теряет события между consent и async-загрузкой PostHog: присваивать `instance` синхронно после `init`).
- 🔲 PlanEditor: «Custom address» `'0x'`/мусор проходит Approve-гейт (валидировать `/^0x[a-fA-F0-9]{40}$/`); «Depends on» input дерётся с пользователем (парсить на blur); SubtaskDrawer `STATUS_COLORS` без `awaiting-review`/`refunded`; hardcoded `5042002` в трёх местах (импортировать из `chains/arc.ts`); `SAGE_CHAINS` включает Arc, а `wagmiConfig` — нет (латентный drift; Arc-эскроу — pre-arbitration контракт, при подключении Arc к wallet-mode нужен re-audit ABI-допущений).

### Backend / gateway мелочь

- 🔲 `shared/sse.ts:31` — `attach()` пишет `Access-Control-Allow-Origin: *` в `writeHead`, перекрывая CORS-allowlist сервера (стримы world-readable; митигировано UUID-runId).
- 🔲 `server.ts readBody` — без лимита размера (memory-DoS); stream-роуты не отрезают `?query` у runId; `sse.ts` GC не убирает каналы зависших run'ов (плюс `waitForTransactionReceipt` без `timeout` — зависшая tx держит канал вечно).
- 🔲 `dispute-flow.ts mapVerdict` — при `amount === 1n` Split-clamp даёт `executorShare = 0` → revert `resolveDispute`; деградировать вердикт до worker/client при `amount <= 1n`.
- 🔲 `orchestrator-proxy.ts:92-99` — спуфабельные `X-Real-IP`/`X-Forwarded-For` fallback'и (мертвы за Cloudflare, опасны при смене фронта); `detail: String(err)` в 502-ответах наружу.
- ⏸ `demo-run.ts` (protected): receipt-check на approvePayment (H3-остаток) + 2s/3s status-polling в `waitForCompletion` (формально не `watchContractEvent`, но та же квота Worker'а; bounded, не горит).

### Требует решения Alex

- ⏸ `wrangler.toml DAILY_LIMIT = "10"` при «3/IP/day» в корневом CLAUDE.md (комментарий в файле говорит «rebaselined 2026-05-21») — синхронизировать доку или вернуть 3. Заодно: корневой CLAUDE.md всё ещё называет активным M10 и описывает «незакоммиченное working tree» от 2026-05-11 — секция «Текущее состояние» устарела.
- ⏸ Foreign-agent README: добавить предупреждение «runtime исполняет всё, что назначено на твой адрес» + строку «отредактируй app/RPC_URL/ENDPOINT в fly.toml» (B7/B8: дефолтный `ENDPOINT=example.com` уходит on-chain при пропущенном env).

---

## Проверено и чисто (для калибровки будущих ревью)

- Контракты: CEI, `nonReentrant`, bounds `resolveDispute` — ок; enum'ы v1 (0–6) / V2 (0–7, Split=7) ↔ оба `STATUS_MAP` SDK сходятся; topic `TaskCreated` верифицирован keccak'ом; V2 ABI полностью соответствует `TaskEscrowV2.sol`; чтение V3 9-полевого `Task` через v1 8-полевый ABI безопасно (сознательно, задокументировано в коде).
- Polling-правило ≥10s соблюдено во всех живых путях (plan-runner 10s, воркеры/task-poller 15s, viem clients 15s, wagmi 30s).
- Секреты: ключи только из env, нигде не логируются; `briefPreview` усечён в трейсах.
- BigInt USDC base-units сквозные, float-математики нет. `any` — ноль в packages и demo-agents, два в web (см. выше).
- D1 rate-limit атомарен (`INSERT … ON CONFLICT … RETURNING`); SSE-cleanup в web-хуках корректен; ключи списков в React без index-багов; LLM-парсинг classify/council строгий (enum-checks, `parseBigIntStrict`, clamp).
