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
| [0008](./0008-sage-angle-position.md) | Sage angle / position: multi-chain settlement infrastructure for AI agents, distinguished by observable decomposition | Accepted; extended 2026-06-04 (platform + arbitration) | 2026-05-20 |
| [0014](./0014-arc-adapter-native-erc-8183.md) | Arc as sibling chain via `@sage/adapter-arc` over native ERC-8183 + ERC-8004 (scaffold-first) | Accepted, partially superseded by 0015 | 2026-05-21 |
| [0015](./0015-arc-deploy-bridge.md) | Arc testnet bridge: deploy Sage contracts on Arc via Arachnid CREATE2 (interim, until native ERC-8183/8004 ship) | Accepted, partially superseded by 0016 | 2026-05-21 |
| [0016](./0016-erc-8183-discovery-correction.md) | Discovery correction: ERC-8183 was deployed on Arc testnet all along; bridge stands on shape-mismatch rationale | Accepted | 2026-05-22 |
| [0017](./0017-task-escrow-arbitration.md) | Task escrow arbitration: `resolveDispute`, configurable arbiter, reachable `Refunded`, split outcomes | Accepted | 2026-06-04 |
| [0018](./0018-composite-content-envelope.md) | Composite content envelope: faithful `source` payload + `inputs` dependency chaining alongside `spec` | Accepted | 2026-06-08 |
| [0019](./0019-off-chain-council-v1.md) | Off-chain council v1: opt-in review gate, single LLM-judge verdict, arbiter EOA auto-executes `resolveDispute` | Accepted | 2026-06-08 |
| [0020](./0020-useful-output-pipelines.md) | Useful-output pipelines: демо как поверка с чатом, консолидация воркеров, wake-on-HTTP | Accepted | 2026-06-10 |
| [0021](./0021-ui-polish-galaxy-hero.md) | UI/UX polish + Galaxy hero: try-first CTA, AA-контраст, composite legend/animation/chips/stepper, nav `Demo ▾`, vendored OGL Galaxy фон | Accepted | 2026-06-14 |
| [0022](./0022-responsibility-boundaries.md) | Responsibility boundaries: three zones (first-party / referee / foreign-agent), Sage guarantees fair settlement not work quality | Accepted | 2026-06-23 |
| [0023](./0023-foreign-agent-conformance.md) | Foreign-agent conformance: tiered damage-bounding + routing gates over a permissionless registry | Accepted | 2026-06-23 |
| [0024](./0024-privacy-on-chain-commitments.md) | Privacy: on-chain carries commitments not content; encrypted off-chain + least-privilege envelope | Accepted | 2026-06-23 |
| [0025](./0025-key-management.md) | Key management: per-subtask DEK (AES-256-GCM), ECIES-wrapped to party keys (secp256k1 reuse v1 → X25519 v2), evaluator scoped re-wrap, no trusted reader | Accepted | 2026-06-24 |
| [0026](./0026-monad-testnet-deployment.md) | Monad testnet deployment: WMON settlement (same bytecode, соль `sage:escrow-wmon:v1`), approve-path вместо permit, explicit gas-limit policy | Accepted | 2026-08-10 |

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
| ~~0014~~ | ✅ Accepted (partially superseded by 0015) — Arc adapter scaffold | новая ось: chain expansion |
| ~~0015~~ | ✅ Accepted — Arc deploy bridge (interim) | chain expansion / bridge |
| 0015 | Plan artifact storage (off-chain indexer / IPFS / wallet metadata) | follows 0007 |

_(Эти номера могут измениться в зависимости от порядка принятия.)_
