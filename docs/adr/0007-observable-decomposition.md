# ADR-0007 — Observable decomposition: plan-then-execute as the default flow for composite agent tasks

- **Status:** Accepted
- **Date:** 2026-05-19
- **Deciders:** Alex, Claude
- **Supersedes:** —
- **Related:** ADR-0001 (deterministic addresses), ADR-0002 (agent identity), ADR-0004 (USDC settlement); `docs/research/observable-decomposition.md` (full reasoning); `docs/research/classification-trigger-design.md` (forthcoming — trigger mechanics)

## Context

Sage today exposes a single `/demo` flow: user enters a brief, the orchestrator runs a hard-coded `summarize → translate` pipeline, the UI shows a linear step tracker. This is a fine demo of *atomic settlement*, but a poor demo of *composite work*. The interesting agent tasks are not "translate this sentence" — they are "research the top three options and pick the best for me," "plan my Tokyo trip and book it," "audit this contract and write a report." These are inherently decomposable, and how that decomposition is surfaced — or hidden — defines the user's experience and what kind of artifact the task leaves behind.

In the broader agent-payment landscape, decomposition is universally hidden. ReAct-style frameworks (Claude Code, Devin, AutoGPT, LangChain agents) keep it inside the LLM's context window; pay-per-call standards (x402, Stripe MPP) don't model it; even ERC-8183 treats each Job as atomic and leaves composition to implementers. We see this as an underexplored gap.

The position we want to take: **decomposition should be a first-class observable artifact**. The LLM may produce the plan, but the plan becomes a structured object — visible to the user, editable before execution, verifiable per step, retained as a reusable artifact after completion.

This ADR locks the user-facing pattern. It does not change any deployed contract. The full reasoning is in `docs/research/observable-decomposition.md`.

## Decision

For composite agent tasks initiated through Sage, the default flow is **plan-then-execute**:

1. The parent agent classifies the incoming brief and produces a structured plan: an array of sub-tasks, each with type, executor, estimated cost, deadline, and dependencies.
2. The plan is **surfaced to the user** through a plan card UI, with three actions: approve, edit, cancel.
3. Upon approval, each sub-task becomes a separate on-chain settlement record — a `TaskEscrow` on Base, an `ERC-8183` Job on Arc, the equivalent primitive on any future chain — linked back to the plan via a `parent_id` metadata convention in `specUri`.
4. Sub-tasks execute according to their dependency graph. Each completion is a verification point; the user (or automated policy) approves payment or disputes before downstream sub-tasks unblock.
5. The parent agent may extend the plan mid-execution by proposing additional sub-tasks; these go through the same approval gate before becoming on-chain records.
6. The final artifact is the complete graph of paid sub-tasks plus their deliverables — retained, queryable, and reusable as a template.

A **two-axis classification trigger** (decomposability × stakes) determines UX intensity, not whether decomposition happens. Single-shot low-stakes tasks bypass the plan card and execute directly; composite high-stakes tasks engage per-step approval gates. Decomposition is always externalized; only the user-facing ceremony scales with task complexity and risk.

## Rationale

- **Decomposition that lives only in LLM context is not a transferable artifact.** It cannot be reused, audited by a third party, replayed, or templated. Externalizing it converts ephemeral reasoning into durable structure.
- **Per-step verification is cheaper than end-to-end re-execution.** When an intermediate result is wrong, catching it early avoids cascading waste. The atomic settlement primitive we already have makes this natural.
- **The plan itself becomes a reusable asset.** Successful plans become templates for similar future tasks, reducing both cost and decision overhead on subsequent runs.
- **Settlement granularity matches the work granularity.** Different sub-tasks executed by different specialized agents at different costs settle independently. Partial-failure pricing is automatic: research gets paid even if the downstream booking step fails.
- **The pattern is chain-agnostic.** Same flow on Base (via our `TaskEscrow`) and Arc (via native `ERC-8183`) through a uniform SDK. This reinforces Sage's multi-chain framing (see CLAUDE.md "Project ethos").
- **No contract changes required.** The decision is about orchestration patterns and user-facing surfaces. Our existing primitives (atomic escrow, approvePayment, disputeTask, permissionless refund, event emission) already support this.

## Alternatives considered

### Option A — Status quo: hard-coded pipeline in orchestrator

- Pros: simple; predictable behavior; current code works.
- Cons: pipeline structure invisible to the user; cannot handle tasks not foreseen by the developer; one breakage means full restart; no reusable plan artifact; doesn't demonstrate our angle.
- Rejected because: it under-uses our atomic primitive and produces the same one-size-fits-all demo as everyone else.

### Option B — Fully implicit decomposition (ReAct-style)

- Pros: lowest latency, no plan-approval ceremony; matches most contemporary agent frameworks; users familiar with ChatGPT-style "just do it."
- Cons: decomposition is invisible; settlement is coarse; verification is only end-to-end; produces no reusable artifact; trust assumed rather than demonstrated.
- Rejected because: this is what every existing system already does. Our angle is precisely the opposite.

### Option C — Mandatory full plan approval for every task

