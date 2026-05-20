# ADR-0014 — Arc as sibling chain via `@sage/adapter-arc` over native ERC-8183 + ERC-8004

- **Status:** Accepted
- **Date:** 2026-05-21
- **Deciders:** Alex, Claude
- **Supersedes:** —
- **Related:** ADR-0001 (deterministic addresses); ADR-0002 (agent identity); ADR-0008 (Sage angle / position); `docs/market/chain-expansion-recon-2026-05-13.md` Phase 1b (Arc testnet readiness); `packages/adapter-arc/`; `apps/web/chains/arc.ts`.

## Context

ADR-0008 positions Sage as multi-chain settlement infrastructure for AI agents. Today that claim is honoured by Base alone: `AgentRegistry` + `TaskEscrow` on Base mainnet + Base Sepolia, plus the chain-agnostic `@sage/core` + `@sage/adapter-evm` factoring. Other EVM chains in the v2.1 roadmap (Arbitrum / OP / BNB) extend that pattern in the obvious way — same contracts, same salts via CreateX + CREATE3 (per ADR-0001), same SDK.

Arc is the first chain where the obvious extension is not the right one.

Arc is Circle's L1 for stablecoin finance, currently testnet-only with mainnet "expected 2026" (no published date as of 2026-05-21; reference: `docs/market/chain-expansion-recon-2026-05-13.md` row 10, Circle's announcement at <https://www.arc.network/>). Arc ships with native primitives that the rest of EVM does not have:

- **ERC-8183** (draft EIP) — Job-based on-chain composability. A native task-escrow shape: caller specifies executor + amount + deadline + spec, atoms compose into composite jobs, lifecycle is on-chain.
- **ERC-8004** (draft EIP) — Agent Identity registry. Native, not bolted on as a separate registry contract.

