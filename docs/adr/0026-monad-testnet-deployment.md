# ADR-0026 — Monad testnet deployment: WMON settlement, approve-path, gas-limit policy

- **Status:** Accepted
- **Date:** 2026-08-10
- **Deciders:** Alex, Claude
- **Supersedes:** —
- **Related:** ADR-0001 (CreateX + CREATE3), ADR-0004 (USDC + permit — остаётся в силе для Base), ADR-0015 (Arc deploy bridge — прецедент порта), ADR-0017 (TaskEscrowV2 arbitration), ADR-0020 (useful-output pipelines)

## Context

Проект переориентируется на Monad testnet: питч-материалы под Monad Foundation (ecosystem whitepaper + дека, `docs/market/`) обещают «deploying to Monad as a configuration change» и MON-native settlement (§4.4 whitepaper). Base-прод в спячке с 2026-08-05 (решение Alex — остановить постоянный Alchemy-трафик), on-chain состояние Base не трогается.

Разведка `docs/research/monad-recon-2026-08.md` (S0) подтвердила: EVM-байткод-совместимость, нативный стейкинг через precompile, наличие WMON/Permit2/Multicall3/4337 на mainnet, x402-facilitator и ERC-8004-реестры в экосистеме. Три Monad-специфики, влияющие на порт: (1) канонический WMON почти наверняка без EIP-2612 permit; (2) газ-модель списывает `gas_limit`, а не `gas_used`; (3) присутствие CreateX не подтверждено.

Мультичейн-каркас уже существует (Arc-прецедент): chain-config в `@sage/adapter-evm`, `SAGE_CHAINS`/chain-picker в web, мультичейн reputation-индексер в gateway (M13.3), отдельный Fly app per chain.

Решения зафиксированы Alex 2026-08-10: объём — полный demo-стек (протокол + gateway + агенты + web, оба пайплайна e2e); settlement-токен — WMON.

## Decision

Деплоим Sage на **Monad testnet полным demo-стеком** по Arc-шаблону: AgentRegistryV2 + TaskEscrowV2 (тот же байткод) с **WMON как settlement-токеном** (соль `sage:escrow-wmon:v1`), **approve-путь** в SDK/оркестраторе вместо permit (контракт не меняется — permit уже в `try/catch`), **явная gas-limit-политика** во всех транзакционных путях (Monad списывает limit), Monad-upstream в gateway + опциональный env-флаг Base-индексации, `fly.monad.toml`-приложение для агентов, запись Monad в `SAGE_CHAINS`/chain-picker.

## Rationale

- **Ноль контрактных изменений.** `createTask` оборачивает permit в `try/catch` и падает в `safeTransferFrom` (`TaskEscrowV2.sol:146–150`) — WMON без permit работает через предварительный approve. Тот же audited-байткод, те же 77 тестов.
- **WMON соответствует питчу.** Вайтпепер §4.4 и дека продают «MON-native end to end»; testnet-USDC разошёлся бы с нарративом, который поедет в Monad Foundation.
- **Порт — конфигурация, и это уже доказано дважды.** Arc-порт (ADR-0015) оставил полный шаблон: chain-config файл, отдельный Fly app, мультичейн индексер, verification-ранбук. Заявление деки «configuration, not a rewrite» подтверждается делом.
- **Gas-limit-политика — дешёвая страховка.** Небрежный limit на Monad = реальная переплата (анти-DoS для async-execution). Ревизия лимитов заодно даёт замеры для side-by-side слайда.
- **Спячка Base не нарушается.** Monad-стек живёт на своих RPC и своих Fly-приложениях; Base-машины не стартуют. Единственная точка соприкосновения — gateway-деплой вернёт cron: Base-индексация закрывается env-флагом.

## Alternatives considered

