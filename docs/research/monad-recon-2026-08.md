# Monad recon — что есть у Monad и что нужно Sage (S0)

Дата: 2026-08-05 · Источник: docs.monad.xyz (+ поиск) · Статус: разведка под whitepaper §4 (Stake-for-Work) и §5 (deployment). Обновлять при изменении сетевых параметров.

## 1. Сеть и деплой

| Параметр | Значение |
|---|---|
| Chain ID | **143** (mainnet); есть testnet |
| Валюта | MON; block time ~0.4s (50,000 блоков/эпоху ≈ 5.5 ч) |
| EVM | Байткод-совместимая; лимит контракта **128KB** (vs 24KB), initcode 256KB; память линейная (8MB/tx); repriced-опкоды; новый precompile P256 `0x0100` (WebAuthn) |
| **Gas-модель** | ⚠️ **Списывается gas_limit, а не gas_used** (`value + gas_bid × gas_limit`) — анти-DoS для async-execution. Наши агенты/оркестратор обязаны выставлять аккуратные лимиты — небрежный limit = реальная переплата |
| Reserve balance | Механизм гарантии оплаты включённых tx; edge: tx может попасть в блок и revert'нуться, съев газ |
| EIP-7702 | Делегированный EOA: **CREATE/CREATE2 запрещены** + минимум 10 MON на балансе. Наш деплойер — обычный EOA, ок |
| RPC | 16 провайдеров mainnet, **Alchemy поддерживает** (public 15 rps) — gateway расширяется одним upstream'ом |
| Explorers | monadvision.com, monadscan.com |

**Каноничные контракты (mainnet):** WMON `0x3bd359C1119dA7Da1D913D1C4D2B7c461115433A` · Permit2 `0x0000...ba3` · Multicall3 `0xcA11...CA11` · Safe `0x69f4...2938` · 4337 EntryPoint v0.6 `0x5FF1...2789`.
**CreateX (ADR-0001):** присутствие на Monad НЕ подтверждено доками/поиском — проверить `0xba5Ed0...ba5Ed` на monadscan; если нет — CreateX деплоится permissionless на тот же адрес (штатная процедура репо pcaversaccio/createx), после чего наши CREATE3-адреса совпадут с Base.
⚠️ WMON-адрес НЕ vanity-совместим с «same address everywhere» — наш `TaskEscrow` на WMON будет иметь свой адрес (соль `sage:escrow-wmon:v1`), это ок и уже заложено в §4.4 whitepaper.

## 2. Стейкинг (фундамент Stake-for-Work) — всё подтверждено

- **Делегация — нативная, через precompile `0x1000`:** `delegate{value}(validatorId)` / `undelegate(validatorId, amount, withdrawId)` / `withdraw` / `claimRewards` / `compound`. Минимум — 1 gwei (dust threshold). Изменения активируются на границах эпох (~5.5 ч).
- **Комиссия валидатора 0–100%, задаётся валидатором** → наша модель «стандартные ~10%, поинты из комиссии» реализуема буквально. Механика наград: 18 MON/блок + priority fees валидатору-продюсеру; после комиссии — pro-rata делегаторам.
- **Unbonding: 1 эпоха (~5.5 ч)** — короткий. Следствие для дизайна: exit-friction минимальный, tenure-тиры становятся единственным удержанием (и это ок — так и задумано); «continuous tenure» меряем по эпохам.
- **Слэшинга сейчас нет** («automated in-protocol slashing is not currently implemented») — риск-дисклеймер в §4.7 можно смягчить до «slashing not currently implemented; may change».
- **Активный сет: топ-200 по стейку, порог = self-delegation ≥ 100,000 MON + total ≥ 10,000,000 MON.** Вне сета блоков нет → наград нет → поинтов нет. Это главный bootstrap-барьер.
- **VDP (Validator Delegation Program) — наш путь через барьер:** фонд делегировал ~9.3B MON на 170 валидаторов (Wave 1), тиры 25M / 52.5M / 75M / 90M MON — любой тир закрывает порог сета. Требования: ≥4 недель работы на testnet, KYC/KYB, uptime ≥98%, апгрейды ≤48 ч, MEV-политика, **комиссия ≤15%** (наши 10% вписываются). Действие для S1: testnet-валидатор сразу + заявка в VDP.
- APR-прикидка: 18 MON/блок × ~79M блоков/год ≈ 1.4B MON/год инфляции на весь сет; при 15–25B застейканных → **~6–9% gross APR** — наша консервативная модельная 5% ок, реальную ставку подставить после замера.