- Pros: maximum transparency and user control.
- Cons: friction for trivial tasks ("translate this sentence" shouldn't need a plan card); cognitive load for users; runs counter to good defaults.
- Rejected because: the two-axis trigger already addresses this — low-stakes single-shot tasks bypass the ceremony automatically. Mandating approval for everything would be over-correction.

### Option D — On-chain plan as a single composite contract call

- Pros: atomic from the user's perspective; one transaction approves the entire graph.
- Cons: requires contract changes; couples plan structure to contract bytecode (every new plan shape needs a new contract); loses the per-sub-task settlement granularity that is our actual primitive.
- Rejected because: it inverts the design — instead of using our atomic primitive as a building block, it forces a monolithic alternative. The whole point is that the *primitive* stays simple and *composition* lives elsewhere.

## Consequences

**Positive:**

- Sage gains a distinctive, articulable user-facing pattern that no current competitor exposes. The angle is verifiable in our code, not a marketing claim.
- Plan artifacts accumulate over time as a corpus of structured work patterns — reusable templates, audit trails, replay material.
- Per-step verification creates natural insertion points for compliance hooks (EU AI Act human-override, MiCA audit logs) without bolting them on afterward.
- The same flow demonstrates on Base and Arc with no per-chain pattern divergence, reinforcing Sage's multi-chain provider framing.
- **Human-in-the-loop is the point, not the cost.** Plan-approval lets the user catch wrong decompositions and wrong executors *before* execution, avoiding the much larger cost of rejecting the whole final deliverable after the fact.
- **LLM classification errors are caught by design.** When the classifier mis-routes a task, human review surfaces this immediately; no silent failures bury the mistake until completion.
- **The friction we add is small compared to the user's alternative.** A non-technical user faced with "build my own agent infrastructure — scaffolding, skill libraries, MCPs, RAG pipelines, prompt engineering" finds "read and approve a plan card" trivially light by comparison. Plan-approval is the price of *delegating without losing visibility* — and it is the cheapest such price on offer.

**Negative / trade-offs:**

- **Plan storage durability.** Plans live off-chain. If the indexer goes down, or wallet-encrypted plans are lost, the audit trail is gone. Forthcoming ADR to decide where plans live for durability — off-chain indexer, IPFS / Arweave pinning, wallet metadata, or a hybrid.
- **Privacy leak potential.** Surfacing a plan exposes intent. For financial, legal, or regulated workflows this is undesirable. Requires opt-in private mode — e.g. on-chain commitment hashes plus encrypted off-chain plan visible only to client + executor.
- **Recursion / cycle hazard.** A parent agent could pathologically keep adding sub-tasks. Implementation needs budget caps (max total USDC for the parent task), max-depth limits, and circuit-breaker logic.
- **Cross-chain composition complexity.** A parent task on one chain spawning sub-tasks on another requires linkage and verification across chains — harder than single-chain plans. First implementations stay single-chain per parent task; cross-chain plans come later with explicit design.
- **Initial onboarding cost.** A first-time user has to understand the plan-approval concept. Real but bounded — one-time learning, not recurring. Mitigated by minimal explanatory copy in the plan card itself.

**Requires follow-up decisions:**

- Plan storage durability — off-chain indexer, encrypted in user wallet metadata, IPFS / Arweave pinning, or hybrid. Forthcoming ADR.
- Whether `parent_id` linkage stays as `specUri` metadata convention forever, or upgrades to an explicit field in a future TaskEscrow version. Recommend metadata-only until concrete need arises.
- Reputation accrual across composite tasks — what flows to parent agent for planning quality vs. to sub-task executors for execution quality. Touches ERC-8004 integration. Forthcoming ADR.
- Privacy treatment for plans whose existence is sensitive. Recommend off-chain default with optional on-chain commitment hashes.
- Cycle / recursion guards — max-depth, budget cap, circuit breakers. Design + implementation specifics.
- Onboarding flow for first-time users — minimal copy in plan card vs. separate tutorial vs. progressive disclosure. UI decision.

## Implementation notes

This ADR is intentionally pattern-level. The implementation footprint is:

- `packages/core/` — types for `Plan`, `SubTask`, `ClassificationResult`. Chain-agnostic.
- `packages/adapter-evm/` and forthcoming `packages/adapter-arc/` — `createSubTask({ parent, ... })` helper that wraps the native settlement primitive with `parent_id` metadata.
- `apps/demo-agents/` — new `parent-agent/` service that does classify → plan → spawn-children, with structured output via LLM function calling.
- An off-chain indexer service that listens for `TaskCreated` events, parses `parent_id` from `specUri` metadata, and reconstructs the parent-child graph for UI consumption.
- `apps/web/app/demo/` — new plan-card UI component, graph-view component (likely via `react-flow` or `dagre`), per-sub-task result drawer with approve / dispute actions.
- `docs/research/classification-trigger-design.md` — forthcoming companion document detailing the trigger's signal model.

No changes to `packages/contracts/`. No re-deployment. No new salt.

## References

- `docs/research/observable-decomposition.md` — full reasoning, worked example, open questions.
- `CLAUDE.md` — "Project ethos" section establishing multi-chain provider framing.
- ADR-0001 — deterministic addresses across EVM chains (enables uniform settlement primitive).
- ADR-0004 — USDC settlement + EIP-2612 permit (the actual atomic primitive being composed).
- ERC-8004 — agent identity standard on Arc.
- ERC-8183 — programmable job standard on Arc.
