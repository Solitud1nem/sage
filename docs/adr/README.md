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
| [0006](./0006-web-integration-topology.md) | Web frontend integration: static export on Cloudflare Pages + Alchemy RPC proxy + Fly.io demo-agents + PostHog | Accepted | 2026-04-23 |
| [0007](./0007-observable-decomposition.md) | Observable decomposition: plan-then-execute as the default flow for composite agent tasks | Accepted | 2026-05-19 |
| [0008](./0008-sage-angle-position.md) | Sage angle / position: multi-chain settlement infrastructure for AI agents, distinguished by observable decomposition | Accepted | 2026-05-20 |

## Ожидаемые ADR (черновик)

Эти ADR мы будем оформлять по мере прохождения архитектурных осей. Порядок — примерный.

| # (планируется) | Тема | Ось из `project-sage` |
|------|------|-----------------------|
| ~~0001–0006~~ | ✅ Accepted — см. индекс выше | A1, A2, A3, A4, A8, web-axis |
| ~~0007~~ | ✅ Accepted — см. индекс выше (observable decomposition) | A11 — composition pattern |
| ~~0008~~ | ✅ Accepted — Sage angle / position (см. индекс) | meta-position — ethos formalisation |
| 0009 | Task escrow lifecycle inherited from v1 (formalisation) | A5 (JIT — оформить при ревизии контрактов) |
| 0010 | Upgradability: immutable TaskEscrow, UUPS AgentRegistry | A6 (JIT — перед каждым mainnet deploy) |
| 0011 | Event indexer tooling | A7 (JIT — при имплементации индексера) |
| 0012 | Gas abstraction (ERC-4337 + paymaster) | A9 (JIT — v2.1) |
| 0013 | Chain-agnostic protocol spec + `ChainAdapter` SDK interface | A10 (JIT — встраивается в процесс) |
| 0014 | Arc as sibling chain via `@sage/adapter-arc` over native ERC-8183/8004 | новая ось: chain expansion |
| 0015 | Plan artifact storage (off-chain indexer / IPFS / wallet metadata) | follows 0007 |

_(Эти номера могут измениться в зависимости от порядка принятия.)_
