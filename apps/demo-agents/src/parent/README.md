# `parent/` — observable-decomposition runtime

This directory implements the parent-agent flow from
[ADR-0007](../../../../docs/adr/0007-observable-decomposition.md):
a brief is classified into a structured `Plan`, the user approves (and
optionally edits) the plan card, and each approved sub-task becomes a real
on-chain `TaskEscrow` record carrying a `parent_id` link back to the run.

It's a thin coordinator. Most of the work happens in:
- [`@sage/core`](../../../../packages/core/src/types/plan.ts) — shared
  types (`Plan`, `SubTask`, `ClassificationResult`, `Decomposability`, `Stakes`)
- [`@sage/adapter-evm`](../../../../packages/adapter-evm/src/task-escrow.ts)
  — `createTask` / `getTask` / `approvePayment` over viem

## Files

| File | What it does |
|------|-------------|
| `classify.ts` | LLM-backed brief classifier (gpt-4o-mini, function-calling). Falls back to a 5-template mock when `openaiApiKey` is absent. Retries once on malformed responses; returns a degraded `confidence_*=0` result on second failure. |
| `heuristic.ts` | Deterministic cross-check that halves `confidence_*` when the brief contains ≥ 2 composite cues or any stakes cues. Pure function. |
| `parent-id-codec.ts` | `encodeParentId({run, sub}, spec)` → `data:application/json,...` URI carrying both the parent_id and the executor-facing spec text. `decodeParentId(specUri)` extracts the pair; returns `null` for non-envelope URIs. |
| `plan-runner.ts` | `runPlan(plan, channel, bundle, {runId})` — executes the plan one sub-task at a time in topological order, polling `getTask` every 10s, emitting lifecycle events into the SSE channel. |
| `agent.ts` | Two entry points: `executePlan(plan, bundle)` (pre-approved Plan) and `classifyAndExecute(brief, bundle, env)` (autonomous one-shot). Both register progress channels with `demoRegistry`. |
| `index.ts` | Barrel re-exporting the public surface. |

## How to add a new sub-task type

1. Pick a kebab-case `type` string for it (e.g. `"sentiment-text"`).
2. Update the classifier so it can produce sub-tasks with this type:
   - **Mock path:** add a `MockTemplate` entry to `TEMPLATES` in
     `classify.ts` whose `build()` produces a `proposed_plan` containing
     the new type, and a `matches()` predicate for the trigger keywords.
   - **LLM path:** the system prompt does not enumerate types — the LLM
     can emit any string. Make sure the new type is described in the
     prompt only if it needs special instructions.
3. Register an executor for the new type. Either:
   - Re-use an existing worker (e.g. point `executor_address` at the
     summarizer wallet) — fast but conflates capability with executor.
   - Add a dedicated worker under `apps/demo-agents/src/<type>/` mirroring
     the existing `summarizer/agent.ts` pattern, with its own Fly process
     and private key.
4. Wire the executor address into the Plan flow. For mock plans, set
   `executor_address` in the template's `build()`. For LLM-generated
   plans, either:
   - Have the LLM emit `executor_address` directly (only if you give it
     the executor catalogue in the prompt), or
   - Resolve type → address in a pre-execute hook on the server.

> **Important:** the existing 4 workers (summarizer/translator/vision/sentiment)
> read `specUri` as raw text and pass it straight to OpenAI. The composite
> flow wraps `specUri` in a `data:application/json,{...}` envelope, which
> the existing workers will treat as JSON text. That works (the LLM is
> happy to summarize JSON), but isn't ideal. A composite-aware worker
> generation that uses `decodeSpec()` is a future task.

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

The off-chain indexer rebuilds the parent → sub-task graph by scanning
`TaskCreated` events and calling `decodeParentId(specUri)` on each. Events
whose specUri is not a properly-formed envelope are treated as standalone
non-composite tasks.

## Lifecycle events emitted on the SSE channel

`runPlan` emits the following events into the registered `SseChannel`. Each
event payload is JSON.

| Event | Payload | When |
|-------|---------|------|
| `plan_started` | `{runId, plan_summary, order, startedAt}` | First thing after validation. `order` is the topological order. |
| `subtask_status` | `{subId, status}` | Every status transition (`created` → `accepted` → `completed` → `paid`, or `errored` / `disputed`). Flat firehose-style event for graph rendering. |
| `subtask_created` | `{subId, taskId, executor, amount, deadline}` | `createTask` returned. |
| `subtask_accepted` | `{subId, taskId}` | First poll where status === Accepted. |
| `subtask_completed` | `{subId, taskId, resultUri}` | First poll where status === Completed. |
| `subtask_paid` | `{subId, taskId, txHash}` | After `approvePayment` tx submitted. |
| `subtask_errored` | `{subId, error}` | Any lifecycle exception. Followed by `plan_failed`. |
| `plan_completed` | `{runId, durationMs}` | All sub-tasks reached `paid`. |
| `plan_failed` | `{runId, failedSubId, error}` | Plan aborted due to a sub-task failure. |
| `done` | `{runId, ok, ...}` | Emitted by `SseChannel.close()`. Final event in the stream. |

