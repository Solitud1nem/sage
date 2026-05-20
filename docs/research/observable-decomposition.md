# Observable Decomposition: Making Agent Plans Legible

**Status:** Draft for discussion · 2026-05-19
**Author:** Sage research notebook
**Companion to:** ADR-0010 (forthcoming), `classification-trigger-design.md` (forthcoming)

---

## 1. Premise

Complex agent tasks decompose. "Plan my Tokyo trip" becomes research → compare → book → confirm. "Build me a landing page" becomes wireframe → copy → design → code. "Analyze this market" becomes survey → categorize → evaluate → write.

In most agent systems today, this decomposition happens **inside the language model's context window**. The agent receives a brief, reasons internally about sub-steps, and emits tool calls in sequence. The decomposition exists — but only as ephemeral chain-of-thought, gone after the run completes.

This document argues that **decomposition should be a first-class observable artifact**: a structured plan, declared before execution, verified per step, retained after completion. We call this **observable decomposition**.

The proposition is not new in software (workflow engines, pipeline DAGs, BPMN). What is new is treating it as the **primary user contract** for agent work — not a hidden implementation detail. That shift has consequences for trust, cost transparency, verification, and what kind of artifacts agent work leaves behind.

Sage's task-escrow primitive — atomic, settled-on-completion, verifiable — composes naturally into observable decomposition graphs without any contract changes. The contribution here is the pattern and the user-facing surfaces, not new infrastructure.

## 2. Where decomposition lives today

A representative sample of how today's agentic systems handle composite tasks:

**ReAct-style loops (Claude Code, Devin, AutoGPT, LangChain agents).** The model thinks ("I should first check X, then if Y, do Z..."), emits a tool call, observes the result, and decides the next call. The full plan exists only as concatenated reasoning trace plus tool-call history. Inspecting it requires reading prose; structured query of "what sub-tasks happened" is impossible without post-hoc parsing.

**Hardcoded pipelines (current Sage demo, traditional LLM products).** A developer wires a fixed sequence: `summarize → translate`. The model only fills one slot per call. Decomposition is static, predictable, and lives in the orchestrator's code — not visible to the user, not reusable as data.

**x402 / Stripe MPP / single-call payment standards.** Each call is its own thing. Multi-step is "the developer's problem." There is no notion of "a task that consists of sub-tasks" at the standard level.

**ERC-8183 jobs (Arc native).** Each Job is atomic with a Client / Provider / Evaluator triple and a single deliverable. Composition across Jobs is not part of the standard. Hooks allow extension but the composition pattern is left to implementers.

What is common across all these: **the decomposition graph, if it exists at all, is not a queryable artifact accessible to the user or to third parties**. It lives in the LLM's working memory, in the orchestrator's code, or in nowhere at all.

## 3. Why this matters

Three reasons, in order of immediacy.

### 3.1 Economic

If decomposition is hidden, settlement is coarse. The user pays for "the whole task" — a single fee, opaque. Different sub-tasks may have been executed by different specialized agents at different costs, but the user sees a lump sum.

When decomposition is observable, settlement becomes fine-grained. The research sub-task is paid to the research-agent; the writing sub-task to the writing-agent; the verification sub-task to an evaluator. Each receives compensation proportional to their contribution. The user sees the breakdown.

This matters in two ways. First, **specialization becomes economically viable** — an agent that only does code-review can exist and be paid for that specific work, rather than only as part of a generalist agent's offering. Second, **partial-failure pricing becomes natural** — if research succeeded but final writing failed, research still gets paid; writing does not.

### 3.2 Trust

If decomposition is hidden, verification is end-to-end. The user receives a final deliverable and decides if it's acceptable. If unacceptable, the only recourse is to reject the whole.

When decomposition is observable, verification is per-step. Sub-task results are surfaced as they complete. The user (or a designated evaluator agent) can check intermediate outputs before downstream sub-tasks proceed. Errors are caught early, cheap to correct.

