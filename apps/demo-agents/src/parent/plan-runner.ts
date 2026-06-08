/**
 * Plan runner — executes a user-approved `Plan` as a sequence of on-chain
 * `TaskEscrow` records on Base mainnet.
 *
 * Behavior:
 * - Sub-tasks are executed one at a time in topologically-sorted order.
 *   Parallelism would be possible in principle but every sub-task is a
 *   sponsor-side transaction; serialized execution sidesteps the nonce
 *   races we hit in the existing pipeline (see GOTCHAS / `demo-run.ts`
 *   nonce-gap comment).
 * - For each sub-task: `createTask` → poll status every 10s → `approvePayment`
 *   on Completed → wait for receipt before the next sub-task. Polling
 *   interval is explicit (`POLL_INTERVAL_MS = 10_000`) per the project
 *   guard against sub-10s polling (CLAUDE.md / GOTCHAS 2026-05-13).
 * - Each sub-task's `specUri` is a `data:application/json` envelope produced
 *   by `parent-id-codec` carrying `{run, sub}` + the spec text.
 *   Off-chain indexers reconstruct the parent → sub-task graph from these.
 * - All lifecycle events are emitted into the SSE `channel`. The frontend
 *   plan-graph component renders sub-task nodes from these.
 * - On dispute (M10.5.A): the runner pauses via `awaitUserDecision` instead
 *   of failing the plan. The orchestrator's `/composite/retry-subtask`
 *   endpoint resolves the wait — either re-spawn with the same or a new
 *   executor, or surface `plan_failed`.
 *
 * Out of scope here (deferred to later milestones):
 * - Per-sub-task user approval gate (M10.3 / M10.4 — frontend + endpoint).
 * - Parallel execution of independent sub-tasks (deferred).
 */

import { agentId, TaskStatus, type TaskId } from '@sage/core';
import type { Plan, SubTask } from '@sage/core';

import type { SseChannel } from '../shared/sse.js';
import type { createSageFromConfig } from '../shared/config.js';
import { encodeParentId, type EnvelopeContent } from './parent-id-codec.js';
import { awaitUserDecision } from './run-registry.js';

type SageClientBundle = ReturnType<typeof createSageFromConfig>;

/**
 * Status of a sub-task within a single plan-run. Mirrors `TaskStatus` from
 * `@sage/core` but adds `waiting` (deps not satisfied yet) and `errored`
 * (lifecycle failed). Emitted on every transition so the graph view in
 * the frontend can update node colors.
 */
export type SubTaskRunStatus =
  | 'waiting'
  | 'created'
  | 'accepted'
  | 'completed'
  | 'paid'
  | 'errored'
  | 'disputed';

export interface RunPlanOptions {
  /** Server-minted run identifier; used as the `run` half of `parent_id`. */
  readonly runId: string;
  /**
   * Hard ceiling on the per-sub-task wait between Created → Completed.
   * Default 5 min — matches the existing demo's 120s × N retry tolerance.
   */
  readonly subtaskTimeoutMs?: number;
}

/** Explicit polling interval. Do NOT lower below 10s — see GOTCHAS 2026-05-13. */
const POLL_INTERVAL_MS = 10_000;

const DEFAULT_SUBTASK_TIMEOUT_MS = 5 * 60 * 1000;

class PlanError extends Error {}

/**
 * Thrown by `pollUntilCompleted` when a sub-task transitions to `Disputed`.
 * Caught by the per-sub-task retry loop in `runPlan`, which pauses for a
 * user decision via `awaitUserDecision` and either retries or surfaces
 * `plan_failed`. Distinct class so we don't conflate disputes with other
 * lifecycle failures.
 */
class DisputedError extends Error {
  constructor(public readonly subId: number) {
    super(`subtask #${subId} disputed`);
  }
}

/**
 * Execute a Plan end-to-end. Resolves when every sub-task has reached `paid`
 * (or one has errored — channel emits `plan_failed` and the function returns
 * without throwing, since the channel is the canonical progress surface).
 */
