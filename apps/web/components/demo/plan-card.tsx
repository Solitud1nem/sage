'use client';

import type { WireClassification, WireSubTask } from '@/hooks/use-composite-demo';
import { formatUsdc } from '@/lib/format-usdc';

/**
 * Read-only rendering of a `ClassificationResult` (or the snapshot derived
 * from one). Surfaces the classifier's reasoning and per-subtask breakdown,
 * with a confidence badge for each axis. Three buttons gate the next step:
 *
 *   - Approve  → caller commits the plan as-is and starts execution.
 *   - Edit     → caller flips into plan-editor mode (M10.3.4).
 *   - Cancel   → caller resets to idle.
 *
 * Confidence threshold = 0.7 (from `classification-trigger-design.md` §5).
 * Below that we tint the badge to warn the user that the heuristic /
 * classifier was uncertain — they should look harder before approving.
 */

const CONFIDENCE_THRESHOLD = 0.7;

interface PlanCardProps {
  classification: WireClassification;
  brief: string;
  onApprove: () => void;
  /** Absent for fixed-template plans (website pipeline) — hides the Edit button. */
  onEdit?: () => void;
  onCancel: () => void;
}

export function PlanCard({
  classification,
  brief,
  onApprove,
  onEdit,
  onCancel,
}: PlanCardProps) {
  const {
    decomposability,
    stakes,
    confidence_decomposability,
    confidence_stakes,
    estimated_total_cost_units,
    estimated_duration_ms,
    proposed_plan,
    reasoning,
  } = classification;

  // Block Approve when any sub-task lacks a VALID executor address. High-stakes
  // plans strip the LLM-emitted executor by design, and the plan-editor's
  // "Custom address…" seeds a bare '0x' placeholder — both must resolve to a
  // real 40-hex address before execute (the server rejects malformed ones, so
  // failing here just avoids a wasted round-trip).
  const isValidExecutor = (a: string | undefined): boolean => /^0x[a-fA-F0-9]{40}$/.test(a ?? '');
  const hasUnassigned = proposed_plan.some((s) => !isValidExecutor(s.executor_address));

  return (
    <section className="rounded-[14px] border border-border bg-surface overflow-hidden">
      <header className="px-6 md:px-8 pt-6 pb-4 border-b border-border">
        <div className="flex items-center justify-between gap-3 mb-4">
          <h2 className="font-mono text-[13px]">
            <span className="text-text-subtle">02</span>{' '}
            <span className="font-medium">Proposed plan</span>
          </h2>
          <div className="flex flex-wrap items-center gap-2">
            <AxisBadge
              label={decomposability}
              accent={decomposability === 'composite' ? '#A78BFA' : '#6EE7B7'}
            />
            <AxisBadge
              label={`${stakes} stakes`}
              accent={stakes === 'high' ? '#F472B6' : '#6EE7B7'}
            />
            <ConfidenceBadge label="dec" value={confidence_decomposability} />
            <ConfidenceBadge label="stk" value={confidence_stakes} />
          </div>
        </div>

        <div className="font-mono text-[11px] uppercase tracking-[0.08em] text-text-subtle mb-2">
          Brief
        </div>
        <p className="text-[14px] leading-[1.55] text-text-muted line-clamp-3">
          {brief}
        </p>

        <div className="mt-4 font-mono text-[11px] uppercase tracking-[0.08em] text-text-subtle mb-2">
          Reasoning
        </div>
        <p className="text-[13px] leading-[1.55] text-text-muted italic">{reasoning}</p>
      </header>

      <ol className="divide-y divide-border">
        {proposed_plan.map((sub) => (
          <SubTaskRow key={sub.id} sub={sub} />
        ))}
      </ol>

      <footer className="px-6 md:px-8 py-5 border-t border-border flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex flex-wrap items-baseline gap-x-6 gap-y-2">
          <div>
            <div className="font-mono text-[11px] uppercase tracking-[0.08em] text-text-subtle">
              Total cost
            </div>
            <div className="font-mono text-[16px] text-text font-medium">
              {formatUsdc(estimated_total_cost_units)}
            </div>
          </div>
          <div>
            <div className="font-mono text-[11px] uppercase tracking-[0.08em] text-text-subtle">
              Est. duration
            </div>
            <div className="font-mono text-[13px] text-text-muted">
              {formatDuration(estimated_duration_ms)}
            </div>
          </div>
          <div>
            <div className="font-mono text-[11px] uppercase tracking-[0.08em] text-text-subtle">
              Sub-tasks
            </div>
            <div className="font-mono text-[13px] text-text-muted">
              {proposed_plan.length}
            </div>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="h-9 px-4 rounded-[8px] border border-border font-mono text-[12px] text-text-muted hover:text-text hover:border-text-muted transition-colors"
          >
            Cancel
          </button>
          {onEdit && (
            <button
              type="button"
              onClick={onEdit}
              className="h-9 px-4 rounded-[8px] border border-border font-mono text-[12px] text-text hover:border-purple transition-colors"
            >
              Edit
            </button>
          )}
          <button
            type="button"
            onClick={onApprove}
            disabled={hasUnassigned}
            title={
              hasUnassigned
                ? 'Some sub-tasks have no executor — open Edit to assign before approving.'
                : undefined
            }
            className="h-9 px-5 rounded-[8px] bg-cyan text-[#0A0A0F] font-mono text-[12px] font-medium hover:bg-[#7AEAF8] transition-colors disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-cyan"
          >
            Approve · Execute
          </button>
        </div>
      </footer>
      {hasUnassigned && (
        <div className="px-6 md:px-8 pb-5 -mt-2 font-mono text-[11px] text-[#F472B6]">
          ⓘ One or more sub-tasks need an executor. Click <strong>Edit</strong> to
          assign before approving.
        </div>
      )}
    </section>
  );
}