## Endpoints (added in `server.ts` M10.2.6)

```
POST /api/demo/composite/classify
  body: { "brief": "<text>" }
  → 200 { classification: ClassificationResult }   // bigints serialized as strings

POST /api/demo/composite/execute
  body: Plan (with cost fields as decimal strings)
  → 202 { runId, streamUrl, chainId, chainName, explorerUrl }
  → 400 { error: "<validation>" }
  → 503 { error: "sponsor_exhausted", ... }

GET  /api/demo/composite/stream/:runId
  → text/event-stream of the lifecycle events above
  → 404 { error } when runId is unknown / expired
```

Existing `/api/demo/start` + `/api/demo/stream/:id` are unchanged; the
3-mode demo (pipeline/sentiment/vision) is untouched by this work.

## Local smoke (mock classifier — safe)

Skip the LLM call by NOT setting `OPENAI_API_KEY`. The classifier falls back
to the 5-template mock, no money is spent, runs hit the mock executors only
if you supply real `executor_address` values.

```bash
# In one terminal, start the orchestrator
cd apps/demo-agents
pnpm dev:orchestrator   # reads .env.orchestrator

# In another terminal, classify a brief
curl -s -X POST http://localhost:3000/api/demo/composite/classify \
  -H 'Content-Type: application/json' \
  -d '{"brief":"translate this paragraph"}' | jq

# Execute a hand-crafted Plan
curl -s -X POST http://localhost:3000/api/demo/composite/execute \
  -H 'Content-Type: application/json' \
  -d '{
    "brief": "demo",
    "decomposability": "one-shot",
    "stakes": "low",
    "subtasks": [{
      "id": 1,
      "type": "translate-text",
      "executor_address": "0xa61b00000000000000000000000000000000001c",
      "estimated_cost_units": "100000",
      "deadline_offset_s": 600,
      "spec": "translate me"
    }],
    "estimated_total_cost_units": "100000",
    "estimated_duration_ms": 8000
  }' | jq

# Tail the stream
curl -N http://localhost:3000/api/demo/composite/stream/<runId>
```

## Mainnet smoke (M10.2.7 — uses real USDC)

The full smoke requires:
- `PRIVATE_KEY` for the sponsor wallet (≥ 1 USDC on Base mainnet)
- `OPENAI_API_KEY` to exercise the real classifier path
- `CHAIN=mainnet`, `CHAIN_ID=8453`, `RPC_URL=...`
- Real worker addresses set as `executor_address` on each sub-task

Each sub-task spends `estimated_cost_units` USDC from the sponsor (locked
in escrow, paid to executor on completion). A 3-step composite at 100_000
units each is ~0.3 USDC. Budget accordingly.

## Debugging

- **Where do trace events go?** `classify.ts` emits JSON-line events via
  `console.error`. On Fly, these appear in `fly logs -a sage-demo-agents`.
  Filter with `grep parent.classify` if it gets noisy.
- **Why is a sub-task stuck on `created`?** The executor for that
  `executor_address` either isn't running or isn't watching `TaskCreated`
  for that chain. Check the appropriate worker process.
- **Why does the plan run but produce garbage results?** Existing workers
  treat the wrapped `data:application/json,{...}` `specUri` as text. The
  LLM summary of a JSON envelope is a summary OF the envelope, not of the
  sub-task spec. See "How to add a new sub-task type" for the composite-aware
  worker plan.
- **Where is the runId logged?** `executePlan` returns it; `plan_started`
  + `plan_completed` + `done` events on the SSE channel carry it.

## Out-of-scope vs deferred

| Concern | Status | Where it goes |
|---------|--------|--------------|
| Modifying existing 4 workers to decode the parent envelope | Deferred | Composite-aware workers, future milestone |
| Per-sub-task user-approval gate (instead of auto-approve) | Deferred | M10.3 frontend + new endpoint |
| Dispute path beyond emitting `subtask_disputed` | Partial | M10.4.1–M10.4.3 |
| Parallel execution of independent sub-tasks | Deferred | Performance work, future |
| ERC-8004 / AgentRegistry integration for executor discovery | Out of scope (Phase B) | Arc / multi-chain milestone |
