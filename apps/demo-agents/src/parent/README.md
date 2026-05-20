# `parent/` — observable-decomposition runtime

This directory implements the parent-agent flow from
[ADR-0007](../../../../docs/adr/0007-observable-decomposition.md):
a brief is classified into a structured `Plan`, the user approves (and
optionally edits) the plan card, and each approved sub-task becomes a real
on-chain `TaskEscrow` record carrying a `parent_id` link back to the run.

**Live on prod:** `https://sage-protocol.pages.dev/demo/composite` →
`https://sage-demo-agents.fly.dev/api/demo/composite/*` → Base mainnet.

This module is a thin coordinator. Most of the work happens in:
- [`@sage/core`](../../../../packages/core/src/types/plan.ts) — shared
  types (`Plan`, `SubTask`, `ClassificationResult`, `Decomposability`, `Stakes`)
- [`@sage/adapter-evm`](../../../../packages/adapter-evm/src/task-escrow.ts)
  — `createTask` / `getTask` / `approvePayment` over viem

## Files

| File | What it does |
|------|-------------|
| `classify.ts` | LLM-backed brief classifier (gpt-4o-mini, function-calling). Falls back to a 5-template mock when `openaiApiKey` is absent. Retries once on malformed responses; returns a degraded `confidence_*=0` result on second failure. Emits 5 structured trace events per pass. |
| `heuristic.ts` | Deterministic cross-check that halves `confidence_*` when the brief contains ≥ 2 composite cues or any stakes cues. Pure function. |
| `parent-id-codec.ts` | `encodeParentId({run, sub}, spec)` → `data:application/json,...` URI carrying both the parent_id and the executor-facing spec text. `decodeParentId(specUri)` extracts the pair; returns `null` for non-envelope URIs. |
| `plan-runner.ts` | `runPlan(plan, channel, bundle, {runId})` — executes the plan one sub-task at a time in topological order, polling `getTask` every 10s, emitting lifecycle events into the SSE channel. On dispute it pauses via `run-registry` and awaits a user decision instead of failing the plan. |
| `run-registry.ts` | In-memory pause/resume coordination keyed by `runId`. `awaitUserDecision(runId, subId, timeoutMs)` blocks the runner; `resolveUserDecision(runId, subId, action)` resolves it. Default pause timeout 2 min; on expiry the runner emits `plan_failed` with `reason: 'pause_timeout'`. |
| `agent.ts` | Two entry points: `executePlan(plan, bundle)` (pre-approved Plan) and `classifyAndExecute(brief, bundle, env)` (autonomous one-shot). Both register progress channels with `demoRegistry`. |
| `index.ts` | Barrel re-exporting the public surface. |

## Frontend counterpart

Lives in `apps/web/`, parallel to (not modifying) the existing 3-mode `/demo`.

| File | What it does |
|------|-------------|
| `app/demo/composite/page.tsx` | Page orchestrator. Local UI state: `editing` (toggles between plan-card and plan-editor), `selectedSubId` (drives the drawer). |
| `hooks/use-composite-demo.ts` | State machine `idle → classifying → plan-ready → executing → completed \| error`. SSE consumption. `planFromClassification` derives an approved Plan from a `ClassificationResult` and **auto-resolves `executor_address`** by mapping `type` against capability stems (`translat` → translator, `summari/compar/research/analy/write` → summarizer, `sentiment/classif/emotion` → sentiment, `vision/image/describ` → vision). |
| `components/demo/plan-card.tsx` | Read-only review with decomposability/stakes badges, confidence pills (tinted when below 0.7), per-subtask rows, three actions (Approve / Edit / Cancel). |
| `components/demo/plan-editor.tsx` | Toggle from plan-card. `↑↓` reorder (no drag dep — by design), executor dropdown reading `NEXT_PUBLIC_DEMO_*_ADDRESS` env vars, add/remove. Live total cost. |
| `components/demo/plan-graph.tsx` | DAG via `@xyflow/react`. Layout by topological depth. Nodes colored per runtime status (`waiting` slate, `created` purple, `accepted` cyan, `completed` pink, `paid` mint, `errored`/`disputed` red). Click handling at `ReactFlow.onNodeClick` level. |
| `components/demo/subtask-drawer.tsx` | Slide-out right-side drawer per node. Shows status / spec / executor (Basescan-linked) / on-chain Task ID / timing / cost / result / tx hashes. |

## How to add a new sub-task type

