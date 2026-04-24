'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Drives a live demo run against the orchestrator backend (M-INT.4).
 *
 *   1. POST /api/demo/start with the prompt text.
 *   2. Open an EventSource to /api/demo/stream/:demoRunId.
 *   3. Translate stream events into a reducer-style state machine that the
 *      step-tracker and event-log render from.
 *
 * State model:
 *   status         idle → running → done | error
 *   currentStage   null | summarize | translate
 *   steps          per-node state { createTask, acceptTask, completeTask, approvePayment }
 *                  each: waiting | active | complete
 *   txHashes       accumulates confirm-able Basescan links
 *   events         raw event log (newest last) for the Event log panel
 *   result         populated on `done`
 */

const ORCHESTRATOR_URL =
  process.env.NEXT_PUBLIC_ORCHESTRATOR_URL ?? 'http://localhost:3000';

export type StepName = 'createTask' | 'acceptTask' | 'completeTask' | 'approvePayment';
export type StepStatus = 'waiting' | 'active' | 'complete';
export type DemoStatus = 'idle' | 'running' | 'done' | 'error';
export type Stage = 'summarize' | 'translate';

export interface DemoEvent {
  id: number;
  event: string;
  data: Record<string, unknown>;
  receivedAt: number;
}

export interface DemoResult {
  summary: string;
  translation: string;
  txHashes: string[];
  durationMs: number;
  totalUsdcSettled: string;
}

export interface DemoState {
  status: DemoStatus;
  currentStage: Stage | null;
  steps: Record<StepName, StepStatus>;
  txByStep: Partial<Record<StepName, string>>;
  txHashes: string[];
  events: DemoEvent[];
  result: DemoResult | null;
  error: string | null;
  demoRunId: string | null;
}

const INITIAL_STEPS: Record<StepName, StepStatus> = {
  createTask: 'waiting',
  acceptTask: 'waiting',
  completeTask: 'waiting',
  approvePayment: 'waiting',
};

const INITIAL_STATE: DemoState = {
  status: 'idle',
  currentStage: null,
  steps: INITIAL_STEPS,
  txByStep: {},
  txHashes: [],
  events: [],
  result: null,
  error: null,
  demoRunId: null,
};

export function useDemoStream() {
  const [state, setState] = useState<DemoState>(INITIAL_STATE);
  const esRef = useRef<EventSource | null>(null);
  const eventIdRef = useRef(0);

  const start = useCallback(async (text: string): Promise<void> => {
    // Close any prior stream.
    esRef.current?.close();
    esRef.current = null;
    eventIdRef.current = 0;

    setState({ ...INITIAL_STATE, status: 'running' });

    try {
      const res = await fetch(`${ORCHESTRATOR_URL}/api/demo/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      });

      if (!res.ok) {
        const body = await safeJson(res);
        throw new Error(
          (body as { error?: string })?.error ?? `Backend returned ${res.status}`,
        );
      }

      const { demoRunId, streamUrl } = (await res.json()) as {
        demoRunId: string;
        streamUrl: string;
      };

      setState((prev) => ({ ...prev, demoRunId }));

      const es = new EventSource(`${ORCHESTRATOR_URL}${streamUrl}`);
      esRef.current = es;

      const handlers: Record<string, (data: Record<string, unknown>) => void> = {
        run_started: () => {
          // Just log.
        },
        stage_started: (data) => {
          const stage = data.stage as Stage;
          setState((prev) => ({
            ...prev,
            currentStage: stage,
            // Reset step states when moving to translate stage.
            steps: stage === 'translate' ? { ...INITIAL_STEPS } : prev.steps,
            txByStep: stage === 'translate' ? {} : prev.txByStep,
          }));
        },
        task_created: (data) =>
          setState((prev) => ({
            ...prev,
            steps: { ...prev.steps, createTask: 'complete', acceptTask: 'active' },
            txByStep: stashTx(prev.txByStep, 'createTask', data),
          })),
        task_accepted: (data) =>
          setState((prev) => ({
            ...prev,
            steps: { ...prev.steps, acceptTask: 'complete', completeTask: 'active' },
            txByStep: stashTx(prev.txByStep, 'acceptTask', data),
          })),
        task_completed: (data) =>
          setState((prev) => ({
            ...prev,
            steps: { ...prev.steps, completeTask: 'complete', approvePayment: 'active' },
            txByStep: stashTx(prev.txByStep, 'completeTask', data),
          })),
        task_paid: (data) =>
          setState((prev) => {
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
            setState((prev) => ({ ...prev, status: 'error', error: data.error as string }));
          } else {
            setState((prev) => ({
              ...prev,
              status: 'done',
              result: {
                summary: (data.summary as string) ?? '',
                translation: (data.translation as string) ?? '',
                txHashes:
                  (data.txHashes as string[]) ?? prev.txHashes,
                durationMs: Number(data.durationMs ?? 0),
                totalUsdcSettled: (data.totalUsdcSettled as string) ?? '0',
              },
            }));
          }
          es.close();
          esRef.current = null;
        },
        error: (data) => {
          const msg = typeof data.message === 'string' ? data.message : 'Stream error';
          setState((prev) => ({ ...prev, status: 'error', error: msg }));
          es.close();
          esRef.current = null;
        },
      };

      // Attach handlers. Custom SSE events arrive as named listeners.
      Object.entries(handlers).forEach(([name, handler]) => {
        es.addEventListener(name, (ev) => {
          const data = safeParse((ev as MessageEvent).data);
          pushEvent(setState, eventIdRef, name, data);
          handler(data);
        });
      });

      es.onerror = () => {
        // EventSource auto-reconnects by default. Only surface an error if the
        // server has explicitly closed (readyState === CLOSED).
        if (es.readyState === EventSource.CLOSED) {
          setState((prev) =>
            prev.status === 'done'
              ? prev
              : { ...prev, status: 'error', error: 'Connection to orchestrator lost' },
          );
        }
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setState((prev) => ({ ...prev, status: 'error', error: msg }));
    }
  }, []);

  const reset = useCallback(() => {
    esRef.current?.close();
    esRef.current = null;
    setState(INITIAL_STATE);
  }, []);

  useEffect(
    () => () => {
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