This matters most when **trust is incomplete**: new agent counterparties, third-party services, regulated workflows. The ability to check progress incrementally is the difference between "I delegated and hope" and "I delegated and stayed in the loop."

### 3.3 Long-term: artifacts vs. ephemera

A hidden decomposition produces one thing: the final result. After the run, the reasoning trace is forgotten (or stored as low-value log data).

An observable decomposition produces three things: the plan, the per-step deliverables, and the final result. All three persist. The plan can be **reused as a template** for similar future tasks. The per-step deliverables can be **audited** for compliance or debugged for failures. The final result is what you would have gotten anyway.

The compounding effect: every executed task adds to a corpus of structured plans. Patterns emerge. The system becomes smarter not by retraining its LLM, but by accumulating reusable decomposition artifacts.

This third point may be the most underrated. Today's agent systems treat each invocation as fresh. Observable decomposition treats each invocation as a contribution to a growing library of legible work patterns.

## 4. The Sage angle

Sage proposes:

> Decomposition should be **externalized as a structured artifact** before any sub-task executes. The LLM may produce the plan, but the plan is then **a first-class object** — visible, editable, approvable, verifiable per step, retained after completion.

Concretely:

1. A parent agent receives a brief.
2. The parent agent runs a **classification + planning** step. The output is a structured plan: list of sub-tasks, each with type, executor, estimated cost, deadline, dependencies. (See `classification-trigger-design.md` for the trigger design.)
3. The plan is presented to the user (or to an automated policy gate) for **approval or editing**.
4. Upon approval, the parent agent creates one **TaskEscrow record per sub-task** on-chain. Each sub-task is now an atomic on-chain object with its own lifecycle, payment, deadline, and result URI.
5. Sub-tasks execute. Each transition (created → accepted → completed → paid) emits an on-chain event observable from any indexer or UI.
6. Between sub-tasks, the user (or evaluator) reviews intermediate results. Approve releases payment and unblocks dependent sub-tasks. Dispute halts the chain and triggers replan.
7. The parent agent may **dynamically extend the plan** mid-execution — adding new sub-tasks based on results — but each extension goes through the same approval gate.
8. On completion, the plan + per-step deliverables + final result are all available as a connected graph of on-chain records.

The LLM remains in the loop. It produces the plan. It chooses executors. It decides when to add a sub-task. But **the output of every decision becomes a structured artifact**, not a hidden reasoning trace.

## 5. The flow: a worked example

Suppose a user asks Sage:

> *"Research the top three stablecoin yield products on Arc and produce a comparison report I can show my treasury team."*

**Step 1 — Classification + planning.** Parent agent receives the brief. It runs `classify(brief)` which returns:

```json
{
  "decomposability": "composite",
  "stakes": "medium",
  "confidence": 0.87,
  "estimated_total_cost": "0.40 USDC",
  "estimated_duration_ms": 1200000,
  "proposed_plan": [
    { "id": 1, "type": "list-active-yield-products", "executor": "research-agent-a",
      "deadline_offset_s": 600, "est_cost": "0.05 USDC" },
    { "id": 2, "type": "fetch-current-rates-and-tvl", "executor": "research-agent-a",
      "depends_on": [1], "deadline_offset_s": 300, "est_cost": "0.05 USDC" },
    { "id": 3, "type": "evaluate-each-by-risk-return", "executor": "analyst-agent",
      "depends_on": [2], "deadline_offset_s": 900, "est_cost": "0.20 USDC" },
    { "id": 4, "type": "produce-comparative-report", "executor": "writer-agent",
      "depends_on": [3], "deadline_offset_s": 600, "est_cost": "0.10 USDC" }
  ],
  "reasoning": "Composite task requires listing, data fetch, evaluation, and writing — four distinct skills. Medium stakes because output informs financial decision but is advisory, not transactional."
}
```

**Step 2 — Plan surfacing.** UI presents the four sub-tasks as cards: title, executor (resolved via AgentRegistry / ERC-8004), estimated cost, dependencies visualized as edges. Total cost prominent. Buttons: **Approve all** · **Edit plan** · **Cancel**.

