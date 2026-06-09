'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import * as Sentry from '@sentry/nextjs';

import { track, readConsent } from '@/lib/posthog';

/**
 * Capture an exception to Sentry with the composite-flow tags so we can
 * filter `phase=classify` or `phase=execute` separately in the dashboard.
 * Falls back to a no-op when the DSN env var is unset (local dev) per
 * `sentry.client.config.ts`.
 */
function captureCompositeError(
  err: unknown,
  phase: 'classify' | 'execute' | 'subtask',
  extras: Record<string, unknown> = {},
): void {
  Sentry.captureException(err, {
    tags: { flow: 'composite', phase },
    extra: extras,
  });
}

/**
 * Drives the composite (observable-decomposition) demo against the parent-agent
 * backend endpoints added in M10.2.6.
 *
 * Three phases the user can step through:
 *
 *   1. classify
 *      POST /api/demo/composite/classify { brief } → ClassificationResult
 *      The plan-card renders from this. User reviews / edits, then approves.
 *
 *   2. execute
 *      POST /api/demo/composite/execute  { Plan }   → { runId, streamUrl }
 *      Plan is what the user approved (possibly edited). Server kicks off
 *      `runPlan` in the background and returns immediately.
 *
 *   3. stream
 *      EventSource /api/demo/composite/stream/:runId
 *      Lifecycle events get folded into `runtimes[subId]` so the plan-graph
 *      colors nodes live as on-chain TaskEscrow records progress.
 *
 * Status machine:
 *   idle → classifying → plan-ready → executing → completed | error
 *                                  ↘ idle  (user cancel)
 *
 * The shape mirrors `DemoState` from `use-demo-stream.ts` where it makes
 * sense (events list, chain metadata, status string) so existing layout
 * primitives can be reused mode-agnostically.
 */

const ORCHESTRATOR_URL =
  process.env.NEXT_PUBLIC_ORCHESTRATOR_URL ?? 'http://localhost:3000';

/**
 * Worker gateway routes `?chain=arc` to the sibling Fly app per ADR-0015.
 * Empty string for Base chains lets us concat without checking — the
 * Worker treats absence and `chain=base` identically.
 */
function chainQs(chainId: number): string {
  return chainId === 5042002 ? '?chain=arc' : '';
}

/**
 * Build an upstream URL that carries the chain selector. Used for the
 * three POST endpoints (`/classify`, `/execute`, `/retry-subtask`) and to
 * decorate the relative SSE URL returned by `/execute`.
 */
function urlFor(path: string, chainId: number): string {
  const base = path.startsWith('http') ? path : `${ORCHESTRATOR_URL}${path}`;
  const qs = chainQs(chainId);
  if (!qs) return base;
  return base.includes('?') ? `${base}&${qs.slice(1)}` : `${base}${qs}`;
}

export type CompositeStatus =
  | 'idle'
  | 'classifying'
  | 'plan-ready'
  | 'executing'
  | 'completed'
  | 'error';

export type SubTaskRunStatus =
  | 'waiting'
  | 'created'
  | 'accepted'
  | 'completed'
  | 'awaiting-review'
  | 'paid'
  | 'errored'
  | 'disputed'
  | 'refunded';

/** Council verdict surfaced for a disputed sub-task (ADR-0019). */
export interface SubTaskVerdict {
  outcome: 'worker' | 'client' | 'split';
  reasoning: string;
  executorSharePct?: number;
}

/**
 * Wire-format SubTask — cost fields as decimal strings (JSON has no bigint).
 * Mirrors `SubTask` from `@sage/core` for everything except the bigint→string
 * promotion. The plan-runner on the backend converts back.
 */
export interface WireSubTask {
  id: number;
  type: string;
  executor_address?: `0x${string}`;
  estimated_cost_units: string;
  deadline_offset_s: number;
  depends_on?: number[];
  spec: string;
}

export interface WireClassification {
  decomposability: 'one-shot' | 'composite';
  stakes: 'low' | 'high';
  confidence_decomposability: number;
  confidence_stakes: number;
  estimated_total_cost_units: string;
  estimated_duration_ms: number;
  proposed_plan: WireSubTask[];
  reasoning: string;
  signal_trace: { lexical: string[]; semantic: string[]; stakes: string[] };
}

