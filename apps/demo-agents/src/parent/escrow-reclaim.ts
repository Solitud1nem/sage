/**
 * Best-effort reclaim of stranded escrows after a failed plan run (code
 * review 2026-06-09, CR.3 / finding M2).
 *
 * When a plan fails mid-run, sub-tasks already spawned on-chain may hold
 * USDC in a non-terminal status with nobody driving them further:
 *
 *   - `Created` / `Accepted` — the worker never completed. After the task's
 *     deadline anyone may call `refundExpired` to return the escrow to the
 *     client (sponsor). Nothing in the codebase called it before this module.
 *   - `Disputed` — only the arbiter can settle (`resolveDispute`). Reached
 *     here only when the in-line settle on the dispute-retry path failed;
 *     this is the second (and last) attempt.
 *   - `Completed` — NOT reclaimed: the executor can `claimAutoRelease` after
 *     the grace period, so the escrow is theirs to collect.
 *
 * Each stranded task gets a one-shot timer at `deadline + margin`; on fire we
 * re-read the on-chain status and act only on what we find — the worker may
 * have completed late, in which case we leave the task alone.
 *
 * Limitations (accepted — best-effort by design):
 *   - Timers are in-memory; an orchestrator restart drops them. The orphaned
 *     taskIds are logged and included in the `plan_failed` payload, so manual
 *     reclaim stays possible.
 *   - Single attempt per task; failures are logged, never retried or thrown.
 */

import { TaskStatus, type TaskId } from '@sage/core';

import type { createSageFromConfig } from '../shared/config.js';

type SageClientBundle = ReturnType<typeof createSageFromConfig>;

export interface StrandedTask {
  readonly subId: number;
  readonly taskId: TaskId;
  /** Unix seconds — the on-chain deadline passed to `createTask`. */
  readonly deadline: number;
}

export interface ReclaimOptions {
  readonly runId: string;
  /**
   * Arbiter capability for `Disputed` orphans (`resolveDispute` → client
   * refund). Same capability as `RunPlanOptions.resolveStranded`. When
   * absent, Disputed orphans are logged and skipped.
   */
  readonly resolveStranded?: (taskId: TaskId) => Promise<string>;
  /** Margin past the on-chain deadline before acting. Default {@link RECLAIM_MARGIN_MS}. */
  readonly marginMs?: number;
}

/**
 * Wait this long past the task's deadline before calling `refundExpired` —
 * absorbs block-timestamp variance (Arc blocks can share a timestamp, see
 * GOTCHAS 2026-05-22) plus RPC replica lag.
 */
export const RECLAIM_MARGIN_MS = 60_000;

function log(event: string, fields: Record<string, unknown>): void {
  console.error(JSON.stringify({ ts: Date.now(), event: `plan.reclaim.${event}`, ...fields }));
}

/**
 * Schedule a best-effort reclaim attempt for each stranded task. Fire-and-
 * forget: timers are unref'd so they never hold the process open, and every
 * failure path logs instead of throwing.
 */
export function scheduleReclaim(
  bundle: SageClientBundle,
  tasks: readonly StrandedTask[],
  opts: ReclaimOptions,
): void {
  const marginMs = opts.marginMs ?? RECLAIM_MARGIN_MS;
  for (const t of tasks) {
    const dueInMs = Math.max(0, t.deadline * 1000 + marginMs - Date.now());
    log('scheduled', {
      runId: opts.runId,
      subId: t.subId,
      taskId: t.taskId.toString(),
      dueInMs,
    });
    const timer = setTimeout(() => {
      void reclaimOne(bundle, t, opts);
    }, dueInMs);
    timer.unref?.();
  }
}

/** Single reclaim attempt. Never throws — all outcomes are logged. */
async function reclaimOne(
  bundle: SageClientBundle,
  t: StrandedTask,
  opts: ReclaimOptions,
): Promise<void> {
  const tid = t.taskId.toString();
  try {
    const task = await bundle.sage.tasks.getTask(t.taskId);
    if (!task) {
      log('skipped', { runId: opts.runId, taskId: tid, why: 'task_not_found' });
      return;
    }

    if (task.status === TaskStatus.Created || task.status === TaskStatus.Accepted) {
      const hash = await bundle.sage.tasks.refundExpired(t.taskId);
      const receipt = await bundle.publicClient.waitForTransactionReceipt({
        hash: hash as `0x${string}`,
      });
      if (receipt.status === 'reverted') {
        log('refund_reverted', { runId: opts.runId, taskId: tid, txHash: hash });
        return;
      }
      log('refunded', { runId: opts.runId, taskId: tid, txHash: hash });
      return;
    }

    if (task.status === TaskStatus.Disputed) {
      if (!opts.resolveStranded) {
        log('skipped', { runId: opts.runId, taskId: tid, why: 'disputed_no_resolver' });
        return;
      }
      const hash = await opts.resolveStranded(t.taskId);
      log('dispute_resolved', { runId: opts.runId, taskId: tid, txHash: hash });
      return;
    }

    // Completed → the executor's claimAutoRelease path; terminal statuses →
    // already settled. Either way the escrow is not ours to move.
    log('skipped', { runId: opts.runId, taskId: tid, why: `status_${task.status}` });
  } catch (err) {
    log('failed', {
      runId: opts.runId,
      taskId: tid,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

export const __testing = { reclaimOne };
