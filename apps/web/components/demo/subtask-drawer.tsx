'use client';

import { useEffect } from 'react';

import type { SubTaskRuntime, WireSubTask } from '@/hooks/use-composite-demo';

/**
 * Slide-out drawer surfacing one sub-task's runtime detail. Renders when a
 * node is clicked in the plan-graph. Closes on backdrop click, on the close
 * button, or on Escape.
 *
 * Content (per M10.3.6):
 * - Spec + executor address (with Basescan link)
 * - Status timeline (started / completed / elapsed)
 * - Result content — rendered inline if `data:text/plain,…`, otherwise as
 *   a link to the raw URI
 * - Tx hashes (Basescan links per chain explorer)
 * - Error message when sub-task is in `errored` / `disputed`
 *
 * Manual Approve / Dispute buttons are out of scope for v1 — the plan-runner
 * currently auto-approves on Completed (M10.2.4). Per-step user gating is
 * deferred to M10.4.x along with the dispute path.
 */

interface SubtaskDrawerProps {
  subtask: WireSubTask | null;
  runtime: SubTaskRuntime | undefined;
  explorerUrl: string | null;
  onClose: () => void;
}

export function SubtaskDrawer({
  subtask,
  runtime,
  explorerUrl,
  onClose,
}: SubtaskDrawerProps) {
  // Escape-to-close.
  useEffect(() => {
    if (!subtask) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [subtask, onClose]);

  if (!subtask) return null;

  const status = runtime?.status ?? 'waiting';
  const elapsed = computeElapsed(runtime);

  return (
    <div className="fixed inset-0 z-50">
      <button
        type="button"
        aria-label="Close drawer"
        onClick={onClose}
        className="absolute inset-0 bg-black/40 backdrop-blur-[2px] cursor-default"
      />
      <aside
        role="dialog"
        aria-labelledby="subtask-drawer-title"
        className="absolute right-0 top-0 h-full w-full sm:w-[480px] bg-surface border-l border-border overflow-y-auto animate-[slide-in-right_220ms_ease-out]"
        style={{ animationName: 'slide-in-right' }}
      >
        <header className="sticky top-0 bg-surface border-b border-border px-5 py-4 flex items-start justify-between gap-3 z-10">
          <div>
            <div className="font-mono text-[11px] uppercase tracking-[0.08em] text-text-subtle">
              Sub-task #{subtask.id}
            </div>
            <h3 id="subtask-drawer-title" className="font-mono text-[15px] text-text mt-1">
              {subtask.type}
            </h3>
          </div>
          <div className="flex items-center gap-2">
            <StatusBadge status={status} />
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="h-7 w-7 rounded-[6px] border border-border text-text-subtle hover:text-text hover:border-text-muted font-mono"
            >
              ✕
            </button>
          </div>
        </header>

        <div className="px-5 py-5 space-y-5">
          <Section title="Spec">
            <p className="text-[13px] leading-[1.6] text-text-muted whitespace-pre-wrap">
              {subtask.spec || <em>(none)</em>}
            </p>
          </Section>

          <Section title="Executor">
            {subtask.executor_address ? (
              <AddressLink
                address={subtask.executor_address}
                explorerUrl={explorerUrl}
              />
            ) : (
              <span className="font-mono text-[12px] text-text-subtle italic">
                unassigned
              </span>
            )}
          </Section>

          {runtime?.taskId && (
            <Section title="On-chain Task ID">
              <span className="font-mono text-[12px] text-text">
                #{runtime.taskId}
              </span>
            </Section>
          )}

          <Section title="Timing">
            <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 font-mono text-[12px]">
              <dt className="text-text-subtle">Started</dt>
              <dd className="text-text">{runtime?.startedAt ? formatTime(runtime.startedAt) : '—'}</dd>
              <dt className="text-text-subtle">Completed</dt>
              <dd className="text-text">
                {runtime?.completedAt ? formatTime(runtime.completedAt) : '—'}
              </dd>
              <dt className="text-text-subtle">Elapsed</dt>
              <dd className="text-text">{elapsed}</dd>
              <dt className="text-text-subtle">Deadline</dt>
              <dd className="text-text">{subtask.deadline_offset_s}s</dd>
            </dl>
          </Section>

          <Section title="Cost">
            <span className="font-mono text-[13px] text-text">
              {formatUsdc(subtask.estimated_cost_units)}
            </span>
          </Section>

          {runtime?.result && (
            <Section title="Result">
              <p className="text-[13px] leading-[1.6] text-text whitespace-pre-wrap break-words">
                {runtime.result}
              </p>
            </Section>
          )}

          {runtime?.resultUri &&
            !runtime.result &&
            !runtime.resultUri.startsWith('data:text/plain,') && (
              <Section title="Result URI">
                <a
                  href={runtime.resultUri}
                  target="_blank"
                  rel="noreferrer"
                  className="font-mono text-[12px] text-cyan hover:underline underline-offset-4 break-all"
                >
                  {runtime.resultUri}
                </a>
              </Section>
            )}

          {runtime?.txHashes && runtime.txHashes.length > 0 && (
            <Section title="Transactions">
              <ul className="space-y-1.5">
                {runtime.txHashes.map((tx) => (
                  <li key={tx}>
                    {explorerUrl ? (
                      <a
                        href={`${explorerUrl}/tx/${tx}`}
                        target="_blank"
                        rel="noreferrer"
                        className="font-mono text-[12px] text-cyan hover:underline underline-offset-4"
                      >
                        {tx.slice(0, 12)}…{tx.slice(-6)} ↗
                      </a>
                    ) : (
                      <span className="font-mono text-[12px] text-cyan break-all">
                        {tx}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </Section>
          )}

          {runtime?.error && (
            <Section title="Error" tone="error">
              <p className="text-[13px] leading-[1.55] text-pink whitespace-pre-wrap">
                {runtime.error}
              </p>
            </Section>
          )}
        </div>
      </aside>

      <style jsx>{`
        @keyframes slide-in-right {
          from {
            transform: translateX(8%);
            opacity: 0;
          }
          to {
            transform: translateX(0);
            opacity: 1;
          }
        }
      `}</style>
    </div>
  );
}

// ───────────────────────────────────────────────────────────────────────

function Section({
  title,
  tone,
  children,
}: {
  title: string;
  tone?: 'error';
  children: React.ReactNode;
}) {
  return (
    <div>
      <div
        className="font-mono text-[10px] uppercase tracking-[0.08em] mb-1.5"
        style={{ color: tone === 'error' ? '#F472B6' : '#6E6E85' }}
      >
        {title}
      </div>
      {children}
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const color = STATUS_COLORS[status] ?? '#6E6E85';
  return (
    <span
      className="inline-flex items-center h-[22px] px-2 rounded-full font-mono text-[10px] uppercase tracking-[0.08em]"
      style={{ background: `${color}1A`, color }}
    >
      <span
        className="w-[6px] h-[6px] rounded-full mr-2"
        style={{ background: color }}
        aria-hidden
      />
      {status}
    </span>
  );
}

function AddressLink({
  address,
  explorerUrl,
}: {
  address: string;
  explorerUrl: string | null;
}) {
  const text = `${address.slice(0, 6)}…${address.slice(-4)}`;
  if (!explorerUrl) {
    return <span className="font-mono text-[12px] text-text">{text}</span>;
  }
  return (
    <a
      href={`${explorerUrl}/address/${address}`}
      target="_blank"
      rel="noreferrer"
      className="font-mono text-[12px] text-cyan hover:underline underline-offset-4"
    >
      {text} ↗
    </a>
  );
}

const STATUS_COLORS: Record<string, string> = {
  waiting: '#6E6E85',
  created: '#A78BFA',
  accepted: '#5EE3F5',
  completed: '#F472B6',
  paid: '#6EE7B7',
  errored: '#F87171',
  disputed: '#F87171',
};

function computeElapsed(rt: SubTaskRuntime | undefined): string {
  if (!rt?.startedAt) return '—';
  const end = rt.completedAt ?? Date.now();
  const ms = end - rt.startedAt;
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const mins = Math.floor(ms / 60_000);
  const secs = Math.round((ms % 60_000) / 1000);
  return `${mins}m ${secs}s`;
}

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

function formatUsdc(amountStr: string): string {
  try {
    const amt = BigInt(amountStr);
    const whole = amt / 1_000_000n;
    const frac = amt % 1_000_000n;
    const fracStr = frac.toString().padStart(6, '0').slice(0, 3);
    return `${whole.toString()}.${fracStr} USDC`;
  } catch {
    return amountStr;
  }
}