export interface WirePlan {
  brief: string;
  decomposability: 'one-shot' | 'composite';
  stakes: 'low' | 'high';
  subtasks: WireSubTask[];
  estimated_total_cost_units: string;
  estimated_duration_ms: number;
}

export interface SubTaskRuntime {
  status: SubTaskRunStatus;
  taskId?: string;
  resultUri?: string;
  /** Decoded `result` text when `resultUri` is `data:text/plain,…`. Raw URI otherwise. */
  result?: string;
  /** Tx hashes accumulated for this sub-task (currently just the approvePayment hash). */
  txHashes: string[];
  startedAt?: number;
  completedAt?: number;
  error?: string;
  /** Council verdict, set when a disputed sub-task is resolved (ADR-0019). */
  verdict?: SubTaskVerdict;
}

export interface CompositeEvent {
  id: number;
  event: string;
  data: Record<string, unknown>;
  receivedAt: number;
}

export interface CompositeState {
  status: CompositeStatus;
  /** Raw classifier output (before user edits). Source of truth for plan-card. */
  classification: WireClassification | null;
  /** Plan the user actually approved (post-edit). Set when execute is called. */
  plan: WirePlan | null;
  runId: string | null;
  /** Per-subtask runtime, keyed by SubTask.id. */
  runtimes: Record<number, SubTaskRuntime>;
  events: CompositeEvent[];
  chainId: number | null;
  chainName: string | null;
  explorerUrl: string | null;
  error: string | null;
  startedAt: number | null;
  completedAt: number | null;
  /**
   * Sub-task that just transitioned to `disputed` and needs user attention.
   * Drives the inline `replan-prompt` UI (M10.4.3). Reset when the user
   * picks an action.
   */
  disputedSubId: number | null;
  /**
   * Sub-task paused at the review gate (ADR-0019), awaiting an approve/dispute
   * decision. Drives the review-prompt UI. Reset once the user decides.
   */
  awaitingReviewSubId: number | null;
}

const INITIAL_STATE: CompositeState = {
  status: 'idle',
  classification: null,
  plan: null,
  runId: null,
  runtimes: {},
  events: [],
  chainId: null,
  chainName: null,
  explorerUrl: null,
  error: null,
  startedAt: null,
  completedAt: null,
  disputedSubId: null,
  awaitingReviewSubId: null,
};

