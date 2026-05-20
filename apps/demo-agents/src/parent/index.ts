/**
 * Parent-agent module — implements the observable-decomposition flow from ADR-0007.
 *
 * Responsibilities:
 * - classify a brief into a structured `Plan` via LLM + heuristic cross-check;
 * - on user approval, spawn each `SubTask` as an on-chain `TaskEscrow` record
 *   with a `parent_id` link back to the originating plan;
 * - stream lifecycle events back through the orchestrator's SSE channel.
 *
 * The parent does NOT run as its own Fly process — it executes inside the
 * orchestrator's HTTP handlers (see `apps/demo-agents/src/orchestrator/server.ts`).
 *
 * Planned layout (filled in across M10.1.4 → M10.2.5):
 * - `heuristic.ts`        — deterministic keyword cross-check on classifier output
 * - `classify.ts`         — LLM-driven classifier (mock-first, real LLM in M10.2.1)
 * - `parent-id-codec.ts`  — encode/decode `parent_id` inside `specUri`
 * - `plan-runner.ts`      — per-subtask spawn + dependency-aware execution
 * - `agent.ts`            — wires classify → plan-runner together
 *
 * See: `apps/demo-agents/PARENT-PLAN.md` for the full 4-week plan.
 */

// Public surface of the parent module — consumed by the orchestrator's
// composite endpoints (M10.2.6) and by tests.

export { classifyBrief, type ParentEnv } from './classify.js';
export { applyHeuristicAdjustment } from './heuristic.js';
export {
  encodeParentId,
  decodeParentId,
  decodeSpec,
  type ParentId,
} from './parent-id-codec.js';
export {
  runPlan,
  topoSort,
  type RunPlanOptions,
  type SubTaskRunStatus,
} from './plan-runner.js';
export {
  executePlan,
  classifyAndExecute,
  classificationToPlan,
  type ExecuteResult,
  type ClassifyAndExecuteResult,
} from './agent.js';
export {
  awaitUserDecision,
  resolveUserDecision,
  hasPendingDecision,
  DEFAULT_PAUSE_TIMEOUT_MS,
  type RetryAction,
} from './run-registry.js';
