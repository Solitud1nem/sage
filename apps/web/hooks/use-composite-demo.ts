'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

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
  | 'paid'
  | 'errored'
  | 'disputed';

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
};

export function useCompositeDemo() {
  const [state, setState] = useState<CompositeState>(INITIAL_STATE);
  const esRef = useRef<EventSource | null>(null);
  const eventIdRef = useRef(0);

  /** POST /classify. Status: idle → classifying → plan-ready | error. */
  const classify = useCallback(async (brief: string): Promise<void> => {
    closeStream(esRef);
    eventIdRef.current = 0;
    setState({ ...INITIAL_STATE, status: 'classifying' });

    try {
      const res = await fetch(`${ORCHESTRATOR_URL}/api/demo/composite/classify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ brief }),
      });
      if (!res.ok) {
        const body = (await safeJson(res)) as { error?: string };
        throw new Error(body?.error ?? `Backend returned ${res.status}`);
      }
      const data = (await res.json()) as { classification: WireClassification };
      // Mirror brief inside classification result for plan derivation.
      setState((prev) => ({
        ...prev,
        status: 'plan-ready',
        classification: data.classification,
      }));
    } catch (err) {
      setState((prev) => ({
        ...prev,
        status: 'error',
        error: err instanceof Error ? err.message : String(err),
      }));
    }
  }, []);

  /**
   * POST /execute with the (possibly user-edited) `Plan`. Status: plan-ready → executing.
   * Opens an EventSource to the returned `streamUrl` and folds lifecycle
   * events into `runtimes[subId]`.
   */
  const approve = useCallback(async (plan: WirePlan): Promise<void> => {
    setState((prev) => ({ ...prev, status: 'executing', plan, runtimes: {} }));
    try {
      const res = await fetch(`${ORCHESTRATOR_URL}/api/demo/composite/execute`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(plan),
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

      attachStream(data.streamUrl, setState, esRef, eventIdRef);
    } catch (err) {
      setState((prev) => ({
        ...prev,
        status: 'error',
        error: err instanceof Error ? err.message : String(err),
      }));
    }
  }, []);

  /** User clicked Cancel on the plan card. Returns to idle. */
  const cancel = useCallback(() => {
    closeStream(esRef);
    setState(INITIAL_STATE);
  }, []);

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

  return { ...state, classify, approve, cancel, reset };
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
  setState: React.Dispatch<React.SetStateAction<CompositeState>>,
  esRef: React.MutableRefObject<EventSource | null>,
  eventIdRef: React.MutableRefObject<number>,
): void {
  const fullUrl = streamUrl.startsWith('http')
    ? streamUrl
    : `${ORCHESTRATOR_URL}${streamUrl}`;
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
      setState((prev) => updateRuntime(prev, subId, (r) => ({
        ...r,
        status: 'paid',
        completedAt: Date.now(),
        txHashes: txHash ? [...r.txHashes, txHash] : r.txHashes,
      })));
    },
    subtask_errored: (data) => {
      const subId = numberField(data, 'subId');
      const error = stringField(data, 'error') ?? 'sub-task errored';
      if (subId === null) return;
      setState((prev) => updateRuntime(prev, subId, (r) => ({
        ...r,
        status: 'errored',
        error,
        completedAt: Date.now(),
      })));
    },
    subtask_status: (data) => {
      // Specific events already cover created/accepted/completed/paid; this
      // catches disputed (which doesn't have a dedicated event in M10.2.4).
      const status = stringField(data, 'status') as SubTaskRunStatus | null;
      const subId = numberField(data, 'subId');
      if (subId === null || status !== 'disputed') return;
      setState((prev) => updateRuntime(prev, subId, (r) => ({ ...r, status: 'disputed' })));
    },
    plan_completed: () => {
      setState((prev) => ({ ...prev, status: 'completed', completedAt: Date.now() }));
    },
    plan_failed: (data) => {
      const error = stringField(data, 'error') ?? 'plan failed';
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
 */
export function planFromClassification(
  brief: string,
  c: WireClassification,
): WirePlan {
  return {
    brief,
    decomposability: c.decomposability,
    stakes: c.stakes,
    subtasks: c.proposed_plan,
    estimated_total_cost_units: c.estimated_total_cost_units,
    estimated_duration_ms: c.estimated_duration_ms,
  };
}
