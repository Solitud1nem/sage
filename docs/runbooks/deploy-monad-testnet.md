# Deploy Sage contracts to Monad testnet

Per [ADR-0026](../adr/0026-monad-testnet-deployment.md). One-time deploy of
`AgentRegistryV2` + `TaskEscrowV2 (WMON)` on Monad testnet (chainId **10143**)
via CreateX + CREATE3. After the deploy lands, paste the resulting addresses
into `packages/adapter-evm/src/chains/monad.ts` + `apps/web/chains/monad.ts`
(M14.2.1 / M14.5.1) and record the **escrow deploy block** — it becomes the
reputation-indexer `MONAD_ESCROW_FROM_BLOCK` (M14.4.2).

Разведка с живыми RPC-проверками — `docs/research/monad-recon-2026-08.md` §5.

## Кастоди-дисциплина (правило 2026-06-11)

`DEPLOYER_PRIVATE_KEY` живёт **только в терминале оператора** (Alex). Ключ не
вставляется в чат AI-сессии, не пишется в файлы репо, не коммитится. Все
команды ниже оператор запускает сам; ассистенту для сверки нужны только
адреса и tx-хэши.

## Pre-deploy — состояние на 2026-08-10 (проверено live)

| Что | Значение | Статус |
|-----|----------|--------|
| Chain ID | 10143 (`0x279f`) | ✅ `eth_chainId` |
| RPC | `https://testnet-rpc.monad.xyz` (QuickNode, 50 rps, archive) | ✅ live |
| CreateX | `0xba5Ed099633D3B313e4D5F7bdc1305d3c28ba5Ed` | ✅ код на месте → `DeployRegistryV2.s.sol` работает как есть |
| WMON | `0xFb8bf4c1CC7a94c73D209a149eA2AbEa852BC541` (18 dec, **без permit**) | ✅ проверен `eth_call` |
| Deployer | `0x6D8aCa48c1E064e71078656f7fB946e52cd8376d` | ✅ 20 MON, nonce 0 |
| Скрипты | `DeployRegistryV2.s.sol` (as-is) + `DeployEscrowWmon.s.sol` (новый, ADR-0026) | ✅ `forge build` зелёный |

⚠️ **Деплоить должен именно `0x6D8a…376d`** — CREATE3-соль guarded (байты
0–19 = адрес деплойера), другой EOA даст другие адреса и сломает
same-address-инвариант реестра.

Foundry живёт в WSL-дистро `Ubuntu` (`wsl -d Ubuntu`, `~/.foundry/bin`).

## Ожидаемые адреса

| Контракт | Соль | Ожидаемый адрес |
|----------|------|-----------------|
| AgentRegistryV2 | `sage:registry:v2` | **`0x8df78599868ec740c26f0eb0b660519b166cdd9e`** — тот же, что Base (CREATE3: соль+деплойер, initcode не влияет) |
| TaskEscrowV2 (WMON) | `sage:escrow-wmon:v1` | новый детерминированный адрес — фиксируется из вывода скрипта |

Если registry-адрес НЕ совпал с Base — стоп, что-то не так с деплойером/солью.

## Шаг 1 — окружение (терминал оператора, WSL Ubuntu)

```bash
cd /mnt/d/Sage/packages/contracts
export PATH="$HOME/.foundry/bin:$PATH"

export DEPLOYER_PRIVATE_KEY=0x...        # ключ 0x6D8a…376d — ТОЛЬКО здесь
export MONAD_TESTNET_RPC=https://testnet-rpc.monad.xyz
export REGISTRY_OWNER=0x6D8aCa48c1E064e71078656f7fB946e52cd8376d
export INITIAL_OWNER=0x6D8aCa48c1E064e71078656f7fB946e52cd8376d
export INITIAL_ARBITER=0x6D8aCa48c1E064e71078656f7fB946e52cd8376d
export WMON_ADDRESS=0xFb8bf4c1CC7a94c73D209a149eA2AbEa852BC541
```

(Launch posture как на Base: deployer/owner/arbiter — один EOA; миграция на
Safe/отдельный arbiter-ключ — позже, через Ownable2Step + setArbiter.)

## Шаг 2 — dry-run на форке (денег не тратит)

```bash
forge script script/DeployRegistryV2.s.sol --fork-url $MONAD_TESTNET_RPC
forge script script/DeployEscrowWmon.s.sol --fork-url $MONAD_TESTNET_RPC
```

Сверить в выводе: Chain ID 10143, registry-адрес = `0x8df7…dd9e`, у эскроу
`Settlement token` = WMON. Sanity-require в скриптах проверяют owner/arbiter/token
автоматически.