export async function runPlan(
  plan: Plan,
  channel: SseChannel,
  bundle: SageClientBundle,
  options: RunPlanOptions,
): Promise<void> {
  const startedAt = Date.now();
  const subtasks = plan.subtasks;
  const timeoutMs = options.subtaskTimeoutMs ?? DEFAULT_SUBTASK_TIMEOUT_MS;

  validatePlan(plan);
  const order = topoSort(subtasks);

  channel.emit('plan_started', {
    runId: options.runId,
    plan_summary: {
      brief: plan.brief,
      decomposability: plan.decomposability,
      stakes: plan.stakes,
      subtask_count: subtasks.length,
    },
    order: order.map((s) => s.id),
    startedAt,
  });

  const results = new Map<number, string>();
  const txHashes: string[] = [];

  for (const sub of order) {
    // Per-sub-task retry loop. The default path executes once and breaks.
    // On dispute we pause for a user decision (via run-registry) and either
    // re-enter the loop with a possibly-different executor, or surface
    // plan_failed and exit. Non-dispute errors fall through to the existing
    // failure path unchanged.
    let currentSub = sub;
    let attempt = 1;
    // eslint-disable-next-line no-constant-condition
    while (true) {
      try {
        const result = await runSubtask({
          sub: currentSub,
          runId: options.runId,
          bundle,
          channel,
          timeoutMs,
          txHashes,
          content: buildContent(currentSub, plan.brief, results),
        });
        results.set(sub.id, result);
        break;
      } catch (err) {
        if (err instanceof DisputedError) {
          const decision = await awaitUserDecision(options.runId, sub.id);
          if (decision.kind === 'retry') {
            attempt += 1;
            const nextExecutor = decision.newExecutor ?? sub.executor_address;
            currentSub = nextExecutor
              ? { ...sub, executor_address: nextExecutor }
              : sub;
            channel.emit('subtask_retrying', {
              subId: sub.id,
              attempt,
              executor: nextExecutor,
            });
            continue;
          }
          const reason =
            decision.kind === 'timeout'
              ? `subtask #${sub.id} paused without decision (timeout)`
              : `subtask #${sub.id} cancelled by user after dispute`;
          channel.emit('plan_failed', {
            runId: options.runId,
            failedSubId: sub.id,
            error: reason,
            reason:
              decision.kind === 'timeout'
                ? 'pause_timeout'
                : 'user_cancelled_after_dispute',
          });
          channel.close({
            runId: options.runId,
            ok: false,
            error: reason,
            completedSubIds: Array.from(results.keys()),
            txHashes,
          });
          return;
        }
        const message = err instanceof Error ? err.message : String(err);
        channel.emit('subtask_errored', { subId: sub.id, error: message });
        channel.emit('plan_failed', {
          runId: options.runId,
          failedSubId: sub.id,
          error: message,
        });
        channel.close({
          runId: options.runId,
          ok: false,
          error: message,
          completedSubIds: Array.from(results.keys()),
          txHashes,
        });
        return;
      }
    }
  }

  channel.emit('plan_completed', { runId: options.runId, durationMs: Date.now() - startedAt });
  channel.close({
    runId: options.runId,
    ok: true,
    results: Object.fromEntries(
      Array.from(results.entries()).map(([id, r]) => [String(id), r]),
    ),
    txHashes,
    durationMs: Date.now() - startedAt,
  });
}

// ────────────────────────────────────────────────────────────────────────
// Internal helpers
// ────────────────────────────────────────────────────────────────────────

interface RunSubtaskArgs {
  readonly sub: SubTask;
  readonly runId: string;
  readonly bundle: SageClientBundle;
  readonly channel: SseChannel;
  readonly timeoutMs: number;
  readonly txHashes: string[];
  /**
   * Content material attached to the envelope (ADR-0018). Dependent sub-tasks
   * carry `{inputs}` (upstream results); root sub-tasks carry `{source}` (the
   * original brief). Absent → spec-only (legacy behavior).
   */
  readonly content?: EnvelopeContent;
}

/**
 * Build the envelope content for a sub-task per the ADR-0018 convention:
 *   - if any `depends_on` upstream has produced a result → attach those as
 *     `inputs` (this is a dependent sub-task; its material is the upstream
 *     output, not the original brief);
 *   - otherwise → attach the original `brief` verbatim as `source` (root
 *     sub-task; this is what guarantees the full payload reaches the worker
 *     instead of the lossy LLM-written spec).
 *
 * Attaching one or the other (never both) keeps the brief from being stored
 * on-chain redundantly across every sub-task of a chain.
 */
