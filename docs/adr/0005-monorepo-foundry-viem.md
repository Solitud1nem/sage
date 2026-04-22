# ADR-0005 — Repo structure: pnpm monorepo + Foundry + viem

- **Status:** Accepted
- **Date:** 2026-04-22
- **Deciders:** Alex, Claude
- **Supersedes:** —
- **Related:** ADR-0001 (deterministic addresses), ADR-0002 (agent identity), ADR-0004 (settlement); Ось A8 в `project-sage`

## Context

До начала имплементации v2 надо зафиксировать структуру репозитория и ключевой тулкит. Решение определяет import-граф, npm-имена пакетов, тестовую инфраструктуру, CI-контур — всё, что дорого менять потом.

Три измерения:

1. **Monorepo vs single-package.** v1 использовал single-package (`@agentpay/sdk` в корне с `contracts/`, `sdk/`, `agents/`).
2. **Tooling для Solidity:** Hardhat (v1 стандарт) vs Foundry (стандарт 2026 в DeFi security) vs гибрид.
3. **EVM client для TypeScript SDK:** ethers.js v6 (v1) vs viem (современнее, tree-shake-friendly, AA-ready).

Ключевой контекст:
- Sage позиционируется как chain-agnostic — нужно место для `adapter-solana` в v3 без перестановки кода.
- v1 контракты переписываются под chain-agnostic (USDC вместо zkLTC, CREATE3 вместо direct deploy, etc.) — тесты в любом случае нужно переписать.
- Chain-agnostic protocol spec (ось A10, пока JIT) должен жить в отдельном пакете, чтобы non-EVM адаптеры могли на него ссылаться.

## Decision

**pnpm monorepo + Foundry для контрактов + viem для SDK.**

Структура репозитория:

```
D:\Sage\
├── packages/
│   ├── core/              # @sage/core — chain-agnostic типы, интерфейсы, протокольные inv.
│   ├── adapter-evm/       # @sage/adapter-evm — viem-based client для всех EVM-сетей
│   ├── contracts/         # Solidity (Foundry project)
│   └── indexer/           # off-chain event indexer (создаётся при имплементации A7)
├── apps/
│   └── demo-agents/       # reference-агенты (Orchestrator, Summarizer, Translator)
├── docs/
│   ├── architecture/
│   ├── adr/
│   └── runbooks/
├── pnpm-workspace.yaml
├── package.json           # root, с workspace-definitions
├── tsconfig.base.json     # shared TS config
├── .changeset/            # changesets для version management пакетов
├── AGENTS.md, CLAUDE.md, README.md, ...
```

Конкретный tooling:
- **Package manager:** pnpm (workspaces built-in, максимально быстрый install, disk-space-efficient через hard-linking).
- **TS-пакеты:** tsup для сборки, vitest для тестов, eslint strict.
- **Contracts:** Foundry (forge для тестов, cast для on-chain interaction, chisel для REPL). OpenZeppelin-контракты через git submodule (forge стандарт).
- **SDK client:** viem 2.x для всех EVM-операций (не ethers).
- **CI:** GitHub Actions, matrix-build на Node 20+ и forge latest.

## Rationale

**Почему monorepo:**
- Chain-agnostic narrative прямо отражается в структуре: `@sage/core` (чистая спека) + `@sage/adapter-evm` (EVM-конкретика). В v3 добавляем `@sage/adapter-solana` — ноль перестановок в core.
- Consumer тянет только нужное: агент на EVM не подтягивает Solana-зависимости.
- Per-package версионирование через changesets — core может оставаться на `1.x`, пока adapter-evm итерирует до `2.x`.
- Shared tooling (root-level eslint, prettier, tsconfig) — консистентность без дублирования.

**Почему pnpm, не turborepo/nx:**
- Sage — одна-двухчеловеческая команда на обозримом горизонте. Build-caching turborepo/nx даёт выгоду в больших командах; здесь overhead конфигурации не окупается.
- pnpm workspaces сами по себе решают 90% monorepo-нужд (общие deps, dependency hoisting, script running across packages).
- Если в v3 команда вырастет — миграция на turborepo поверх pnpm тривиальна.

**Почему Foundry:**
- 10–100x быстрее Hardhat на средних и больших test-suites (на 46-тестовом suite v1 это секунды vs минуты).
- Нативный property-based fuzzing (`forge test --match fuzz`) — критически важно для escrow-контрактов, где авто-поиск edge cases находит то, что ручные unit-тесты пропустят.
- Stable foundation: Uniswap v4, Sky (ex-MakerDAO), Morpho, Aerodrome и большинство новых протоколов 2025–2026 — Foundry-based.
- Solidity-native тесты (`Test.sol`) — contract-engineers не переключают контекст на JS/TS для валидации инвариантов. Плотность мышления выше.
- Интеграция с формальной верификацией (Halmos, Certora) — бесшовная.
- Deploy-скрипты через `forge script` достаточны для наших нужд (CreateX-based deploy — один вызов, сложной оркестрации не требуется).