### Option A — Testnet-USDC как settlement-токен
- Pros: ноль код-тачей вообще (permit работает, decimals 6 как на Base).
- Cons: расходится с «MON-native» нарративом вайтпепера/деки; demo на Monad показывал бы чужой стейбл вместо родного актива.
- Rejected because: порт делается под Monad-питч; нарратив дороже сэкономленного дня работы.

### Option B — Оба эскроу (USDC + WMON)
- Pros: скорость старта + нарратив.
- Cons: два деплоя, две записи конфигов, двойной e2e, размытая история «какой из них — настоящий».
- Rejected because: полный стек на WMON достижим без промежуточной ступени; multi-token — v2.1 (`TaskEscrowMultiToken`), не сейчас.

### Option C — Нативный MON-эскроу (новый контракт без ERC-20)
- Pros: без wrap/unwrap на краях.
- Cons: новый контракт = новый audit-цикл, ломает «same bytecode, same tests» — главный инженерный аргумент питча.
- Rejected because: вайтпепер §4.4 явно выбирает WMON-шорткат именно по этой причине.

## Consequences

**Положительные:**
- Monad-порт исполняет Phase 0–1 из деки (слайды 18/21) — контракты + оба пайплайна + staged failure с рефандом, всё проверяемо on-chain.
- Multi-token settlement фактически прибывает раньше срока (WMON ≠ USDC), как побочный эффект.
- Gas-limit-ревизия и замеры латентности → сырьё для side-by-side демо против Base.

**Отрицательные / компромиссы:**
- **Decimals 18 vs 6** — самый вероятный источник багов порта: захардкоженные USDC-допущения (парсинг сумм, подписи «USDC» в UI, `SPONSOR_MIN_BALANCE_USDC`-семантика, цены identities) требуют аудита по всему стеку.
- Wrap/unwrap MON↔WMON на краях — новая операционная обязанность оркестратора.
- Registry-адрес совпадёт с Base (CREATE3, те же соли), но escrow-WMON — новая соль → свой адрес; «same address everywhere» для эскроу не выполняется (уже заложено в whitepaper §4.4; память: CreateX — не selling point, не выпячиваем).
- Gateway-деплой возвращает cron (`wrangler.toml [triggers]`) — принято осознанно, Base-индексация гейтится флагом.

**Что потребует дальнейшего решения:**
- Канонический testnet-WMON адрес + chain-id/RPC/explorer — фиксируются в 14.0 (recon).
- CreateX на Monad testnet: если отсутствует — permissionless-деплой штатной процедурой (pcaversaccio/createx).
- Наблюдение делегаций для Stake-for-Work (события precompile vs epoch-снапшоты) — вне этого ADR, отдельная ось при старте S1.
- Testnet-валидатор / VDP-трек — отдельная операционная работа, не блокирует порт.

## Implementation notes

Разбивка — `TASKS.md` Milestone 14 (14.0 recon → 14.1 контракты → 14.2 SDK/оркестратор → 14.3 агенты → 14.4 gateway → 14.5 web → 14.6 e2e + замеры). Протокол проверки: локальные гейты → on-chain сверка деплоя (CREATE3-адреса, verified source, `token()==WMON`) → gas-limit сверка по receipts (limit ≤ ~1.3× used) → скриптовый одиночный цикл → полный e2e (website + research + failure-demo → on-chain рефанд) → browser-verify UI → регрессия «Base спит». Ранбуки — по образцу `deploy-arc-testnet.md` / `arc-testnet-verification-2026-05-21.md`.

## References

- `docs/research/monad-recon-2026-08.md` — S0-разведка (сеть, стейкинг, агентская инфраструктура, gap-чеклист)
- `docs/market/monad-ecosystem-whitepaper-2026-08.md` §4.4, §5 — MON-native решение и deployment plan
- docs.monad.xyz: developer-essentials/differences (gas-модель), reference/staking
- `packages/contracts/src/TaskEscrowV2.sol:146` — permit try/catch → approve-путь без контрактных изменений
