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
import {
  encodeEvaluationCase,
  decodeVerdict,
  type EvaluationVerdict,
} from '../shared/evaluation.js';
import type { WakeFn } from './wake.js';
import { encodeParentId, type EnvelopeContent } from './parent-id-codec.js';
import { scheduleReclaim } from './escrow-reclaim.js';
import { awaitUserDecision } from './run-registry.js';
import type { CouncilOutcome, CouncilVerdict } from './council.js';
import type { Capture } from '../shared/analytics.js';

type SageClientBundle = ReturnType<typeof createSageFromConfig>;

/**
 * Resolves a disputed sub-task end-to-end (ADR-0019): raise the dispute
 * on-chain, ask the council for a verdict, and have the arbiter execute
 * `resolveDispute`. Supplied by the orchestrator (which owns the V2 client +
 * council env); kept as an injected capability so the runner stays decoupled
 * and unit-testable.
 */
export interface DisputeResolution {
  readonly verdict: CouncilVerdict;
  readonly outcome: CouncilOutcome;
  /** USDC base units sent to the executor (full amount for worker, partial for split, 0 for client). */
  readonly executorShare: bigint;
  readonly disputeTxHash?: string;
  readonly resolveTxHash?: string;
}

export type DisputeFlow = (args: {
  readonly taskId: TaskId;
  readonly amount: bigint;
  readonly spec: string;
  readonly result: string;
  readonly reason: string;
}) => Promise<DisputeResolution>;

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
  /**
   * Opt-in review gate (ADR-0019). When true, each Completed sub-task pauses
   * before payment for an `approve | dispute` decision. When false/absent,
   * sub-tasks auto-approve (legacy behavior).
   */
  readonly reviewMode?: boolean;
  /**
   * Pause window for the review gate. Default {@link REVIEW_TIMEOUT_MS}.
   * On timeout the runner treats silence as approval (mirrors the protocol's
   * own auto-release-after-grace semantics).
   */
  readonly reviewTimeoutMs?: number;
  /**
   * Dispute resolver. Required for `reviewMode` to honor a `dispute` decision;
   * when absent, a dispute decision falls back to approval (degraded, logged).
   */
  readonly disputeFlow?: DisputeFlow;
  /**
   * Consent-gated server-side analytics capturer (ADR-0006). When provided,
   * authoritative lifecycle events (plan / subtask / dispute outcomes) are sent
   * to PostHog. No-op stub when analytics is off or the run has no consent.
   */
  readonly capture?: Capture;
  /**
   * Arbiter capability to settle a stranded `Disputed` escrow as a client
   * refund (code review 2026-06-09, CR.3 / M1). Wired unconditionally by
   * `executePlan`; when absent (tests, custom embeddings) the dispute-retry
   * path degrades to the legacy behavior of leaving the disputed escrow
   * unresolved (logged loudly).
   */
  readonly resolveStranded?: (taskId: TaskId) => Promise<string>;
  /**
   * Wake-ping for scale-to-zero workers (ADR-0020, M12.0.2). Called
   * fire-and-forget after each createTask, and re-called while a task sits in
   * Created (a lost first ping must not strand the sub-task until timeout).
   * Absent → legacy behavior: pure polling, no pings.
   */
  readonly wake?: WakeFn;
  /**
   * ADR-0007 run-level guards (M12.0.3). Defaults to {@link DEFAULT_RUN_CAPS};
   * the orchestrator overrides from env (MAX_RUN_SPEND_UNITS / MAX_RUN_TASKS /
   * MAX_PLAN_DEPTH).
   */
  readonly caps?: Partial<RunCaps>;
  /**
   * Delegation depth this run executes at. A user-initiated UI run is 1
   * (default). A future parent-as-worker re-entering the runner from a task
   * envelope passes `envelope.parent.depth + 1` — and is refused once it
   * exceeds `caps.maxDepth`. This is the recursion brake from ADR-0007.
   */
  readonly depth?: number;
}

/**
 * ADR-0007 run-level guards (M12.0.3). `checkPlanCaps` bounds what a plan
 * PROMISES at submission; this ledger bounds what a run actually DOES —
 * evaluator steps, dispute-retry re-spawns and future dynamic tasks all draw
 * from the same caps, so no path can spend past them. Checked BEFORE every
 * createTask: a breach fails the plan without committing new escrow.
 */
export interface RunCaps {
  /** Hard ceiling on total escrowed USDC base units per run. */
  readonly maxRunSpendUnits: bigint;
  /** Hard ceiling on createTask count per run (circuit breaker). */
  readonly maxRunTasks: number;
  /** Max delegation depth this runner may execute at (root UI run = 1). */
  readonly maxDepth: number;
}

