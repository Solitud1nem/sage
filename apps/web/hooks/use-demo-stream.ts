'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Drives a live demo run against the orchestrator backend.
 *
 *   1. POST /api/demo/start with { mode, text? | imageUrl? }.
 *   2. Open an EventSource to /api/demo/stream/:demoRunId.
 *   3. Translate stream events into a reducer-style state machine that the
 *      step-tracker, event-log, and result-panel render from.
 *
 * Modes:
 *   pipeline  → Summarizer → Translator (2 stages, body: { text })
 *   sentiment → Sentiment classifier (1 stage, body: { text })
 *   vision    → Image describer (1 stage, body: { imageUrl })
 *
 * State model:
 *   status         idle → running → done | error
 *   currentStage   null | summarize | translate | sentiment | vision
 *   steps          per-node state { createTask, acceptTask, completeTask, approvePayment }
 *                  each: waiting | active | complete
 *   txHashes       accumulates confirm-able Basescan links
 *   events         raw event log (newest last) for the Event log panel
 *   result         populated on `done`, mode-aware fields
 */

const ORCHESTRATOR_URL =
  process.env.NEXT_PUBLIC_ORCHESTRATOR_URL ?? 'http://localhost:3000';

export type AgentMode = 'pipeline' | 'sentiment' | 'vision';
export type StepName = 'createTask' | 'acceptTask' | 'completeTask' | 'approvePayment';
export type StepStatus = 'waiting' | 'active' | 'complete';
export type DemoStatus = 'idle' | 'running' | 'done' | 'error';
export type Stage = 'summarize' | 'translate' | 'sentiment' | 'vision';

export interface DemoEvent {
  id: number;
  event: string;
  data: Record<string, unknown>;
  receivedAt: number;
}

export interface DemoResult {
  mode: AgentMode;
  /** pipeline only */
  summary?: string | undefined;
  /** pipeline only */
  translation?: string | undefined;
  /** sentiment only */
  sentiment?: string | undefined;
  /** vision only */
  description?: string | undefined;
  txHashes: string[];
  durationMs: number;
  totalUsdcSettled: string;
}

export interface DemoState {
  status: DemoStatus;
  mode: AgentMode | null;
  currentStage: Stage | null;
  steps: Record<StepName, StepStatus>;
  txByStep: Partial<Record<StepName, string>>;
  txHashes: string[];
  events: DemoEvent[];
  result: DemoResult | null;
  error: string | null;
  demoRunId: string | null;
  /** Chain that transactions in this run landed on. */
  chainId: number | null;
  /** Explorer base URL (Basescan / Sepolia.basescan etc). */
  explorerUrl: string | null;
  /** Human label for the chain (e.g. "Base", "Base Sepolia"). */
  chainName: string | null;
}

const INITIAL_STEPS: Record<StepName, StepStatus> = {
  createTask: 'waiting',
  acceptTask: 'waiting',
  completeTask: 'waiting',
  approvePayment: 'waiting',
};

const INITIAL_STATE: DemoState = {
  status: 'idle',
  mode: null,
  currentStage: null,
  steps: INITIAL_STEPS,
  txByStep: {},
  txHashes: [],
  events: [],
  result: null,
  error: null,
  demoRunId: null,
  chainId: null,
  explorerUrl: null,
  chainName: null,
};