// ───────────────────────────────────────────────────────────────────────

function SubTaskRow({ sub }: { sub: WireSubTask }) {
  return (
    <li className="px-6 md:px-8 py-4 grid grid-cols-1 sm:grid-cols-[36px_1fr_auto] gap-x-4 gap-y-2 items-start">
      <div className="font-mono text-[13px] text-text-subtle">#{sub.id}</div>

      <div>
        <div className="flex flex-wrap items-center gap-2 mb-1">
          <span className="font-mono text-[13px] text-text">{sub.type}</span>
          {sub.evaluates !== undefined && (
            <span
              className="font-mono text-[11px] px-2 py-[1px] rounded-full border"
              style={{ borderColor: '#A78BFA', color: '#A78BFA' }}
              title="Paid evaluator: its verdict releases or disputes the judged step's payment."
            >
              ⚖ judges #{sub.evaluates}
            </span>
          )}
          {sub.depends_on && sub.depends_on.length > 0 && (
            <span className="font-mono text-[11px] text-text-subtle">
              ← depends on{' '}
              {sub.depends_on.map((d, i) => (
                <span key={d}>
                  #{d}
                  {i < sub.depends_on!.length - 1 && ', '}
                </span>
              ))}
            </span>
          )}
        </div>
        <p className="text-[13px] leading-[1.55] text-text-muted">{sub.spec}</p>
      </div>

      <div className="sm:text-right flex sm:flex-col gap-4 sm:gap-1 items-baseline sm:items-end">
        <div>
          <div className="font-mono text-[11px] uppercase tracking-[0.08em] text-text-subtle">
            Cost
          </div>
          <div className="font-mono text-[13px] text-text">
            {formatUsdc(sub.estimated_cost_units)}
          </div>
        </div>
        <div>
          <div className="font-mono text-[11px] uppercase tracking-[0.08em] text-text-subtle">
            {sub.executor_address ? 'Executor' : 'Executor'}
          </div>
          <div className="font-mono text-[12px] text-text-muted">
            {sub.executor_address ? shortAddr(sub.executor_address) : <em>unassigned</em>}
          </div>
        </div>
      </div>
    </li>
  );
}

function AxisBadge({ label, accent }: { label: string; accent: string }) {
  return (
    <span
      className="inline-flex items-center h-[22px] px-2 rounded-full border font-mono text-[10px] uppercase tracking-[0.08em]"
      style={{ borderColor: accent, color: accent }}
    >
      {label}
    </span>
  );
}

function ConfidenceBadge({ label, value }: { label: string; value: number }) {
  const ok = value >= CONFIDENCE_THRESHOLD;
  const color = ok ? '#6EE7B7' : '#F59E0B';
  return (
    <span
      className="inline-flex items-center h-[22px] px-2 rounded-full font-mono text-[10px] uppercase tracking-[0.08em]"
      style={{ background: `${color}1A`, color }}
      title={ok ? 'Above 0.7 threshold' : 'Below 0.7 threshold — classifier was uncertain'}
    >
      {label} {value.toFixed(2)}
    </span>
  );
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const mins = Math.floor(ms / 60_000);
  const secs = Math.round((ms % 60_000) / 1000);
  return `${mins}m ${secs}s`;
}

function shortAddr(addr: string): string {
  if (addr.length < 12) return addr;
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}
