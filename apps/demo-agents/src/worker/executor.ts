/**
 * Per-task lifecycle for the generic worker: guards → accept → execute
 * (handler with bounded retries) → complete.
 *
 * Mirrors the proven shape of the existing single-identity workers
 * (`summarizer/agent.ts`) and the foreign-agent template, with two
 * differences:
 *
 * - **Resume path.** Boot-reconciliation hands us tasks already in
 *   `Accepted` (we crashed / were stopped between accept and complete).
 *   Those skip the guard + accept steps and go straight to execute.
 *
 * - **Honest failure completes.** When the handler exhausts its retries we
 *   still `completeTask` with an explicit failure text rather than leaving
 *   the task `Accepted` until its deadline. The client's review gate /
 *   future evaluator step (M12.0.3) is the layer that decides whether money
 *   moves — stranding escrow until deadline-reclaim helps no one (same
 *   reasoning as the summarizer's CR.2 fix).
 *
 * In-flight accounting lives here (`ActivityTracker`) because the window
 * that must block shutdown/idle-exit is exactly accept→complete: from the
 * moment the client's escrow is committed to us until the result is
 * on-chain.
 */

import { TaskStatus, taskId, type TaskRecord } from '@sage/core';

import { awaitTaskState } from '../shared/await-task-state.js';
import { decodeCompositeEnvelope, materialFromEnvelope } from '../shared/composite-codec.js';
import type { CapabilityHandler, WorkerJob } from './handlers/index.js';
import type { IdentityRuntime } from './runtime.js';

/**
 * Tracks in-flight tasks + the last moment anything happened. The server's
 * idle-exit and graceful drain both key off this.
 */
export class ActivityTracker {
  private inFlightCount = 0;
  private lastActivityMs = Date.now();

  get inFlight(): number {
    return this.inFlightCount;
  }

  /** Ms since the last begin/end/touch. */
  idleForMs(): number {
    return Date.now() - this.lastActivityMs;
  }

  touch(): void {
    this.lastActivityMs = Date.now();
  }

  begin(): void {
    this.inFlightCount += 1;
    this.touch();
  }

  end(): void {
    this.inFlightCount = Math.max(0, this.inFlightCount - 1);
    this.touch();
  }
}