**Step 3 — User decision.** The user reviews. Suppose they edit: add a fifth sub-task — "check audit status of each protocol" — between #2 and #3, using a specialist `audit-agent`. They approve the revised plan.

**Step 4 — On-chain manifestation.** Parent agent now creates five `TaskEscrow` records (or five `ERC-8183` Jobs if running on Arc) — one per sub-task. Each escrow holds the budgeted USDC. Each carries a `parent_id` metadata field linking back to the plan.

**Step 5 — Execution unfolds.** Sub-task #1 executor (research-agent-a) sees `TaskCreated` event with its address as executor, calls `acceptTask`, does the work, submits result URI, calls `completeTask`. UI shows the deliverable. User (or auto-approve policy) reviews and calls `approvePayment`. USDC settles. Sub-task #2 unblocks because #1 is now Paid.

**Step 6 — Branching events.** Suppose sub-task #3's audit check finds one of the listed protocols has no recent audit. Parent agent decides this is material: adds a new sub-task — "find the most recent informal security review available" — using `audit-agent` again. This goes through the same approval gate. User approves. New TaskEscrow created. Execution continues.

**Step 7 — Final delivery.** Sub-task #5 (writer-agent) produces the report. User reviews, approves payment. The complete graph now exists: five on-chain TaskEscrows, all in Paid state, with verifiable result URIs, deadlines met, and a parent-id metadata thread connecting them.

**Step 8 — Reusable artifact.** Next month, the user wants a similar report for a different ecosystem. They reference the plan from last month. Parent agent uses it as a template, adjusts parameters, runs again. The structured plan is now a reusable asset.

## 6. The trigger: two-axis classification

Not every task warrants this full ceremony. A short translation does not need a plan card. A simple summary does not need per-step approval gates.

The trigger that determines presentation lives on two axes:

**Axis 1 — Decomposability:**
- `one-shot` — the task is atomic. One executor, one deliverable, one payment.
- `composite` — the task naturally splits into N > 1 sub-tasks.

**Axis 2 — Stakes:**
- `low` — small cost, reversible outcome, well-known task type.
- `high` — significant cost, irreversible outcome, unfamiliar pattern, or regulated context.

The four quadrants yield four UX modes:

| | **Low stakes** | **High stakes** |
|---|---|---|
| **One-shot** | Auto-execute. Single proceed-button. | Show plan with 1 step. Approve to proceed. |
| **Composite** | Show plan. Default "approve all." | Show plan with per-step gates enabled. |

The trigger is **not binary on/off** for decomposition. Decomposition always happens — but its presentation, gating, and approval mode adapt to stakes and complexity.

A standalone document, `classification-trigger-design.md`, will detail how the classifier itself is constructed: which signals the LLM uses (verbs, scope quantifiers, cost estimates, reversibility indicators), how confidence is reported, and how user preference overrides defaults.

## 7. What Sage primitives already provide

The pattern requires no new contract.

- **Atomic settlement** — Sage's `TaskEscrow` (on Base) and the ERC-8183 Job standard (on Arc) both treat each sub-task as a self-contained settlement object with its own lifecycle.
- **Verification checkpoints** — `approvePayment` is the natural per-sub-task gate. `disputeTask` halts the dependency chain and triggers replan.
- **Permissionless refund** — sub-tasks that miss their deadline can be refunded by anyone, ensuring the parent task never deadlocks on an absent executor.
- **Grace-period auto-release** — protects executors from silent clients; sub-tasks resolve even when the human in the loop is asleep.
- **Event emission** — every state transition is an indexable event, sufficient to reconstruct the entire decomposition graph from chain state alone.

The contribution of this work is **patterns + tooling** built on these primitives:

- A parent-id metadata convention in `specUri` (no contract change required).
- An SDK helper, `client.tasks.createSubTask({ parent, ... })`, that wraps `createTask` with the linkage.
- An off-chain indexer service that listens for `TaskCreated` events and reconstructs the parent-child graph for UI consumption.
- A UI component (graph view) that replaces our current linear step-tracker.
- A reference parent-agent implementation in `apps/demo-agents/` that demonstrates the full flow.