1. Pick a kebab-case `type` string for it (e.g. `"sentiment-text"`).
2. Update the classifier so it can produce sub-tasks with this type:
   - **Mock path:** add a `MockTemplate` entry to `TEMPLATES` in
     `classify.ts` whose `build()` produces a `proposed_plan` containing
     the new type, and a `matches()` predicate for the trigger keywords.
   - **LLM path:** the system prompt does not enumerate types — the LLM
     can emit any string. Add the type description to the prompt only if
     it needs special instructions.
3. Add a stem to `resolveExecutorByType` in `apps/web/hooks/use-composite-demo.ts`
   so the frontend auto-assigns this type to an existing worker, OR add a
   dedicated worker (see step 4).
4. **Optionally** stand up a dedicated worker under
   `apps/demo-agents/src/<capability>/agent.ts` mirroring `summarizer/agent.ts`
   pattern, with its own Fly process + private key. Cleaner than reusing
   an existing worker for a new capability, but adds operational surface.

## `parent_id` convention

Every sub-task's `specUri` is a `data:application/json,` data URI with the shape:

```json
{
  "parent": { "run": "<runId>", "sub": <subTaskId> },
  "spec":   "<executor instructions>"
}
```

- `run` is the plan-run UUID, minted by `executePlan()`.
- `sub` is the 1-indexed ordinal within the plan (matches `SubTask.id`).
- Both are positive integers / non-empty strings.

Off-chain indexers can rebuild the parent → sub-task graph by scanning
`TaskCreated` events and calling `decodeParentId(specUri)` on each. Events
whose specUri is not a properly-formed envelope are treated as standalone
non-composite tasks. (We don't currently run an indexer — the in-memory
runtime tracks the graph for the active SSE channel.)

## Worker dual-mode contract

All four demo workers (`summarizer` / `translator` / `vision` /
`sentiment`) operate in two modes depending on the shape of `specUri`:

- **3-mode `/demo` path** — `specUri = CONTENT` (an article, an image URL).
  The worker treats the spec as the thing to act on directly: summarize the
  article, translate the text, describe the image URL, classify the
  sentiment of the text.

- **Composite `/demo/composite` path** — `specUri = ENVELOPE` carrying an
  INSTRUCTION (`data:application/json,{parent,spec}`). The worker decodes
  the envelope via the shared helper in
  [`src/shared/composite-codec.ts`](../shared/composite-codec.ts), extracts
  the inner `spec` string, and switches its system prompt to
  execution-style — "execute this instruction and return the result
  directly", not "summarize the instruction back".

The same decoder powers all four workers (DRY since M10.5.B, 2026-05-21).
Each worker keeps its capability-specific composite prompt:

| Worker | 3-mode behavior | Composite behavior |
|--------|-----------------|--------------------|
| `summarizer` | Summarize the raw text. | Generalist task executor: produce the deliverable (research, comparison, report, draft). 100-250 words target. |
| `translator` | Translate raw text EN↔RU. | Translation executor: extract source text from the instruction, produce only the translation. Honest failure when no source text is present. |
| `sentiment` | Classify raw text as POSITIVE / NEGATIVE / NEUTRAL with score + rationale. | Same 3-line output format applied to whatever text the instruction targets. Honest failure when no text is referenced. |
| `vision` | Describe a raw image URL. | Regex-extract an `http(s)://...png/jpg/...` URL from the instruction and describe it. Honest failure when no URL is embedded. |

The "honest failure" paths matter: when a composite sub-task gives a
worker insufficient input, the worker returns a structured "spec did not
include X" message rather than fabricating output. The operator then sees
the gap on the per-node drawer and can fix the plan via edit + retry.

Adding a new worker that should support both modes: follow
`summarizer/agent.ts` as the canonical pattern (import
`decodeCompositeSpec` from `../shared/composite-codec.js`, define
`RAW_SYSTEM_PROMPT` + `COMPOSITE_SYSTEM_PROMPT`, dispatch via
`if (compositeSpec !== null) { ... }`).

## Lifecycle events emitted on the SSE channel

`runPlan` emits the following events into the registered `SseChannel`. Each
event payload is JSON.