/** Sized against checkPlanCaps defaults (2 USDC/plan) + evaluator/retry headroom. */
export const DEFAULT_RUN_CAPS: RunCaps = {
  maxRunSpendUnits: 3_000_000n, // 3 USDC
  maxRunTasks: 12,
  maxDepth: 1,
};

/** Dispute-retry circuit breaker: re-spawn at most this many times per sub-task. */
const MAX_DISPUTE_RETRIES = 2;

/**
 * Floor `deadline_offset_s` at 600s so we don't trip TaskEscrow's
 * `deadline <= block.timestamp` check when the LLM classifier emits a short
 * value (60-90s observed). Arc testnet block timestamps have inter-block
 * variance (multiple blocks can share a ts), so a 600s minimum absorbs mining
 * latency + accept-window. Same floor works fine on Base (~2s blocks). See
 * ADR-0015 verification + GOTCHAS 2026-05-22.
 */
const MIN_DEADLINE_OFFSET_S = 600;

function effectiveDeadlineOffset(offsetS: number): number {
  return Math.max(offsetS, MIN_DEADLINE_OFFSET_S);
}

interface RunLedger {
  spentUnits: bigint;
  tasksCreated: number;
}

/** Explicit polling interval. Do NOT lower below 10s — see GOTCHAS 2026-05-13. */
const POLL_INTERVAL_MS = 10_000;

/** Re-ping cadence while a task stays in Created (lost-wake recovery). */
const WAKE_REPING_MS = 60_000;

const DEFAULT_SUBTASK_TIMEOUT_MS = 5 * 60 * 1000;

/** Review-gate pause window (ADR-0019). Silence past this → treated as approval. */
const REVIEW_TIMEOUT_MS = 3 * 60 * 1000;

class PlanError extends Error {}

/**
 * Thrown when a disputed sub-task resolves to `client` (Refunded) — there is
 * no usable result to chain forward, so the plan fails (v1 semantics per
 * ADR-0019; auto-replan on refund is a later refinement). Distinct from
 * `DisputedError` (reactive retry path) and generic lifecycle errors.
 */
class RefundedError extends Error {
  constructor(public readonly subId: number, public readonly reasoning: string) {
    super(`subtask #${subId} refunded after dispute`);
  }
}

/**
 * Thrown by `pollUntilCompleted` when a sub-task transitions to `Disputed`.
 * Caught by the per-sub-task retry loop in `runPlan`, which pauses for a
 * user decision via `awaitUserDecision` and either retries or surfaces
 * `plan_failed`. Distinct class so we don't conflate disputes with other
 * lifecycle failures.
 */
class DisputedError extends Error {
  constructor(
    public readonly subId: number,
    public readonly taskId: TaskId,
  ) {
    super(`subtask #${subId} disputed`);
  }
}

/**
 * On-chain task spawned by this run. Tracked so failure paths know which
 * escrows are still unsettled (CR.3 / M2): `settled` flips to true once the
 * USDC provably moved (approvePayment / resolveDispute receipt verified).
 * Whatever remains unsettled when the plan fails is surfaced in the
 * `plan_failed` payload and handed to the best-effort reclaim sweep.
 */
interface SpawnedRecord {
  readonly subId: number;
  readonly taskId: TaskId;
  /** Unix seconds — on-chain deadline used at createTask. */
  readonly deadline: number;
  settled: boolean;
}