## Шаг 3 — деплой

```bash
forge script script/DeployRegistryV2.s.sol --rpc-url $MONAD_TESTNET_RPC --broadcast
forge script script/DeployEscrowWmon.s.sol --rpc-url $MONAD_TESTNET_RPC --broadcast
```

Записать из вывода / broadcast-журнала (`broadcast/…/10143/run-latest.json`):
tx-хэши обоих деплоев, адрес эскроу, **блок деплоя эскроу** (→ indexer fromBlock).

Газ-заметка: Monad списывает `gas_bid × gas_limit` (не used). Forge выставляет
лимит из estimate с запасом — для двух деплоев ожидай суммарно ~0.3–0.5 MON
при base ~102 gwei.

## Шаг 4 — верификация исходников (sourcify → Monadscan)

```bash
forge verify-contract 0x8df78599868ec740c26f0eb0b660519b166cdd9e \
  src/AgentRegistryV2.sol:AgentRegistryV2 \
  --chain 10143 --verifier sourcify \
  --verifier-url https://sourcify-api-monad.blockvision.org/

forge verify-contract <ESCROW_ADDR> \
  src/TaskEscrowV2.sol:TaskEscrowV2 \
  --chain 10143 --verifier sourcify \
  --verifier-url https://sourcify-api-monad.blockvision.org/
```

Проверить глазами: `https://testnet.monadscan.com/address/<addr>#code`.

## Шаг 5 — post-deploy смоуки (может выполнить ассистент по RPC)

```bash
RPC=https://testnet-rpc.monad.xyz
cast call --rpc-url $RPC <ESCROW_ADDR> "USDC()(address)"     # → WMON 0xFb8b…C541
cast call --rpc-url $RPC <ESCROW_ADDR> "owner()(address)"    # → 0x6D8a…376d
cast call --rpc-url $RPC <ESCROW_ADDR> "arbiter()(address)"  # → 0x6D8a…376d
cast call --rpc-url $RPC <ESCROW_ADDR> "nextTaskId()(uint256)" # → 0 или 1 (initial)
cast call --rpc-url $RPC 0x8df78599868ec740c26f0eb0b660519b166cdd9e "owner()(address)"
cast call --rpc-url $RPC 0x8df78599868ec740c26f0eb0b660519b166cdd9e "agentCount()(uint256)" # → 0
```

## Шаг 6 — записать результат

1. Verification-ранбук `monad-testnet-verification-<дата>.md` (по образцу Arc):
   адреса, tx-хэши, блок деплоя, вывод смоуков.
2. CHANGELOG-запись + KB-sync.
3. Адреса → `chains/monad.ts` (adapter-evm + web), fromBlock → gateway env
   (задачи M14.2.1 / M14.4.2 / M14.5.1).

## Шаг 7 — WMON для спонсора (перед первым e2e, операторский)

Эскроу тянет WMON со спонсора (approve-путь) — нативный MON надо один раз
обернуть. WETH9-интерфейс: `deposit()` payable, `withdraw(uint256)` обратно.

```bash
# 15 MON → WMON на спонсоре (ключ — только в терминале оператора)
cast send --rpc-url https://testnet-rpc.monad.xyz \
  --private-key $DEPLOYER_PRIVATE_KEY \
  0xFb8bf4c1CC7a94c73D209a149eA2AbEa852BC541 "deposit()" \
  --value 15ether

cast call --rpc-url https://testnet-rpc.monad.xyz \
  0xFb8bf4c1CC7a94c73D209a149eA2AbEa852BC541 \
  "balanceOf(address)(uint256)" 0x6D8aCa48c1E064e71078656f7fB946e52cd8376d
```

Авто-wrap в оркестраторе сознательно не делаем (M14: явная операция —
меньше денежной магии в коде); ревизит после e2e при необходимости.

## Money-env на Monad (обязательно — boot упадёт без них)

WMON = 18 decimals → 6-decimal дефолты денежных гардов не работают.
`assertMoneyEnvForSettlement` (shared/env.ts) роняет boot оркестратора,
пока эти env не выставлены явно (в WMON base units, 1 WMON = 1e18):

```
TASK_AMOUNT                 напр. 500000000000000000      (0.5 WMON — легаси /api/demo/start)
SPONSOR_MIN_BALANCE_USDC    напр. 2000000000000000000     (2 WMON floor)
MAX_SUBTASK_UNITS           напр. 25000000000000000000    (25 WMON/сабтаск ceiling)
MAX_PLAN_TOTAL_UNITS        напр. 100000000000000000000   (100 WMON/план)
MAX_RUN_SPEND_UNITS         напр. 150000000000000000000   (150 WMON/ран, факт-спенд)
QUARANTINE_MAX_UNITS        только если стоит FIRST_PARTY_AGENTS
```