None of this requires modifying our deployed contracts on Base, nor working against any specification on Arc.

## 8. Multi-chain unification

A subtle but important property: the pattern is **chain-agnostic**.

On Base, sub-tasks become `TaskEscrow` records via `@sage/adapter-evm`. On Arc, they become `ERC-8183` Jobs via `@sage/adapter-arc`. The SDK presents a uniform `client.tasks.createSubTask()` API. The parent agent's logic, the user-facing plan UI, the graph reconstruction — all are identical across chains.

The user picks the chain when starting a session. The same brief, the same plan, the same flow, the same verifiable artifacts. The chain is a deployment detail; the pattern is universal.

This is what we mean by "Sage is a multi-chain provider of settlement infrastructure": one consistent way to declare, verify, and audit composite agent work, with the choice of underlying chain left to the user.

## 9. UI thinking

We do not show pixel-perfect mockups here. A few key surfaces:

**Chat surface.** A simple text input where the user states the brief. Indistinguishable from any other chat UI on first impression — the work happens after submit.

**Plan card.** After the parent agent classifies, a card appears. It lists sub-tasks as labeled rows: type, assigned executor (with hover-revealed identity from registry), estimated cost, dependency arrows where they exist. Total cost is prominent. Three buttons: approve / edit / cancel.

**Plan editor.** When the user clicks edit, the card becomes interactive. Drag to reorder, click to remove, add via "+" button, select alternative executor from registry. Cost updates live.

**Graph view (during execution).** Linear step-trackers are insufficient when the graph branches. We move to a node-and-edge visualization: each sub-task is a node, with color reflecting its current status (waiting, accepted, completed, paid, disputed). Edges show dependencies. New nodes appear when the parent agent extends the plan mid-execution — they animate in, with the approval gate inline.

**Result drawer.** Per sub-task, a slide-out panel shows the deliverable, the on-chain tx hash with explorer link, the executor's address, the elapsed time, and (where applicable) the approve / dispute buttons.

The aesthetic remains consistent with the current Sage frontend: dark canvas, purple primary, monospaced for code and addresses. The new dimension is the graph layer, which we will likely build with `react-flow` or `dagre`.

## 10. Where this matters most (and where it doesn't)

We are not arguing this pattern dominates every agent invocation. There are zones where it earns its complexity and zones where it is overkill.

**Where observable decomposition earns its complexity:**

- **Financial agent actions** — irreversibility makes per-step verification valuable.
- **B2B agent-to-agent transactions** — counterparties unknown to each other need a shared, externally verifiable record.
- **Regulated industries** — medical, legal, fintech: audit trails are not optional, and the plan-as-artifact is half of an audit trail by default.
- **Novel task types** — when decomposition itself is uncertain, surfacing it for review catches errors that hidden reasoning would not.
- **Long-running workflows** — when execution spans hours or days, periodic checkpoints prevent silent drift.

**Where observable decomposition is overkill:**

- **Single-shot translations, summaries, classifications** — the task is atomic and well-understood.
- **Internal automation in trusted environments** — when humans are not in the loop and outcomes are bounded.
- **Bulk operations with known templates** — same plan repeated thousands of times; the plan is a template, not a per-run artifact.

The trigger we describe handles this automatically: low-stakes one-shot tasks bypass the plan-card UI entirely. Users do not pay the cognitive cost of approval for tasks that did not need it.

**One more thing about the friction.** Plan-approval feels heavy only in comparison to "just answer me already." But that is the wrong comparison. The relevant comparison is the user's actual alternative when they want a multi-step, verifiable, audit-able piece of work: assembling their own agent infrastructure — scaffolding, skill libraries, MCP servers, RAG pipelines, prompt engineering, monitoring. Compared to that, reading a plan card and clicking approve is the cheap option. Plan-approval is the price of *delegating without losing visibility*. Most users would pay much more in time and cognitive load to get equivalent control through other means.

## 11. Open questions

