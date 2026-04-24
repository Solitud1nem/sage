'use client';

import { useEffect, useRef } from 'react';

import type { DemoEvent } from '@/hooks/use-demo-stream';

const EVENT_COLORS: Record<string, string> = {
  run_started: '#6E6E85',
  stage_started: '#6E6E85',
  task_created: '#5EE3F5',
  task_accepted: '#A78BFA',
  task_completed: '#F472B6',
  task_paid: '#6EE7B7',
  done: '#6EE7B7',
  error: '#F472B6',
};

export function EventLog({ events }: { events: DemoEvent[] }) {
  const logRef = useRef<HTMLOListElement | null>(null);

  useEffect(() => {
    // Auto-scroll to newest event.
    const el = logRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [events.length]);

  return (
    <section className="rounded-[14px] border border-border bg-surface p-6 md:p-8">
      <header className="flex items-center justify-between gap-3 mb-5">
        <h2 className="font-mono text-[13px]">
          <span className="text-text-subtle">03</span>{' '}
          <span className="font-medium">Event log</span>
        </h2>
        <span className="font-mono text-[11px] text-text-subtle">
          {events.length} event{events.length === 1 ? '' : 's'}
        </span>
      </header>

      {events.length === 0 ? (
        <div className="py-10 text-center text-[13px] text-text-subtle">
          No events yet. Hit <span className="text-text-muted">Run task</span> to begin.
        </div>
      ) : (
        <ol
          ref={logRef}
          className="font-mono text-[12px] leading-[1.7] max-h-[280px] overflow-y-auto space-y-1"
        >
          {events.map((ev) => (
            <li key={ev.id} className="flex items-start gap-3">
              <span className="text-text-subtle">{formatTime(ev.receivedAt)}</span>
              <span style={{ color: EVENT_COLORS[ev.event] ?? '#EDEDF5' }}>{ev.event}</span>
              <span className="text-text-muted truncate">{formatPayload(ev)}</span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

function formatTime(ms: number): string {
  const d = new Date(ms);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function pad(n: number): string {
  return n.toString().padStart(2, '0');
}

function formatPayload(ev: DemoEvent): string {
  const d = ev.data;
  const stage = typeof d.stage === 'string' ? d.stage : '';
  const taskId = typeof d.taskId === 'string' ? `#${d.taskId}` : '';
  const txHash =
    typeof d.txHash === 'string' ? ` ${d.txHash.slice(0, 6)}…${d.txHash.slice(-4)}` : '';
  const resultUri = typeof d.resultUri === 'string' ? truncate(d.resultUri, 22) : '';

  const parts: string[] = [stage, taskId, txHash, resultUri].filter(Boolean);
  return parts.join(' ').trim();
}

function truncate(s: string, n: number): string {
  if (s.length <= n) return s;
  return `${s.slice(0, Math.floor(n / 2))}…${s.slice(-Math.floor(n / 2))}`;
}
