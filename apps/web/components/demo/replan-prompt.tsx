'use client';

import { useState } from 'react';

import type { SubTaskRuntime, WireSubTask } from '@/hooks/use-composite-demo';

/**
 * Inline prompt that appears mid-execution when a sub-task either errors
 * or is explicitly disputed. Three actions:
 *
 *   - **Retry sub-task** — calls back into the hook's `retry({ subId })`,
 *     which hits `/api/demo/composite/retry-subtask`. Plan-runner re-spawns
 *     the disputed TaskEscrow with the same params; the graph node resets
 *     to `waiting` on `subtask_retrying`.
 *   - **Change executor** — expands a worker picker. Clicking a different
 *     worker calls `retry({ subId, newExecutorAddress })` and the runner
 *     re-spawns with the new executor.
 *   - **Cancel run** — calls back to the page-level reset, ending the plan.
 *
 * The first two actions only work for `reason === 'disputed'`: a generic
 * execution error tore down the channel and there is nothing for the
 * backend to resume. Errored sub-tasks still get Cancel + a clarifying
 * note.
 */

const WORKER_OPTIONS: ReadonlyArray<{
  label: string;
  address: `0x${string}` | undefined;
}> = [
  {
    label: 'Summarizer',
    address: process.env.NEXT_PUBLIC_DEMO_SUMMARIZER_ADDRESS as
      | `0x${string}`
      | undefined,
  },
  {
    label: 'Translator',
    address: process.env.NEXT_PUBLIC_DEMO_TRANSLATOR_ADDRESS as
      | `0x${string}`
      | undefined,
  },
  {
    label: 'Sentiment',
    address: process.env.NEXT_PUBLIC_DEMO_SENTIMENT_ADDRESS as
      | `0x${string}`
      | undefined,
  },
  {
    label: 'Vision',
    address: process.env.NEXT_PUBLIC_DEMO_VISION_ADDRESS as
      | `0x${string}`
      | undefined,
  },
];

interface ReplanPromptProps {
  /** The disputed or errored sub-task. */
  subtask: WireSubTask;
  /** The runtime detail (status, error message, etc.). */
  runtime: SubTaskRuntime | undefined;
  /** Whether this was an explicit dispute or a generic execution error. */
  reason: 'disputed' | 'errored';
  /** End the plan and return to idle. Functional in v1. */
  onCancelRun: () => void;
  /**
   * Resolve the pause with retry. Available only when `reason === 'disputed'`
   * — the plan-runner is awaiting a decision in `awaitUserDecision`.
   */
  onRetry?: (opts: { subId: number; newExecutorAddress?: `0x${string}` }) => Promise<void>;
}