function markSettled(spawned: SpawnedRecord[], taskId: TaskId): void {
  const rec = spawned.find((r) => r.taskId === taskId);
  if (rec) rec.settled = true;
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
  const caps: RunCaps = { ...DEFAULT_RUN_CAPS, ...options.caps };
  const depth = options.depth ?? 1;

  // ADR-0007 recursion brake: refuse to execute past max delegation depth.
  // Thrown (not failPlan'd) like validatePlan — nothing has been spawned yet,
  // and executePlan's catch surfaces it as plan_failed.
  if (depth > caps.maxDepth) {
    throw new PlanError(
      `run depth ${depth} exceeds maxDepth ${caps.maxDepth} — nested delegation refused (ADR-0007)`,
    );
  }

  validatePlan(plan);

  // Evaluator rows (M12.0.3, ADR-0020 п.5) are pulled OUT of the execution
  // order: they don't run as standalone steps — runSubtask spawns one inline
  // when its evaluated sibling reaches Completed, and the verdict decides
  // between payment and the dispute hook.
  const executorRows = subtasks.filter((s) => s.evaluates === undefined);
  const evaluators = new Map(
    subtasks.filter((s) => s.evaluates !== undefined).map((e) => [e.evaluates!, e]),
  );

  const order = topoSort(executorRows);
  const ledger: RunLedger = { spentUnits: 0n, tasksCreated: 0 };

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
  options.capture?.('srv_plan_started', {
    subtask_count: subtasks.length,
    decomposability: plan.decomposability,
    stakes: plan.stakes,
    review_mode: options.reviewMode ?? false,
  });

  const results = new Map<number, string>();
  const txHashes: string[] = [];
  const spawned: SpawnedRecord[] = [];

  /**
   * Emit `plan_failed`, close the channel, and hand unsettled escrows to the
   * best-effort reclaim sweep. Every failure exit goes through here so the
   * orphaned-task list (CR.3 / M2) is never forgotten on a new failure path.
   */
  const failPlan = (args: { failedSubId: number; error: string; reason?: string }): void => {
    const orphans = spawned.filter((r) => !r.settled);
    const orphanedTasks = orphans.map((r) => ({
      subId: r.subId,
      taskId: r.taskId.toString(),
      deadline: r.deadline,
    }));
    channel.emit('plan_failed', {
      runId: options.runId,
      failedSubId: args.failedSubId,
      error: args.error,
      ...(args.reason ? { reason: args.reason } : {}),
      ...(orphanedTasks.length > 0 ? { orphanedTasks } : {}),
    });
    channel.close({
      runId: options.runId,
      ok: false,
      error: args.error,
      completedSubIds: Array.from(results.keys()),
      txHashes,
      ...(orphanedTasks.length > 0 ? { orphanedTasks } : {}),
    });
    if (orphans.length > 0) {
      scheduleReclaim(bundle, orphans, {
        runId: options.runId,
        ...(options.resolveStranded ? { resolveStranded: options.resolveStranded } : {}),
      });
    }
  };

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
          spawned,
          content: buildContent(currentSub, plan.brief, results),
          reviewMode: options.reviewMode ?? false,
          reviewTimeoutMs: options.reviewTimeoutMs ?? REVIEW_TIMEOUT_MS,
          caps,
          ledger,
          depth,
          evaluators,
          ...(options.disputeFlow ? { disputeFlow: options.disputeFlow } : {}),
          ...(options.capture ? { capture: options.capture } : {}),
          ...(options.wake ? { wake: options.wake } : {}),
        });
        results.set(sub.id, result);
        break;
      } catch (err) {
        if (err instanceof RefundedError) {
          // Council refunded the client — no usable result to continue with.
          const reason = `subtask #${sub.id} refunded after dispute: ${err.reasoning}`;
          options.capture?.('srv_plan_failed', { reason: 'dispute_refunded', failed_sub_id: sub.id });
          failPlan({ failedSubId: sub.id, error: reason, reason: 'dispute_refunded' });
          return;
        }
        if (err instanceof DisputedError) {
          // The disputed escrow holds USDC only the arbiter can release.
          // Settle it as a client refund BEFORE asking the user for a
          // decision (CR.3 / M1): a retry would otherwise stack a second
          // escrow on top of the unresolved one, and a cancel/timeout would
          // strand it. The user disputing means the result was rejected, so
          // refunding the client is the only outcome this gate supports.
          if (options.resolveStranded) {
            try {
              const reclaimHash = await options.resolveStranded(err.taskId);
              markSettled(spawned, err.taskId);
              channel.emit('subtask_escrow_reclaimed', {
                subId: sub.id,
                taskId: err.taskId.toString(),
                txHash: reclaimHash,
              });
            } catch (settleErr) {
              const detail = settleErr instanceof Error ? settleErr.message : String(settleErr);
              const reason = `subtask #${sub.id} disputed escrow could not be settled: ${detail}`;
              options.capture?.('srv_plan_failed', { reason: 'stranded_dispute', failed_sub_id: sub.id });
              failPlan({ failedSubId: sub.id, error: reason, reason: 'stranded_dispute' });
              return;
            }
          } else {
            console.error(
              JSON.stringify({
                ts: Date.now(),
                event: 'plan.dispute.no_stranded_resolver',
                subId: sub.id,
                taskId: err.taskId.toString(),
              }),
            );
          }
          const decision = await awaitUserDecision(options.runId, sub.id, 'dispute-retry');
          if (decision.kind === 'retry') {
            // Circuit breaker (ADR-0007): a sub-task that keeps getting
            // disputed must not re-spawn escrows forever.
            if (attempt > MAX_DISPUTE_RETRIES) {
              const reason = `subtask #${sub.id} exhausted ${MAX_DISPUTE_RETRIES} dispute retries`;
              options.capture?.('srv_plan_failed', { reason: 'retry_limit', failed_sub_id: sub.id });
              failPlan({ failedSubId: sub.id, error: reason, reason: 'retry_limit' });
              return;
            }
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
          const reasonTag =
            decision.kind === 'timeout' ? 'pause_timeout' : 'user_cancelled_after_dispute';
          options.capture?.('srv_plan_failed', { reason: reasonTag, failed_sub_id: sub.id });
          failPlan({ failedSubId: sub.id, error: reason, reason: reasonTag });
          return;
        }
        const message = err instanceof Error ? err.message : String(err);
        channel.emit('subtask_errored', { subId: sub.id, error: message });
        options.capture?.('srv_plan_failed', { reason: 'subtask_error', failed_sub_id: sub.id });
        failPlan({ failedSubId: sub.id, error: message });
        return;
      }
    }
  }

  channel.emit('plan_completed', { runId: options.runId, durationMs: Date.now() - startedAt });
  options.capture?.('srv_plan_completed', {
    duration_ms: Date.now() - startedAt,
    subtask_count: subtasks.length,
  });
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
  /** Per-run ledger of spawned escrows; see {@link SpawnedRecord}. */
  readonly spawned: SpawnedRecord[];
  /**
   * Content material attached to the envelope (ADR-0018). Dependent sub-tasks
   * carry `{inputs}` (upstream results); root sub-tasks carry `{source}` (the
   * original brief). Absent → spec-only (legacy behavior).
   */
  readonly content?: EnvelopeContent;
  /** Opt-in review gate before payment (ADR-0019). */
  readonly reviewMode?: boolean;
  readonly reviewTimeoutMs?: number;
  readonly disputeFlow?: DisputeFlow;
  /** Consent-gated server-side analytics capturer. */
  readonly capture?: Capture;
  /** Wake-ping for scale-to-zero workers — see {@link RunPlanOptions.wake}. */
  readonly wake?: WakeFn;
  /** Resolved run caps (ADR-0007 guards) — checked before every createTask. */
  readonly caps: RunCaps;
  /** Mutable per-run spend/count ledger shared across all spawns of this run. */
  readonly ledger: RunLedger;
  /** Delegation depth of this run — stamped into every sub-task envelope. */
  readonly depth: number;
  /** Evaluator rows keyed by the sub-task id they judge (M12.0.3). */
  readonly evaluators?: ReadonlyMap<number, SubTask>;
}

