/**
 * Run registry — pause / resume coordination for plan-runner on dispute.
 *
 * When `plan-runner.ts` sees a sub-task transition to `Disputed`, it pauses
 * by `await`-ing `awaitUserDecision(runId, subId)`. The orchestrator's
 * `/api/demo/composite/retry-subtask` endpoint resolves that promise with
 * either `retry` (optionally with a new executor) or `cancel`, letting the
 * runner either re-spawn the sub-task or surface `plan_failed`.
 *
 * The registry is in-memory and per-process, matching `demoRegistry` (SSE
 * channels) and the orchestrator's other run-scoped state. Only one paused
 * sub-task per run is supported — sequential execution means at most one
 * sub-task is in-flight at a time, so the "one pending decision per runId"
 * invariant holds for v1.
 *
 * Pause timeout (default 2 min, per session decision 2026-05-21): if the
 * user doesn't respond within the window, the promise resolves as
 * `{ kind: 'timeout' }` so the runner can emit `plan_failed` and free
 * memory. Aggressive vs. lenient is a deliberate UX trade-off captured in
 * CHANGELOG.
 */

/**
 * Decision delivered to a paused plan-runner. Covers two gates that share the
 * same one-pending-per-run primitive (they never overlap — execution is
 * sequential):
 *   - reactive dispute-retry (M10.5): `retry` | `cancel`;
 *   - opt-in review gate before payment (M11.4, ADR-0019): `approve` | `dispute`.
 * `timeout` is delivered by the registry itself when the window elapses.
 */
export type RetryAction =
  | { kind: 'retry'; newExecutor?: `0x${string}` }
  | { kind: 'cancel' }
  | { kind: 'approve' }
  | { kind: 'dispute'; reason: string }
  | { kind: 'timeout' };

interface PausedRun {
  readonly subId: number;
  readonly resolve: (action: RetryAction) => void;
  readonly timer: NodeJS.Timeout;
}

const paused = new Map<string, PausedRun>();

/**
 * Default pause window. 2 minutes — short enough that abandoned runs don't
 * accumulate, long enough for a human to read a dispute and click. Override
 * in tests via the `timeoutMs` parameter to `awaitUserDecision`.
 */
export const DEFAULT_PAUSE_TIMEOUT_MS = 2 * 60 * 1000;

/**
 * Block until either `resolveUserDecision` fires for `runId` or the timeout
 * elapses. Resolves to `{ kind: 'timeout' }` on timeout — callers (currently
 * just `plan-runner.ts`) handle all three cases.
 *
 * Throws synchronously if `runId` already has a pending decision — that
 * would indicate two sub-tasks paused simultaneously, which the sequential
 * runner is not supposed to allow. Treat it as a programming error.
 */
export function awaitUserDecision(
  runId: string,
  subId: number,
  timeoutMs: number = DEFAULT_PAUSE_TIMEOUT_MS,
): Promise<RetryAction> {
  if (paused.has(runId)) {
    throw new Error(
      `run-registry: runId ${runId} already has a pending decision (subId ${paused.get(runId)!.subId})`,
    );
  }
  return new Promise<RetryAction>((resolve) => {
    const timer = setTimeout(() => {
      // Timer first so resolve(timeout) cannot race with a late resolveUserDecision.
      paused.delete(runId);
      resolve({ kind: 'timeout' });
    }, timeoutMs);
    // Keep Node's event loop free to exit if this is the only outstanding work.
    timer.unref?.();
    paused.set(runId, { subId, resolve, timer });
  });
}

/**
 * Resolve the pending decision for `runId` with `action`. Returns:
 *   - `'ok'`        — pending decision matched the supplied `subId`, resolved.
 *   - `'not-found'` — no pending decision for this runId.
 *   - `'sub-mismatch'` — pending decision is for a different subId.
 *
 * The frontend always submits the subId it saw in `subtask_disputed`, so a
 * mismatch in practice means the user double-clicked retry after a different
 * sub-task came in (race) or the runner moved on. Returning a discriminated
 * status lets the endpoint reply with a meaningful 4xx instead of silently
 * dropping.
 */
export function resolveUserDecision(
  runId: string,
  subId: number,
  action: RetryAction,
): 'ok' | 'not-found' | 'sub-mismatch' {
  const pending = paused.get(runId);
  if (!pending) return 'not-found';
  if (pending.subId !== subId) return 'sub-mismatch';
  clearTimeout(pending.timer);
  paused.delete(runId);
  pending.resolve(action);
  return 'ok';
}

/** True when `runId` currently has a paused decision awaiting resolution. */
export function hasPendingDecision(runId: string): boolean {
  return paused.has(runId);
}

export const __testing = {
  /** Drop all in-flight pauses. Tests only — production never resets state. */
  clear(): void {
    for (const { timer } of paused.values()) clearTimeout(timer);
    paused.clear();
  },
  size(): number {
    return paused.size;
  },
};