Числа выше — примерные рамки demo-масштаба ($0.02/MON → 25 WMON = $0.50);
перед выставлением сверить с ценами identities на Monad (M14.3.2).

## Шаг 8 — регистрация identities в Monad-реестре (операторский)

Цены — WMON base units (~4× ниже долларового паритета, testnet-масштаб).
Endpoint = Monad-workers app (wake-пинги идут из registry-endpoint).
Запускать из корня репо в WSL `Ubuntu` (интерактивный шелл — pnpm в PATH);
ключ каждой identity — env-переменная только на время команды.

```bash
cd /mnt/d/Sage
EP=https://sage-workers-monad.fly.dev
REG="pnpm --filter @sage/demo-agents exec tsx scripts/register-identity.ts"

CHAIN=monad-testnet COPYWRITER_PRIVATE_KEY=0x…   $REG copywriter   copywrite         400000000000000000  $EP
CHAIN=monad-testnet BUILDER_PRIVATE_KEY=0x…      $REG builder      build-website    1000000000000000000  $EP
CHAIN=monad-testnet PACKAGER_PRIVATE_KEY=0x…     $REG packager     package-archive   150000000000000000  $EP
CHAIN=monad-testnet QA_WEBSITE_PRIVATE_KEY=0x…   $REG qa-website   qa-website        400000000000000000  $EP
CHAIN=monad-testnet SEARCHER_PRIVATE_KEY=0x…     $REG searcher     web-search        500000000000000000  $EP
CHAIN=monad-testnet EXTRACTOR_PRIVATE_KEY=0x…    $REG extractor    extract-content   150000000000000000  $EP
CHAIN=monad-testnet SYNTHESIZER_PRIVATE_KEY=0x…  $REG synthesizer  synthesize-report 1000000000000000000  $EP
CHAIN=monad-testnet FACT_CHECKER_PRIVATE_KEY=0x… $REG fact-checker fact-check        750000000000000000  $EP
```

| Identity | Capability | Цена (WMON) |
|---|---|---|
| copywriter | copywrite | 0.4 |
| builder | build-website | 1.0 |
| packager | package-archive | 0.15 |
| qa-website | qa-website (evaluator) | 0.4 |
| searcher | web-search | 0.5 |
| extractor | extract-content (per source) | 0.15 |
| synthesizer | synthesize-report | 1.0 |
| fact-checker | fact-check (evaluator) | 0.75 |

Бюджеты ранов при этих ценах: website ≈ 1.95 WMON · research ≈ 2.85 WMON
(4 extractor-таска) → полный e2e-набор (website + research + failure-demo)
≈ 7.7 WMON — под спонсорские 8 WMON. `MANIFEST_*`-env опциональны
(дефолты консервативные, см. `register-worker-identity.md` §4a).

Скрипт идемпотентен (already-registered → no-op / resume / manифест-бэкфилл).
Сверка после: `getAgent` каждого адреса — сделает ассистент по RPC.

## Шаг 9 — Fly-приложения (двухэтапно: секреты — оператор, деплой — любой)

Конфиги: `apps/demo-agents/fly.monad.toml` (оркестратор,
`sage-demo-agents-monad`, money-env уже в [env]) +
`apps/demo-agents/fly.workers.monad.toml` (8 identities,
`sage-workers-monad`). Порядок и команды — в шапках конфигов.
⚠️ Секреты стейджить ДО первого деплоя (грабли WORKER_IDENTITIES-crashloop:
`fly secrets set` рестартит машину на старом образе). ⚠️ Проверить машинный
лимит орг-аккаунта (было 17/20): `fly machines list -a <app>` по всем аппам;
спящие Base/Arc машины считаются.

## Известные грабли

- **Списание по gas_limit**: не задирать `--gas-limit` вручную; estimate+буфер
  forge достаточен.
- **Pending tx невидим** через `eth_getTransactionByHash` до включения — если
  forge «висит», он ждёт receipt, это норма (блоки ~400ms, ждать недолго).
- **Reserve balance edge**: tx может включиться и revert'нуться с оплатой газа —
  смоуки Шага 5 обязательны, «broadcast прошёл» ≠ «контракт жив».
- `eth_getLogs` на этом RPC — чанки ≤100 блоков (важно не для деплоя, а для
  индексера, M14.4.2).
