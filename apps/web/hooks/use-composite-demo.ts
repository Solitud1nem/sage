'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import * as Sentry from '@sentry/nextjs';

import { track } from '@/lib/posthog';

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
  /**
   * Sub-task that just transitioned to `disputed` and needs user attention.
   * Drives the inline `replan-prompt` UI (M10.4.3). Reset when the user
   * picks an action.
   */
  disputedSubId: number | null;
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
    track('composite_classify_started', { brief_len: brief.length });
    const startedAt = Date.now();

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
  }, []);

  /**
   * POST /execute with the (possibly user-edited) `Plan`. Status: plan-ready → executing.
   * Opens an EventSource to the returned `streamUrl` and folds lifecycle
   * events into `runtimes[subId]`.
   */
  const approve = useCallback(async (plan: WirePlan): Promise<void> => {
    track('composite_plan_approved', {
      decomposability: plan.decomposability,
      stakes: plan.stakes,
      subtask_count: plan.subtasks.length,
      estimated_total_cost_units: plan.estimated_total_cost_units,
    });
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
 * Auto-resolves `executor_address` per sub-task by mapping `type` against the
 * known worker registry (NEXT_PUBLIC_DEMO_*_ADDRESS). Neither the mock nor the
 * LLM classifier sets `executor_address`, but the plan-runner requires one
 * before spawning a TaskEscrow — so we resolve at the seam between
 * classification (capability tag) and execution (concrete address). User can
 * still override via plan-editor.
 */
export function planFromClassification(
  brief: string,
  c: WireClassification,
): WirePlan {
  return {
    brief,
    decomposability: c.decomposability,
    stakes: c.stakes,
    subtasks: c.proposed_plan.map(autoAssignExecutor),
    estimated_total_cost_units: c.estimated_total_cost_units,
    estimated_duration_ms: c.estimated_duration_ms,
  };
}

/**
 * Lowercased allowlist of the four production worker addresses, derived
 * from the same env vars the plan-editor reads. Computed once per module
 * load — sponsor's worker set doesn't change at runtime.
 */
const KNOWN_WORKER_ADDRESSES: readonly string[] = [
  process.env.NEXT_PUBLIC_DEMO_SUMMARIZER_ADDRESS,
  process.env.NEXT_PUBLIC_DEMO_TRANSLATOR_ADDRESS,
  process.env.NEXT_PUBLIC_DEMO_SENTIMENT_ADDRESS,
  process.env.NEXT_PUBLIC_DEMO_VISION_ADDRESS,
]
  .filter((a): a is string => !!a && /^0x[a-fA-F0-9]{40}$/.test(a))
  .map((a) => a.toLowerCase());

function isKnownWorker(addr: string | undefined): boolean {
  if (!addr) return false;
  return KNOWN_WORKER_ADDRESSES.includes(addr.toLowerCase());
}

/**
 * Type-stems that imply an irreversible / high-value side effect. For these,
 * we deliberately *do not* auto-route to the summarizer fallback — the
 * intent is to surface them as "unassigned" in plan-card so the user must
 * either pick a deliberate executor in the editor or cancel. This is the
 * defensive interpretation of the stakes axis (ADR-0007 §5).
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

function autoAssignExecutor(sub: WireSubTask): WireSubTask {
  // Trust the classifier's `executor_address` ONLY if it's one of our
  // 4 production workers. The LLM occasionally echoes addresses from the
  // brief text into this field — e.g. a "send $500 to 0xABCDeF…" brief
  // makes the recipient address show up as the executor. Allowing that
  // through would mint a TaskEscrow with an unrelated party as the
  // designated executor; harmless in practice (no one watches that
  // address, the task times out and refunds) but a real trust-boundary
  // violation. Strip and re-resolve via stem matcher.
  const llmAddr = sub.executor_address;
  if (llmAddr && isKnownWorker(llmAddr)) return sub;

  // High-stakes types (transfer/send/book/etc.) intentionally do NOT
  // auto-route to summarizer — leave unassigned so the user has to make
  // a deliberate choice in the plan-editor. This is what makes the
  // `stakes: high` axis behaviourally meaningful at the spawn boundary,
  // not just a UI badge.
  if (isHighStakesType(sub.type)) {
    const { executor_address: _stripped, ...rest } = sub;
    return rest;
  }

  const resolved = resolveExecutorByType(sub.type);
  // Strip any LLM-emitted address first so we don't keep a hallucinated
  // value if stem-resolution returns undefined.
  const { executor_address: _stripped, ...rest } = sub;
  return resolved ? { ...rest, executor_address: resolved } : rest;
}

/**
 * Lookup table mapping a sub-task `type` (the capability tag emitted by the
 * classifier — `summarize-text`, `translate-text`, etc.) to a concrete
 * executor address. Falls back across normalized variants (`summarize` →
 * `summarize-text`) so LLM-emitted shorthand still resolves.
 *
 * Sources: `NEXT_PUBLIC_DEMO_*_ADDRESS` baked at build time from `.env.local`
 * (or future GH Actions repo vars). When the var is absent the slot returns
 * undefined → the sub-task surfaces as "unassigned" in plan-card and the
 * user has to pick via plan-editor before approving.
 */
function resolveExecutorByType(type: string): `0x${string}` | undefined {
  const summarizer = process.env.NEXT_PUBLIC_DEMO_SUMMARIZER_ADDRESS;
  const translator = process.env.NEXT_PUBLIC_DEMO_TRANSLATOR_ADDRESS;
  const sentiment = process.env.NEXT_PUBLIC_DEMO_SENTIMENT_ADDRESS;
  const vision = process.env.NEXT_PUBLIC_DEMO_VISION_ADDRESS;

  // Stem-based substring matching. The LLM-driven classifier emits types
  // in unpredictable shapes: noun forms (`translation`, `summarization`,
  // `sentiment-classification`), verb forms (`translate`, `summarize`),
  // canonical mock-template tags (`translate-text`, `summarize-text`),
  // and ad-hoc compounds (`image-description`, `comparative-analysis`).
  // Hard-coding every variant fails on the next novel string. Instead we
  // map a CAPABILITY to a list of STEMS that indicate it, and pick the
  // first bucket whose stem occurs in the lowercased type.
  //
  // Order matters when stems overlap (translator before summarizer so
  // "translate-and-summarize" → translator wins). Add new stems freely
  // — over-matching is cheaper than under-matching (UX-wise: defaulting
  // to summarizer is benign; "unassigned" blocks execution).
  const lower = type.toLowerCase();
  const buckets: Array<{ stems: readonly string[]; address: string | undefined }> = [
    { stems: ['translat'], address: translator },
    { stems: ['sentiment', 'classif', 'emotion', 'tone', 'mood'], address: sentiment },
    { stems: ['vision', 'image', 'visual', 'describ', 'caption', 'ocr'], address: vision },
    {
      stems: [
        'summari', 'summary',
        'compar', 'compose', 'composit',
        'research', 'analy', 'synthes',
        'write', 'writing', 'report',
        'extract', 'review',
      ],
      address: summarizer,
    },
  ];

  for (const { stems, address } of buckets) {
    if (stems.some((stem) => lower.includes(stem))) {
      if (address && /^0x[a-fA-F0-9]{40}$/.test(address)) {
        return address as `0x${string}`;
      }
    }
  }

  // Default fallback: the summarizer (in dual-mode it executes any text task).
  // The alternative — `undefined` → "unassigned" → plan-runner refuses to
  // spawn → plan dies — is too punishing for the realistic case where the
  // LLM emits a novel type (`flights`, `itinerary`, `budget`, `phrasebook`,
  // …) we haven't enumerated. Better to attempt execution with best-effort
  // output than to block the whole plan on one unknown capability. Users
  // can still override per-subtask in the plan-editor.
  // Trade-off: composite plans with unusual types route everything to one
  // worker. Acceptable for v1; M10.5 + Phase B introduce a worker manifest
  // and proper capability resolution.
  if (typeof window !== 'undefined') {
    // Browser-only log so the operator can see this in DevTools when
    // troubleshooting; no need to ship the warning in SSR/prerender.
    console.warn(
      `[composite] type "${type}" had no stem match — defaulting to summarizer`,
    );
  }
  if (summarizer && /^0x[a-fA-F0-9]{40}$/.test(summarizer)) {
    return summarizer as `0x${string}`;
  }
  return undefined;
}
