# ADR-0002 — Agent identity: Base-anchored registry + EAS attestations + single EOA, no spoke registries

- **Status:** Accepted
- **Date:** 2026-04-21
- **Deciders:** Alex, Claude
- **Supersedes:** —
- **Related:** ADR-0001 (deterministic addresses), Ось A2 в `project-sage`

## Context

Sage работает на нескольких EVM-сетях одновременно. Нужен ответ на три вопроса:

1. **Что такое «один агент» в мире Sage?** — идентификатор должен быть стабильным между сетями.
2. **Где хранится профиль агента** (capabilities, pricing, endpoint, display name)?
3. **Как агент доказывает свою идентичность на spoke-сетях** без cross-chain messaging (которое в v2 запрещено — см. `AGENTS.md`)?

Ключевое ограничение v2: **никаких bridges, никаких cross-chain message-layers**. Любая идентификация должна работать локально в пределах одного RPC-запроса или через off-chain индексер.

Дополнительный контекст: ADR-0001 (CreateX+CREATE3) уже гарантирует единый адрес `AgentRegistry` на всех поддерживаемых EVM. Это создаёт предпосылки для чистого identity-решения.

## Decision

**Гибрид Base-anchor + EAS + single EOA:**

1. **Agent identifier = EOA-адрес агента**, один и тот же на всех EVM (стандартная Ethereum derivation — тот же private key → тот же адрес). Формат canonical-ID: `sage:{0xAddress}`.
2. **Canonical registry — только на Base.** Контракт `AgentRegistry` на Base — источник истины для регистрации. На Base хранится минимальная on-chain запись: ownerAddress + endpoint + статус (active/paused).
3. **Rich profile data — EAS-аттестации на Base.** Детали профиля (capabilities, pricing, display name, description, version) выпускаются как аттестации через Ethereum Attestation Service (EAS). Обновление профиля = новая аттестация; старая помечается revoked.
4. **Spoke-chain registries в v2.0 отсутствуют.** На Arbitrum, Optimism, BNB деплоится только `TaskEscrow` (без `AgentRegistry`). Escrow принимает любой EOA как исполнителя; проверка, что исполнитель — зарегистрированный Sage-агент, — обязанность заказчика (через SDK, который дёргает Base-registry / EAS off-chain).
5. **Rotation / revocation.** Агент обновляет запись в Base-registry → существующие EAS-аттестации переиздаются по новому адресу или revoke-ятся. Компрометированный ключ лечится через `pause()` в registry + revoke EAS.

## Rationale

- **Single EOA = нулевой UX-trade-off.** Разработчик агента использует обычный ключ, как в любом EVM-проекте. Ничего нового учить не надо.
- **Base как anchor — правильный выбор** по тем же причинам, что и primary chain v2.0: максимальная AI-agent плотность, native x402, cheapest gas для registry-операций.
- **EAS вместо storage контракта — экономия gas + композабельность.** Storage в registry — дорого и жёстко. EAS-аттестация — одна строка с подписью, $0.01 на Base, обновляется дёшево, видна любым EAS-consumer'ом. Плюс можно потом добавить KYC-аттестации, reputation-badges от сторонних сервисов — это уже стандартный EAS-паттерн.
- **Отсутствие spoke-registry — radical simplification.** Одна меньше контракт-поверхность на каждой сети, ноль проблем синхронизации между сетями. TaskEscrow и без registry делает свою работу (он работает с адресами, а не с метаданными).
- **CREATE2/CREATE3-адрес registry + single EOA агента** = agent говорит «я 0xAAA на Sage», и это true на Base, Arbitrum, OP, BNB без дополнительных движений.

## Alternatives considered

### Option A — Peer registries + canonical ID (ENS-like)
- Pros: нет single-point-of-failure; truly decentralized.
- Cons: (1) enforcement уникальности — кто резолвит коллизии между сетями; (2) тройной деплой контрактов registry; (3) cross-chain reputation-aggregation становится сложной задачей.
- Rejected because: сложность несоразмерна с выгодой для v2, reputation v2 всё равно off-chain.

### Option B — Per-chain siloed
- Pros: простейшая имплементация; ноль cross-chain допущений.
- Cons: агент на Base ≠ агенту на Arbitrum; reputation фрагментирован; маркетинговая история «один агент, много сетей» сломана.
- Rejected because: убивает ключевое ценностное предложение «chain-agnostic».

