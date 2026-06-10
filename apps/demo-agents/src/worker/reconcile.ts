/**
 * On-chain reconciliation for the generic worker (ADR-0020 п.4: wake-on-HTTP
 * вместо постоянного watch).
 *
 * There is NO interval polling here. A reconciliation pass runs exactly when
 * something asks for one — boot, or an inbound `/wake` ping — and recovers
 * everything in one sweep:
 *
 *   - `Created` tasks naming one of our identities → fresh dispatch
 *     (guards → accept → execute → complete);
 *   - `Accepted` tasks naming us → resume (we accepted before a crash or
 *     stop, never completed — re-execute and complete);
 *   - anything else → ignore.
 *
 * Because dispatch decisions come only from on-chain state, the wake ping
 * itself carries no authority: a lost ping is recovered by the next boot's
 * scan-back window, and a hostile/duplicate ping costs at most one bounded
 * read sweep (see single-flight + throttle below).
 *
 * Scan model mirrors the foreign-agent template: first pass starts at
 * `nextTaskId − BOOT_SCAN_BACK` (catching tasks created while the machine
 * was stopped — the scale-to-zero normal case), later passes resume from the
 * in-memory cursor. Re-scanning is safe — the status filter skips anything
 * already handled. A read error mid-pass parks the cursor AT the failed id,
 * so nothing is silently skipped.
 *
 * Concurrency:
 *   - single-flight: concurrent `requestPass` calls coalesce — the running
 *     pass picks up a rerun flag instead of a second scan racing the first;
 *   - throttle: scan starts are spaced `minScanIntervalMs` apart, bounding
 *     the RPC cost of a wake flood.
 */

import { TaskStatus, type TaskRecord } from '@sage/core';

export interface TaskReader {
  nextTaskId(): Promise<bigint>;
  getTask(id: bigint): Promise<TaskRecord | null>;
}

export interface ReconcilerOptions {
  readonly reader: TaskReader;
  /** Lower-cased executor addresses we host. */
  readonly addresses: ReadonlySet<string>;
  /**
   * Start the task lifecycle for one of ours. `resume` = already Accepted by
   * us. Must not throw (executor.ts catches internally); belt-and-braces
   * caught here anyway.
   */
  readonly dispatch: (id: bigint, task: TaskRecord, resume: boolean) => Promise<void>;
  /** How far behind `nextTaskId` the FIRST pass starts. Default 200. */
  readonly bootScanBack?: number;
  /** Minimum spacing between scan starts. Default 3000ms. */
  readonly minScanIntervalMs?: number;
  /** When true, passes return without dispatching (graceful drain). */
  readonly isDraining?: () => boolean;
  readonly log?: (msg: string) => void;
  /** Test seams. */
  readonly now?: () => number;
  readonly sleep?: (ms: number) => Promise<void>;
}

export interface Reconciler {
  /**
   * Request a reconciliation pass. Coalesces: if a pass is already running,
   * flags a rerun and returns the in-progress promise — the running pass
   * will loop once more before settling.
   */
  requestPass(reason: string): Promise<void>;
  /** Exposed for tests/health: next id the scanner will look at, if known. */
  readonly cursor: bigint | null;
}

export function createReconciler(opts: ReconcilerOptions): Reconciler {
  const log = opts.log ?? ((m: string) => console.error(`[worker:reconcile] ${m}`));
  const now = opts.now ?? Date.now;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const bootScanBack = BigInt(opts.bootScanBack ?? 200);
  const minIntervalMs = opts.minScanIntervalMs ?? 3000;

  let cursor: bigint | null = null;
  let running: Promise<void> | null = null;
  let rerun = false;
  let lastScanStart = -Infinity;

  async function scanOnce(reason: string): Promise<void> {
    if (opts.isDraining?.()) {
      log(`pass skipped (${reason}) — draining`);
      return;
    }
    const head = await opts.reader.nextTaskId();
    let from = cursor ?? (head > bootScanBack ? head - bootScanBack : 0n);
    if (from > head) from = head; // defensive: never scan backwards past head
    if (from === head) {
      cursor = head;
      return;
    }
    log(`pass (${reason}): scanning tasks [${from}, ${head})`);

    const dispatches: Array<Promise<void>> = [];
    for (let id = from; id < head; id++) {
      if (opts.isDraining?.()) {
        cursor = id; // resume exactly here after the drain-stop
        log(`pass interrupted by drain at task ${id}`);
        break;
      }
      let task: TaskRecord | null;
      try {
        task = await opts.reader.getTask(id);
      } catch (err) {
        // Park the cursor AT the failed id — the next pass retries from here
        // instead of silently skipping a task we may own.
        cursor = id;
        log(`getTask(${id}) failed — pass aborted, cursor parked: ${String(err)}`);
        await Promise.allSettled(dispatches);
        return;
      }
      cursor = id + 1n;
      if (!task) continue;
      if (!opts.addresses.has(String(task.executor).toLowerCase())) continue;
      if (task.status === TaskStatus.Created || task.status === TaskStatus.Accepted) {
        const resume = task.status === TaskStatus.Accepted;
        dispatches.push(
          opts.dispatch(id, task, resume).catch((err) => {
            log(`dispatch(${id}) threw (executor should not): ${String(err)}`);
          }),
        );
      }
    }
    await Promise.allSettled(dispatches);
  }

  // Deliberately NOT an async function: callers coalescing on a running pass
  // must receive the SAME promise object (an async wrapper would mint a new
  // one per call and hide the single-flight guarantee from tests/embedders).
  function requestPass(reason: string): Promise<void> {
    if (running) {
      rerun = true;
      return running;
    }
    running = (async () => {
      do {
        rerun = false;
        const wait = minIntervalMs - (now() - lastScanStart);
        if (wait > 0) await sleep(wait);
        lastScanStart = now();
        try {
          await scanOnce(reason);
        } catch (err) {
          // nextTaskId failure etc. — cursor untouched, next wake retries.
          log(`pass failed (${reason}): ${String(err)}`);
        }
        reason = 'rerun';
      } while (rerun);
    })().finally(() => {
      running = null;
    });
    return running;
  }

  return {
    requestPass,
    get cursor() {
      return cursor;
    },
  };
}
