# ADR-0016 — Discovery correction to ADR-0015: ERC-8183 was deployed on Arc testnet all along; bridge stands on shape-mismatch rationale

- **Status:** Accepted
- **Date:** 2026-05-22
- **Deciders:** Alex, Claude
- **Supersedes:** ADR-0015 (partially — Discovery table rows for ERC-8183 / ERC-8004, and Migration trigger #1; the deploy-our-own outcome itself stands).
- **Related:** ADR-0014 (native ERC-8183/8004 wrap direction); ADR-0015 (Arc testnet bridge); `packages/adapter-arc/`.

## Context

ADR-0015 (2026-05-21) recorded a substrate-readiness check for Arc testnet and concluded that **ERC-8183 Job** and **ERC-8004 Agent Identity** reference contracts were "Not deployed at canonical addresses on testnet. Not present in `docs/arc/references/contract-addresses`." On that basis, Sage deployed its own `TaskEscrow` / `AgentRegistry` on Arc testnet via Arachnid CREATE2 as an interim bridge, with a Migration trigger that would fire when the native primitives were published.

On 2026-05-22, while preparing a Circle grant application that referenced this finding, we verified the claim against sources beyond `docs.arc.io`. Two findings:

1. **ERC-8183 IS deployed on Arc testnet** at `0x0747EEf0706327138c69792bF28Cd525089e4583`. Documented in the [Arc blog post 2026-04-07](https://www.arc.network/blog/running-an-agentic-economic-flow-on-arc-with-erc-8183) ("Using Arc with ERC-8183 to Run an Agentic Economic Flow") and in the tutorial at `docs.arc.network/arc/tutorials/create-your-first-erc-8183-job`.

2. **ERC-8004 has documented support for Arc** in the tutorial at `docs.arc.network/arc/tutorials/register-your-first-ai-agent`. ERC-8004 went live on Ethereum mainnet 2026-01-29 and is supported on Arc via the same tutorial-referenced contracts.

The ADR-0015 Discovery table was based on a single-source check of `https://docs.arc.io/arc/references/contract-addresses`. That page does indeed not list ERC-8183/8004 — but the canonical addresses live on a separate Arc-owned domain (`docs.arc.network`) and on `arc.network/blog`. Arc's documentation surface is split across at least three Mintlify / blog properties; ADR-0015 treated one as authoritative for all contract-deployment claims.

This ADR corrects the discovery, re-evaluates whether ADR-0015's outcome (deploy our own contracts) still holds given the corrected facts, and records the process learning so the same single-source-check error does not recur on the next chain we evaluate.

## Decision

ADR-0015's outcome — Sage runs its own `TaskEscrow` / `AgentRegistry` on Arc testnet via Arachnid CREATE2 — **stands**, on revised rationale.

The earlier rationale ("ERC-8183/8004 reference contracts don't exist on testnet") was factually wrong. The rationale that holds:

**Shape mismatch.** ERC-8183 and Sage's `TaskEscrow` are not drop-in equivalents. ERC-8183 uses:

- **Three roles**: client, provider, **separate evaluator** (`createJob(provider, evaluator, expiredAt, description, hook)`).
- **Three-transaction setup**: `createJob` → `setBudget(jobId, amount)` → `fund(jobId)`.
- **`bytes32` deliverable** (`submit(jobId, deliverable_bytes32)`).
- **Hook contract** for custom completion logic.

Sage's `TaskEscrow` uses:

- **Two roles**: sponsor, executor.
- **Single-transaction create-and-fund** via EIP-2612 USDC permit (`createTask(executor, deadline, amount, specUri)` + permit signature, one tx).
- **`string` `specUri`** for both spec and result (off-chain URI envelope, ADR-0007 `parent_id` lives inside it).
- **No native hook**; lifecycle is monolithic in `TaskEscrow`.

Wrapping ERC-8183 into Sage's `TaskClient` interface (the ADR-0014 design) would require: collapsing three calls into one (not possible without modifying ERC-8183), bridging the evaluator role (omit it, or map to orchestrator), and adapting `bytes32` deliverable to/from `string` `specUri`. None of these are impossible, but the resulting wrapper would be either a leaky abstraction or a re-implementation. The cost-of-wrapping today is higher than the cost-of-running-our-own.

## Rationale

1. **The correction does not change the working code.** Sage's contracts on Arc testnet — `AgentRegistry` at `0xD100d7CE4f610dDb59C276AF293aA79F9Fcff936`, `TaskEscrow` at `0xA9e6Dc31F21149868C0fd43C83038C74cC8Ffcdb` — are operational; the composite demo runs on them; reverting would discard working infrastructure to gain interface alignment the project does not currently need.

2. **ERC-8183 doesn't fit Sage's UX-shape today.** Single-tx create-and-fund via permit is one of Sage's defining ergonomic choices: one signature for the user, one on-chain transaction. ERC-8183's three-step pattern is workable but introduces extra round-trips and gas — at exactly the layer where Sage is trying to minimise friction.

3. **Honest engineering aesthetics (per ADR-0008).** Now that we know ERC-8183 exists on Arc testnet, we acknowledge it explicitly — in this ADR, in `packages/adapter-arc/README.md`, in any external materials describing Arc support. The story shifts from "the substrate doesn't exist" to "the substrate exists in a shape we chose not to wrap." That distinction matters; we record it instead of silently rewriting ADR-0015.

4. **Wrapper preserved as future work, not blocker.** `@sage/adapter-arc` scaffold stays in the repo. If a future use case — Arc-ecosystem agent discoverability, ERC-8004 reputation integration, multi-protocol composability on Arc — makes the wrapper valuable, it can be implemented then, informed by real demand rather than speculative architecture.

## Migration trigger (replaces ADR-0015's Migration trigger)

ADR-0015's Migration trigger #1 ("ERC-8183/8004 reference contracts deployed at canonical addresses listed in `docs.arc.io/...`") **has effectively fired** under a reasonable reading of "deployed at canonical addresses" — but the condition was the wrong trigger to begin with. Wrapping is not automatically the right move when reference contracts exist; it is the right move only when wrapping has value the bridge doesn't.

The right trigger is whichever of the following fires first:

1. **Explicit demand for ERC-8183 interop.** A Sage user (or a near-future user with a concrete use case) needs to interoperate with ERC-8183-shaped tasks on Arc — e.g. accept jobs created via Arc-native ERC-8183 contracts, or expose Sage tasks as ERC-8183 jobs for Arc-ecosystem agents to consume. At that point, a wrapper adapter is implemented in `@sage/adapter-arc` along the ADR-0014 design.

2. **Arc mainnet ships and Sage launches on Arc mainnet.** At that point we re-evaluate whether to run our own contracts on mainnet or wrap ERC-8183, informed by what mainnet's economic model looks like, whether ERC-8183 has evolved to accommodate permit-based single-tx funding, and whether the multi-chain story benefits from interface alignment with Arc-native primitives.

3. **ERC-8183 surface evolves** to accommodate Sage's two-role + single-tx + string-spec pattern. Unlikely in the short term, but possible if the EIP draft incorporates feedback from production deployments.

None of the three is active today. The bridge remains canonical for Sage on Arc.

## Process correction

The recon failure mode: relying on a single docs domain as canonical for all substrate claims. Going forward, when characterising substrate-readiness on any new chain:

- Check the network's primary docs domain.
- Check any sibling docs domains — Arc has `docs.arc.io` for network references and `docs.arc.network` for tutorials and AI-agent flows; both are Circle-owned and authoritative for different content.
- Check the network's blog (`arc.network/blog` in Arc's case) for contract deployment announcements; protocols often announce deployments there before the reference page catches up.
- Verify on-chain via `eth_getCode` on plausible canonical addresses before declaring something "not deployed."

Codifying this checklist into a `docs/runbooks/chain-substrate-recon.md` runbook is a follow-up task — not blocking on this ADR.

## Consequences

**Положительные:**

- External materials about Sage on Arc (grant application, blog drafts, README) become factually accurate. We describe our deployed contracts honestly as a shape-mismatch decision, not as a substrate-absence workaround.
- ADR-0015's Discovery error is on the record as corrected. Future readers — including future contributors evaluating whether to wrap ERC-8183 — see what we got wrong and what's actually true, not a silent retcon.
- The recon process improves for the next chain evaluation; the single-source-check failure mode is named and avoidable.

**Отрицательные / компромиссы:**

- The narrative is slightly harder to compress. "We chose not to wrap because the surfaces differ" requires more context than "they weren't deployed yet." The shorter, simpler version is no longer available, and the longer version is what we owe readers.
- We carry the maintenance burden of our own deployed contracts on Arc (per ADR-0015's Maintenance commitment) where an ERC-8183 wrapper would have offloaded operational responsibility to whichever party maintains the canonical ERC-8183 deployment. Trade-off: full control over the shape vs. ecosystem alignment.

**Что потребует дальнейшего решения:**

- Whether to write a chain-substrate-recon runbook (mentioned above as follow-up, not blocking).
- If Arc mainnet ships before Sage launches on Arc mainnet, an ADR-0017 will be needed to record the re-evaluation per Migration trigger #2.
- If a real interop use case appears (per Migration trigger #1), a follow-up ADR will record the wrapper-adapter design and the cutover plan.

## Implementation notes

Files updated alongside this ADR:

- `docs/adr/0015-arc-deploy-bridge.md` — Status line updated to record partial supersession by 0016; inline note added to the Discovery table referencing this ADR.
- `docs/adr/README.md` — Index updated: ADR-0015 status reflects partial supersession; ADR-0016 added with Accepted status.

Pending (next session):

- `packages/adapter-arc/README.md` — "when reference contracts appear" language replaced with "when shape-alignment becomes valuable."
- `CHANGELOG.md` — 2026-05-22 entry recording the discovery correction.
- `D:\knowledge\projects\project-sage.md` — KB dossier updated with ADR-0016 link.

The contracts themselves are unchanged; the deployments at `0xD100d7CE…` (AgentRegistry) and `0xA9e6Dc31…` (TaskEscrow) on Arc testnet remain canonical for Sage's task flow on Arc.

## References

- ADR-0014 — `0014-arc-adapter-native-erc-8183.md` (native wrap direction; the structural commitment that ADR-0015 deferred).
- ADR-0015 — `0015-arc-deploy-bridge.md` (interim bridge; partially superseded by this ADR's correction).
- [Arc blog: Running an Agentic Economic Flow on Arc with ERC-8183, 2026-04-07](https://www.arc.network/blog/running-an-agentic-economic-flow-on-arc-with-erc-8183).
- [docs.arc.network: Create your first ERC-8183 job](https://docs.arc.network/arc/tutorials/create-your-first-erc-8183-job).
- [docs.arc.network: Register your first AI agent (ERC-8004)](https://docs.arc.network/arc/tutorials/register-your-first-ai-agent).
- [EIP-8183 — Agentic Commerce](https://eips.ethereum.org/EIPS/eip-8183).
- [EIP-8004 — Trustless Agents](https://eips.ethereum.org/EIPS/eip-8004).
- [docs.arc.io: Contract addresses](https://docs.arc.io/arc/references/contract-addresses) — the page ADR-0015 relied on; does NOT list ERC-8183/8004 today.