## 3. Агентская инфраструктура Monad (что уже есть)

- **x402 Facilitator (официальный, live):** `x402-facilitator.molandak.org`, mainnet+testnet, USDC-платежи, газ за клиента. → Sage-позиционирование «pay-per-call делегируем x402» работает на Monad из коробки; USDC на Monad существует (наша MON-native ставка — выбор, не необходимость).
- **MPP (Machine Payments Protocol):** SDK `@monad-crypto/mpp`, HTTP 402 + одноразовые ERC-20 переводы (push/pull через `transferWithAuthorization`). Это pay-per-call, НЕ escrow. **Ниша multi-step verification-gated escrow свободна** — прямых аналогов Sage в их стеке нет.
- **ERC-8004 Trustless Agents — реестры задеплоены на Monad:** Identity `0x8004A169FB4a3325136EB29fA0ceB6D2e539a432` (ERC-721 agent cards), Reputation `0x8004BAa17C55a88189AE136b182e5fdA19dE9b63` (on-chain feedback), Validation — в разработке. → Точка интеграции: дуал-регистрация наших identities (AgentRegistryV2 + ERC-8004 identity), публикация нашего reputation-скора туда же — мгновенная легитимность в их экосистеме; их «Validation registry (in development)» — это ровно то, что у нас уже live (evaluator-вердикты) → сильный грант-аргумент.
- **Monad MCP Server** (гайд) + сторонний monad-agent-kit (MCP-доступ к чейну) — стыкуется с нашей идеей MCP-коннекторов (§8.1 whitepaper).
- AA-инфраструктура: 4337 EntryPoint, провайдеры AA/embedded wallets, шаблоны sponsored-tx → gasless-onboarding (§8.1) обеспечен экосистемно.

## 4. Gap-чеклист: поднять Sage на Monad

1. **CreateX:** проверить/задеплоить на 143 → Deploy.s.sol работает как есть (соли `sage:registry:v1` — те же адреса, что Base; escrow-WMON — новая соль).
2. **Контракты:** тот же байткод; `TaskEscrow` деплой с token=WMON. Проверить permit: **WMON вряд ли поддерживает EIP-2612 permit** → путь approve/transferFrom или обёртка; уточнить интерфейс WMON (это единственный вероятный код-тач в SDK).
3. **Gas-модель:** пройтись по orchestrator/agents — везде явные разумные gas limits (списывается limit!); пересчитать цену полного цикла с учётом repriced-опкодов.
4. **Gateway:** +Alchemy Monad upstream (или Ankr/QuickNode), `chainConfigs` индексера уже мультичейн (M13.3 Arc-паттерн) — добавить Monad escrow+fromBlock.
5. **Async execution / RPC-отличия:** прочитать RPC differences перед e2e (eth_getLogs-семантика, спекулятивные данные); историческое состояние ограничено — индексеру важен свежий fromBlock.
6. **Стейкинг-индексер (Stake-for-Work):** событий precompile в доках не видно — выяснить, как наблюдать делегации (execution events? getLogs по 0x1000? опрос view-методов по эпохам). Кандидат: epoch-снапшоты `delegate`-состояния через staking API.
7. **Валидатор:** testnet-валидатор (hardware по node-ops docs) → 4 недели наработки → VDP-заявка (KYC) → mainnet + self-bond 100k MON (запросить в грант/у фонда).
8. **ERC-8004 дуал-регистрация** наших identities + фид репутации (новый маленький скрипт по образцу register-identity).

## 5. Testnet (S0.5 — разведка под M14, проверено вживую 2026-08-10)

Статус: параметры сверены живыми RPC-вызовами (не только доки). Основание — ADR-0026 / TASKS.md Milestone 14.