/**
 * Charge an intended createTask against the run ledger, or throw PlanError
 * BEFORE any escrow is committed. One door for every spawn path (sub-tasks
 * today; evaluator steps and dispute re-spawns draw from the same caps).
 */
function chargeLedger(ledger: RunLedger, caps: RunCaps, amount: bigint, label: string): void {
  if (ledger.tasksCreated + 1 > caps.maxRunTasks) {
    throw new PlanError(
      `${label} would exceed maxRunTasks ${caps.maxRunTasks} — run circuit breaker tripped (ADR-0007)`,
    );
  }
  if (ledger.spentUnits + amount > caps.maxRunSpendUnits) {
    throw new PlanError(
      `${label} (${amount} units) would push run spend past ${caps.maxRunSpendUnits} base units — budget cap (ADR-0007)`,
    );
  }
  ledger.tasksCreated += 1;
  ledger.spentUnits += amount;
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

/**
 * Signature of a createTask tx that mined but reverted: the adapter waits for
 * the receipt, finds no `TaskCreated` event, and throws this. The usual cause
 * is a USDC permit signed against a stale nonce read (see createTask call site)
 * — a transient, retryable condition, distinct from a network error or a
 * persistent failure (bad params, RPC down), which should NOT be retried.
 */
function isRetryableCreateError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return msg.includes('TaskCreated event not found');
}

/**
 * Run an async action, retrying once (after a delay) only when `retryable`
 * matches the thrown error. The delay lets a lagging RPC replica catch up; the
 * retry re-runs the action from scratch — for createTask that re-signs the
 * permit against the now-current nonce.
 */
async function withRetry<T>(
  action: () => Promise<T>,
  opts: { label: string; subId: number; delayMs?: number; retryable: (err: unknown) => boolean },
): Promise<T> {
  try {
    return await action();
  } catch (err) {
    if (!opts.retryable(err)) throw err;
    const reason = err instanceof Error ? err.message : String(err);
    console.error(
      JSON.stringify({ ts: Date.now(), event: 'plan.retry', label: opts.label, subId: opts.subId, reason: reason.slice(0, 160) }),
    );
    await new Promise((resolve) => setTimeout(resolve, opts.delayMs ?? 4000));
    return action();
  }
}

/**
 * Wait for a tx receipt and throw when the tx mined but reverted. Without the
 * status check a reverted approvePayment would be reported to the stream (and
 * analytics) as success while the escrow stays unsettled on-chain — code
 * review 2026-06-09, finding H3. The wait itself also keeps the next
 * sponsor-side tx from reusing a still-pending nonce.
 */
