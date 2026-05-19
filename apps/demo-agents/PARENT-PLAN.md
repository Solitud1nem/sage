# Parent Agent — Observable Decomposition Prototype

**Status:** Approved 2026-05-19. Drives Milestone 10 in `TASKS.md`.
**Scope:** Implement the plan-then-execute pattern from ADR-0007 as a working prototype on Base mainnet.
**Related:**
- [ADR-0007](../../docs/adr/0007-observable-decomposition.md) — accepted decision
- [`docs/research/observable-decomposition.md`](../../docs/research/observable-decomposition.md) — full reasoning
- [`docs/research/classification-trigger-design.md`](../../docs/research/classification-trigger-design.md) — trigger mechanics
- [`CLAUDE.md`](../../CLAUDE.md) "Project ethos" — positioning context

---

## Goal

Build a working prototype where:

1. User submits a brief on `sage-protocol.pages.dev/demo/composite` (or local equivalent).
2. A **parent agent** classifies the brief and produces a structured plan.
3. The plan is surfaced to the user with approve / edit / cancel.
4. On approval, each sub-task becomes a real on-chain `TaskEscrow` record on Base mainnet with `parent_id` metadata linking back to the plan.
5. Sub-tasks execute according to dependencies. Each completion is verified before downstream sub-tasks unblock.
6. The user sees a live graph of sub-task progression, can review each result, approve / dispute per step.

This proves the **observable decomposition** angle exists in code, not just in documents.

## Scope

**In scope:**

- A new `parent-agent` service in `apps/demo-agents/src/parent/`.
- A classification trigger using OpenAI gpt-4o-mini with structured outputs (function calling).
- A heuristic cross-check layer (deterministic keyword scanner) for confidence adjustment.
- New types in `@sage/core` for `Plan`, `SubTask`, `ClassificationResult`.
- Two new orchestrator endpoints: `POST /api/demo/composite/classify` and `POST /api/demo/composite/execute`.
- A new page `apps/web/app/demo/composite/page.tsx` with plan-card, plan-editor, graph-view, and per-subtask drawer components.
- An off-chain indexer-stub that reconstructs parent-child graphs from `TaskCreated` events using `parent_id` metadata.

**Out of scope:**

- Modifying existing `/demo` (pipeline / sentiment / vision) — continues unchanged.
- Modifying existing 4 worker agents (summarizer / translator / vision / sentiment).
- Modifying `TaskEscrow` or `AgentRegistry` contracts. No new salt, no redeploy.
- Try-with-wallet integration in the new flow (currently hidden UI-wise; revisit later).
- Arc integration (Phase B, follows this milestone).
- Custom `sage.xyz` domain wiring (M9.6, parallel concern).

## Architecture overview

```
apps/demo-agents/src/
├── orchestrator/           ← existing, unchanged
│   ├── server.ts            ← we add two endpoints to this file only
│   ├── demo-run.ts          ← existing 3-mode dispatcher, untouched
│   └── guards.ts            ← sponsor balance check, reused
├── summarizer/             ← existing worker, unchanged
├── translator/             ← existing worker, unchanged
├── vision/                 ← existing worker, unchanged
├── sentiment/              ← existing worker, unchanged
├── shared/                 ← existing, may add new helpers
└── parent/                 ← NEW directory
    ├── agent.ts             ← parent-agent runtime (executes approved plans)
    ├── classify.ts          ← LLM-driven classifier
    ├── heuristic.ts         ← deterministic cross-check
    ├── plan-runner.ts       ← per-subtask spawning + status polling
    ├── parent-id-codec.ts   ← encode/decode parent_id in specUri
    └── index.ts

apps/web/
├── app/demo/
│   ├── page.tsx             ← existing 3-mode demo, unchanged
│   └── composite/           ← NEW
│       └── page.tsx
├── components/demo/
│   ├── (existing components stay)
│   ├── plan-card.tsx        ← NEW
│   ├── plan-editor.tsx      ← NEW
│   ├── plan-graph.tsx       ← NEW (uses @xyflow/react)
│   └── subtask-drawer.tsx   ← NEW
└── hooks/
    ├── (existing hooks stay)
    └── use-composite-demo.ts ← NEW

packages/core/src/types/
├── (existing types stay)
└── plan.ts                  ← NEW: Plan, SubTask, ClassificationResult
```

