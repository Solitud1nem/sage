'use client';

import type { SubTaskRuntime, WireSubTask } from '@/hooks/use-composite-demo';

/**
 * Inline prompt that appears mid-execution when a sub-task either errors
 * or is explicitly disputed. Three actions:
 *
 *   - **Cancel run** — functional in v1. Calls back to the page-level
 *     reset, ending the plan.
 *   - **Retry sub-task** — present but disabled. Real implementation
 *     requires a backend endpoint to spawn a replacement `TaskEscrow`
 *     with the same params and graft it into the running plan. Deferred
 *     to M10.5.
 *   - **Change executor** — also present but disabled. Same blocker as
 *     retry, plus a UI affordance to pick a new executor before
 *     re-spawning.
 *
 * Visually present-but-disabled is the deliberate choice: the dispute
 * path is wired end-to-end (plan-runner emits `subtask_disputed`, hook
 * captures `disputedSubId`, this prompt renders), so the *flow* is
 * legible even if two of the three actions are pending. Users get an
 * honest signal about what's not yet possible rather than missing UI.
 */

interface ReplanPromptProps {
  /** The disputed or errored sub-task. */
  subtask: WireSubTask;
  /** The runtime detail (status, error message, etc.). */
  runtime: SubTaskRuntime | undefined;
  /** Whether this was an explicit dispute or a generic execution error. */
  reason: 'disputed' | 'errored';
  /** End the plan and return to idle. Functional in v1. */
  onCancelRun: () => void;
}

export function ReplanPrompt({
  subtask,
  runtime,
  reason,
  onCancelRun,
}: ReplanPromptProps) {
  const headlineColor = reason === 'disputed' ? '#F472B6' : '#F87171';
  const headlineLabel =
    reason === 'disputed' ? 'Sub-task disputed' : 'Sub-task errored';
  const errorText = runtime?.error ?? 'No detail available.';

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
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled
              title="Coming in M10.5 — backend endpoint to spawn a replacement TaskEscrow with the same params. Track issue in IDEAS.md."
              className="h-9 px-4 rounded-[8px] border border-border font-mono text-[12px] text-text-subtle cursor-not-allowed opacity-50"
            >
              Retry sub-task
            </button>
            <button
              type="button"
              disabled
              title="Coming in M10.5 — pick a new executor and re-spawn. Requires the same backend endpoint as Retry."
              className="h-9 px-4 rounded-[8px] border border-border font-mono text-[12px] text-text-subtle cursor-not-allowed opacity-50"
            >
              Change executor
            </button>
            <button
              type="button"
              onClick={onCancelRun}
              className="h-9 px-4 rounded-[8px] border border-border font-mono text-[12px] text-text hover:border-cyan transition-colors"
            >
              Cancel run
            </button>
          </div>
          <p className="mt-3 text-[11px] text-text-subtle leading-[1.5]">
            Retry and Change-executor surfaces are wired but their backend (a
            new <code className="font-mono">/composite/retry-subtask</code>{' '}
            endpoint and replan-graft logic in <code className="font-mono">plan-runner.ts</code>) ships in M10.5.
            Cancel ends the plan and returns to idle; the on-chain sub-tasks
            already settled stay paid.
          </p>
        </div>
      </div>
    </section>
  );
}