async function waitReceiptOrThrow(
  bundle: SageClientBundle,
  hash: string,
  label: string,
): Promise<void> {
  const receipt = await bundle.publicClient.waitForTransactionReceipt({
    hash: hash as `0x${string}`,
  });
  if (receipt.status === 'reverted') {
    throw new PlanError(`${label} reverted on-chain (tx ${hash})`);
  }
}

async function runSubtask(args: RunSubtaskArgs): Promise<string> {
  const { sub, runId, bundle, channel, timeoutMs, txHashes } = args;
  if (!sub.executor_address) {
    throw new PlanError(`subtask #${sub.id} has no executor_address`);
  }
  if (sub.estimated_cost_units <= 0n) {
    throw new PlanError(`subtask #${sub.id} estimated_cost_units must be > 0`);
  }

  // Run-level guards fire BEFORE the escrow tx — a tripped cap costs nothing.
  chargeLedger(args.ledger, args.caps, sub.estimated_cost_units, `createTask#${sub.id}`);

  const specUri = encodeParentId(
    { run: runId, sub: sub.id, depth: args.depth },
    sub.spec,
    args.content,
  );
  const deadline = Math.floor(Date.now() / 1000) + effectiveDeadlineOffset(sub.deadline_offset_s);

  channel.emit('subtask_status', { subId: sub.id, status: 'created' satisfies SubTaskRunStatus });

  // createTask carries a freshly-signed USDC permit whose nonce is read from
  // the RPC at sign-time. Immediately after a burst of sponsor txs (notably the
  // dispute path's disputeTask + resolveDispute, which fire just before the
  // next sub-task with no buffer), that read can land on a lagging replica and
  // produce a permit signed against a stale nonce — the tx then mines and
  // reverts in `USDC.permit`, surfacing as "TaskCreated event not found in
  // receipt". The auto-approve path doesn't hit this because the approvePayment
  // receipt-wait gives the replica time to catch up. Retry once: the re-sign
  // reads the nonce fresh. (Observed intermittently in M11.4 review-mode runs.)
  const tid = await withRetry(
    () =>
      bundle.sage.tasks.createTask({
        executor: agentId(sub.executor_address as `0x${string}`),
        deadline,
        amount: sub.estimated_cost_units,
        specUri,
      }),
    { label: `createTask#${sub.id}`, subId: sub.id, retryable: isRetryableCreateError },
  );

  args.spawned.push({ subId: sub.id, taskId: tid, deadline, settled: false });

  // Wake the (possibly stopped, scale-to-zero) worker hosting this executor.
  // Fire-and-forget: a lost ping is recovered by the re-ping below and by the
  // worker's boot reconciliation (ADR-0020 п.4).
  args.wake?.(sub.executor_address, { taskId: tid.toString() });

  channel.emit('subtask_created', {
    subId: sub.id,
    taskId: tid.toString(),
    executor: sub.executor_address,
    amount: sub.estimated_cost_units.toString(),
    deadline,
  });

  const resultUri = await pollUntilCompleted(bundle, tid, channel, sub.id, timeoutMs, {
    ...(args.wake ? { wake: args.wake } : {}),
    executor: sub.executor_address,
  });
  const result = decodeResult(resultUri);

  // Evaluator step (M12.0.3, ADR-0020 п.5): the evaluated step's payment is
  // withheld until a paid sibling evaluator returns a verdict. Pass → fall
  // through to the (review gate and) payment; fail → the existing dispute →
  // council hook with the verdict's reasons; evaluator breakage → degrade to
  // the legacy path (logged + surfaced) — an evaluator must never wedge a run.
  const evaluator = args.evaluators?.get(sub.id);
  if (evaluator) {
    const verdict = await runEvaluatorStep(args, evaluator, { sub, tid, result });
    if (verdict && !verdict.pass) {
      const reason =
        verdict.reasons.length > 0
          ? `evaluator #${evaluator.id}: ${verdict.reasons.join('; ')}`
          : `evaluator #${evaluator.id} rejected the result`;
      return runDisputeFlow(args, tid, result, reason);
    }
  }

  // Review gate (ADR-0019): pause for an approve/dispute decision before paying.
  // Silence past the window = approval (mirrors on-chain auto-release-after-grace).
  if (args.reviewMode) {
    channel.emit('subtask_awaiting_review', {
      subId: sub.id,
      taskId: tid.toString(),
      resultUri,
      result,
    });
    const decision = await awaitUserDecision(
      runId,
      sub.id,
      'review',
      args.reviewTimeoutMs ?? REVIEW_TIMEOUT_MS,
    );
    if (decision.kind === 'dispute') {
      return runDisputeFlow(args, tid, result, decision.reason);
    }
    // Only an explicit approval (or the silence-equals-approval timeout) may
    // release payment. The registry's gate typing rejects retry/cancel here
    // ('wrong-gate'), so this throw is a defensive backstop — money must
    // never move on an unrecognized decision kind (review finding H2).
    if (decision.kind !== 'approve' && decision.kind !== 'timeout') {
      throw new PlanError(
        `subtask #${sub.id} review gate received unexpected decision "${decision.kind}"`,
      );
    }
  }

  const approveHash = await bundle.sage.tasks.approvePayment(tid);
  txHashes.push(approveHash);
  // Verify the receipt BEFORE emitting subtask_paid — a mined-but-reverted
  // approvePayment must surface as plan_failed, not as a success event.
  await waitReceiptOrThrow(bundle, approveHash, `approvePayment for subtask #${sub.id}`);
  markSettled(args.spawned, tid);
  channel.emit('subtask_paid', {
    subId: sub.id,
    taskId: tid.toString(),
    txHash: approveHash,
  });
  channel.emit('subtask_status', { subId: sub.id, status: 'paid' satisfies SubTaskRunStatus });
  args.capture?.('srv_subtask_paid', {
    sub_id: sub.id,
    type: sub.type,
    executor: sub.executor_address,
    amount_units: sub.estimated_cost_units.toString(),
    disputed: false,
  });

  return result;
}