function buildContent(
  sub: SubTask,
  brief: string,
  results: ReadonlyMap<number, string>,
): EnvelopeContent {
  const inputs: Record<number, string> = {};
  for (const dep of sub.depends_on ?? []) {
    const upstream = results.get(dep);
    if (upstream !== undefined) inputs[dep] = upstream;
  }
  return Object.keys(inputs).length > 0 ? { inputs } : { source: brief };
}

async function runSubtask(args: RunSubtaskArgs): Promise<string> {
  const { sub, runId, bundle, channel, timeoutMs, txHashes } = args;
  if (!sub.executor_address) {
    throw new PlanError(`subtask #${sub.id} has no executor_address`);
  }
  if (sub.estimated_cost_units <= 0n) {
    throw new PlanError(`subtask #${sub.id} estimated_cost_units must be > 0`);
  }

  const specUri = encodeParentId({ run: runId, sub: sub.id }, sub.spec, args.content);
  // Floor `deadline_offset_s` at MIN_DEADLINE_OFFSET_S so we don't trip
  // TaskEscrow's `deadline <= block.timestamp` check when the LLM
  // classifier emits a short value (60-90s observed). Arc testnet block
  // timestamps have inter-block variance (multiple blocks can share a
  // ts), so a 600s minimum absorbs mining latency + accept-window. Same
  // floor works fine on Base (~2s blocks). See ADR-0015 verification +
  // GOTCHAS 2026-05-22.
  const MIN_DEADLINE_OFFSET_S = 600;
  const effectiveOffset = Math.max(sub.deadline_offset_s, MIN_DEADLINE_OFFSET_S);
  const deadline = Math.floor(Date.now() / 1000) + effectiveOffset;

  channel.emit('subtask_status', { subId: sub.id, status: 'created' satisfies SubTaskRunStatus });

  const tid = await bundle.sage.tasks.createTask({
    executor: agentId(sub.executor_address),
    deadline,
    amount: sub.estimated_cost_units,
    specUri,
  });

  channel.emit('subtask_created', {
    subId: sub.id,
    taskId: tid.toString(),
    executor: sub.executor_address,
    amount: sub.estimated_cost_units.toString(),
    deadline,
  });

  const resultUri = await pollUntilCompleted(bundle, tid, channel, sub.id, timeoutMs);
  const result = decodeResult(resultUri);

  const approveHash = await bundle.sage.tasks.approvePayment(tid);
  txHashes.push(approveHash);
  channel.emit('subtask_paid', {
    subId: sub.id,
    taskId: tid.toString(),
    txHash: approveHash,
  });
  channel.emit('subtask_status', { subId: sub.id, status: 'paid' satisfies SubTaskRunStatus });

  // Same rationale as demo-run.ts:222-224 — block until the approvePayment
  // receipt lands before sending the next sponsor-side createTask, otherwise
  // the next tx reuses the still-pending nonce.
  await bundle.publicClient.waitForTransactionReceipt({ hash: approveHash as `0x${string}` });

  return result;
}

