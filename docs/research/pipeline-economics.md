# Экономика useful-output пайплайнов (M12.0.4)

Дата: 2026-06-11 · Статус: рабочий расчёт под ADR-0020 · Обновлять при изменении цен моделей/API.

Принцип (ADR-0020): **внешние косты сидят в цене исполнителя** — identity назначает цену за задачу, покрывающую свои LLM/API-расходы; протокол не знает про OpenAI. Цены ниже — для регистрации в AgentRegistryV2 (USDC base units, 6 знаков).

## 1. Себестоимость единицы работы

**LLM (gpt-4o-mini: $0.15/M in, $0.60/M out; gpt-4o: $2.50/M in, $10/M out):**

| Шаг | Модель | Токены (in/out, оценка) | Себестоимость |
|---|---|---|---|
| copywriter | 4o-mini | 1.5k / 1.5k | ~$0.001 |
| builder (multi-file сайт) | **4o** (M12.1.5: дизайн-качество — решение Alex 2026-06-12) | 2.5k / 8k | ~$0.05 |
| packager (zip, без LLM) | — | — | ~$0 |
| qa-website (evaluator: verdict + Lighthouse + vision-скриншот, M12.1.5) | 4o-mini | 10k+img / 1k | ~$0.003 |
| searcher (5 SERP-запросов) | 4o-mini + SERP | 1k / 0.5k + API | ~$0.005–0.015* |
| extractor (×5 источников) | 4o-mini | 3k / 0.5k each | ~$0.004 |
| synthesizer | 4o-mini | 8k / 2k | ~$0.003 |
| fact-checker (URL-фетчи + verdict) | 4o-mini | 6k / 1k | ~$0.002 |
| module-splitter | 4o-mini | 5k / 1k | ~$0.001 |
| reviewer | 4o-mini | 15k / 3k | ~$0.004 |
| second-reviewer (**другая модель** — 4o) | 4o | 15k / 3k | ~$0.07 |

\* SERP: Serper.dev ≈ $1/1k запросов на стартовом пакете; Brave/Tavily сопоставимы. Выбор провайдера — M12.2.1.

**Gas (Base, ~0.01–0.05 gwei):** полный lifecycle задачи (createTask+permit / accept / complete / approve) ≈ 500–600k gas ≈ **<$0.01 даже при всплеске**; регистрация identity ≈ 250k gas — копейки. Gas платят: спонсор (create/approve) и identity-кошелёк (accept/complete) — отсюда требование ETH на identity-EOA.

## 2. Цены identities (для регистрации в V2)

С запасом ×3–10 от себестоимости (запас = маржа на ретраи хэндлера + рост токенов на реальных входах; «цена ≠ себестоимость» также делает демо-цифры на plan card осмысленными):

| Identity | Capability | Цена (units) | USDC |
|---|---|---|---|
| copywriter | `copywrite` | 30_000 | 0.03 |
| builder | `build-website` | 80_000 | 0.08 |
| packager | `package-archive` | 10_000 | 0.01 |
| qa-website | `qa-website` (evaluator) | 30_000 | 0.03 |
| searcher | `web-search` | 40_000 | 0.04 |
| extractor | `extract-content` | 30_000 | 0.03 |
| synthesizer | `synthesize-report` | 50_000 | 0.05 |
| fact-checker | `fact-check` (evaluator) | 60_000 | 0.06 |
| module-splitter | `split-modules` | 20_000 | 0.02 |
| reviewer | `structured-review` | 100_000 | 0.10 |
| second-reviewer | `structured-review-alt` (evaluator, 4o) | 150_000 | 0.15 |

Summarizer (1_000 units, `summarize`) переезжает capability'ей в research как synthesizer — его цена пересматривается при сносе (M12.4.1).

## 3. Бюджет полного рана (escrow со спонсора)

| Пайплайн | Шаги | Escrow/ран | Чистый кост/ран (LLM+API+gas)** |
|---|---|---|---|
| Website | copywriter+builder+packager+qa | **0.15 USDC** | ~$0.07 (M12.1.5: builder на 4o; ×2 при rework-цикле) |
| Research | searcher+extractor+synthesizer+fact-checker | **0.18 USDC** | ~$0.03 |
| Review | splitter+reviewer+second-reviewer | **0.27 USDC** | ~$0.08 |

\** Escrow уходит на НАШИ identity-кошельки — это циркуляция, не расход. Невозвратный кост рана = LLM + SERP + gas. Классификатор (~$0.002/classify) — поверх.

Все цифры с запасом внутри существующих гардов: `MAX_SUBTASK_UNITS` 0.5 / `MAX_PLAN_TOTAL_UNITS` 2 / `MAX_RUN_SPEND_UNITS` 3 / `MAX_RUN_TASKS` 12 — менять капы не нужно.

## 4. Проверка против 3/IP/day

- Гейт: один D1-бакет `demo_start` на `/api/demo/start` + все `/api/demo/composite/*` — composite-раны УЖЕ под лимитом (проверено в orchestrator-proxy.ts).
- 3 рана/IP/day × 0.27 USDC (худший пайплайн) = 0.81 USDC escrow-оборота на IP — при том что escrow возвращается. Невозвратно: ≤$0.25/IP/day.
- От множества IP защищает не лимит, а **floor спонсора** (`SPONSOR_MIN_BALANCE_USDC`, сейчас 1 USDC): максимальный суммарный драин = баланс − floor. При балансе ~10.8 USDC это ≤ ~36 худших ранов до автостопа — приемлемо для стадии.
- Run-caps (ADR-0007, M12.0.3) ограничивают каждый отдельный ран независимо от лимитера.

**Операционная нота — рециркуляция:** USDC скапливается на identity-кошельках; периодический sweep обратно на спонсора (ручной, раз в N ранов) закрывает цикл. Автоматизация — backlog.

## 5. EOA + газ + регистрация

- По EOA на identity (identity = кошелёк + capability + цена). Ключи — только Fly secrets (`<ID>_PRIVATE_KEY`), генерация — `scripts/new-identity-wallets.ts`.
- Газ на identity: 0.0005 ETH покрывает регистрацию + сотни accept/complete. На 4 website-identity: **0.002 ETH (~$6–7) — запрос фандинга Alex'у**; спонсорские 0.0042 ETH не трогаем (нужны самому спонсору).
- Endpoint при регистрации: `https://sage-workers.fly.dev` — это включает wake-пинги orchestrator'а (M12.0.2: пингуются только http(s)-endpoints; легаси `on-chain://task-events` не пингуется by design).
- **Порядок (отклонение от буквы M12.0.4, фиксируется здесь):** регистрация identity выполняется ТОЛЬКО вместе с её handler'ом (M12.1.1+) — зарегистрированная capability без handler'а маршрутизирует живые эскроу в никуда (classifier выберет её как cheapest). Поэтому M12.0.4 готовит EOAs + скрипт + цены, а `registerAgent` для website-четвёрки запускается в конце M12.1.1. Ранбук: `docs/runbooks/register-worker-identity.md`.