export function useCompositeDemo(chainId: number) {
  const [state, setState] = useState<CompositeState>(INITIAL_STATE);
  const esRef = useRef<EventSource | null>(null);
  const eventIdRef = useRef(0);
  // Freeze the chain at classify-time so a mid-run picker change can't
  // misroute approve/execute/retry. The page UI also disables the picker
  // once status !== 'idle' — this ref is a belt-and-braces backstop.
  const runChainRef = useRef<number>(chainId);

  /** POST /classify. Status: idle → classifying → plan-ready | error. */
  const classify = useCallback(async (brief: string): Promise<void> => {
    closeStream(esRef);
    eventIdRef.current = 0;
    runChainRef.current = chainId;
    setState({ ...INITIAL_STATE, status: 'classifying' });
    track('composite_classify_started', { brief_len: brief.length, chain_id: chainId });
    const startedAt = Date.now();

    try {
      const res = await fetch(urlFor('/api/demo/composite/classify', chainId), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ brief }),
      });
      if (!res.ok) {
        const body = (await safeJson(res)) as { error?: string };
        throw new Error(body?.error ?? `Backend returned ${res.status}`);
      }
      const data = (await res.json()) as { classification: WireClassification };
      const c = data.classification;
      track('composite_classify_completed', {
        decomposability: c.decomposability,
        stakes: c.stakes,
        confidence_decomposability: c.confidence_decomposability,
        confidence_stakes: c.confidence_stakes,
        subtask_count: c.proposed_plan.length,
        duration_ms: Date.now() - startedAt,
      });
      setState((prev) => ({
        ...prev,
        status: 'plan-ready',
        classification: c,
      }));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      track('composite_run_errored', { phase: 'classify', error: message });
      captureCompositeError(err, 'classify', { brief_len: brief.length });
      setState((prev) => ({
        ...prev,
        status: 'error',
        error: message,
      }));
    }
  }, [chainId]);

  /**
   * POST /execute with the (possibly user-edited) `Plan`. Status: plan-ready → executing.
   * Opens an EventSource to the returned `streamUrl` and folds lifecycle
   * events into `runtimes[subId]`.
   */
  const approve = useCallback(async (plan: WirePlan, reviewMode = false): Promise<void> => {
    const runChainId = runChainRef.current;
    track('composite_plan_approved', {
      decomposability: plan.decomposability,
      stakes: plan.stakes,
      subtask_count: plan.subtasks.length,
      estimated_total_cost_units: plan.estimated_total_cost_units,
      review_mode: reviewMode,
      chain_id: runChainId,
    });
    setState((prev) => ({ ...prev, status: 'executing', plan, runtimes: {} }));
    try {
      const res = await fetch(urlFor('/api/demo/composite/execute', runChainId), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // Forward cookie-consent so the orchestrator only captures server-side
        // analytics for this run when the user has opted in (ADR-0006).
        body: JSON.stringify({ ...plan, reviewMode, analyticsConsent: readConsent() === 'granted' }),
      });
      if (!res.ok) {
        const body = (await safeJson(res)) as { error?: string; message?: string };
        throw new Error(body?.message ?? body?.error ?? `Backend returned ${res.status}`);
      }
      const data = (await res.json()) as {
        runId: string;
        streamUrl: string;
        chainId?: number;
        chainName?: string;
        explorerUrl?: string;
      };

      setState((prev) => ({
        ...prev,
        runId: data.runId,
        chainId: data.chainId ?? null,
        chainName: data.chainName ?? null,
        explorerUrl: data.explorerUrl ?? null,
        startedAt: Date.now(),
        // Seed every sub-task at waiting so the graph renders all nodes upfront.
        runtimes: Object.fromEntries(
          plan.subtasks.map((s) => [s.id, { status: 'waiting', txHashes: [] }]),
        ),
      }));

      attachStream(data.streamUrl, runChainId, setState, esRef, eventIdRef);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      track('composite_run_errored', { phase: 'execute', error: message });
      captureCompositeError(err, 'execute', {
        subtask_count: plan.subtasks.length,
        decomposability: plan.decomposability,
        stakes: plan.stakes,
      });
      setState((prev) => ({
        ...prev,
        status: 'error',
        error: message,
      }));
    }
  }, []);

  /** User clicked Cancel on the plan card. Returns to idle. */
  const cancel = useCallback(() => {
    track('composite_plan_cancelled', {});
    closeStream(esRef);
    setState(INITIAL_STATE);
  }, []);

  /**
   * Resolve a paused dispute via the M10.5.A `/composite/retry-subtask`
   * endpoint. `subId` must match the currently disputed sub-task. Optional
   * `newExecutorAddress` swaps the executor on re-spawn. The SSE channel
   * stays attached — the runner emits `subtask_retrying` once the decision
   * lands, which the handler below uses to reset the runtime row.
   *
   * Errors surface inline (sets `state.error`) but do not tear down the
   * run; the user can retry the request or pick Cancel from the prompt.
   */
  const retry = useCallback(
    async (opts: {
      subId: number;
      newExecutorAddress?: `0x${string}`;
    }): Promise<void> => {
      const runId = state.runId;
      if (!runId) {
        setState((prev) => ({ ...prev, error: 'Cannot retry: no active run.' }));
        return;
      }
      const runChainId = runChainRef.current;
      track('composite_subtask_retry_requested', {
        subId: opts.subId,
        hasNewExecutor: !!opts.newExecutorAddress,
        chain_id: runChainId,
      });
      // Clear a stale banner from a previous failed attempt — a successful
      // re-submit should leave no error on screen.
      setState((prev) => ({ ...prev, error: null }));
      try {
        const res = await fetch(urlFor('/api/demo/composite/retry-subtask', runChainId), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            runId,
            subId: opts.subId,
            action: 'retry',
            ...(opts.newExecutorAddress
              ? { newExecutorAddress: opts.newExecutorAddress }
              : {}),
          }),
        });
        if (!res.ok) {
          const body = (await safeJson(res)) as { error?: string; message?: string };
          throw new Error(
            body?.message ?? body?.error ?? `Backend returned ${res.status}`,
          );
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        captureCompositeError(err, 'subtask', {
          subId: opts.subId,
          retry_failed: true,
        });
        setState((prev) => ({
          ...prev,
          error: `Retry failed: ${message}`,
        }));
      }
    },
    [state.runId],
  );

  /**
   * Resolve a review gate (ADR-0019). `approve` → the orchestrator pays the
   * executor; `dispute` (with an optional `reason`) → the orchestrator raises
   * the dispute on-chain, the council judges, and the arbiter resolves it.
   * The SSE channel stays attached — `subtask_dispute_resolved` / `subtask_paid`
   * / `subtask_refunded` report the outcome.
   */
  const submitReview = useCallback(
    async (opts: { subId: number; action: 'approve' | 'dispute'; reason?: string }): Promise<void> => {
      const runId = state.runId;
      if (!runId) {
        setState((prev) => ({ ...prev, error: 'Cannot submit review: no active run.' }));
        return;
      }
      const runChainId = runChainRef.current;
      track('composite_review_decision', {
        subId: opts.subId,
        action: opts.action,
        chain_id: runChainId,
      });
      // Optimistically clear the prompt so the user isn't double-prompted.
      // Also clear a stale error banner from a previous failed attempt.
      setState((prev) => ({ ...prev, awaitingReviewSubId: null, error: null }));
      try {
        const res = await fetch(urlFor('/api/demo/composite/review-decision', runChainId), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            runId,
            subId: opts.subId,
            action: opts.action,
            ...(opts.action === 'dispute' && opts.reason ? { reason: opts.reason } : {}),
          }),
        });
        if (!res.ok) {
          const body = (await safeJson(res)) as { error?: string; message?: string };
          throw new Error(body?.message ?? body?.error ?? `Backend returned ${res.status}`);
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        captureCompositeError(err, 'subtask', { subId: opts.subId, review_failed: true });
        // Restore the review prompt so the user can re-decide (web-H1: the
        // optimistic clear above used to swallow it on a failed POST) — but
        // only while the gate is still actually open. The backend may have
        // auto-approved on its review timeout while this request was failing,
        // in which case `subtask_paid` already moved the runtime past
        // `awaiting-review` and resurrecting the prompt would be stale.
        setState((prev) => ({
          ...prev,
          awaitingReviewSubId:
            prev.runtimes[opts.subId]?.status === 'awaiting-review'
              ? opts.subId
              : prev.awaitingReviewSubId,
          error: `Review submit failed: ${message}`,
        }));
      }
    },
    [state.runId],
  );

  /** Full reset (used after completed/error to start over). */
  const reset = useCallback(() => {
    closeStream(esRef);
    setState(INITIAL_STATE);
  }, []);

  useEffect(
    () => () => {
      closeStream(esRef);
    },
    [],
  );

  return { ...state, classify, approve, cancel, reset, retry, submitReview };
}