| Параметр | Значение | Как проверено |
|---|---|---|
| Chain ID | **10143** (`0x279f`) | `eth_chainId` live ✓ |
| RPC (основной) | `https://testnet-rpc.monad.xyz` (QuickNode; 50 rps, 25 rps для call/estimate, batch 100, archive) | live ✓ |
| RPC (альтернативы) | Ankr `rpc.ankr.com/monad_testnet` (300/10s, без archive) · MF `rpc-testnet.monadinfra.com` (20 rps, archive) | доки |
| Explorers | `testnet.monadvision.com` · `testnet.monadscan.com` | доки |
| Faucet | `faucet.monad.xyz` (официальный); ETHGlobal 0.2 MON/day; OpenBuild | доки/поиск |
| **WMON (канонический)** | **`0xFb8bf4c1CC7a94c73D209a149eA2AbEa852BC541`** — код на месте, `symbol()=WMON`, **`decimals()=18`** | `eth_getCode`+`eth_call` live ✓ |
| **WMON permit** | **НЕТ EIP-2612**: `DOMAIN_SEPARATOR()` и `nonces()` возвращают `0x` (WETH9-стиль) → **approve-путь подтверждён** (ADR-0026); `try permit{}catch{}` в `createTask` уходит в fallback без вреда | `eth_call` live ✓ |
| **CreateX** | **`0xba5Ed099633D3B313e4D5F7bdc1305d3c28ba5Ed` — ЗАДЕПЛОЕН** (код на месте). Гэп §1 закрыт: CreateX канонический и на mainnet (доки network-information), и на testnet → Deploy.s.sol работает как есть, permissionless-деплой не нужен | `eth_getCode` live ✓ |
| Gas price | base ≈ **102 gwei**, `eth_maxPriorityFeePerGas` = hardcoded **2 gwei** | `eth_gasPrice` live ✓ |
| Прочие канонические | Multicall3 `0xcA11…CA11` · Permit2 `0x…ba3` · EntryPoint v0.6/0.7/0.8 · Safe v1.4.1 набор · Foundry Deterministic Deployer `0x4e59…956c` | доки |

**Газ-математика (по лимиту! Monad списывает `gas_bid × gas_limit`):** полный одиночный цикл ≤600k limit ≈ **0.06 MON**; composite-ран ~20 writes ≈ 0.2–0.4 MON; деплой Registry+Escrow ≈ 0.3–0.5 MON. Фасет ETHGlobal (0.2/day) — только на капли; для стека нужен официальный faucet и/или запрос у Monad (testnet-support контакт — он же в деке слайд 22 как non-monetary ask).

**Оценка фандинга M14 (кошельки создаёт Alex, кастоди-правило 2026-06-11):** deployer ~3 MON · sponsor/orchestrator ~10–15 MON (e2e-раны + wrap в WMON для эскроу) · 8–9 worker-identities по ~1 MON (completeTask/verdict) → **суммарно ~25–30 MON** на комфортный M14 с запасом на повторные e2e.

**RPC-отличия, важные для нас (reference/rpc-differences):**
- **`eth_getLogs` chunk ≤100 блоков** на QuickNode/MF (Alchemy-эндпоинт mainnet — 1000/10k логов). Блоки по ~400ms → индексер M13.3 на Monad обязан ходить мелкими чанками; fromBlock строго = блок деплоя эскроу (бэкфилл с нуля бессмыслен и невозможен — историческое состояние ограничено).
- `eth_sendRawTransaction`: deferred nonce/balance-валидация, **pending tx не виден** через `eth_getTransactionByHash` → ждать receipt (viem `waitForTransactionReceipt` ок при 400ms блоках), не опрашивать pending.
- `eth_feeHistory` дублирует последний `baseFeePerGas`; blob-tx нет; `newPendingTransactions`-подписок нет.
- Reserve balance: tx может попасть в блок и revert'нуться с оплатой газа — receipt-чеки обязательны (у нас уже есть после CR-волны).

## Источники

docs.monad.xyz: reference/staking/{overview,api} · monad-arch/consensus/staking · developer-essentials/{network-information,differences} · tooling-and-infra/{agentic-payments,rpc-providers} · reference/mpp/overview · guides/erc-8004 · node-ops/validator-delegation-program · github.com/pcaversaccio/createx · github.com/stakeme-team/monad-agent-kit