export interface ExecutorOptions {
  readonly activity: ActivityTracker;
  readonly openaiApiKey: string | undefined;
  /** Skip a Created task whose deadline is closer than this. Default 120s. */
  readonly minDeadlineMarginS?: number;
  /** Cap on envelope material size, chars. Default 100k. 0 disables. */
  readonly maxMaterialChars?: number;
  /** Handler retry attempts after the first failure. Default 2. */
  readonly handlerRetries?: number;
  /** Test seam — backoff sleep between handler retries. */
  readonly sleep?: (ms: number) => Promise<void>;
  readonly log?: (msg: string) => void;
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Pre-accept economics, free to evaluate (the task record is already in
 * hand from the reconciliation scan). Returns a skip reason or null.
 * Same guard set as the foreign-agent template: the escrow routes ANY task
 * naming our address, including ones created outside the Sage classifier
 * with hostile economics.
 */
export function rejectReason(
  task: Pick<TaskRecord, 'amount' | 'deadline'>,
  priceUnits: bigint,
  minDeadlineMarginS: number,
  nowS = Math.floor(Date.now() / 1000),
): string | null {
  if (task.amount < priceUnits) {
    return `pays ${task.amount} < identity price ${priceUnits}`;
  }
  if (task.deadline <= nowS + minDeadlineMarginS) {
    return `deadline in ${task.deadline - nowS}s < margin ${minDeadlineMarginS}s`;
  }
  return null;
}

/** Decode a specUri into a handler job per the ADR-0018 envelope convention. */
export function decodeJob(specUri: string, maxMaterialChars: number): WorkerJob {
  const env = decodeCompositeEnvelope(specUri);
  if (env === null) {
    // Legacy/raw path: the whole specUri is both instruction and material.
    return { spec: specUri, material: null };
  }
  let material = materialFromEnvelope(env);
  if (material !== null && maxMaterialChars > 0 && material.length > maxMaterialChars) {
    material = material.slice(0, maxMaterialChars);
  }
  return { spec: env.spec, material };
}

/**
 * Drive one task to completion under the given identity. `resume` marks the
 * boot-reconciliation path for tasks already Accepted by us.
 *
 * Never throws — every failure is logged and leaves the task in a state the
 * next reconciliation pass (or the escrow deadline) can recover.
 */
export async function executeTask(
  rt: IdentityRuntime,
  handler: CapabilityHandler,
  id: bigint,
  task: TaskRecord,
  opts: ExecutorOptions,
  resume: boolean,
): Promise<void> {
  const log = opts.log ?? ((m: string) => console.error(`[worker:${rt.identity.id}] ${m}`));
  const sleep = opts.sleep ?? defaultSleep;
  const tid = taskId(id.toString());
  const { sage, publicClient } = rt.bundle;

  if (!resume) {
    const reason = rejectReason(
      task,
      rt.identity.priceUnits,
      opts.minDeadlineMarginS ?? 120,
    );
    if (reason) {
      log(`task ${id} skipped — ${reason}`);
      return;
    }
  }

  // From accept (or resume of a prior accept) to complete the client's escrow
  // is committed to us — the whole span counts as in-flight for drain/idle.
  opts.activity.begin();
  try {
    let current: TaskRecord | null = task;

    if (!resume) {
      log(`task ${id} accepting…`);
      const acceptHash = await sage.tasks.acceptTask(tid);
      const receipt = await publicClient.waitForTransactionReceipt({
        hash: acceptHash as `0x${string}`,
      });
      if (receipt.status === 'reverted') {
        log(`task ${id} accept reverted (another agent got it first)`);
        return;
      }
      // RPC read replicas can lag the mined accept — bounded wait, not a
      // flat sleep (see shared/await-task-state.ts).
      current = await awaitTaskState((t) => sage.tasks.getTask(t), tid, TaskStatus.Accepted);
      if (!current) {
        log(`task ${id} did not read back as Accepted — leaving for next reconcile pass`);
        return;
      }
    }

    const job = decodeJob(current.specUri, opts.maxMaterialChars ?? 100_000);
    log(`task ${id} working (capability ${rt.identity.capability}, spec: ${job.spec.slice(0, 60)}…)`);

    let result: string;
    try {
      result = await runWithRetry(handler, job, rt, opts, sleep, log, id);
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      // Honest failure result — settle the escrow surface instead of
      // stranding it Accepted until deadline; review/evaluator decides pay.
      result = `Task failed: ${detail}`;
      log(`task ${id} handler failed permanently: ${detail}`);
    }

    const resultUri = `data:text/plain,${encodeURIComponent(result)}`;
    const completeHash = await sage.tasks.completeTask(tid, resultUri);
    const completeReceipt = await publicClient.waitForTransactionReceipt({
      hash: completeHash as `0x${string}`,
    });
    if (completeReceipt.status === 'reverted') {
      log(`task ${id} completeTask reverted — stays Accepted, recovered by next pass/deadline`);
      return;
    }
    log(`task ${id} completed (tx ${completeHash})`);
  } catch (err) {
    log(`task ${id} lifecycle error: ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    opts.activity.end();
  }
}

async function runWithRetry(
  handler: CapabilityHandler,
  job: WorkerJob,
  rt: IdentityRuntime,
  opts: ExecutorOptions,
  sleep: (ms: number) => Promise<void>,
  log: (msg: string) => void,
  id: bigint,
): Promise<string> {
  const retries = opts.handlerRetries ?? 2;
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await handler(job, {
        identityId: rt.identity.id,
        capability: rt.identity.capability,
        openaiApiKey: opts.openaiApiKey,
      });
    } catch (err) {
      lastErr = err;
      if (attempt < retries) {
        const backoff = 2000 * (attempt + 1);
        log(`task ${id} handler attempt ${attempt + 1} failed (${String(err)}) — retry in ${backoff}ms`);
        await sleep(backoff);
      }
    }
  }
  throw lastErr;
}