// ───────────────────────────────────────────────────────────────────────
// Internals
// ───────────────────────────────────────────────────────────────────────

function closeStream(esRef: React.MutableRefObject<EventSource | null>): void {
  esRef.current?.close();
  esRef.current = null;
}

function attachStream(
  streamUrl: string,
  chainId: number,
  setState: React.Dispatch<React.SetStateAction<CompositeState>>,
  esRef: React.MutableRefObject<EventSource | null>,
  eventIdRef: React.MutableRefObject<number>,
): void {
  // urlFor handles both absolute (rare) and relative orchestrator paths
  // and tacks on `?chain=arc` when applicable so the Worker proxy
  // routes the long-lived SSE connection to the right Fly app.
  const fullUrl = urlFor(streamUrl, chainId);
  const es = new EventSource(fullUrl);
  esRef.current = es;

  const handlers: Record<string, (data: Record<string, unknown>) => void> = {
    plan_started: () => {
      /* metadata already known; ignore */
    },
    subtask_created: (data) => {
      const subId = numberField(data, 'subId');
      const taskId = stringField(data, 'taskId');
      if (subId === null) return;
      track('composite_subtask_started', { subId, taskId: taskId ?? null });
      setState((prev) => updateRuntime(prev, subId, (r) => ({
        ...r,
        status: 'created',
        ...(taskId ? { taskId } : {}),
        ...(r.startedAt ? {} : { startedAt: Date.now() }),
      })));
    },
    subtask_accepted: (data) => {
      const subId = numberField(data, 'subId');
      if (subId === null) return;
      setState((prev) => updateRuntime(prev, subId, (r) => ({ ...r, status: 'accepted' })));
    },
    subtask_completed: (data) => {
      const subId = numberField(data, 'subId');
      const resultUri = stringField(data, 'resultUri');
      if (subId === null) return;
      setState((prev) => updateRuntime(prev, subId, (r) => ({
        ...r,
        status: 'completed',
        ...(resultUri
          ? { resultUri, result: decodeResultUri(resultUri) }
          : {}),
      })));
    },
    subtask_paid: (data) => {
      const subId = numberField(data, 'subId');
      const txHash = stringField(data, 'txHash');
      if (subId === null) return;
      track('composite_subtask_completed', { subId, txHash: txHash ?? null });
      setState((prev) => ({
        ...updateRuntime(prev, subId, (r) => ({
          ...r,
          status: 'paid',
          completedAt: Date.now(),
          txHashes: txHash ? [...r.txHashes, txHash] : r.txHashes,
        })),
        // Clear the gate if this sub-task was the one under review (e.g. a
        // review-window timeout auto-approved without an explicit decision).
        awaitingReviewSubId: prev.awaitingReviewSubId === subId ? null : prev.awaitingReviewSubId,
      }));
    },
    subtask_errored: (data) => {
      const subId = numberField(data, 'subId');
      const error = stringField(data, 'error') ?? 'sub-task errored';
      if (subId === null) return;
      track('composite_run_errored', { phase: 'subtask', subId, error });
      captureCompositeError(new Error(`subtask #${subId}: ${error}`), 'subtask', {
        subId,
        error,
      });
      setState((prev) => updateRuntime(prev, subId, (r) => ({
        ...r,
        status: 'errored',
        error,
        completedAt: Date.now(),
      })));
    },
    subtask_awaiting_review: (data) => {
      // M11.4 (ADR-0019): review gate opened — pause for approve/dispute.
      const subId = numberField(data, 'subId');
      const resultUri = stringField(data, 'resultUri');
      const result = stringField(data, 'result');
      if (subId === null) return;
      track('composite_subtask_awaiting_review', { subId });
      setState((prev) => ({
        ...updateRuntime(prev, subId, (r) => ({
          ...r,
          status: 'awaiting-review',
          ...(resultUri ? { resultUri } : {}),
          ...(result ? { result } : {}),
        })),
        awaitingReviewSubId: subId,
      }));
    },
    subtask_dispute_raised: (data) => {
      // M11.4: client raised a dispute on-chain; council is now judging.
      const subId = numberField(data, 'subId');
      if (subId === null) return;
      track('composite_subtask_dispute_raised', { subId });
      setState((prev) =>
        updateRuntime(prev, subId, (r) => ({ ...r, status: 'disputed' })),
      );
    },
    subtask_dispute_resolved: (data) => {
      // M11.4: council verdict landed. Store it; subtask_paid / subtask_refunded
      // carries the final status transition.
      const subId = numberField(data, 'subId');
      const outcome = stringField(data, 'outcome') as SubTaskVerdict['outcome'] | null;
      const reasoning = stringField(data, 'reasoning') ?? '';
      const executorSharePct = numberField(data, 'executorSharePct');
      if (subId === null || outcome === null) return;
      track('composite_subtask_dispute_resolved', { subId, outcome });
      setState((prev) =>
        updateRuntime(prev, subId, (r) => ({
          ...r,
          verdict: {
            outcome,
            reasoning,
            ...(executorSharePct !== null ? { executorSharePct } : {}),
          },
        })),
      );
    },
    subtask_refunded: (data) => {
      // M11.4: council refunded the client — sub-task produced no usable result.
      const subId = numberField(data, 'subId');
      const txHash = stringField(data, 'txHash');
      if (subId === null) return;
      track('composite_subtask_refunded', { subId });
      setState((prev) =>
        updateRuntime(prev, subId, (r) => ({
          ...r,
          status: 'refunded',
          completedAt: Date.now(),
          txHashes: txHash ? [...r.txHashes, txHash] : r.txHashes,
        })),
      );
    },
    subtask_disputed: (data) => {
      // M10.4.2: dedicated handler for dispute event. Mirrors subtask_status
      // firehose but carries richer payload (taskId, resultUri) and sets
      // `disputedSubId` so the replan-prompt UI can target the right node.
      const subId = numberField(data, 'subId');
      if (subId === null) return;
      track('composite_subtask_disputed', { subId });
      setState((prev) => ({
        ...updateRuntime(prev, subId, (r) => ({ ...r, status: 'disputed' })),
        disputedSubId: subId,
      }));
    },
    subtask_retrying: (data) => {
      // M10.5.A: plan-runner has resolved a dispute pause and is re-spawning
      // this sub-task. Wipe per-attempt runtime state (taskId, result, error)
      // so the graph node visibly resets to waiting; keep `txHashes` so prior
      // approvePayment hashes remain part of the run record. Clear
      // `disputedSubId` since the prompt's job is done.
      const subId = numberField(data, 'subId');
      const executor = stringField(data, 'executor');
      const attempt = numberField(data, 'attempt');
      if (subId === null) return;
      track('composite_subtask_retrying', {
        subId,
        attempt: attempt ?? null,
        executor: executor ?? null,
      });
      setState((prev) => {
        const next = updateRuntime(prev, subId, (r) => ({
          status: 'waiting',
          txHashes: r.txHashes,
        }));
        return { ...next, disputedSubId: null };
      });
    },
    subtask_status: (data) => {
      // Firehose status event — kept for graph-rendering consistency. The
      // dedicated `subtask_disputed` handler above does the heavy lifting
      // for dispute UI state; this branch is a safety net if the dedicated
      // event ever drops.
      const status = stringField(data, 'status') as SubTaskRunStatus | null;
      const subId = numberField(data, 'subId');
      if (subId === null || status !== 'disputed') return;
      setState((prev) => updateRuntime(prev, subId, (r) => ({ ...r, status: 'disputed' })));
    },
    plan_completed: (data) => {
      const durationMs = numberField(data, 'durationMs');
      track('composite_run_completed', { duration_ms: durationMs ?? null });
      setState((prev) => ({ ...prev, status: 'completed', completedAt: Date.now() }));
    },
    plan_failed: (data) => {
      const error = stringField(data, 'error') ?? 'plan failed';
      const failedSubId = numberField(data, 'failedSubId');
      track('composite_run_errored', {
        phase: 'execute',
        error,
        ...(failedSubId !== null ? { failed_sub_id: failedSubId } : {}),
      });
      captureCompositeError(new Error(`plan_failed: ${error}`), 'execute', {
        ...(failedSubId !== null ? { failed_sub_id: failedSubId } : {}),
      });
      setState((prev) => ({
        ...prev,
        status: 'error',
        error,
        completedAt: Date.now(),
      }));
    },
    done: () => {
      es.close();
      esRef.current = null;
    },
  };

  Object.entries(handlers).forEach(([name, handler]) => {
    es.addEventListener(name, (ev) => {
      const data = safeParse((ev as MessageEvent).data);
      pushEvent(setState, eventIdRef, name, data);
      handler(data);
    });
  });

  es.onerror = () => {
    if (es.readyState === EventSource.CLOSED) {
      setState((prev) =>
        prev.status === 'completed' || prev.status === 'error'
          ? prev
          : { ...prev, status: 'error', error: 'Connection to orchestrator lost' },
      );
    }
  };
}

