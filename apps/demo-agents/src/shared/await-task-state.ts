/**
 * Bounded poll for a task to reach an expected on-chain status.
 *
 * Replaces hardcoded `setTimeout(2000)` post-receipt sleeps in worker agents.
 * Even after `waitForTransactionReceipt`, the RPC read replica can lag the
 * mined state — on Arc testnet because block timestamps have intra-block
 * variance (ADR-0015), and on Cloudflare→Alchemy proxy paths because
 * `getTransactionCount(pending)` and the contract-state reads can briefly
 * disagree (GOTCHAS 2026-04-29). A flat 2s either over-waits in the happy
 * case or silently abandons the task when the replica is slower.
 *
 * Returns the task once `status === expectedStatus`, or `null` if neither
 * lands within `timeoutMs`. Caller decides how to react to `null` —
 * workers log + skip; future call sites might re-queue or alert.
 */
import type { TaskId, TaskStatus } from '@sage/core';

export interface AwaitTaskStateOptions {
  /** Hard ceiling on total wait. Default 10s. */
  readonly timeoutMs?: number;
  /** Initial inter-poll delay; doubles up to `maxDelayMs`. Default 500ms. */
  readonly initialDelayMs?: number;
  /** Cap per-attempt delay. Default 2000ms. */
  readonly maxDelayMs?: number;
}

export async function awaitTaskState<T extends { status: TaskStatus }>(
  getTask: (id: TaskId) => Promise<T | null>,
  id: TaskId,
  expectedStatus: TaskStatus,
  options: AwaitTaskStateOptions = {},
): Promise<T | null> {
  const timeoutMs = options.timeoutMs ?? 10_000;
  const initialDelayMs = options.initialDelayMs ?? 500;
  const maxDelayMs = options.maxDelayMs ?? 2_000;

  const start = Date.now();
  let delay = initialDelayMs;

  while (Date.now() - start < timeoutMs) {
    const task = await getTask(id);
    if (task !== null && task.status === expectedStatus) return task;
    if (Date.now() - start + delay >= timeoutMs) break;
    await sleep(delay);
    delay = Math.min(delay * 2, maxDelayMs);
  }
  return null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
