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
 *
 * Out of scope here (deferred to later milestones):
 * - Per-sub-task user approval gate (M10.3 / M10.4 — frontend + endpoint).
 * - Dispute handling beyond emitting the event (M10.4.1).
 * - Parallel execution of independent sub-tasks (deferred).
 */

import { agentId, TaskStatus, type TaskId } from '@sage/core';
import type { Plan, SubTask } from '@sage/core';

import type { SseChannel } from '../shared/sse.js';
import type { createSageFromConfig } from '../shared/config.js';
import { encodeParentId } from './parent-id-codec.js';

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
    try {
      const result = await runSubtask({
        sub,
        runId: options.runId,
        bundle,
        channel,
        timeoutMs,
        txHashes,
      });
      results.set(sub.id, result);
    } catch (err) {
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
}

async function runSubtask(args: RunSubtaskArgs): Promise<string> {
  const { sub, runId, bundle, channel, timeoutMs, txHashes } = args;
  if (!sub.executor_address) {
    throw new PlanError(`subtask #${sub.id} has no executor_address`);
  }
  if (sub.estimated_cost_units <= 0n) {
    throw new PlanError(`subtask #${sub.id} estimated_cost_units must be > 0`);
  }

  const specUri = encodeParentId({ run: runId, sub: sub.id }, sub.spec);
  const deadline = Math.floor(Date.now() / 1000) + sub.deadline_offset_s;

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
        // graph-rendering consistency. Both fire, then the runner throws
        // — the v1 hook surfaces `disputedSubId` and shows the prompt;
        // actual retry / change-executor wiring needs M10.5 backend
        // endpoint and is not in this iteration.
        channel.emit('subtask_disputed', {
          subId,
          taskId: taskId.toString(),
          resultUri: task.resultUri,
        });
        channel.emit('subtask_status', { subId, status: 'disputed' satisfies SubTaskRunStatus });
        throw new PlanError(`subtask #${subId} disputed`);
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