function shortAddr(addr?: string): string {
  if (!addr) return '—';
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

export function ReplanPrompt({
  subtask,
  runtime,
  reason,
  onCancelRun,
  onRetry,
}: ReplanPromptProps) {
  const [picking, setPicking] = useState(false);
  const [busy, setBusy] = useState(false);

  const headlineColor = reason === 'disputed' ? '#F472B6' : '#F87171';
  const headlineLabel =
    reason === 'disputed' ? 'Sub-task disputed' : 'Sub-task errored';
  const errorText = runtime?.error ?? 'No detail available.';
  const canRetry = reason === 'disputed' && !!onRetry;
  const currentExecutor = subtask.executor_address;

  const runRetry = async (newExecutor?: `0x${string}`): Promise<void> => {
    if (!onRetry || busy) return;
    setBusy(true);
    try {
      await onRetry({
        subId: subtask.id,
        ...(newExecutor ? { newExecutorAddress: newExecutor } : {}),
      });
    } finally {
      setBusy(false);
      setPicking(false);
    }
  };

  return (
    <section
      className="rounded-[14px] border bg-surface overflow-hidden animate-[demo-reveal_240ms_ease-out]"
      style={{ borderColor: `${headlineColor}66` }}
    >
      <header
        className="px-6 md:px-8 py-4 border-b border-border flex items-center justify-between gap-3"
        style={{ background: `${headlineColor}10` }}
      >
        <div>
          <div
            className="font-mono text-[11px] uppercase tracking-[0.08em] mb-1"
            style={{ color: headlineColor }}
          >
            {headlineLabel}
          </div>
          <div className="font-mono text-[13px] text-text">
            #{subtask.id} · {subtask.type}
          </div>
        </div>
        <span
          className="inline-flex items-center h-[22px] px-2 rounded-full font-mono text-[10px] uppercase tracking-[0.08em]"
          style={{ background: `${headlineColor}1A`, color: headlineColor }}
        >
          needs your call
        </span>
      </header>

      <div className="px-6 md:px-8 py-5 space-y-4">
        <div>
          <div className="font-mono text-[10px] uppercase tracking-[0.08em] text-text-subtle mb-1.5">
            What happened
          </div>
          <p className="text-[13px] leading-[1.55] text-text-muted">{errorText}</p>
        </div>

        <div>
          <div className="font-mono text-[10px] uppercase tracking-[0.08em] text-text-subtle mb-2">
            What you can do
          </div>
          {!picking && (
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                disabled={!canRetry || busy}
                onClick={() => void runRetry()}
                title={
                  canRetry
                    ? 'Re-spawn this sub-task with the same executor.'
                    : 'Retry is only available after an explicit dispute.'
                }
                className="h-9 px-4 rounded-[8px] border font-mono text-[12px] transition-colors disabled:cursor-not-allowed disabled:opacity-50 border-border text-text hover:border-cyan"
              >
                {busy ? 'Retrying…' : 'Retry sub-task'}
              </button>
              <button
                type="button"
                disabled={!canRetry || busy}
                onClick={() => setPicking(true)}
                title={
                  canRetry
                    ? 'Pick a different executor and re-spawn.'
                    : 'Change-executor is only available after an explicit dispute.'
                }
                className="h-9 px-4 rounded-[8px] border font-mono text-[12px] transition-colors disabled:cursor-not-allowed disabled:opacity-50 border-border text-text hover:border-cyan"
              >
                Change executor
              </button>
              <button
                type="button"
                onClick={onCancelRun}
                disabled={busy}
                className="h-9 px-4 rounded-[8px] border border-border font-mono text-[12px] text-text hover:border-cyan transition-colors disabled:cursor-not-allowed disabled:opacity-50"
              >
                Cancel run
              </button>
            </div>
          )}

          {picking && (
            <div className="rounded-[10px] border border-border bg-[#0A0A0F] p-4 space-y-3">
              <div className="font-mono text-[11px] text-text-subtle">
                Current executor: <span className="text-text">{shortAddr(currentExecutor)}</span>
              </div>
              <div className="flex flex-wrap gap-2">
                {WORKER_OPTIONS.filter((w) => !!w.address).map((w) => {
                  const isCurrent =
                    !!currentExecutor &&
                    !!w.address &&
                    w.address.toLowerCase() === currentExecutor.toLowerCase();
                  return (
                    <button
                      key={w.label}
                      type="button"
                      disabled={isCurrent || busy}
                      onClick={() => void runRetry(w.address)}
                      title={
                        isCurrent
                          ? 'Already the current executor — pick a different worker.'
                          : `Re-spawn with ${w.label} (${shortAddr(w.address)}).`
                      }
                      className="h-9 px-3 rounded-[8px] border border-border font-mono text-[12px] text-text hover:border-cyan transition-colors disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {w.label}
                      <span className="ml-2 text-text-subtle">{shortAddr(w.address)}</span>
                    </button>
                  );
                })}
                <button
                  type="button"
                  onClick={() => setPicking(false)}
                  disabled={busy}
                  className="h-9 px-3 rounded-[8px] border border-border font-mono text-[12px] text-text-subtle hover:text-text transition-colors disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Back
                </button>
              </div>
              <p className="text-[11px] text-text-subtle leading-[1.5]">
                Pick triggers a new <code className="font-mono">createTask</code> with the chosen executor. The graph
                node resets to waiting and proceeds from there.
              </p>
            </div>
          )}

          {!canRetry && reason === 'errored' && (
            <p className="mt-3 text-[11px] text-text-subtle leading-[1.5]">
              Errored sub-tasks already tore down the run channel — there is
              nothing left to resume. Cancel and start a new plan.
            </p>
          )}
        </div>
      </div>
    </section>
  );
}