/**
 * Spawn the paid evaluator task for a Completed sub-task and return its
 * verdict (M12.0.3, ADR-0020 п.5).
 *
 * The evaluator is an ordinary escrow task on an ordinary worker identity:
 * createTask → poll → approvePayment. It is paid for the VERDICT, not the
 * outcome — paying only on `pass` would give it a reason to always pass.
 *
 * Material rides the ADR-0018 `inputs` channel as an {@link EvaluationCase}
 * (the judged step's instruction + result); the verdict comes back as an
 * {@link EvaluationVerdict} envelope in the result.
 *
 * Failure posture: a tripped run cap propagates (PlanError → plan fails —
 * budget guards outrank evaluation). Any RUNTIME failure — timeout, garbage
 * verdict, payment revert — returns `null` and the caller degrades to the
 * legacy approve path: evaluation is an upgrade, not a new wedge point.
 */
async function runEvaluatorStep(
  args: RunSubtaskArgs,
  evalSub: SubTask,
  judged: { sub: SubTask; tid: TaskId; result: string },
): Promise<EvaluationVerdict | null> {
  const { bundle, channel, runId, txHashes } = args;

  const degrade = (why: string): null => {
    console.error(
      JSON.stringify({
        ts: Date.now(),
        event: 'plan.evaluator.degraded',
        runId,
        evaluatorSubId: evalSub.id,
        judgedSubId: judged.sub.id,
        why: why.slice(0, 200),
      }),
    );
    channel.emit('subtask_verdict', {
      subId: judged.sub.id,
      evaluatorSubId: evalSub.id,
      taskId: judged.tid.toString(),
      degraded: true,
      why,
    });
    return null;
  };

  if (!evalSub.executor_address) {
    return degrade(`evaluator #${evalSub.id} has no executor_address`);
  }

  // Run caps come FIRST and propagate on breach — see failure posture above.
  chargeLedger(args.ledger, args.caps, evalSub.estimated_cost_units, `evaluator#${evalSub.id}`);

  try {
    const specUri = encodeParentId({ run: runId, sub: evalSub.id, depth: args.depth }, evalSub.spec, {
      inputs: {
        [judged.sub.id]: encodeEvaluationCase({
          instruction: judged.sub.spec,
          result: judged.result,
        }),
      },
    });
    const deadline =
      Math.floor(Date.now() / 1000) + effectiveDeadlineOffset(evalSub.deadline_offset_s);

    channel.emit('subtask_status', { subId: evalSub.id, status: 'created' satisfies SubTaskRunStatus });
    const etid = await withRetry(
      () =>
        bundle.sage.tasks.createTask({
          executor: agentId(evalSub.executor_address as `0x${string}`),
          deadline,
          amount: evalSub.estimated_cost_units,
          specUri,
        }),
      { label: `createTask#evaluator${evalSub.id}`, subId: evalSub.id, retryable: isRetryableCreateError },
    );
    args.spawned.push({ subId: evalSub.id, taskId: etid, deadline, settled: false });
    args.wake?.(evalSub.executor_address, { taskId: etid.toString() });
    channel.emit('subtask_created', {
      subId: evalSub.id,
      taskId: etid.toString(),
      executor: evalSub.executor_address,
      amount: evalSub.estimated_cost_units.toString(),
      deadline,
      evaluates: judged.sub.id,
    });

    const evalResultUri = await pollUntilCompleted(bundle, etid, channel, evalSub.id, args.timeoutMs, {
      ...(args.wake ? { wake: args.wake } : {}),
      executor: evalSub.executor_address,
    });

    // Pay the evaluator before acting on the verdict (paid-for-verdict).
    const approveHash = await bundle.sage.tasks.approvePayment(etid);
    txHashes.push(approveHash);
    await waitReceiptOrThrow(bundle, approveHash, `approvePayment for evaluator #${evalSub.id}`);
    markSettled(args.spawned, etid);
    channel.emit('subtask_paid', { subId: evalSub.id, taskId: etid.toString(), txHash: approveHash });
    channel.emit('subtask_status', { subId: evalSub.id, status: 'paid' satisfies SubTaskRunStatus });

    const verdict = decodeVerdict(decodeResult(evalResultUri));
    if (!verdict) {
      return degrade(`evaluator #${evalSub.id} returned an undecodable verdict`);
    }

    channel.emit('subtask_verdict', {
      subId: judged.sub.id,
      evaluatorSubId: evalSub.id,
      taskId: judged.tid.toString(),
      pass: verdict.pass,
      reasons: verdict.reasons,
      ...(verdict.score !== undefined ? { score: verdict.score } : {}),
      ...(verdict.screenshot !== undefined ? { screenshot: verdict.screenshot } : {}),
    });
    args.capture?.('srv_subtask_verdict', {
      sub_id: judged.sub.id,
      evaluator_sub_id: evalSub.id,
      pass: verdict.pass,
    });
    return verdict;
  } catch (err) {
    if (err instanceof DisputedError) {
      // Someone disputed the EVALUATOR task itself — exotic; degrade rather
      // than entering the dispute-retry path meant for executor steps.
      return degrade(`evaluator #${evalSub.id} task was disputed externally`);
    }
    const message = err instanceof Error ? err.message : String(err);
    return degrade(`evaluator #${evalSub.id} lifecycle failed: ${message}`);
  }
}