function updateRuntime(
  prev: CompositeState,
  subId: number,
  mut: (r: SubTaskRuntime) => SubTaskRuntime,
): CompositeState {
  const existing: SubTaskRuntime = prev.runtimes[subId] ?? { status: 'waiting', txHashes: [] };
  return {
    ...prev,
    runtimes: { ...prev.runtimes, [subId]: mut(existing) },
  };
}

function pushEvent(
  setState: React.Dispatch<React.SetStateAction<CompositeState>>,
  idRef: React.MutableRefObject<number>,
  event: string,
  data: Record<string, unknown>,
): void {
  idRef.current += 1;
  const id = idRef.current;
  setState((prev) => ({
    ...prev,
    events: [...prev.events, { id, event, data, receivedAt: Date.now() }],
  }));
}

function decodeResultUri(uri: string): string {
  if (uri.startsWith('data:text/plain,')) {
    try {
      return decodeURIComponent(uri.slice('data:text/plain,'.length));
    } catch {
      return uri;
    }
  }
  return uri;
}

function numberField(d: Record<string, unknown>, key: string): number | null {
  const v = d[key];
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

function stringField(d: Record<string, unknown>, key: string): string | null {
  const v = d[key];
  return typeof v === 'string' ? v : null;
}

function safeParse(raw: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw);
    return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

async function safeJson(res: Response): Promise<unknown> {
  try {
    return await res.json();
  } catch {
    return null;
  }
}

/**
 * Derive a `WirePlan` from a `WireClassification` — drops classifier-only fields.
 * The plan-card uses this for the "Approve as-is" path; the editor can splice
 * in changes before passing the result to `approve()`.
 *
 * Executor assignment is the orchestrator's job now (M11.3.X): the
 * `/classify` endpoint strips any LLM-emitted `executor_address` and fills
 * it from AgentRegistryV2 (capability → cheapest active agent) before this
 * code ever sees the plan. So we trust `sub.executor_address` as-is for
 * low-stakes plans. Two cases still need handling here:
 *
 *   - High-stakes plans → strip the executor so the user must deliberately
 *     pick one in the plan-editor (the defensive read of the stakes axis,
 *     ADR-0007 §5; GOTCHAS 2026-05-22).
 *   - Sub-tasks with no executor (registry miss, or chains without a V2
 *     registry such as Arc) → left unassigned; the user picks in the
 *     plan-editor before approving.
 */
export function planFromClassification(
  brief: string,
  c: WireClassification,
): WirePlan {
  return {
    brief,
    decomposability: c.decomposability,
    stakes: c.stakes,
    subtasks: c.proposed_plan.map((sub) => autoAssignExecutor(sub, c.stakes)),
    estimated_total_cost_units: c.estimated_total_cost_units,
    estimated_duration_ms: c.estimated_duration_ms,
  };
}

/**
 * Type-stems that imply an irreversible / high-value side effect. For these,
 * we deliberately strip any executor so the sub-task surfaces as
 * "unassigned" in plan-card and the user must pick a deliberate executor in
 * the editor or cancel. This is the defensive interpretation of the stakes
 * axis (ADR-0007 §5).
 */
const HIGH_STAKES_TYPE_STEMS: readonly string[] = [
  'transfer',
  'send',
  'book',
  'purchase',
  'sign',
  'pay',
];

function isHighStakesType(type: string): boolean {
  const lower = type.toLowerCase();
  return HIGH_STAKES_TYPE_STEMS.some((stem) => lower.includes(stem));
}

function autoAssignExecutor(
  sub: WireSubTask,
  planStakes: 'low' | 'high',
): WireSubTask {
  // Strip the executor for ANY high-stakes plan, regardless of whether the
  // per-subtask `type` stem matches `HIGH_STAKES_TYPE_STEMS`. The classifier
  // emits `stakes: high` at the plan level when the brief is irreversible /
  // financial, but the per-subtask `type` it produces is unpredictable
  // (`crypto-transaction`, `usdc-transaction`, `wallet-action` — none of
  // which stem-match `send`/`transfer`/etc.). plan-level `stakes` is the
  // authoritative axis; type-stem is a secondary belt for low-stakes plans
  // that nevertheless carry one pay-shaped sub-task. Observed 2026-05-22
  // with the "Send 0.1 USDC to 0x…" smoke.
  if (planStakes === 'high' || isHighStakesType(sub.type)) {
    const { executor_address: _stripped, ...rest } = sub;
    return rest;
  }

  // Low-stakes: trust `sub.executor_address` as supplied by the orchestrator.
  // It is registry-derived — the `/classify` endpoint stripped any
  // LLM-emitted address and resolved the executor from AgentRegistryV2, so
  // there is no hallucinated-recipient risk to guard against here anymore.
  // Absent → the registry had no match (or the chain has no V2 registry, e.g.
  // Arc) → surface as unassigned for a manual pick in the plan-editor.
  return sub;
}
