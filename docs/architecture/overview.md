# Architecture Overview

> **Статус:** Placeholder. Заполняется по мере принятия ADR. Не является источником правды для незафиксированных решений — для этого есть `../adr/`.

## Слои (TBD)

Когда архитектура стабилизируется, здесь будет диаграмма трёх слоёв:
- Discovery / Identity layer (on-chain registry + attestations)
- Task escrow layer (per-chain contracts)
- Transport layer (x402 для pay-per-call, on-chain calls для escrow)

## Chains (TBD)

Таблица поддерживаемых сетей с chain id, RPC, адресами контрактов, explorer'ами. Пока не задеплоено ничего — таблица пустая.

| Chain | Chain ID | Status | RPC | Explorer | AgentRegistry | TaskEscrow |
|-------|----------|--------|-----|----------|---------------|------------|
| Base | 8453 | **Deployed** | https://mainnet.base.org | https://basescan.org | `0x5e95F92FeEb4D46249DC3525C58596856029c661` | `0x12aeF3529b8404709125b727bA3Db40cD5453E1e` |
| Base Sepolia | 84532 | Deployed | https://sepolia.base.org | https://sepolia.basescan.org | `0x5e95f92feeb4d46249dc3525c58596856029c661` | `0x12aef3529b8404709125b727ba3db40cd5453e1e` |

## Money flow (TBD)

Схема движения средств через escrow, с указанием момента approval, lock, release, refund. Заполним после принятия ADR по settlement currency (Ось A3) и task semantics (Ось A5).

---

_Документ живой, обновляется после каждого accepted ADR. Ссылки на ADR обязательны._