This document is a draft. The following were the original unresolved questions; annotations record what changed after the M10 build landed on `sage-protocol.pages.dev/demo/composite` in May 2026.

- **Classifier accuracy.** How do we validate that the parent agent's classification (one-shot vs. composite, stakes assessment) is correct? Is there a feedback loop — does the system learn from cases where the user overrode the classifier's recommendation?
  - *Status after M10: **deepened**.* We did not build the feedback loop. We did observe one consistent miscalibration: the LLM systematically over-flags `stakes: "high"` for reversible research/planning briefs whose subject domain is financial ("research stablecoin yields", "plan a Tokyo trip") even when no irreversibility verbs or dollar values appear. The deterministic heuristic cross-check (`heuristic.ts`) catches the easy decomposability cases (research + "top N" → halve confidence) but has no equivalent de-escalation rule for stakes. Calibration mechanism — track plan-card edits in PostHog (M10.4.5), build an override-rate report after ~200 runs, then refine the system prompt. Same shape as we sketched in `classification-trigger-design.md` §9 "override-driven empirical calibration", just unbuilt.
- **Mid-execution replan.** When the parent agent decides a new sub-task is needed, how do we present that without becoming nagging? Is there a "trust budget" — after N successful auto-approvals, the user implicitly trusts further dynamic additions up to a cost cap?
  - *Status after M10: **unchanged**.* The v1 runner has no replan path — it executes the topologically-sorted plan as approved and stops. Disputed sub-tasks throw `plan_failed`; the user starts over with a refined brief. The "trust budget" pattern is M10.4 territory and depends on having dispute resolution wired through the UI first (M10.4.1–M10.4.3).
- **Plan storage.** Plans are off-chain artifacts. Where do they live for durability and reproducibility? Encrypted in a registry? In the user's wallet metadata? Pinned to IPFS? Each option has trade-offs around availability, censorship-resistance, and cost.
  - *Status after M10: **resolved for v1, open for v2**.* The plan lives in three places: (a) server memory during execution (`runtimes` map in `plan-runner.ts`), (b) as `data:application/json,{parent,spec}` envelopes inside each sub-task's on-chain `specUri` (one per `TaskCreated` event), (c) implicitly in the user's browser via SSE replay. (b) is the most durable — anyone can scan `TaskCreated` and reconstruct the graph via `decodeParentId`. We deliberately did NOT build the off-chain indexer-stub mentioned in PARENT-PLAN.md; the in-memory runtime suffices for the single active run. For multi-run history and "show me my past plans" UX, this question becomes real.
- **Composition with ERC-8183 Hooks.** ERC-8183 supports pre/post hooks on its Jobs. Should our parent-id linkage be expressed via a hook (more native to the standard) or via specUri metadata (simpler, but not standard-aware)?
  - *Status after M10: **unchanged**.* We're on Base mainnet TaskEscrow, not on Arc/ERC-8183. The specUri-metadata path was the only option here. The hook-based variant becomes relevant when `@sage/adapter-arc` lands (Phase B).
- **Recurring and scheduled tasks.** "Run this analysis every Monday morning" is a different shape — neither one-shot nor composite-with-deadline. Where does this fit, and does it require a new primitive?
  - *Status after M10: **unchanged**.* `classification-trigger-design.md` §7 flags this; no implementation. The current trigger emits a `recurring: true` flag schema slot we never populated. Calendar-driven flows are a distinct enough pattern that they probably want a separate UI (subscription view, not plan-card), so this is its own thread.
- **Agent identity & reputation.** ERC-8004 provides agent identity. How does reputation accrue across composite tasks — to the parent agent for good planning, to the sub-task executors for good execution, both? What is double-counted, what is fair?
  - *Status after M10: **unchanged**.* No ERC-8004 integration. Workers are addressed by plain EOAs; the in-memory `resolveExecutorByType` map is the executor catalogue. Reputation accrual is naturally split between *planner* (was the decomposition reasonable?) and *executor* (was the result good?), but we have neither persistence nor signal to back this up.