### Option C — DID + off-chain resolver
- Pros: W3C стандарт; максимальная гибкость.
- Cons: off-chain resolver = trust anchor, его надо поддерживать и защищать; изобретение формата vs использование EAS.
- Rejected because: для v2 — over-engineering. EAS даёт 80% пользы DID при меньшей сложности. Возможно пересмотрим в v3.

### Option D — Shadow-registry на spokes (thin)
- Pros: локальная verifiability на spoke-сети без RPC-запросов на Base.
- Cons: нужна какая-то пропагация из Base (либо cross-chain message, либо trust-based bridge, либо ручной import — все плохие варианты).
- Deferred: возможен в v2.1, если через 3 месяца окажется, что spoke-клиенты не могут полагаться на off-chain индексер.

### Option E — Smart-account (ERC-4337) вместо EOA
- Pros: session keys, social recovery, multi-sig, gasless UX.
- Cons: premature для v2; ломает simple-EOA UX; не все tooling поддерживают smart accounts как "agent identity".
- Deferred: рассмотрим в v2.1 для опциональной поддержки.

### Option F — Per-chain keys + cross-sign attestation
- Pros: изоляция риска ключей; если ключ на OP скомпрометирован, ключ на Base цел.
- Cons: UX-friction при setup; композиция с x402 усложняется.
- Deferred: можем добавить как опцию в v3 для продвинутых пользователей. В v2 — single EOA.

## Consequences

**Положительные:**
- Coherent identity: «я 0xAAA» — единая правда на всех EVM.
- Минимальная контракт-поверхность на spoke-сетях (только TaskEscrow, не registry) → меньше аудит, меньше gas на deploy.
- EAS-композабельность: будущие KYC/reputation-сервисы интегрируются без изменений в протоколе.
- Versioning профиля: обновления через новые EAS-аттестации, не через storage-writes.

**Отрицательные / компромиссы:**
- **Base становится критической зависимостью** для registration и profile-lookup. Митигация: runtime-операции (escrow на spoke) от Base не зависят. Если Base временно недоступен — клиент не может зарегистрировать нового агента, но существующие задачи продолжают исполняться.
- **Spoke-клиент должен верить off-chain data** для проверки «зарегистрирован ли этот агент в Sage». Митигация: SDK кэширует Base-registry snapshot + подписанные EAS-аттестации локально.
- **Нет локальной on-chain verification на spoke** (в отличие от Option D). В большинстве workflow это ок, но для edge-case «escrow-контракт хочет on-chain проверить, что counterparty — Sage-агент» решения в v2 нет. Это принимается как осознанный trade-off.
- **Агент с разными ключами на разных сетях не поддерживается в v2.** Если у пользователя так исторически сложилось — придётся консолидировать или считать их разными Sage-агентами.

**Что потребует дальнейшего решения:**
- Точная EAS-схема для agent profile (отдельный ADR — после выбора формата).
- Архитектура off-chain индексера (Ось A7, следующий кластер).
- Политика revocation для скомпрометированных ключей (текстовый runbook после живого деплоя).
- Как SDK обрабатывает Base-temporarily-down сценарий — graceful degradation vs hard error (ADR в v2.1 по мере необходимости).

## Implementation notes

- `AgentRegistry` на Base — deploy через CreateX+CREATE3 (см. ADR-0001) по соли `keccak256("sage:registry:v1")`.
- На spoke-сетях `AgentRegistry` **не деплоится**. Только `TaskEscrow` по соли `keccak256("sage:escrow:v1")`.
- EAS-deployment addresses на Base: `0x4200...1021` (EAS) и `0x4200...1020` (SchemaRegistry) — проверить перед первым deploy, зафиксировать в `chain-registry.ts`.
- SDK получает метод `agentPay.getAgent(address)` — сначала проверяет Base-registry, затем подтягивает EAS-аттестации.
- Индексер (off-chain) собирает events с Base-registry + EAS + TaskEscrow со всех spoke-сетей в единую БД.

## References

- EAS (Ethereum Attestation Service): https://docs.attest.org/
- EAS-deployments: https://docs.attest.org/docs/quick--start/contracts
- ADR-0001 — основание для единого адреса registry на Base через CreateX