/**
 * Drive a disputed sub-task to resolution (ADR-0019): the injected
 * `disputeFlow` raises the dispute on-chain, asks the council, and has the
 * arbiter execute `resolveDispute` (each with its own receipt wait). We then
 * surface the verdict and either continue (worker/split → result usable) or
 * throw `RefundedError` (client → plan fails).
 *
 * Degrades to approval when no `disputeFlow` is wired, so funds never strand.
 */
async function runDisputeFlow(
  args: RunSubtaskArgs,
  tid: TaskId,
  result: string,
  reason: string,
): Promise<string> {
  const { sub, bundle, channel, txHashes, disputeFlow } = args;

  if (!disputeFlow) {
    console.error(JSON.stringify({ ts: Date.now(), event: 'plan.dispute.no_resolver', subId: sub.id }));
    const approveHash = await bundle.sage.tasks.approvePayment(tid);
    txHashes.push(approveHash);
    await waitReceiptOrThrow(bundle, approveHash, `approvePayment for subtask #${sub.id}`);
    markSettled(args.spawned, tid);
    channel.emit('subtask_paid', { subId: sub.id, taskId: tid.toString(), txHash: approveHash });
    channel.emit('subtask_status', { subId: sub.id, status: 'paid' satisfies SubTaskRunStatus });
    return result;
  }

  channel.emit('subtask_dispute_raised', { subId: sub.id, taskId: tid.toString(), reason });
  channel.emit('subtask_status', { subId: sub.id, status: 'disputed' satisfies SubTaskRunStatus });
  args.capture?.('srv_dispute_raised', { sub_id: sub.id, type: sub.type });

  const resolution = await disputeFlow({
    taskId: tid,
    amount: sub.estimated_cost_units,
    spec: sub.spec,
    result,
    reason,
  });
  if (resolution.disputeTxHash) txHashes.push(resolution.disputeTxHash);
  if (resolution.resolveTxHash) txHashes.push(resolution.resolveTxHash);
  // Whatever the verdict (worker/split/client), resolveDispute moved the
  // escrowed USDC — the task is settled on-chain.
  markSettled(args.spawned, tid);

  channel.emit('subtask_dispute_resolved', {
    subId: sub.id,
    taskId: tid.toString(),
    outcome: resolution.outcome,
    executorShare: resolution.executorShare.toString(),
    ...(resolution.verdict.executorSharePct !== undefined
      ? { executorSharePct: resolution.verdict.executorSharePct }
      : {}),
    reasoning: resolution.verdict.reasoning,
    ...(resolution.resolveTxHash ? { txHash: resolution.resolveTxHash } : {}),
  });
  args.capture?.('srv_dispute_resolved', {
    sub_id: sub.id,
    type: sub.type,
    outcome: resolution.outcome,
    executor_share_units: resolution.executorShare.toString(),
    ...(resolution.verdict.executorSharePct !== undefined
      ? { executor_share_pct: resolution.verdict.executorSharePct }
      : {}),
  });

  if (resolution.outcome === 'client') {
    channel.emit('subtask_refunded', {
      subId: sub.id,
      taskId: tid.toString(),
      ...(resolution.resolveTxHash ? { txHash: resolution.resolveTxHash } : {}),
    });
    channel.emit('subtask_status', { subId: sub.id, status: 'errored' satisfies SubTaskRunStatus });
    args.capture?.('srv_subtask_refunded', { sub_id: sub.id, type: sub.type });
    throw new RefundedError(sub.id, resolution.verdict.reasoning);
  }

  // worker (Paid) or split (Split): executor received (some) funds, result usable.
  channel.emit('subtask_paid', {
    subId: sub.id,
    taskId: tid.toString(),
    executorShare: resolution.executorShare.toString(),
    ...(resolution.resolveTxHash ? { txHash: resolution.resolveTxHash } : {}),
  });
  channel.emit('subtask_status', { subId: sub.id, status: 'paid' satisfies SubTaskRunStatus });
  args.capture?.('srv_subtask_paid', {
    sub_id: sub.id,
    type: sub.type,
    executor: sub.executor_address,
    amount_units: resolution.executorShare.toString(),
    disputed: true,
    outcome: resolution.outcome,
  });
  return result;
}