- **Privacy.** Plans surface intent. For some tasks, exposing the plan publicly on-chain is unacceptable. Where does privacy enter — encrypted plans, off-chain plans with on-chain commitments, opt-in disclosure?
  - *Status after M10: **unchanged**.* Every sub-task's specUri envelope is unencrypted on Base mainnet — readable by anyone scanning `TaskCreated`. Fine for the demo briefs (research questions, trip planning). Real privacy work probably involves either encrypted specUri (with a key in the parent's metadata) or off-chain plans with an on-chain commitment hash. Not blocking for now.

### Surfaced during implementation (new open questions)

The build raised a few questions the design draft did not anticipate:

- **Where does the type → executor mapping live?** The classifier emits a capability tag (`translate-text`, `research`, `comparison`). Something has to resolve that to a concrete executor address. We chose client-side stem matching in `use-composite-demo.ts:resolveExecutorByType` — pragmatic, easy to extend, but it couples UI knowledge to backend infrastructure. Server-side resolution would be cleaner but couples to a worker registry. With multi-chain executor catalogues this becomes a real architectural choice.
- **Worker prompt protocol.** Each worker has an ad-hoc system prompt locked at deploy time. The composite flow needs workers that switch behavior based on input shape (content vs. instruction). Our M10.W3 fix bolted dual-mode logic into the summarizer. A worker manifest standard — exposing input/output schemas, prompt strategies, supported task types — would let the parent classifier resolve types against advertised capabilities rather than relying on stem heuristics.
- **Stem matching as a fallback strategy.** The frontend's stem-based type resolver works because there are only 4 executor capabilities. With 40, this approach falls over. Long term: classifier should emit types from a published catalogue, server should validate against the catalogue, no client-side guesswork. Stem matching is fine for prototype; not the production shape.
- **Result aggregation.** The per-sub-task drawer is good for verification ("show me what executor #3 produced") but doesn't synthesize the final deliverable. For a 5-step research plan, the user has to open 5 drawers and assemble the report mentally. Should the parent agent compose sub-task results into a final artifact and surface *that* as the deliverable? If yes, who pays for the composition — is it another sub-task, or free-and-included?
- **Cost calibration via post-run data.** The LLM's `estimated_cost_units` is a guess. We have ground truth in `TaskPaid` events — actual settled cost per type. After N runs we could feed back into the system prompt: "summarize-text tasks have historically cost ~80k base units; translate-text ~110k". Not built; obvious follow-up.
- **Sequential-only execution.** `plan-runner.ts` runs sub-tasks one at a time to avoid sponsor-side nonce races. Independent sub-tasks could run in parallel for 3-5× speedup on wide DAGs. The tx queue logic is doable; we chose to defer until execution time is the actual UX bottleneck.

These were not foreseen in the original design. They appeared as soon as we ran real briefs through real workers. The pattern is consistent — the trigger-and-plan architecture works, but every concrete instantiation surfaces a new question about how capabilities, workers, and economics connect.

We do not need to answer all of these before building further. Some will become clear by trying things. Others may resolve themselves once we see how users actually use the system.

## 12. Closing

We do not propose this pattern as the single correct way to build agent systems. We propose it as **a way that prioritizes legibility** — the property that decomposition produces artifacts which outlive the run, can be reviewed, replayed, and built upon.

That choice has trade-offs. It adds latency to simple tasks (mitigated by the trigger). It requires the LLM to produce structured output (mitigated by modern function-calling). It places a small cognitive load on the user for plan approval (mitigated by stakes-based defaults). In return, it produces a different kind of agent work — one that accumulates, that can be audited, that can be trusted by counterparties who were not party to its execution.

Sage's existing primitives — atomic task escrow, permissionless refund, grace-period auto-release, per-step approval, event-based observability — compose into this pattern without new contracts. What remains is to build the patterns and tools that surface the decomposition: a parent-agent template, a plan-aware SDK helper, an indexer that reconstructs the graph, and a UI that renders it.

That work is what comes next.

---

*This document is a thinking artifact. It is open for revision as we build and learn.*
