# CHANGELOG.md

Хронология значимых решений, ребрендов, релизов Sage.

Формат: обратная хронология (свежее сверху). Для каждой записи — дата, категория, короткое описание.

Категории: `rebrand` | `decision` | `release` | `adr` | `chain` | `scope`.

---

## 2026-04-22

- `adr` **ADR-0004 Accepted** — settlement currency v2.0: USDC-only + EIP-2612 permit. Multi-token whitelist рассмотрен, отклонён для v2.0 из-за disproportionate cost; отложен в v2.1 через отдельный ADR и, вероятно, отдельный `TaskEscrowMultiToken` (новая соль CREATE3).
- `adr` **ADR-0005 Accepted** — repo structure: pnpm monorepo + Foundry + viem. Структура `packages/{core, adapter-evm, contracts, indexer}` + `apps/{demo-agents}`. v1 Hardhat-тесты не портируются (greenfield v2).
- `milestone` **Все blocking-оси закрыты** (A1, A2, A3, A4, A8). JIT-оси остаются (A5, A6, A7, A9, A10) с дефолтами.
- `sdd` **Planning завершён.** Сгенерированы `PRD.md`, `PLANNING.md`, `TASKS.md` (43 атомарных задачи в 8 milestones). AGENTS.md обновлён session-workflow секцией.
- `milestone` **Готовы к коду.** Следующая рабочая сессия = M1.1 из TASKS.md.

## 2026-04-21

- `rebrand` **AgentPay → Sage.** Проект пивотнут с LitVM-only на chain-agnostic multi-chain. Новый workspace: `D:\Sage\`. v1 в `D:\AgentsPay\` — archived reference.
- `scope` **EVM-first, non-EVM extensibility.** v2.0–v2.x — только EVM-сети (Base primary, затем Arbitrum/OP/BNB). Solana/NEAR — v3+.
- `decision` **x402 принят как транспорт pay-per-call.** `InferenceMarket.sol` из v1 — deprecated. Sage фокусируется на task-level escrow.
- `decision` **LitVM Builders Program submission отменён** в исходной форме. LitVM может стать одной из поддерживаемых сетей как opt-in adapter.
- `scaffolding` Создана базовая структура `D:\Sage\`: README, CLAUDE.md, AGENTS.md, IDEAS/GOTCHAS/BACKLOG, docs/{adr,architecture,runbooks}. KB-dossier `project-sage` создан; `project-agentpay` помечен archived.
- `adr` **ADR-0001 Accepted** — deterministic contract addresses через CreateX + CREATE3 + versioned salt. Единый адрес `AgentRegistry` / `TaskEscrow` на Base, Arbitrum, OP, BNB. zkSync / Polygon zkEVM исключены из same-address-набора в v2.
- `adr` **ADR-0002 Accepted** — agent identity: anchor-registry на Base + EAS-аттестации для профиля + single EOA на всех EVM + spoke-chains без registry (только TaskEscrow).
- `adr` **ADR-0003 Accepted** — x402 как единственный транспорт для pay-per-call; `InferenceMarket.sol` из v1 окончательно deprecated и не переносится. Sage-контракты фокусируются только на task-level escrow. Формализация ранее принятого D5.

## 2026-04-20 (v1, archived)

- `release` AgentPay v1 код завершён: 46 contract tests + 21 SDK tests, все 22 TASKS закрыты. Deploy на LiteForge testnet отложен.

## 2026-04-10 (v1, archived)

- `init` AgentPay v1 начат как LitVM-native протокол для Builders Program. См. `D:\knowledge\projects\project-agentpay.md` (archived).