Both standards directly cover the primitives Sage built for Base (`TaskEscrow` ≈ ERC-8183 Job, `AgentRegistry` ≈ ERC-8004 Identity). Deploying our `TaskEscrow` / `AgentRegistry` on Arc would parallel-deploy primitives that Arc users would already have. The cost of that parallelism would be paid in confusion (two ways to express the same concept), settlement fragmentation (Arc-native agents not visible in Sage's view of Arc), and a stale narrative (Sage as "another job-escrow contract" on a chain that already has one).

The right call is the opposite: on chains that have a native task-escrow primitive, Sage adapts to it. On chains that don't (Base, Arbitrum, OP, BNB today), Sage deploys its own. The `ChainAdapter` interface in `@sage/core` is already the seam — the adapter's job is to project a chain's primitive onto the uniform SDK shape, not to homogenise every chain by ignoring what it offers.

A second forcing factor: Arc testnet is not yet stable enough to wire against. Public RPC, canonical chainId, ERC-8183/ERC-8004 reference contract addresses on testnet — none of these are confirmed in the form we'd commit to the SDK. Building a real adapter today would require speculative addresses and ABIs taken from draft EIPs, with high re-work risk when the substrate stabilises.

We therefore want a decision that (a) commits to the architectural shape now, in code visible to readers and to ourselves, and (b) defers concrete wiring until the substrate exists.

## Decision

`@sage/adapter-arc` is a separate package in the monorepo (sibling to `@sage/adapter-evm`) that implements the `ChainAdapter` interface from `@sage/core`, wrapping **Arc's native ERC-8183 Job and ERC-8004 Agent Identity primitives**. Sage does **not** deploy its own `TaskEscrow` or `AgentRegistry` contracts on Arc.

The package ships today as a **scaffold**: production-shape package metadata, full `ChainAdapter` conformance, every operation throwing `NotImplementedError` with a pointer back to this ADR. Real implementation lands when Arc testnet publishes a stable chainId + RPC + block explorer, and ERC-8183 / ERC-8004 reference contracts on Arc testnet have addresses we are willing to trust.

The UI surfaces Arc as a planned chain (`/docs/architecture` chain table) so the multi-chain commitment is visible to readers without pretending Arc settlement works yet.

## Rationale

1. **Avoid duplicating chain-native primitives.** Arc has ERC-8183 (Jobs) and ERC-8004 (Identity) as native standards. Deploying our `TaskEscrow` / `AgentRegistry` alongside them would create two parallel ways to do the same thing on the same chain, fragment any future agent visibility on Arc, and signal that Sage hasn't read the room. Wrapping the native primitive is what "multi-chain" honestly means.
2. **USDC-native gas is the natural settlement substrate.** Arc was built so that USDC is the gas token. Sage's settlement currency is USDC (ADR-0004). On Arc the alignment is total: a sub-task on Arc settles in USDC without the ETH-gas wrapping ceremony we navigate on Base. The adapter just has to project that into the same SDK shape callers already use for Base.
3. **Alignment with Circle ecosystem narrative.** Per `docs/market/chain-expansion-recon-2026-05-13.md`, Circle's Arc + the Claude Agent SDK integration form a credible adjacent ecosystem to Sage's audience (agent developers who already use Claude). Adapting to Arc's native primitives — rather than parachuting our contracts in — reads as "Sage extends what Arc offers" rather than "Sage competes with what Arc offers." Position: complementary, not parallel.
4. **The `ChainAdapter` interface fits this naturally.** `@sage/core` defines `AgentClient` + `TaskClient` shapes independent of any specific contract. `@sage/adapter-evm` projects our `TaskEscrow` + `AgentRegistry` into that shape; `@sage/adapter-arc` projects ERC-8183 + ERC-8004 into the same shape. The abstraction exists in code already (ADR-0005). Using it on Arc is what it was for.
5. **Scaffold-first is honest at this stage.** Shipping a half-working adapter with mock RPC and synthetic ABIs from draft EIPs would commit us to shapes that may still shift. The `NotImplementedError`-everywhere scaffold instead commits to the *structural* claim (Arc is a planned sibling chain via this package) while being transparent about the runtime gap. ADR-0008's "engineering aesthetics" axis is better served by a clean scaffold + ADR than by working code that pretends to do something it can't.

## Alternatives considered

### Option A — Deploy our own `TaskEscrow` and `AgentRegistry` on Arc

- Pros: zero new code; reuse the same audited contracts; uniform behaviour across all chains; immediate same-address (if CreateX is available on Arc per ADR-0001).
- Cons: parallel-deploys primitives Arc already has natively, fragmenting on-chain task-escrow on Arc into two shapes; signals indifference to Arc's native ecosystem; ignores that ERC-8183 is exactly what we'd want to integrate against. CreateX presence on Arc is also unconfirmed (per `docs/market/chain-expansion-recon-2026-05-13.md` §7) — the same-address strategy might not even hold.
- Rejected because: it makes Sage just-another-escrow on a chain whose whole point is being a stablecoin-native L1 with native composability. The multi-chain framing is supposed to mean adapting to chains, not papering over their primitives.

### Option B — Deploy a fork of ERC-8183 with our opinionated defaults on Arc

- Pros: keeps Sage's lifecycle semantics (grace period, dispute window, refund-on-expiry) explicit; doesn't depend on standard-body finalisation of ERC-8183; we own the ABI surface.
- Cons: same fragmentation problem as Option A (now there's a Sage-Job and an Arc-Job on the same chain, with subtly different semantics); committing to a fork commits us to maintaining drift from upstream as the EIP evolves; reduces interoperability — agents that integrate against native ERC-8183 wouldn't see Sage tasks. Defeats the purpose of being on a chain with a native composability standard.
- Rejected because: the value of being on Arc is exactly Arc's native primitives. Forking them turns Arc into yet-another-EVM with extra steps.

### Option C — Don't add Arc until mainnet ships, scaffolded or otherwise

- Pros: zero new code today; no scaffold to maintain; nothing to update when the EIPs shift.
- Cons: silently delays the multi-chain commitment from ADR-0008 by an unknown amount (Arc mainnet "expected 2026"); no visible place for "Arc is coming" to live in the repo, so the position reads as "Sage is a Base-only project that talks about multi-chain"; no scaffold for readers (or for ourselves later) to anchor against when Arc primitives stabilise.
- Rejected because: the structural claim ("Sage adapts to chains, including chains that have their own task primitives") should exist in code now. Otherwise ADR-0008 stands alone with one chain underneath it, which is exactly the position the ADR was meant to grow out of.

### Option D — Build a real Arc adapter against best-guess testnet endpoints today

- Pros: ships something that runs.
- Cons: every piece of "running" today (chainId, RPC URL, ERC-8183 reference address, ERC-8004 reference address) is speculative. Locks the SDK into addresses that will likely change. Creates the worst version of the maintenance treadmill: keeping fake-real code in sync with a moving testnet until it stabilises, with no users in the meantime.
- Rejected because: it confuses "running" with "real". The honest move is to commit to the shape, scaffold the package, and replace `NotImplementedError`s with real calls when the substrate is real.

## Consequences

**Положительные:**

- `@sage/adapter-arc` exists in code as of 2026-05-21. The multi-chain framing in ADR-0008 has a second concrete adapter (even if its operations throw). Readers see what "multi-chain Sage" means structurally.
- The `ChainAdapter` interface is exercised by two implementations now (EVM + Arc-scaffold). Future adapters (Solana, NEAR) inherit the validated pattern.
- The architecture chain table at `/docs/architecture` carries Arc as a planned row pointing at this ADR — UI commitment matches code commitment.
- When Arc testnet stabilises, the conversion from scaffold to real is local: `packages/adapter-arc/src/` only, with a clear file-mapping plan in the package README. No `@sage/core` change required.
- The decision to wrap native ERC-8183 (not deploy our own contracts) is captured here so future contributors can't quietly drift toward Option A.

**Отрицательные / компромиссы:**

- Maintenance surface grows: the scaffold has tests, a README, a chain config, and a chain row, all of which need attention if the ChainAdapter interface changes. Mitigation: conformance tests fail loudly on interface drift, so the cost shows up as a test failure rather than silent rot.
- We have committed against deploying our contracts on Arc. If ERC-8183 / ERC-8004 are abandoned or take an undesirable shape, Sage would have to reconsider via a new ADR (revisiting this decision), not by quietly adding a `TaskEscrow` deploy script.
- The scaffold is not currently useful at runtime. Callers reaching for Arc operations get a clear error, but they get no settlement. That's intentional — the alternative (silent stubs / mock RPC) is worse — but it does mean adopting `@sage/adapter-arc` today is purely a structural commitment, not a working integration.

**Что потребует дальнейшего решения:**

- When real ERC-8183 + ERC-8004 ABIs land in the adapter, dispute / refund / auto-release semantics may not map cleanly onto Sage's `TaskClient` interface (which was shaped against `TaskEscrow.sol`). A follow-up ADR may be needed to either widen `TaskClient` or to document where Sage's lifecycle vocabulary diverges from ERC-8183's.
- `parent_id` metadata (ADR-0007) lives in the `specUri` envelope on Base because `TaskEscrow` has no first-class hook for it. ERC-8183 may have a native field for composition lineage. When real implementation starts, a small ADR should record whether Sage continues to use the specUri envelope on Arc (uniformity) or uses ERC-8183's native field (alignment) — and how `@sage/core` types reflect the choice.
- The UI chain entry currently sits in `apps/web/chains/arc.ts` as a `PlannedChainConfig` (distinct from `SageChainConfig`). When Arc goes live, the schemas converge or a single typed `status` field replaces the split. Defer until concrete fields are known.
- ADR-0001 (deterministic addresses via CreateX + CREATE3) does not apply to this adapter — we are not deploying contracts on Arc. If a future Sage primitive ever does need to be deployed on Arc alongside the native ones, that decision gets its own ADR; we are not preempting it here.

## Implementation notes

The scaffold package is at `packages/adapter-arc/`:

- `package.json` — production-shape (`@sage/adapter-arc@0.0.1`, `peerDependencies: { viem: ">=2.0.0" }`).
- `src/index.ts` — `createSageArcClient()` returns a `ChainAdapter`; `NotImplementedError` class is exported.
- `src/chain.ts` — `ARC_TESTNET_CHAIN_INFO` with `chainId: '0'` and `explorerUrl: 'https://explorer.arc.network'` as documented placeholders.
- `src/abi/README.md` — explicit gate against importing draft-EIP ABIs prematurely.
- `test/index.test.ts` — 17 conformance tests (structural + NotImplementedError-per-op).
- `README.md` — public-facing status + checklist for moving from scaffold to live.

UI integration: `apps/web/chains/arc.ts` defines `ARC: PlannedChainConfig`; the `/docs/architecture` chain table has an "Arc · Planned · ADR-0014" row with a hover-tooltip carrying the planned-state note.

Workspace already covers `packages/*`; the new package shows up under `pnpm install` automatically.

## References

- ADR-0001 — Deterministic contract addresses via CreateX + CREATE3.
- ADR-0002 — Agent identity: Base-anchored registry + EAS + single EOA, no spoke registries.
- ADR-0008 — Sage angle / position: multi-chain settlement infrastructure, distinguished by observable decomposition.
- `docs/market/chain-expansion-recon-2026-05-13.md` — Phase 1b (Arc testnet readiness) — narrative for why Arc is on-track now.
- `packages/adapter-arc/README.md` — package status + checklist.
- ERC-8183 (Job-based on-chain composability) draft EIP — <https://eips.ethereum.org/EIPS/eip-8183> (verify number / status when implementing).
- ERC-8004 (Agent identity) draft EIP — <https://eips.ethereum.org/EIPS/eip-8004> (same).
- Arc — <https://www.arc.network/> (Circle's L1 for stablecoin finance).
