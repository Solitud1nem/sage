# ADR — Architecture Decision Records

Каждое значимое архитектурное решение оформляется как отдельный файл `NNNN-kebab-case-title.md`.

## Процесс

1. Возникает архитектурный вопрос → обсуждение с пользователем.
2. Выбрана опция → создаётся новый файл `NNNN-*.md` по шаблону `0000-template.md`.
3. Статус начинается с **Proposed** → при approval пользователем меняется на **Accepted**.
4. Отменённое или пересмотренное решение получает статус **Superseded by NNNN** и не удаляется.
5. Новый ADR добавляется в индекс ниже.
6. После accept — запись в `../../CHANGELOG.md` и обновление KB `D:\knowledge\projects\project-sage.md`.

## Нумерация

- `0000-template.md` — шаблон, не является ADR, не входит в индекс.
- `0001` и далее — реальные решения.
- Номера присваиваются последовательно, даже если решение superseded.

## Индекс

| # | Title | Status | Date |
|---|-------|--------|------|
| [0001](./0001-deterministic-addresses.md) | Deterministic contract addresses via CreateX + CREATE3 | Accepted | 2026-04-21 |
| [0002](./0002-agent-identity.md) | Agent identity: Base-anchored registry + EAS + single EOA, no spoke registries | Accepted | 2026-04-21 |
| [0003](./0003-x402-as-pay-per-call-transport.md) | x402 as primary transport for pay-per-call; Sage focuses on task-level escrow | Accepted | 2026-04-21 |
| [0004](./0004-settlement-usdc-permit.md) | Settlement currency: USDC-only + EIP-2612 permit in v2.0 | Accepted | 2026-04-22 |
| [0005](./0005-monorepo-foundry-viem.md) | Repo structure: pnpm monorepo + Foundry + viem | Accepted | 2026-04-22 |

## Ожидаемые ADR (черновик)

Эти ADR мы будем оформлять по мере прохождения 10 архитектурных осей. Порядок — примерный.

| # (планируется) | Тема | Ось из `project-sage` |
|------|------|-----------------------|
| ~~0001~~ | ✅ Accepted — см. индекс выше | A1 |
| ~~0002~~ | ✅ Accepted — см. индекс выше | A2 |
| ~~0003~~ | ✅ Accepted — см. индекс выше | A4 (D5 формализован) |
| ~~0004~~ | ✅ Accepted — см. индекс выше | A3 |
| ~~0005~~ | ✅ Accepted — см. индекс выше | A8 |
| 0006 | Task escrow lifecycle inherited from v1 | A5 (JIT — оформить перед стартом кода контрактов) |
| 0007 | Upgradability: immutable TaskEscrow, UUPS AgentRegistry | A6 (JIT — перед mainnet deploy) |
| 0008 | Event indexer tooling | A7 (JIT — при имплементации индексера) |
| 0009 | Gas abstraction (ERC-4337 + paymaster) | A9 (JIT — v2.1) |
| 0010 | Chain-agnostic protocol spec + ChainAdapter SDK interface | A10 (JIT — встраивается в процесс) |

_(Эти номера могут измениться в зависимости от порядка принятия.)_