**Почему viem:**
- Tree-shakeable: consumer SDK тянет только используемые функции, в отличие от ethers, где импорт `Contract` тянет большую часть библиотеки.
- Native поддержка EIP-712 / permit / EIP-2612 — критично для ADR-0004 (USDC permit flow).
- Native поддержка Smart Accounts (EIP-4337) — пригодится в v2.1 при gas abstraction (ось A9).
- Строже типизация (deeply typed ABI, автовывод параметров).
- Современнее, с активной разработкой; ethers v6 — mature, но в режиме maintenance.

## Alternatives considered

### Option A — Single package (как v1)
- Pros: минимальная конфигурация; быстрый старт.
- Cons: ломает chain-agnostic narrative (где живёт Solana-адаптер?); tree-shaking страдает; версии core и adapter связаны; consumer-SDK тянет всё.
- Rejected because: v2 explicitly positioned как multi-chain; single-package не даёт естественного места для non-EVM.

### Option B — Monorepo с turborepo/nx
- Pros: build-caching, лучшая scale для больших команд.
- Cons: overhead конфигурации несоразмерен с текущим размером команды.
- Deferred: если команда вырастет — можем добавить поверх pnpm без перестановки пакетов.

### Option C — Hardhat + TypeChain (как v1)
- Pros: JS-ecosystem integration; v1-тесты можно портировать почти as-is.
- Cons: медленнее на CI, слабее на fuzzing, меньше используется в новых DeFi-проектах, контекст-свитч для contract-engineers.
- Rejected because: v1 contracts переписываются полностью, тесты в любом случае новые; пользы от сохранения Hardhat нет.

### Option D — Hybrid (Foundry для тестов + Hardhat для deploy)
- Pros: лучшие стороны обоих.
- Cons: две code-базы конфигурации; CI содержит оба тулкита; контрибьюторам учить два.
- Rejected because: deploy через CreateX — один вызов, нам не нужен Hardhat-deploy-manager.

### Option E — ethers.js v6 вместо viem
- Pros: mature, стандарт последнего десятилетия, огромное сообщество.
- Cons: weaker tree-shaking, более высокий bundle-size для consumer-SDK, weaker TS-типизация, устаревающая идиоматика.
- Rejected because: viem — правильный выбор на 2026, не tied to legacy.

## Consequences

**Положительные:**
- Чистый чётко-разделённый codebase: core-спека, EVM-имплементация, контракты, индексер — в отдельных пакетах с ясными границами.
- Готовность к `@sage/adapter-solana` в v3 без крупных перестановок.
- Современный tooling, соответствующий индустрии 2026.
- Быстрый testing loop (Foundry) ускорит итерацию контрактов — critical для security-sensitive кода.
- viem + AA готовит почву для gas abstraction (v2.1, ось A9).

**Отрицательные / компромиссы:**
- Initial setup сложнее single-package: pnpm-workspaces, shared tsconfig, changesets, CI для matrix.
- Контрибьюторам (и будущему "мне" в новой сессии) нужно знать: pnpm basics, Foundry (forge/cast/chisel), viem идиомы. Для пришедших из web2 это +3 новых инструмента.
- v1 Hardhat-тесты не портируются напрямую — пишутся с нуля на Foundry (но контракты и так переписываются).
- OpenZeppelin-контракты в v1 подтягивались через npm; в Foundry — git submodule. Разные workflow updates, нужна дисциплина.

**Что потребует дальнейшего решения:**
- Точный changelog-процесс через changesets — в `AGENTS.md` добавить раздел при первом release-е.
- CI-конфигурация для `@sage/contracts` (forge CI + gas-report snapshots).
- Versioning-политика между packages: semver в каждом или unified release (`v2.0.0` для всех). Склоняюсь к per-package semver — записать в ADR-позже.
- Линтеры для Solidity — solhint или Forge-built-in.

## Implementation notes

- **Initial scaffolding** (следующий шаг после этого ADR):
  - Корневой `package.json` с `"packageManager": "pnpm@9.x"` и workspace-скриптами.
  - `pnpm-workspace.yaml` со списком `packages/*` и `apps/*`.
  - `tsconfig.base.json` — shared strict config, extended каждым пакетом.
  - `packages/contracts/foundry.toml` — Foundry config (solc 0.8.24, optimizer 200 runs, EVM Cancun default).
  - `packages/core/package.json` — нулевые runtime-deps, только types и interfaces.
  - `packages/adapter-evm/package.json` — peerDep на `viem`, `@sage/core`.
  - `.changeset/config.json` — changesets-режим.
- **Migration-путь** v1→v2 — это не migration, это greenfield. v1-код в `D:\AgentsPay\` остаётся архивом; мы не пытаемся сохранить v1-пакет как legacy branch.

## References

- pnpm workspaces: https://pnpm.io/workspaces
- Foundry book: https://book.getfoundry.sh/
- viem docs: https://viem.sh/
- changesets: https://github.com/changesets/changesets
- ADR-0001 — CreateX deploy через forge script
- ADR-0004 — USDC permit flow реализуется через viem EIP-712 helpers