The principle: **strictly additive**. No file in the existing graph is renamed or restructured. New code lives in new directories and new files.

---

## Week 1 — Backend skeleton + classifier (mock-first)

**Goal:** types defined, classifier interface stable, mock-implementation passes test suite. No LLM call yet.

### Files to create

- `packages/core/src/types/plan.ts`
  - `Plan` interface
  - `SubTask` interface
  - `ClassificationResult` interface
  - JSDoc on each field referencing `classification-trigger-design.md` §4
- `packages/core/src/types/index.ts` — add export
- `packages/core/test/plan.test.ts` — minimal smoke (object shape)
- `apps/demo-agents/src/parent/index.ts` — re-exports
- `apps/demo-agents/src/parent/heuristic.ts`
  - Pure function `applyHeuristicAdjustment(brief: string, classification: ClassificationResult): ClassificationResult`
  - Composite-verb keyword list, scope quantifier list, irreversibility keyword list, dollar-value regex
  - Returns adjusted confidence scores
- `apps/demo-agents/src/parent/classify.ts`
  - `classifyBrief(brief: string, env: ParentEnv): Promise<ClassificationResult>`
  - **Mock implementation** returning hardcoded results for 3-5 well-known test briefs ("translate this paragraph", "research X and write Y", "plan a Tokyo trip")
  - Calls `applyHeuristicAdjustment` post-mock
- `apps/demo-agents/test/parent/classify.test.ts`
- `apps/demo-agents/test/parent/heuristic.test.ts`

### Acceptance

```bash
pnpm --filter @sage/core test          # plan.test.ts passes
pnpm --filter @sage/demo-agents test   # classify + heuristic green
```

### What we learn / decide at Week 1 end

- Are the type definitions actually usable, or do they need a field we forgot?
- Is the heuristic catching the obvious cases we expect?
- Is the schema for `Plan` flexible enough for the parent agent to spawn from it?

---

## Week 2 — LLM-driven classifier + parent agent runtime

**Goal:** real LLM classifies briefs; parent agent spawns sub-task escrows on Base mainnet.

### Files to create or modify

- **Replace** mock in `classify.ts` with OpenAI function-calling:
  - System prompt describing both axes, signal list, schema
  - JSON-mode / function-calling enforcement
  - Retry once on malformed; degraded result with `confidence = 0` after second failure
  - Trace logging of LLM response + heuristic adjustments
- `apps/demo-agents/src/parent/parent-id-codec.ts`
  - `encodeParentId({ run, sub }: { run: string; sub: number }): string` returning `data:application/json,...`
  - `decodeParentId(specUri: string): { run: string; sub: number } | null`
- `apps/demo-agents/src/parent/plan-runner.ts`
  - `runPlan(plan: Plan, channel: SseChannel, env: ParentEnv): Promise<void>`
  - For each sub-task: `createTask` via `@sage/adapter-evm` with parent_id metadata, poll status every 10s, emit lifecycle events to channel
  - Respects `depends_on` graph — sub-task only starts when prerequisites are Paid
  - `pollingInterval: 10_000` — explicit, to stay under Cloudflare Worker quota (per GOTCHAS 2026-05-13)
- `apps/demo-agents/src/parent/agent.ts`
  - Wires classify → plan-runner together
- **Modify** `apps/demo-agents/src/orchestrator/server.ts`:
  - Add `POST /api/demo/composite/classify` — calls `classifyBrief`, returns `ClassificationResult`
  - Add `POST /api/demo/composite/execute` — accepts approved `Plan`, creates run id, calls `runPlan` async, returns `{ runId, streamUrl }`
  - Add `GET /api/demo/composite/stream/:runId` — SSE channel (reuse existing `SseRegistry`)
  - Existing endpoints untouched
- `apps/demo-agents/src/parent/README.md` — short doc: how to add a new sub-task type, what the parent_id convention is

### Dependencies introduced

