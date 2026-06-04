# ADR-0015 — Arc testnet bridge: deploy Sage contracts on Arc via Arachnid CREATE2, defer native ERC-8183/8004 wrap

- **Status:** Accepted, partially superseded by [ADR-0016](./0016-erc-8183-discovery-correction.md) (Discovery table rows for ERC-8183 / ERC-8004 + Migration trigger #1 corrected 2026-05-22; the deploy-our-own decision itself stands on revised rationale)
- **Date:** 2026-05-21
- **Deciders:** Alex, Claude
- **Supersedes:** ADR-0014 (partially — see *Relation to ADR-0014* below)
- **Superseded by:** [ADR-0016](./0016-erc-8183-discovery-correction.md) (partial — Discovery + Migration trigger only; bridge decision stands)
- **Related:** ADR-0001 (deterministic addresses); ADR-0014 (Arc as sibling chain via native ERC-8183 + ERC-8004); ADR-0016 (Discovery correction); `packages/adapter-arc/`; `apps/web/chains/arc.ts`; Arc testnet docs at `https://docs.arc.io/` + `https://docs.arc.network/`.

## Context

ADR-0014 (2026-05-21) committed Sage to wrapping Arc's native ERC-8183 (Job) and ERC-8004 (Agent Identity) primitives via `@sage/adapter-arc`, explicitly rejecting deployment of our own `TaskEscrow` / `AgentRegistry` on Arc. That decision rested on the assumption that ERC-8183 + ERC-8004 reference contracts exist on Arc testnet at canonical addresses we can wire against.

On 2026-05-21, during scoping of a real Arc demo, we fetched `https://docs.arc.io/` and verified what is actually on Arc testnet today. The findings:

| Asset | Status on Arc testnet |
|------|------|
| Public testnet RPC + chainId | ✅ Available — `https://rpc.testnet.arc.network`, chainId `5042002`, explorer `https://testnet.arcscan.app`, faucet `https://faucet.circle.com`. |
| Native USDC (ERC-20 wrapper) | ✅ Deployed at `0x3600000000000000000000000000000000000000`. Native balance representation is 18-decimal; ERC-20 interface exposes 6 decimals. Gas paid in USDC. |
| Arachnid CREATE2 deployer | ✅ Deployed at `0x4e59b44847b379578588920cA78FbF26c0B4956C` (canonical). |
| Permit2, Multicall3 | ✅ Deployed at canonical addresses. |
| EVM hard fork | ✅ Prague (newer than Cancun) — all opcodes our contracts use are supported. |
| `SELFDESTRUCT` at deploy | ❌ Restricted (does not affect us — we don't use it). |
| `block.prevrandao` | ❌ Always 0 (does not affect us — we don't use it). |
| Block timestamp uniqueness | ⚠️ Multiple blocks may share a timestamp (affects deadline assertions; mitigated by deadline_offset_s minimums). |
| **ERC-8183 Job reference contracts** | ❌ ~~**Not deployed at canonical addresses on testnet.** Not present in `docs/arc/references/contract-addresses`.~~ **Correction (2026-05-22, ADR-0016):** ERC-8183 IS deployed on Arc testnet at `0x0747EEf0706327138c69792bF28Cd525089e4583`, documented at `arc.network/blog` and `docs.arc.network` (which we did not check during this recon). The bridge decision still holds — see ADR-0016 for the revised shape-mismatch rationale. |
| **ERC-8004 Agent Identity reference contracts** | ❌ ~~**Not deployed at canonical addresses on testnet.** Not present in same reference list.~~ **Correction (2026-05-22, ADR-0016):** ERC-8004 support on Arc is documented at `docs.arc.network/arc/tutorials/register-your-first-ai-agent`. ERC-8004 went live on Ethereum mainnet 2026-01-29. |
| CreateX factory (`0xba5Ed099…`) | ❌ Not documented; same-address property from ADR-0001 cannot be assumed for Arc. |

The substrate ADR-0014 was designed around does not exist yet. We have two honest options: defer Arc support indefinitely (await native primitives), or change tactic and deploy our own contracts on Arc testnet as an interim, with an explicit migration path back to ADR-0014's native-wrap direction.

This ADR records the second choice and documents the conditions under which it is reversed.

## Decision

Sage deploys `AgentRegistry` and `TaskEscrow` on Arc testnet via the Arachnid CREATE2 deployer at `0x4e59b44847b379578588920cA78FbF26c0B4956C`, using the same Solidity sources as Base, parameterised for Arc's USDC address. The deployment is **interim and reversible**: the moment Arc publishes ERC-8183 + ERC-8004 reference contracts at canonical addresses, or Arc mainnet ships with these natively, we replace our deployed contracts with a thin `@sage/adapter-arc` wrapper over the native primitives (the ADR-0014 path), retiring our deployed instances.

Concretely:

1. **Today (interim):** `@sage/adapter-evm` learns Arc as a new chain config (`chains/arc.ts`). `@sage/adapter-arc` remains as scaffold + ADR-0014 target; it does not become the active Arc client. Web `SAGE_CHAINS` adds Arc as a live entry; `apps/web/chains/arc.ts` flips from `PlannedChainConfig` to `SageChainConfig` once contracts are deployed and verified.
2. **Migration trigger:** see *Migration trigger* section below.
3. **At migration:** new ADR-0016 records the cutover, `@sage/adapter-arc` becomes the production Arc client, our deployed contracts on Arc are kept readable for any in-flight tasks but no new tasks are routed through them.

## Rationale

1. **The substrate ADR-0014 anticipated does not yet exist on Arc testnet.** "Wrap native ERC-8183/8004" requires the references to be deployed somewhere we can wire against. They are not. ADR-0014 remains correct as a *direction*; ADR-0015 chooses the bridge that lets us ship a real demo without waiting for the direction to materialise.
2. **Path B is now technically straightforward.** Arc is EVM Prague-compatible, our contracts compile and deploy unchanged, USDC ERC-20 is present at a known canonical address, the Arachnid deployer is available for deterministic-ish addressing, and a faucet exists. None of the previous blockers (no testnet RPC, no USDC, no deployer) are present.
3. **A working Arc demo strengthens the multi-chain framing in ADR-0008.** ADR-0014's scaffold made the structural commitment visible; a real deployment on Arc makes the commitment *operational*. That is the difference between "Sage adapts to chains" as a claim and as evidence.
4. **Bridge is reversible and time-boxed by external events.** Unlike a permanent decision to fork ERC-8183 (which ADR-0014's Option B explicitly rejected), this ADR commits us only until the native substrate is real. The migration trigger is concrete, not nebulous.
5. **Honest engineering aesthetics (per ADR-0008).** Pretending ERC-8183 is available when it isn't would be the worse failure mode. So would silently deploying our contracts on Arc while ADR-0014 stands unmodified. This ADR resolves that tension explicitly.

## Migration trigger

This ADR is replaced (via ADR-0016) when **either** of the following holds:

1. **Native primitives published**: ERC-8183 Job and ERC-8004 Agent Identity reference contracts are deployed on Arc testnet at canonical addresses, listed in `https://docs.arc.io/arc/references/contract-addresses`, with stable ABIs we can wire against — AND a roundtrip test (create → accept → complete → settle) against those contracts passes on Arc testnet.
2. **Arc mainnet ships with native primitives**: Arc mainnet launches and ships with ERC-8183 + ERC-8004 as native contracts at canonical addresses — regardless of whether testnet has caught up.

The migration path:

- A new ADR-0016 documents the cutover (rationale: trigger fired; what changed; how in-flight tasks on the bridge contracts are handled).
- `@sage/adapter-arc` is updated from scaffold to real, wrapping the native primitives per the original ADR-0014 design.
- `@sage/adapter-evm`'s Arc chain config is removed (or marked deprecated for a transition window).
- `apps/web/chains/arc.ts` is updated to point at the new adapter.
- Bridge `TaskEscrow` / `AgentRegistry` instances on Arc testnet remain readable so any in-flight tasks finish their lifecycle; no new tasks route through them.
- CHANGELOG records the migration.

If the trigger does not fire within reasonable time (we are not pre-committing to a calendar deadline), this ADR's bridge remains the canonical Arc support. The maintenance commitment below applies.

## Maintenance commitment

While this ADR is active:

- Bridge contracts on Arc testnet are treated as production-equivalent for the testnet demo: monitored, kept funded via faucet, lifecycle verified by the same smoke matrix that covers Base.
- ABI / config drift between `chains/base.ts` and `chains/arc.ts` is tracked — both ride the same `@sage/adapter-evm` code, so the only legitimate divergence is the per-chain contract addresses, USDC address, and chain metadata.
- A short note in `packages/adapter-arc/README.md` describes the bridge state explicitly: scaffold is reserved for the native-wrap path; today's Arc traffic goes through `@sage/adapter-evm` with the Arc chain config. Readers landing on the adapter-arc package don't get confused into thinking it's the active client.
- If the bridge develops production-incident-level issues that the native-wrap path would not have, we accelerate the migration trigger by writing the ADR-0016 sooner.

## Relation to ADR-0014

ADR-0014 stated: *"Sage does not deploy its own `TaskEscrow` or `AgentRegistry` contracts on Arc."* This ADR overrides that single sentence for the interim period. The rest of ADR-0014 stands:

- The *direction* — adapt to chains' native primitives where they exist — remains canonical.
- The *position* in ADR-0008 (multi-chain settlement infrastructure distinguished by observable decomposition) is unchanged.
- The `@sage/adapter-arc` package as the **eventual** home of native-wrap Arc support is unchanged — it stays scaffolded until migration.

ADR-0014's status header gets a "Partially superseded by ADR-0015 (interim deploy via @sage/adapter-evm; native wrap deferred to ADR-0016 trigger)" note so future readers see the full picture from either entry point.

## ADR-0001 footnote (same-address property)

ADR-0001 commits Sage to deterministic same-address deployment across EVM chains via CreateX + CREATE3. CreateX is not documented as deployed on Arc testnet at the canonical address `0xba5Ed099633D3B313e4D5F7bdc1305d3c28ba5Ed`. Consequences:

- Arc deployments will use the **Arachnid CREATE2 deployer** (`0x4e59b44847b379578588920cA78FbF26c0B4956C`) instead. This deployer is the original deterministic deployer that pre-dates CreateX, and is present at the same canonical address on Arc per the official contract-addresses reference.
- **Same-address property does not hold for Arc.** Our `AgentRegistry` and `TaskEscrow` on Arc will have different addresses than on Base (because Arachnid CREATE2 mixes init code + constructor args + salt into the address, and USDC address as a constructor arg differs between chains).
- This is an explicit, documented divergence from ADR-0001's invariant. The invariant remains canonical for the Base / Arbitrum / OP / BNB cohort. Arc is an opt-in exception, recorded here.
- When migration trigger fires, the divergence becomes moot — the native-wrap path doesn't deploy our contracts at all.
- If CreateX is later deployed on Arc at the canonical address (e.g. by the CreateX maintainers' permissionless deploy script), we can backfill: deploy a second-generation `AgentRegistry` / `TaskEscrow` via CreateX + CREATE3 at the same addresses as Base, run a soft migration. This is not committed; it is recorded as a possible future motion.

## Alternatives considered

### Option A — Wait for native primitives (no Arc demo today)

- Pros: keeps ADR-0014 pristine; no superseding ADR needed; no bridge to maintain.
- Cons: defers a working Arc demo by an unknown amount; ADR-0008's multi-chain framing remains supported by one operational chain (Base) and one scaffold (Arc). The whole point of the discovery exercise was to find that the substrate isn't ready — Option A is "keep waiting" without an end date.
- Rejected because: a real Arc deployment is achievable today and strengthens the multi-chain framing in code, not just in docs.

### Option B — Deploy CreateX ourselves on Arc, then deploy our contracts at the same addresses as Base

- Pros: preserves ADR-0001's same-address invariant for Arc.
- Cons: CreateX deploys itself permissionlessly via its own bootstrap, but adding a chain to its supported list is non-trivial coordination with the CreateX maintainers. We would also be the first deployer on Arc, which is a meaningful operational responsibility for what is meant to be an interim path. The same-address property has limited operational value when the contract addresses are documented in our docs and SDK anyway.
- Rejected because: complexity per ADR-0001 invariant is not worth it for the bridge state. If CreateX is later deployed canonically on Arc by its maintainers, the second-generation deployment path above absorbs the value.

### Option C — Use Permit2 + a custom CREATE3-equivalent via Arachnid for same-address-ish

- Pros: technically possible — bake constructor args into salt, get deterministic addressing without CreateX. Could mimic same-address for Arc.
- Cons: invents a one-off deployment pattern that nothing else in the codebase uses; commits the SDK to a custom address derivation we'd have to document and maintain.
- Rejected because: the operational value of same-address-on-Arc-by-custom-derivation is not worth the bespoke infrastructure. Accept different addresses on Arc; document them; move on.

## Consequences

**Положительные:**

- A real Arc demo becomes shippable in 5-8h instead of indefinitely deferred.
- ADR-0008's multi-chain framing is operationally true on two chains rather than one + one scaffold.
- The migration trigger and reversal path are explicit; no quiet drift away from ADR-0014's direction is possible.
- `@sage/adapter-arc` package retains its scaffold-state with an unambiguous role: future home of native-wrap support.
- Arc demo exercises a chain with USDC-as-gas economics — a genuinely different settlement substrate than Base, which strengthens the "Sage adapts to chains" claim.

**Отрицательные / компромиссы:**

- We now run two contract deployments to monitor: Base mainnet (production) and Arc testnet (bridge). Operational surface grows. Mitigation: Arc testnet contracts inherit Base's audit + invariant + Slither status; the code is identical.
- ADR-0014 is partially superseded one day after acceptance. Reads as ADR churn. Mitigation: the superseding ADR (this one) is grounded in concrete external discovery, not preference change; the supersession is honest and the original ADR's direction survives.
- ADR-0001's same-address property does not hold for Arc. UI surfaces (chain table, addresses in docs) must accommodate this; consumers can no longer assume "Sage contract X is at address Y everywhere".
- Maintenance commitment binds us to the bridge until trigger fires. If the trigger fires never, the bridge is permanent — which is a meaningful drift from ADR-0014's intent. Mitigation: track trigger conditions in `packages/adapter-arc/README.md` checklist; revisit annually.

**Operational consequences:**

- New chain config `packages/adapter-evm/src/chains/arc.ts` lands with `chainId: 5042002`, `usdc: 0x3600...`, plus the deployed `taskEscrow` and `agentRegistry` addresses once known.
- Web `apps/web/chains/arc.ts` flips from `PlannedChainConfig` to `SageChainConfig` once deployment is verified. `SAGE_CHAINS` key type widens from `8453 | 84532` to include `5042002`.
- Foundry deploy scripts get a `--rpc-url` / `--broadcast` flow for Arc via Arachnid CREATE2.
- Sponsor wallet on Arc testnet is the same EOA as Base (per project policy: same EOA across chains); funded via Circle faucet (20 USDC × 2 per wallet, no rate-limit concerns at this scope).
- Worker agents (summarizer / translator / sentiment / vision) use the same EOAs as Base; funded same way.
- Adapter-arc README updated to describe the bridge state (current Arc traffic via adapter-evm, this package reserved for native-wrap migration).
- ADR-0014 status header updated: "Accepted, partially superseded by ADR-0015".

## Implementation notes

Step-by-step execution checklist (used to drive the work after this ADR is committed):

1. Verify USDC ERC-20 interface on Arc testnet behaves as our `TaskEscrow` expects: `decimals() == 6`, EIP-2612 `DOMAIN_SEPARATOR()` and `permit()` present, `balanceOf` and `transferFrom` behave standardly.
2. Add `packages/adapter-evm/src/chains/arc.ts` with the chain config (chainId 5042002, USDC address, Arachnid CREATE2 deployer, no CreateX).
3. Foundry deploy: `forge script script/Deploy.s.sol --rpc-url https://rpc.testnet.arc.network --broadcast` parameterised for Arc.
4. Verify deployed addresses against `https://testnet.arcscan.app`.
5. Add `arcTestnet` chain export to `@sage/adapter-evm` index. ABIs are the same as Base.
6. Flip `apps/web/chains/arc.ts` from `PlannedChainConfig` to `SageChainConfig`, fold into `SAGE_CHAINS`.
7. Sponsor + worker wallets on Arc via faucet (Alex coordinates faucet via existing EOAs).
8. End-to-end smoke: `/demo/composite` against Arc testnet through worker stack.
9. Update `packages/adapter-arc/README.md` to describe bridge state.
10. CHANGELOG entry; ADR-0014 status header refresh.

## References

- ADR-0001 (Deterministic contract addresses via CreateX + CREATE3).
- ADR-0014 (Arc as sibling chain via native ERC-8183 + ERC-8004) — this ADR partially supersedes its deploy-on-Arc rejection.
- ADR-0008 (Sage angle / position) — multi-chain framing this ADR strengthens by going operational on a second chain.
- Arc testnet docs:
  - `https://docs.arc.io/` (root)
  - `https://docs.arc.io/arc/references/connect-to-arc` (chainId, RPC, explorer, faucet)
  - `https://docs.arc.io/arc/references/contract-addresses` (USDC, CCTP, CREATE2 deployer, Permit2)
  - `https://docs.arc.io/arc/references/gas-and-fees` (USDC-as-gas, EIP-1559 + EWMA model)
  - `https://docs.arc.io/arc/references/evm-compatibility` (Prague hard fork, opcode notes)
- `https://faucet.circle.com` — testnet USDC faucet.
- Arachnid CREATE2 deployer canonical address: `0x4e59b44847b379578588920cA78FbF26c0B4956C`.