async function pollUntilCompleted(
  bundle: SageClientBundle,
  taskId: TaskId,
  channel: SseChannel,
  subId: number,
  timeoutMs: number,
): Promise<string> {
  const start = Date.now();
  let lastStatus: TaskStatus | null = null;

  while (Date.now() - start < timeoutMs) {
    const task = await bundle.sage.tasks.getTask(taskId);
    if (!task) {
      await sleep(POLL_INTERVAL_MS);
      continue;
    }

    if (task.status !== lastStatus) {
      lastStatus = task.status;
      if (task.status === TaskStatus.Accepted) {
        channel.emit('subtask_accepted', { subId, taskId: taskId.toString() });
        channel.emit('subtask_status', {
          subId,
          status: 'accepted' satisfies SubTaskRunStatus,
        });
      }
      if (task.status === TaskStatus.Completed) {
        channel.emit('subtask_completed', {
          subId,
          taskId: taskId.toString(),
          resultUri: task.resultUri,
        });
        channel.emit('subtask_status', {
          subId,
          status: 'completed' satisfies SubTaskRunStatus,
        });
        return task.resultUri;
      }
      if (task.status === TaskStatus.Disputed) {
        // M10.4.1: dedicated event for dispute resolution UI (M10.4.3
        // replan-prompt). Plus the firehose `subtask_status` event for
        // graph-rendering consistency.
        // M10.5.A: throws `DisputedError` so the per-sub-task retry loop
        // in `runPlan` can distinguish dispute (pause-for-user-decision)
        // from other lifecycle failures (immediate plan_failed).
        channel.emit('subtask_disputed', {
          subId,
          taskId: taskId.toString(),
          resultUri: task.resultUri,
        });
        channel.emit('subtask_status', { subId, status: 'disputed' satisfies SubTaskRunStatus });
        throw new DisputedError(subId);
      }
    }

    if (
      task.status === TaskStatus.Paid ||
      task.status === TaskStatus.Expired ||
      task.status === TaskStatus.Refunded
    ) {
      throw new PlanError(`subtask #${subId} ended unexpectedly in ${task.status}`);
    }

    await sleep(POLL_INTERVAL_MS);
  }

  throw new PlanError(`subtask #${subId} timed out after ${timeoutMs}ms`);
}

function decodeResult(resultUri: string): string {
  if (resultUri.startsWith('data:text/plain,')) {
    return decodeURIComponent(resultUri.replace('data:text/plain,', ''));
  }
  return resultUri;
}

// ────────────────────────────────────────────────────────────────────────
// Plan validation + topo sort
// ────────────────────────────────────────────────────────────────────────

function validatePlan(plan: Plan): void {
  if (plan.subtasks.length === 0) {
    throw new PlanError('plan has no subtasks');
  }
  const ids = new Set<number>();
  for (const s of plan.subtasks) {
    if (ids.has(s.id)) throw new PlanError(`duplicate subtask id ${s.id}`);
    ids.add(s.id);
  }
  for (const s of plan.subtasks) {
    for (const dep of s.depends_on ?? []) {
      if (!ids.has(dep)) {
        throw new PlanError(`subtask #${s.id} depends on unknown id ${dep}`);
      }
      if (dep === s.id) {
        throw new PlanError(`subtask #${s.id} depends on itself`);
      }
    }
  }
}

/**
 * Kahn's algorithm. Returns the subtasks in a valid topological order.
 * Throws on cycles. Stable for ties — sub-tasks with no remaining deps are
 * processed in ascending `id` order, which matches the plan-card display.
 */
export function topoSort(subtasks: readonly SubTask[]): SubTask[] {
  const byId = new Map<number, SubTask>();
  const indegree = new Map<number, number>();
  const children = new Map<number, number[]>();

  for (const s of subtasks) {
    byId.set(s.id, s);
    indegree.set(s.id, (s.depends_on ?? []).length);
    children.set(s.id, []);
  }
  for (const s of subtasks) {
    for (const dep of s.depends_on ?? []) {
      children.get(dep)!.push(s.id);
    }
  }

  const ready: number[] = [];
  for (const [id, deg] of indegree) {
    if (deg === 0) ready.push(id);
  }
  ready.sort((a, b) => a - b);

  const out: SubTask[] = [];
  while (ready.length > 0) {
    const id = ready.shift()!;
    out.push(byId.get(id)!);
    for (const child of children.get(id) ?? []) {
      indegree.set(child, indegree.get(child)! - 1);
      if (indegree.get(child) === 0) {
        // Insert in sorted position to keep stable ordering.
        const idx = ready.findIndex((x) => x > child);
        if (idx < 0) ready.push(child);
        else ready.splice(idx, 0, child);
      }
    }
  }

  if (out.length !== subtasks.length) {
    throw new PlanError('plan has a dependency cycle');
  }
  return out;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export const __testing = {
  topoSort,
  validatePlan,
  decodeResult,
  POLL_INTERVAL_MS,
  DEFAULT_SUBTASK_TIMEOUT_MS,
};