- `openai` npm package in `apps/demo-agents/package.json` — already used by workers, just import in parent

### Fly.io deploy

- Add new process `parent` to `fly.toml`:
  ```toml
  [processes]
    orchestrator = "node dist/orchestrator/server.js"
    summarizer   = "..."
    ...
    parent       = "node dist/parent/agent.js"
  ```
  Wait — actually `parent` runs **inside the orchestrator** (it's not a separate listener, it executes plans on demand). So no new process. Plan-runner is invoked from orchestrator endpoint handlers.
- New env vars on Fly: `OPENAI_API_KEY` is already there; nothing new needed.

### Acceptance

```bash
# Classification works
curl -X POST http://localhost:3000/api/demo/composite/classify \
  -H "Content-Type: application/json" \
  -d '{"brief":"research the top 3 stablecoin yield products on Base"}'
# → returns structured ClassificationResult JSON

# Execution works
curl -X POST http://localhost:3000/api/demo/composite/execute \
  -H "Content-Type: application/json" \
  -d '{ ... approved Plan JSON ... }'
# → returns { runId, streamUrl }

# Stream works
curl -N http://localhost:3000/api/demo/composite/stream/<runId>
# → SSE events as sub-tasks progress
```

### What we learn / decide at Week 2 end

- How often does the LLM classifier disagree with the heuristic? (signal for whether heuristic threshold is right)
- Is the `parent_id` in `specUri` convention readable when reconstructing the graph?
- Are there race conditions in plan execution (nonce gaps, especially)?

---

## Week 3 — Frontend: plan card + graph view + composite demo page

**Goal:** working UI on `/demo/composite` for end-to-end flow.

### Files to create

- `apps/web/hooks/use-composite-demo.ts`
  - States: `idle` → `classifying` → `plan-ready` → `executing` → `completed` / `error`
  - Mirrors `DemoState` shape from existing hooks for consistency
  - SSE consumption identical to `use-demo-stream`
- `apps/web/components/demo/plan-card.tsx`
  - Renders `Plan` as a list of sub-task cards
  - Per card: type, executor short-address with hover-tooltip, est cost, deadline, depends-on indicator
  - Total cost prominently at bottom
  - 3 buttons: Approve · Edit · Cancel
- `apps/web/components/demo/plan-editor.tsx`
  - Toggle from plan-card via Edit
  - Reorder via drag, delete via X, add via +, executor change via dropdown
  - Cost updates live
- `apps/web/components/demo/plan-graph.tsx`
  - Uses `@xyflow/react` (new dep, see below)
  - Nodes represent sub-tasks, colored by status (waiting=gray, accepted=cyan, completed=pink, paid=mint, disputed=red)
  - Edges represent dependencies
  - New nodes animate in if parent extends plan mid-execution
- `apps/web/components/demo/subtask-drawer.tsx`
  - Slide-out per node
  - Shows result-uri content (rendered for text, otherwise link), tx hashes with Basescan links, executor address, elapsed time
  - Approve / Dispute buttons during execution
- `apps/web/app/demo/composite/page.tsx`
  - Composition: brief input → plan-card → plan-graph → result
  - State managed via `useCompositeDemo` hook

### Dependencies introduced

- `@xyflow/react` ~12.x — DAG visualization library. Justification (per AGENTS.md "deps require 1-line justification"): building graph rendering from scratch would be 1000+ LOC duplicating what xyflow already does well; widely used (~10k stars), MIT, ~150KB gzipped.

### Acceptance

- Open `localhost:3000/demo/composite`
- Type brief: "research the top 3 stablecoin yield products on Base and produce a comparative report"
- See plan card with 3-4 sub-tasks, est cost
- Click Approve
- See graph fill in as sub-tasks progress
- Click on a node mid-flight → see drawer with current state
- After completion → all nodes mint, final result drawer accessible

### What we learn / decide at Week 3 end

- Is the plan-card readable, or does it overwhelm the user?
- Does the graph view scale at N=8 sub-tasks (real composite) or does it become messy?
- Where do users actually click first — review the plan or jump to approve?

---

## Week 4 — Polish + dogfood + reflection

**Goal:** error states, observability, blog draft, ADR-0008 promotion.

### Files to create or modify

- **Error handling enhancements:**
  - `plan-runner.ts` — catch `disputeTask` events, surface as new SSE event `subtask_disputed`
  - `use-composite-demo.ts` — handle `subtask_disputed` → present user with options: retry / change executor / cancel run
  - `apps/web/components/demo/replan-prompt.tsx` — new UI surface for mid-execution dispute resolution
  - `classify.ts` — explicit retry-once on OpenAI 5xx, surface degraded confidence on second failure
- **Observability:**
  - PostHog events: `composite_classify_started`, `composite_classify_completed`, `composite_plan_approved`, `composite_plan_edited`, `composite_plan_cancelled`, `composite_subtask_started`, `composite_subtask_completed`, `composite_subtask_disputed`, `composite_run_completed`, `composite_run_errored`
  - Sentry capture for classify failures, plan execution errors (not for `user_cancelled`)
- **Documentation:**
  - Update `apps/demo-agents/src/parent/README.md` — production-ready docs
  - Update `docs/research/observable-decomposition.md` §11 Open questions — annotate which questions are now resolved by implementation, which deepened, which new appeared
  - New `docs/blog/observable-decomposition-shipped.md` — 1500-word reflective blog: what we built, what surprised us, what didn't work, where we still don't know

### ADR promotion

- Create **ADR-0008 — Sage angle / position** in `docs/adr/`
- Status: Accepted (the angle now exists in code, not just docs)
- Captures the formal angle statement (one paragraph), references ADR-0007 + the two research docs + the live demo URL

### Acceptance

- Smoke test: 5 different briefs (one-shot trivial, composite-3, composite-5, ambiguous, high-stakes) all flow through the system
- Dispute path works end-to-end: trigger dispute, see UI prompt, replan, complete
- Sentry shows zero errors during smoke runs
- PostHog dashboard shows the funnel events
- Blog draft reviewed for tone (matches `observable-decomposition.md` voice)

---

## Dependencies on the user during the 4 weeks

These require your explicit approval when we hit them:

1. **Add `openai` + `@xyflow/react` deps.** Per AGENTS.md, new deps need 1-line justification + approval. (Both are pre-approved by this document if you accept the plan.)
2. **Production OpenAI API key on Fly.io** — already present (used by workers); reused for parent. No new secret.
3. **First Fly deploy of the modified orchestrator** with composite endpoints — happens at end of Week 2. Approval to `fly deploy`.
4. **First Cloudflare Pages deploy of `/demo/composite`** — happens at end of Week 3. Approval to push to main (auto-deploy via workflow).
5. **ADR-0008 promotion at Week 4** — confirmation that the angle is correctly captured.

## Open questions to revisit at each weekly checkpoint

- Is the `parent_id` JSON-in-specUri convention robust enough, or do we need a separate field in a future contract version?
- How big do plans grow in practice (3 subtasks? 8? 15?) — affects graph rendering decisions
- Does the user actually edit plans, or just approve / cancel? — affects how much we invest in plan-editor
- Does the classifier need a domain-restriction list (e.g. financial verbs always force high-stakes)?
- Recurring / scheduled tasks (out of v1 scope) — when do we start to feel their absence?

## What success looks like at end of Week 4

- A working `localhost:3000/demo/composite` (and `sage-protocol.pages.dev/demo/composite` if deployed) where a non-technical user can:
  - Type a real composite brief
  - See it become a plan
  - Approve, watch it execute as a graph
  - Get a verified result
- All without touching a wallet (sponsored mode, no Try-with-wallet)
- All without breaking existing `/demo`
- Three new docs in repo: ADR-0008, blog draft, parent README
- 25+ tasks closed in TASKS.md Milestone 10
- Updated CHANGELOG entry

If we hit that, the angle is in code. The next phases (Arc as sibling chain, unification) build on this foundation without re-litigating the angle.

---

*This plan is open for revision week-by-week. Decisions made during implementation override decisions made here in writing. The plan exists to give Claude Code a stable target between sessions, not to lock the future.*