export function useDemoStream() {
  const [state, setState] = useState<DemoState>(INITIAL_STATE);
  const esRef = useRef<EventSource | null>(null);
  const eventIdRef = useRef(0);
  // Run generation counter (CR.14): every start()/reset() bumps it, and all
  // async continuations of a run (late fetch resolve, SSE handlers) write
  // state only while their captured token is still current. Without this a
  // run that was reset/superseded mid-flight clobbers the next run's state.
  const runTokenRef = useRef(0);

  const start = useCallback(
    async (input: string, agentMode: AgentMode = 'pipeline'): Promise<void> => {
      const token = ++runTokenRef.current;
      const isStale = () => runTokenRef.current !== token;
      const safeSetState: typeof setState = (action) => {
        if (!isStale()) setState(action);
      };

      // Close any prior stream.
      esRef.current?.close();
      esRef.current = null;
      eventIdRef.current = 0;

      setState({ ...INITIAL_STATE, status: 'running', mode: agentMode });

      try {
        const body =
          agentMode === 'vision'
            ? { mode: agentMode, imageUrl: input }
            : { mode: agentMode, text: input };

        const res = await fetch(`${ORCHESTRATOR_URL}/api/demo/start`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });

        if (!res.ok) {
          const errBody = await safeJson(res);
          throw new Error(
            (errBody as { error?: string; message?: string })?.message ??
              (errBody as { error?: string })?.error ??
              `Backend returned ${res.status}`,
          );
        }

        const startResponse = (await res.json()) as {
          demoRunId: string;
          streamUrl: string;
          mode?: AgentMode;
          chainId?: number;
          chainName?: string;
          explorerUrl?: string;
        };
        const { demoRunId, streamUrl } = startResponse;

        // A newer run started (or reset fired) while the POST was in
        // flight — don't open a stream this hook no longer tracks.
        if (isStale()) return;

        setState((prev) => ({
          ...prev,
          demoRunId,
          mode: startResponse.mode ?? agentMode,
          chainId: startResponse.chainId ?? null,
          chainName: startResponse.chainName ?? null,
          explorerUrl: startResponse.explorerUrl ?? null,
        }));

        const es = new EventSource(`${ORCHESTRATOR_URL}${streamUrl}`);
        esRef.current = es;

        const handlers: Record<string, (data: Record<string, unknown>) => void> = {
          run_started: () => {
            // Just log.
          },
          stage_started: (data) => {
            const stage = data.stage as Stage;
            safeSetState((prev) => ({
              ...prev,
              currentStage: stage,
              // Reset step states only when moving to translate stage of pipeline.
              // Single-stage modes (sentiment, vision) only fire stage_started once.
              steps: stage === 'translate' ? { ...INITIAL_STEPS } : prev.steps,
              txByStep: stage === 'translate' ? {} : prev.txByStep,
            }));
          },
          task_created: (data) =>
            safeSetState((prev) => ({
              ...prev,
              steps: { ...prev.steps, createTask: 'complete', acceptTask: 'active' },
              txByStep: stashTx(prev.txByStep, 'createTask', data),
            })),
          task_accepted: (data) =>
            safeSetState((prev) => ({
              ...prev,
              steps: { ...prev.steps, acceptTask: 'complete', completeTask: 'active' },
              txByStep: stashTx(prev.txByStep, 'acceptTask', data),
            })),
          task_completed: (data) =>
            safeSetState((prev) => ({
              ...prev,
              steps: { ...prev.steps, completeTask: 'complete', approvePayment: 'active' },
              txByStep: stashTx(prev.txByStep, 'completeTask', data),
            })),
          task_paid: (data) =>
            safeSetState((prev) => {
              const tx = typeof data.txHash === 'string' ? data.txHash : null;
              return {
                ...prev,
                steps: { ...prev.steps, approvePayment: 'complete' },
                txByStep: stashTx(prev.txByStep, 'approvePayment', data),
                txHashes: tx ? [...prev.txHashes, tx] : prev.txHashes,
              };
            }),
          done: (data) => {
            // Backend sends either the result payload or { error } on fatal failures.
            if ('error' in data && typeof data.error === 'string') {
              safeSetState((prev) => ({ ...prev, status: 'error', error: data.error as string }));
            } else {
              const resolvedMode = (data.mode as AgentMode | undefined) ?? agentMode;
              safeSetState((prev) => ({
                ...prev,
                status: 'done',
                result: {
                  mode: resolvedMode,
                  summary: typeof data.summary === 'string' ? data.summary : undefined,
                  translation:
                    typeof data.translation === 'string' ? data.translation : undefined,
                  sentiment: typeof data.sentiment === 'string' ? data.sentiment : undefined,
                  description:
                    typeof data.description === 'string' ? data.description : undefined,
                  txHashes: Array.isArray(data.txHashes)
                    ? (data.txHashes as string[])
                    : prev.txHashes,
                  durationMs: Number(data.durationMs ?? 0),
                  totalUsdcSettled: (data.totalUsdcSettled as string) ?? '0',
                },
              }));
            }
            es.close();
            if (esRef.current === es) esRef.current = null;
          },
          error: (data) => {
            const msg = typeof data.message === 'string' ? data.message : 'Stream error';
            safeSetState((prev) => ({ ...prev, status: 'error', error: msg }));
            es.close();
            if (esRef.current === es) esRef.current = null;
          },
        };

        // Attach handlers. Custom SSE events arrive as named listeners.
        Object.entries(handlers).forEach(([name, handler]) => {
          es.addEventListener(name, (ev) => {
            const data = safeParse(typeof ev.data === 'string' ? ev.data : '');
            pushEvent(safeSetState, eventIdRef, name, data);
            handler(data);
          });
        });

        es.onerror = () => {
          // EventSource auto-reconnects by default. Only surface an error if the
          // server has explicitly closed (readyState === CLOSED).
          if (es.readyState === EventSource.CLOSED) {
            safeSetState((prev) =>
              prev.status === 'done'
                ? prev
                : { ...prev, status: 'error', error: 'Connection to orchestrator lost' },
            );
          }
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        safeSetState((prev) => ({ ...prev, status: 'error', error: msg }));
      }
    },
    [],
  );

  const reset = useCallback(() => {
    runTokenRef.current += 1;
    esRef.current?.close();
    esRef.current = null;
    setState(INITIAL_STATE);
  }, []);

  useEffect(
    () => () => {
      runTokenRef.current += 1;
      esRef.current?.close();
      esRef.current = null;
    },
    [],
  );

  return { ...state, start, reset };
}

// ── Helpers ───────────────────────────────────────────────────────────
function pushEvent(
  setState: React.Dispatch<React.SetStateAction<DemoState>>,
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

function stashTx(
  current: DemoState['txByStep'],
  step: StepName,
  data: Record<string, unknown>,
): DemoState['txByStep'] {
  const tx = typeof data.txHash === 'string' ? data.txHash : undefined;
  if (!tx) return current;
  return { ...current, [step]: tx };
}

function safeParse(raw: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(raw);
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