| Event | Payload | When |
|-------|---------|------|
| `plan_started` | `{runId, plan_summary, order, startedAt}` | First thing after validation. `order` is the topological order. |
| `subtask_status` | `{subId, status}` | Every status transition. Flat firehose-style event for graph rendering. |
| `subtask_created` | `{subId, taskId, executor, amount, deadline}` | `createTask` returned. |
| `subtask_accepted` | `{subId, taskId}` | First poll where status === Accepted. |
| `subtask_completed` | `{subId, taskId, resultUri}` | First poll where status === Completed. |
| `subtask_paid` | `{subId, taskId, txHash}` | After `approvePayment` tx submitted. |
| `subtask_errored` | `{subId, error}` | Any non-dispute lifecycle exception. Followed by `plan_failed`. |
| `subtask_disputed` | `{subId, taskId, resultUri}` | Sub-task transitioned to `Disputed` on chain. Runner pauses for user decision (M10.5.A). |
| `subtask_retrying` | `{subId, attempt, executor}` | User picked Retry; runner re-spawns the sub-task. `attempt` is 1-indexed (2 means first retry). |
| `plan_completed` | `{runId, durationMs}` | All sub-tasks reached `paid`. |
| `plan_failed` | `{runId, failedSubId, error, reason?}` | Plan aborted. `reason` is `'pause_timeout'` (user didn't respond to dispute) or `'user_cancelled_after_dispute'`; absent for generic lifecycle failures. |
| `done` | `{runId, ok, ...}` | Emitted by `SseChannel.close()`. Final event in the stream. |

## Endpoints

```
POST /api/demo/composite/classify
  body: { "brief": "<text>" }
  → 200 { classification: ClassificationResult }   // bigints serialized as strings

POST /api/demo/composite/execute
  body: Plan (with cost fields as decimal strings, executor_address required per sub-task)
  → 202 { runId, streamUrl, chainId, chainName, explorerUrl }
  → 400 { error: "<validation>" }
  → 503 { error: "sponsor_exhausted", ... }

GET  /api/demo/composite/stream/:runId
  → text/event-stream of the lifecycle events above
  → 404 { error } when runId is unknown / expired

POST /api/demo/composite/retry-subtask          (M10.5.A)
  body: { runId, subId, action?: "retry"|"cancel", newExecutorAddress?: 0x... }
  → 202 { ok: true, action }                    // pause resolved, runner continues
  → 400 { error }                               // validation
  → 404 { error: "no_paused_run" }              // no pending decision for runId
  → 409 { error: "sub_mismatch" }               // pending decision is for a different subId
  → 503 { error: "sponsor_exhausted", ... }     // retry would re-spawn; sponsor check failed
```

Existing `/api/demo/start` + `/api/demo/stream/:id` are unchanged; the
3-mode demo (pipeline/sentiment/vision) is untouched by this work.

## Local smoke (mock classifier — safe, no money)

Skip the LLM call by NOT setting `OPENAI_API_KEY`. The classifier falls back
to the 5 mock templates (`translate this`, `summarize this`, `research X and
write Y`, `plan a Tokyo trip`, `send $X USDC`). The frontend auto-assigns
executor addresses; from curl you have to set them manually.

```bash
# In one terminal, start the orchestrator
cd apps/demo-agents
pnpm dev:orchestrator   # reads .env.orchestrator

# In another terminal, classify a brief
curl -s -X POST http://localhost:3000/api/demo/composite/classify \
  -H 'Content-Type: application/json' \
  -d '{"brief":"translate this paragraph"}' | python3 -m json.tool

# Execute a hand-crafted Plan (executor_address required for each sub-task)
curl -s -X POST http://localhost:3000/api/demo/composite/execute \
  -H 'Content-Type: application/json' \
  -d '{
    "brief": "demo",
    "decomposability": "one-shot",
    "stakes": "low",
    "subtasks": [{
      "id": 1,
      "type": "translate-text",
      "executor_address": "0xa61bd5efa704805B08970C34Cd639fA5D6Ce1c8c",
      "estimated_cost_units": "100000",
      "deadline_offset_s": 600,
      "spec": "translate me"
    }],
    "estimated_total_cost_units": "100000",
    "estimated_duration_ms": 8000
  }' | python3 -m json.tool

# Tail the stream
curl -N http://localhost:3000/api/demo/composite/stream/<runId>
```

## Production smoke (uses real USDC)

The live URL is `https://sage-protocol.pages.dev/demo/composite`. Each
sub-task spends `estimated_cost_units` USDC from the sponsor wallet
(locked in escrow, paid to executor on completion). A 3-step composite at
~100k units each is ~0.3 USDC. Sponsor balance visible via
`https://sage-demo-agents.fly.dev/health`.

Brief patterns that exercise the full graph:

| Brief | Shape |
|-------|-------|
| `translate this paragraph` | one-shot → 1 sub-task |
| `summarize this article` | one-shot → 1 sub-task |
| `research the top 3 stablecoin yield products on Base and write a comparative report` | composite → 2-3 sub-tasks, sequential `research → write` |
| `plan a Tokyo trip` | composite → 3-4 sub-tasks, sequential |
| `research the top 5 stablecoin protocols on Base, summarize each, translate the summary to Russian, write a comparative report, and identify the safest one` | composite → 5+ sub-tasks |

## Manual dispute-path smoke (M10.5.A)

Disputes are hard to trigger naturally — the depositor (sponsor) would have to call
`disputeTask` on a sub-task between Completed and the orchestrator's
`approvePayment`, which is a narrow window in normal flow. To exercise the
pause-on-dispute path end-to-end against a deployed backend:

1. Start a composite run via `/demo/composite` (UI) or curl the
   `/composite/execute` endpoint with a known plan.
2. While polling sub-task #N (status `accepted`), run a script from the
   sponsor wallet that calls `TaskEscrow.disputeTask(taskId)` for that
   sub-task — needs sponsor signing capability. (Sponsor address visible at
   `/health`; current sponsor only signs in the orchestrator process, so
   this requires either temporarily exporting the key for the test or
   wiring a dev-only `/debug/dispute-subtask` endpoint. The latter is the
   right move if disputes need to be smoked regularly.)
3. Verify the SSE stream emits `subtask_disputed` and that
   `GET /health` reports the run as paused (would require surfacing
   `hasPendingDecision` in `/health` — currently it's not exposed).
4. POST to `/api/demo/composite/retry-subtask` with the runId+subId.
5. Verify `subtask_retrying` event lands and the sub-task resumes.

Unit tests in `test/parent/plan-runner.dispute.test.ts` cover the pause →
retry / cancel / timeout / change-executor matrix without needing a real
chain.

## Debugging

- **Where do trace events go?** `classify.ts` emits JSON-line events via
  `console.error`. On Fly, these appear in `fly logs -a sage-demo-agents`.
  Filter with `grep parent.classify` if it gets noisy.
- **Why is a sub-task stuck on `created`?** The executor for that
  `executor_address` either isn't running or isn't watching `TaskCreated`
  for that chain. Check the appropriate worker process via
  `fly logs -a sage-demo-agents | grep '\[<Worker>\]'`.
- **Why does a vision sub-task return "Vision sub-task requires an image URL in the spec"?**
  The composite spec didn't contain an `http(s)://...png/jpg/...` URL the
  vision worker could regex-extract. This is the M10.5.B honest-failure
  path — the worker explicitly refuses to fabricate a description when
  the input is insufficient. Fix the plan to embed an image URL in the
  spec via plan-editor + Retry, or route the sub-task to a different
  capability via Change-executor.
- **Why does translator/sentiment return "X requires Y in the spec"?**
  Similar — the composite spec didn't include the source content (translator)
  or text to classify (sentiment). Honest-failure pattern from M10.5.B.
  Same fix: edit the plan to embed the input, or change executor.
- **Where is the runId logged?** `executePlan` returns it; `plan_started`
  + `plan_completed` + `done` events on the SSE channel carry it.
- **Frontend says "Executor: unassigned"?** Means the sub-task `type` didn't
  match any stem in `resolveExecutorByType` and no `executor_address` was
  provided. Two fixes: (a) add a stem for the type in
  `use-composite-demo.ts`, (b) open the plan-editor and pick an executor
  manually.

## Out-of-scope vs deferred

| Concern | Status | Where it goes |
|---------|--------|---------------|
| Dual-mode prompt for `translator` / `sentiment` / `vision` | Shipped 2026-05-21 (M10.5.B) | All 4 workers composite-aware via shared `src/shared/composite-codec.ts` decoder. Vision uses regex URL-extract; sentiment + translator emit honest-failure messages when spec lacks the needed input. |
| Dedicated composite-aware workers per capability | Deferred | Phase B / future milestone, replaces dual-mode hacks |
| Per-sub-task user-approval gate (instead of auto-approve) | Deferred | M10.4 + new "user_approval_required" endpoint |
| Dispute path UI (`subtask_disputed` SSE handling + replan prompt) | Shipped 2026-05-20 (M10.4.1–M10.4.3) + 2026-05-21 (M10.5.A) | Backend `subtask_disputed` emit, frontend `disputedSubId` capture, `ReplanPrompt` with Retry / Change-executor / Cancel, `/composite/retry-subtask` endpoint, pause-on-dispute in plan-runner, 2-min pause timeout. |
| Aggregate result panel (vs per-node drawer) | Deferred | UX polish — drawer is sufficient for v1 |
| Parallel execution of independent sub-tasks | Deferred | Performance work, future. Sequential is safe and cheap to reason about. |
| ERC-8004 / AgentRegistry integration for executor discovery | Out of scope | Phase B (Arc / multi-chain milestone) |
| Drag-and-drop reorder in plan-editor (currently ↑↓ buttons) | Deferred | UX polish — see `IDEAS.md` |
| Heuristic stem-aware keyword match (`compare`/`comparative`/`comparison`) | Deferred | UX polish — see `IDEAS.md` |