async function pollUntilCompleted(
  bundle: SageClientBundle,
  taskId: TaskId,
  channel: SseChannel,
  subId: number,
  timeoutMs: number,
  wakeOpts?: { wake?: WakeFn; executor?: string },
): Promise<string> {
  const start = Date.now();
  let lastStatus: TaskStatus | null = null;
  // The createTask-time ping counts as the first one.
  let lastWakeAt = Date.now();

  while (Date.now() - start < timeoutMs) {
    const task = await bundle.sage.tasks.getTask(taskId);

    // Re-ping while the task sits unaccepted: the initial wake may have been
    // lost, or the woken machine may have idle-exited before noticing it.
    const unaccepted = !task || task.status === TaskStatus.Created;
    if (unaccepted && wakeOpts?.wake && wakeOpts.executor && Date.now() - lastWakeAt >= WAKE_REPING_MS) {
      lastWakeAt = Date.now();
      wakeOpts.wake(wakeOpts.executor, { taskId: taskId.toString() });
    }

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
        throw new DisputedError(subId, taskId);
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
  const evaluatorIds = new Set(
    plan.subtasks.filter((s) => s.evaluates !== undefined).map((s) => s.id),
  );
  for (const s of plan.subtasks) {
    for (const dep of s.depends_on ?? []) {
      if (!ids.has(dep)) {
        throw new PlanError(`subtask #${s.id} depends on unknown id ${dep}`);
      }
      if (dep === s.id) {
        throw new PlanError(`subtask #${s.id} depends on itself`);
      }
      // Evaluator rows never enter the execution order and never produce
      // chainable results — depending on one would deadlock the topo sort.
      if (evaluatorIds.has(dep)) {
        throw new PlanError(`subtask #${s.id} depends on evaluator #${dep} — evaluator verdicts are not chainable results`);
      }
    }
  }
  // Evaluator referential rules (M12.0.3).
  const evaluatedTargets = new Set<number>();
  for (const s of plan.subtasks) {
    if (s.evaluates === undefined) continue;
    if (s.evaluates === s.id) {
      throw new PlanError(`evaluator #${s.id} evaluates itself`);
    }
    if (!ids.has(s.evaluates)) {
      throw new PlanError(`evaluator #${s.id} evaluates unknown id ${s.evaluates}`);
    }
    if (evaluatorIds.has(s.evaluates)) {
      throw new PlanError(`evaluator #${s.id} evaluates evaluator #${s.evaluates} — nested evaluation is not supported`);
    }
    if (evaluatedTargets.has(s.evaluates)) {
      throw new PlanError(`subtask #${s.evaluates} has more than one evaluator`);
    }
    evaluatedTargets.add(s.evaluates);
    if (s.depends_on && s.depends_on.length > 0) {
      throw new PlanError(`evaluator #${s.id} must not declare depends_on — it implicitly follows its target`);
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
  WAKE_REPING_MS,
  MAX_DISPUTE_RETRIES,
  chargeLedger,
  topoSort,
  validatePlan,
  decodeResult,
  POLL_INTERVAL_MS,
  DEFAULT_SUBTASK_TIMEOUT_MS,
};
