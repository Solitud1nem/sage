# ADR-0004 — Settlement currency: USDC-only + EIP-2612 permit in v2.0

- **Status:** Accepted
- **Date:** 2026-04-22
- **Deciders:** Alex, Claude
- **Supersedes:** —
- **Related:** ADR-0001 (deterministic addresses), ADR-0003 (x402 transport); Ось A3 в `project-sage`

## Context

`TaskEscrow` — ядро value-prop Sage. Ему нужен settlement-механизм: в чём заказчик блокирует средства, в чём исполнитель получает payout, как оформлено approval.

Варианты, рассмотренные при обсуждении:
1. USDC-only (один стейблкоин на всех сетях через Circle CCTP).
2. USDC + native ETH (две ветки в контракте — ERC-20 и payable).
3. Multi-token whitelist (любой ERC-20 из одобренного списка).

И отдельный суб-вопрос — approval mechanism:
- EIP-2612 permit (встроен в токен).
- Permit2 (универсальный Uniswap-контракт).
- Classic `approve` + `transferFrom` (два tx).

Multi-token whitelist был серьёзно рассмотрен, но отклонён: увеличение аудит-поверхности в 3–5 раз (fee-on-transfer, transfer-hooks, blacklist-токены, rebasing), усложнённая pricing-модель, необходимость governance, cross-chain whitelist-синхронизация, удвоение базового контракта относительно v1. Disproportionate cost для v2.0 MVP.

## Decision

**v2.0 TaskEscrow работает только с USDC. Approval — через EIP-2612 permit.**

Конкретика:
- TaskEscrow имеет `IERC20 public immutable USDC` — адрес USDC-контракта для данной сети, передаётся через constructor при деплое.
- Все escrow-операции (`createTask`, `completeTask`, refunds) — в USDC, никаких других токенов на уровне контракта.
- Approval flow для заказчика: один `signPermit` (off-chain EIP-712 signature) + один `createTask(..., PermitData)` tx. Контракт вызывает `USDC.permit(...)` внутри `createTask`, затем `transferFrom`. Два вложенных вызова, один tx от пользователя.
- Native ETH в v2.0 не поддерживается на уровне контракта. Если агент хочет заплатить ETH — SDK-layer отвечает за swap в USDC (через Uniswap или Aerodrome на Base) до вызова `createTask`.
- Multi-token поддержка — явный v2.1+ item через отдельный ADR и, вероятно, отдельный `TaskEscrowMultiToken.sol` (новая соль `sage:escrow-mt:v1`), сосуществующий с `TaskEscrow:v1`.

## Rationale

- **Simplicity = security.** В escrow-контракте с чужими деньгами каждое допущение — потенциальный вектор. USDC-only убирает целый класс атак (fee-on-transfer mismatches, reentrancy через token-hooks, rebasing-рассинхрон).
- **Pricing consistency.** Агент ставит цену в USD-equivalent — это понятно пользователям, понятно для сравнения между агентами, понятно для рекламы протокола. Multi-token ломает эту простоту на старте.
- **USDC native на всех целевых сетях v2** (Base, Arbitrum, Optimism, BNB) через Circle CCTP. Круговая совместимость: USDC на Base можно перевести на Arbitrum нативно через Circle, без bridges.
- **EIP-2612 permit у USDC работает из коробки.** Circle реализовал EIP-2612 в каноническом USDC-контракте. Нет внешней зависимости (как была бы с Permit2).
- **Ship faster.** v2.0 можно реализовать за 2–3 месяца. Multi-token добавил бы +1–2 месяца только на аудит edge-cases.
- **x402 alignment.** Протокол x402 (ADR-0003) тоже primary-USDC. Нет impedance mismatch между двумя нашими слоями платежей.

## Alternatives considered

### Option A — Multi-token whitelist
- Pros: гибкость; агенты могут settle в DAI/WETH/custom-token.
- Cons: аудит-поверхность x3–x5; fee-on-transfer / rebase / transfer-hook атаки; governance whitelist-а; cross-chain синхронизация; pricing-фрагментация для конечного UX.
- Rejected because: disproportionate cost для v2.0. Отложено в v2.1 как явный roadmap item. При необходимости реализуется как отдельный `TaskEscrowMultiToken` через новую соль CREATE3 (не ломает v1-контракт).

