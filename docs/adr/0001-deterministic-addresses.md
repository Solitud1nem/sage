# ADR-0001 — Deterministic contract addresses via CreateX + CREATE3

- **Status:** Accepted
- **Date:** 2026-04-21
- **Deciders:** Alex, Claude
- **Supersedes:** —
- **Related:** ADR-0002 (agent identity), Ось A1 в `project-sage`

## Context

Sage поддерживает multi-EVM deploy (v2.0 — Base, затем Arbitrum/OP/BNB). Для единого UX и маркетинговой истории «один протокол на всех сетях» хотим, чтобы `AgentRegistry` и `TaskEscrow` имели **одинаковый адрес на всех поддерживаемых EVM-сетях**.

Единый адрес даёт:
- SDK: константа вместо `chainId → address` map.
- Devs: «SageRegistry = 0xAAA...» — одинаково везде.
- Phishing-resistance: «только этот адрес — настоящий Sage».
- Discovery: etherscan-style поиск по адресу возвращает все instance.

Проблема: прямой `CREATE2` требует **байткод-парности**. Но наши контракты содержат chain-specific immutable переменные (например, адрес USDC, который разный на Base и Arbitrum). Это ломает байткод-парность и, следовательно, CREATE2.

## Decision

Деплоим `AgentRegistry`, `TaskEscrow` (и будущие протокольные контракты Sage) через **CreateX** с использованием **CREATE3**, с salt-ом формата `keccak256("sage:<component>:v<N>")`.

- Фактори: **CreateX** (внешний, permissionless, задеплоен на одном адресе `0xba5Ed099633D3B313e4D5F7bdc1305d3c28ba5Ed` на 50+ EVM сетях).
- Метод: `CreateX.deployCreate3(salt, initCode)` или эквивалент.
- Salt: `keccak256("sage:registry:v1")` для `AgentRegistry`, `keccak256("sage:escrow:v1")` для `TaskEscrow`, и так далее.

## Rationale

- **CREATE3 отвязывает адрес от bytecode.** Адрес контракта зависит только от `salt` + `factory address`, не от initCode. Это позволяет нам иметь chain-specific immutables (USDC-адрес, feature-flags, версии зависимостей) без потери единого адреса.
- **CreateX — battle-tested.** Используется Uniswap v4 и многими DeFi-протоколами, задеплоен на широком наборе EVM-сетей на одинаковом адресе, immutable (нет upgrade-risk).
- **Versioned salt.** `:v1` в salt позволяет деплоить v2 контрактов по новой соли, не нарушая v1. Миграции управляемые.
- **Нет кастомного deployer-key management.** Фактори permissionless, нет эксклюзивного ключа-деплоера как критического секрета.

## Alternatives considered

### Option A — Прямой CREATE2 от нашего EOA
- Pros: простейший путь.
- Cons: (1) deployer-key — вектор атаки, (2) байткод-парность ломается при chain-specific immutables.
- Rejected because: не решает проблему USDC-immutable и вводит операционный риск ключа.

### Option B — CreateX + CREATE2
- Pros: через фактори, но без CREATE3-слоя.
- Cons: требует байткод-парности — значит chain-specific immutables **запрещены в контрактах Sage**. Это лимит на дизайн.
- Rejected because: жёсткое ограничение «никаких chain-specific immutables» — сильный долг на будущее, который CREATE3 снимает бесплатно.

### Option C — Собственный `SageFactory`
- Pros: полный контроль; можно добавить chain-gate проверки; можно логировать deploys.
- Cons: +300 строк кода в аудит; нужно деплоить factory с тем же подходом (рекурсия решается CREATE2-деплоем factory через CreateX — но тогда зачем нам свой factory вообще).
- Rejected because: не даёт реальных плюсов против CreateX, добавляет аудит-поверхность.

### Option D — chainId → address map в SDK (без CREATE2/CREATE3)
- Pros: максимально просто, никаких зависимостей.
- Cons: теряем «единый адрес» как UX-fichu; каждый новый deploy — новая константа в SDK.
- Rejected because: отказ от преимущества, ради которого мы вообще ставим вопрос.

## Consequences

**Положительные:**
- Единый адрес `AgentRegistry` / `TaskEscrow` на Base, Arbitrum, Optimism, BNB → проще SDK, лучше UX.
- Chain-specific immutables разрешены — можем хранить USDC-адрес, L2-specific флаги в контракте.
- Versioned salt даёт чёткий путь миграции v1 → v2.

**Отрицательные / компромиссы:**
- Зависимость от внешнего контракта CreateX. Риск низкий (immutable, широко используется), но формально это supply chain.
- Salt становится защищаемым артефактом: кто угодно, зная наш salt + initCode, может заранее задеплоить по этому адресу на сети, где мы ещё не деплоили. Митигация: деплоим на все поддерживаемые сети сразу; salt включает длинный protocol-specific префикс (`sage:*`), минимизирующий коллизии случайно.
- **zkSync, Polygon zkEVM и некоторые другие zk-EVM используют другую CREATE2-формулу** — единый адрес на них **не гарантируется**. В v2 эти сети исключены из «same-address» набора. В v3 решим отдельно (скорее всего через chain-specific fallback).

**Что потребует дальнейшего решения:**
- Точный список соль-значений для каждого контракта (фиксируется в `chains/salts.ts` в SDK, после создания кодовой базы).
- Процедура deploy на новую EVM-сеть (→ runbook `deploy-new-evm-chain.md`).
- Что делать, если CreateX в будущем будет апгрейднут или заменён (политика pinning факториного адреса).

## Implementation notes

- В репо будет файл `packages/contracts/scripts/deploy-createx.ts` (появится после решения по Ось A8 — SDK-структура).
- Runbook `docs/runbooks/deploy-new-evm-chain.md` — точные команды, pre-flight проверки, post-flight верификация.
- В `AGENTS.md` уже зафиксирован запрет на CREATE2 при расхождении байткода — это автоматически направляет в CREATE3.

## References

- CreateX документация: https://github.com/pcaversaccio/createx
- CreateX адрес: `0xba5Ed099633D3B313e4D5F7bdc1305d3c28ba5Ed`
- EIP-1014 (CREATE2): https://eips.ethereum.org/EIPS/eip-1014
- Обсуждение CREATE3-паттерна: https://github.com/0xsequence/create3
