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

## Волна 3 — частично закрыта (гигиена / drift / мелочь)

> ✅ CR.7 (SDK), CR.8 (web ABI→V3), CR.9 (docs sample), CR.10 (hygiene-batch), CR.11 (CLAUDE.md) исправлены и задеплоены 2026-06-09 (web→Pages, demo-agents→Fly Base+Arc, gateway→Worker). Остаток — мелкие/protected пункты ниже.

### ✅ SDK (`packages/`) — CR.7

- ✅ `task-escrow.ts` + `task-escrow-v2.ts` — `?? TaskStatus.Created` заменён на `decodeStatus()`/`decodeStatusV2()` (throw на статус вне 0–7; карты уже полны, так что throw недостижим для деплоенного контракта — но будущий enum больше не превратится в тихий `Created`).
- ✅ `events.ts` — `createEventSubscriptions` принимает `EventSubscriptionOptions { pollingInterval?, onError? }`; pollingInterval флорится на 10s, onError дефолтит в `console.error` (раньше viem молча глотал). Все 8 watch-вызовов прокинуты.
- ✅ `index.ts` — `TaskStatus` теперь value-export (`export { TaskStatus }`), value-import работает.
- ✅ `core/interfaces/task-client.ts` + `contracts/.../ITaskEscrow.sol` — doc исправлен `→ Expired` (проверено по контракту: `refundExpired` ставит `Expired`, эмитит `TaskExpired`).
- ✅ `task-escrow.ts` + `v2` — `TaskCreated`-lookup в receipt теперь фильтрует и по `escrowAddress`.
- 🔲 **Не делалось (отдельный заход):** `client.ts` x402-стаб cast/мёртвая ветка, `x402.ts` безусловный `response.json()`, `pay-direct.ts` док-дрейф, `listActiveAgentsV2` overshoot, дублированный `signPermit` (вынести + EIP-5267), `adapter-arc` name-drift, мёртвое событие `TaskRefunded` в v1-интерфейсе.

### ✅ Web (`apps/web/`) — CR.8/CR.9/CR.10

- ✅ ABI-mirror → V3: `task-escrow.ts` +`Split=7` +`executorShare`; `task-escrow-events.ts` +`TaskResolved` (+ `EVENT_TO_METHOD.resolveDispute` + case в `formatEventPayload` → live-tx-фид показывает арбитражные исходы worker/client/split). `use-wallet-demo.ts waitForCompletion` различает терминальные failure-статусы (Disputed/Refunded/Expired/Split → throw, не «успех»).
- ✅ `/docs/patterns` — устаревший `escrowAddress`-ternary сэмпл заменён на реальный `chainConfig.contracts.taskEscrow`.
- ✅ Оба `any`: `use-wallet-demo.ts:214` → `as unknown as PublicClient`; `posthog.ts` → `instance = posthog` синхронно после `init` (события между consent и loaded больше не теряются).
- ✅ PlanCard Approve-гейт валидирует `/^0x[a-fA-F0-9]{40}$/` (`'0x'`-placeholder больше не проходит).
- 🔲 **Не делалось:** generation-token'ы в `use-demo-stream`/`use-wallet-demo` (wallet-mode скрыт в UI — низкий приоритет), `chain: null` в wallet-mode writeContract, «Depends on» input на blur, `STATUS_COLORS` для awaiting-review/refunded, hardcoded `5042002`, `SAGE_CHAINS`/`wagmiConfig` Arc-drift.

### Backend / gateway мелочь — CR.10

- ✅ `dispute-flow.ts mapVerdict` — при `amount <= 1n` Split деградирует до Paid/Refunded (по `executorSharePct >= 50`), `resolveDispute` больше не реверт-ит на share=0.
- ✅ `server.ts readBody` — cap 1 MB (memory-DoS); оба stream-роута отрезают `?query` у runId.
- ✅ `orchestrator-proxy.ts` — `clientIp` доверяет только `CF-Connecting-IP` (спуфабельные fallback'и убраны); 502 больше не отдаёт `String(err)` наружу (логируется server-side).
- 🔲 **Не делалось (protected `shared/`):** `sse.ts:31` `ACAO: *` в `attach()` перекрывает CORS-allowlist (стримы world-readable, митигировано UUID-runId); `sse.ts` GC не убирает каналы зависших run'ов; `waitForTransactionReceipt` без `timeout`. Требует явного TASKS-таска для shared/.
- ⏸ `demo-run.ts` (protected): receipt-check на approvePayment (H3-остаток) + 2s/3s status-polling в `waitForCompletion`.

### ✅ CLAUDE.md / решения Alex — CR.11

- ✅ Корневой CLAUDE.md «Текущее состояние» обновлён: активный milestone M10 → M11, устаревший working-tree снапшот 2026-05-11 заменён актуальным (+ ссылка на этот review).
- ⏸ **Решение за Alex:** `wrangler.toml DAILY_LIMIT = "10"` при «3/IP/day» в позиционировании — синхронизировать текст или вернуть 3 (значение не менял, флаг оставлен в CLAUDE.md).
- ✅ Foreign-agent README: добавлены секции «runtime serves anything routed to your address» + «Deploying your fork» (B7/B8).

---

## Проверено и чисто (для калибровки будущих ревью)

- Контракты: CEI, `nonReentrant`, bounds `resolveDispute` — ок; enum'ы v1 (0–6) / V2 (0–7, Split=7) ↔ оба `STATUS_MAP` SDK сходятся; topic `TaskCreated` верифицирован keccak'ом; V2 ABI полностью соответствует `TaskEscrowV2.sol`; чтение V3 9-полевого `Task` через v1 8-полевый ABI безопасно (сознательно, задокументировано в коде).
- Polling-правило ≥10s соблюдено во всех живых путях (plan-runner 10s, воркеры/task-poller 15s, viem clients 15s, wagmi 30s).
- Секреты: ключи только из env, нигде не логируются; `briefPreview` усечён в трейсах.
- BigInt USDC base-units сквозные, float-математики нет. `any` — ноль в packages и demo-agents, два в web (см. выше).
- D1 rate-limit атомарен (`INSERT … ON CONFLICT … RETURNING`); SSE-cleanup в web-хуках корректен; ключи списков в React без index-багов; LLM-парсинг classify/council строгий (enum-checks, `parseBigIntStrict`, clamp).