### Option B — USDC + native ETH (два path в одном контракте)
- Pros: агент без USDC сразу работает.
- Cons: удвоенная логика контракта; pricing-конвертация через oracle (price-risk + oracle-risk); удвоенный аудит без реальной пользы — агент в любом случае может сделать ETH→USDC на SDK-layer перед созданием task-а.
- Rejected because: лучше решается на SDK-уровне, не в контракте.

### Option C — Permit2 (universal approval)
- Pros: работает с любым ERC-20, не только EIP-2612-совместимыми; Uniswap Foundation поддерживает.
- Cons: зависимость от external Permit2 контракта; для USDC-only — overhead без выгоды (permit у USDC уже есть).
- Deferred: если в v2.1 мы перейдём на multi-token, Permit2 станет сильным кандидатом — пересмотрим в новом ADR.

### Option D — Classic approve + transferFrom
- Pros: zero external deps, максимально простой код.
- Cons: два tx от пользователя на каждую задачу, UX-friction особенно в agent-agent сценариях где нужна скорость.
- Rejected because: permit решает ту же задачу проще и уже работает на USDC.

## Consequences

**Положительные:**
- Escrow-контракт минимален: одна USDC-операция, нет ERC-20 dispatcher-слоя, нет fee-on-transfer проверок.
- Single-tx UX для заказчика: signPermit → createTask в одном действии.
- Нет внешних зависимостей кроме самого USDC-контракта.
- Консистентная pricing-story для агентов и для маркетинга Sage.

**Отрицательные / компромиссы:**
- Агенты, которые принципиально хотят settle в не-USDC (DAI, ETH, чего-то экзотичного), в v2.0 не поддерживаются. Для них — либо swap-в-USDC на SDK-layer, либо ждать v2.1 с multi-token.
- Зависимость от USDC как единой точки ликвидности. Если Circle имеет regulatory issue или USDC depeg-ится — протокол фактически парализован. Митигация: это system-wide risk любого USDC-based DeFi; альтернативы (DAI/USDT) в v2.1 снижают риск.
- **USDC-адрес per chain — разный** (Base: `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`, Arbitrum: `0xaf88d065e77c8cC2239327C5EDb3A432268e5831`, OP: `0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85`, BNB: `0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d`). Через CREATE3 (ADR-0001) это решается прозрачно — immutable в constructor, единый адрес контракта, разные USDC-адреса внутри.

**Что потребует дальнейшего решения:**
- Выбор revenue mechanism (если будет): protocol fee % от escrow, fee-on-register, etc. — отдельный ADR позже (не v2.0 scope).
- Политика обработки отказа USDC-permit (expired deadline, invalid sig) — тривиально, на уровне revert-а в контракте, но закрепить в `AGENTS.md`-уровне test coverage.
- При переходе к multi-token в v2.1 — решить, единый `TaskEscrowMultiToken` или per-token-контракты. Отложено.

## Implementation notes

- `TaskEscrow.sol` конструктор:
  ```solidity
  constructor(IERC20 _usdc) {
      USDC = _usdc;
  }
  ```
- `createTask` принимает структуру `PermitData { uint256 value; uint256 deadline; uint8 v; bytes32 r; bytes32 s }` и делает:
  ```solidity
  IERC20Permit(address(USDC)).permit(msg.sender, address(this), value, deadline, v, r, s);
  USDC.transferFrom(msg.sender, address(this), amount);
  ```
- Chain-registry (в SDK) хранит USDC-адреса per chain, передаётся deploy-скрипту при деплое TaskEscrow через CreateX.
- SDK-метод `sage.createTask(...)` обёртывает signPermit + сборку PermitData + contract call — для потребителя SDK это один вызов.
- Тесты: обязательное покрытие permit-flow (expired deadline, wrong signer, replay-attempt через nonce, permit uses USDC.nonces() правильно).

## References

- EIP-2612 (Permit): https://eips.ethereum.org/EIPS/eip-2612
- Circle USDC contracts: https://developers.circle.com/stablecoins/docs/usdc-on-main-networks
- ADR-0001 (CreateX + CREATE3, объясняет, почему chain-specific USDC-address не ломает single-contract-address narrative)
- ADR-0003 (x402 transport — тоже USDC-first)
