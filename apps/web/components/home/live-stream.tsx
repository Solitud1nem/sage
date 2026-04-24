'use client';

import { useEffect, useState } from 'react';

import { BASE_MAINNET, txUrl } from '@/chains/base';
import {
  formatEventPayload,
  relativeTime,
  useLiveTxStream,
  type LiveTxEvent,
} from '@/hooks/use-live-tx-stream';
import { StatusPill } from '@/components/status-pill';

const rowOpacity = [1, 0.92, 0.82, 0.72, 0.6];

const methodColor: Record<string, string> = {
  createTask: '#5EE3F5',
  acceptTask: '#A78BFA',
  completeTask: '#F472B6',
  approvePayment: '#6EE7B7',
  disputeTask: '#F472B6',
  refundExpired: '#8787A5',
};

export function LiveStream() {
  const { events, isLoading, error } = useLiveTxStream({ limit: 5 });

  return (
    <section id="live" className="mx-auto max-w-[1200px] px-6 md:px-10 py-20">
      <div className="flex items-center gap-4 mb-8">
        <StatusPill>Live tx stream</StatusPill>
        <span className="font-mono text-[11px] text-text-subtle">
          {BASE_MAINNET.displayName} mainnet
        </span>
      </div>

      <div className="rounded-[14px] border border-border bg-surface overflow-hidden">
        {isLoading && events.length === 0 && <LoadingState />}
        {!isLoading && events.length === 0 && !error && <EmptyState />}
        {error && <ErrorState error={error} />}

        {events.length > 0 && (
          <ul className="divide-y divide-border">
            {events.map((ev, i) => (
              <TxRow key={`${ev.txHash}-${ev.eventName}`} event={ev} opacity={rowOpacity[i] ?? 0.6} />
            ))}
          </ul>
        )}

        <div className="flex items-center justify-between px-5 py-3 border-t border-border bg-canvas/40">
          <span className="text-[11px] text-text-subtle">
            Streaming from <span className="font-mono text-text-muted">AgentRegistry</span> +{' '}
            <span className="font-mono text-text-muted">TaskEscrow</span> on Base mainnet.
          </span>
          <a
            href={`${BASE_MAINNET.explorer}/address/${BASE_MAINNET.contracts.taskEscrow}`}
            target="_blank"
            rel="noreferrer"
            className="text-[11px] text-cyan hover:underline underline-offset-4"
          >
            Basescan ↗
          </a>
        </div>
      </div>
    </section>
  );
}

function TxRow({ event, opacity }: { event: LiveTxEvent; opacity: number }) {
  const [, forceUpdate] = useState(0);
  useEffect(() => {
    const t = setInterval(() => forceUpdate((n) => n + 1), 15_000);
    return () => clearInterval(t);
  }, []);

  const color = methodColor[event.methodName] ?? '#EDEDF5';
  return (
    <li style={{ opacity }} className="transition-opacity duration-500">
      <a
        href={txUrl(BASE_MAINNET.chainId, event.txHash)}
        target="_blank"
        rel="noreferrer"
        className="grid grid-cols-[auto_1fr_auto_auto] items-center gap-5 px-5 py-3 font-mono text-[12px] hover:bg-surface-2 transition-colors duration-150"
      >
        <span style={{ color }}>▲</span>
        <span className="text-cyan truncate">
          {event.txHash.slice(0, 10)}…{event.txHash.slice(-4)}
        </span>
        <span className="flex items-baseline gap-3">
          <span className="text-text-muted">{event.methodName}</span>
          <span style={{ color }}>{formatEventPayload(event)}</span>
        </span>
        <span className="text-text-subtle text-[11px]">{relativeTime(event.receivedAt)}</span>
      </a>
    </li>
  );
}

function LoadingState() {
  return (
    <div className="px-5 py-10 text-center">
      <p className="font-mono text-[12px] text-text-subtle">
        Loading recent events from Base mainnet…
      </p>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="px-5 py-10 text-center space-y-2">
      <p className="font-mono text-[12px] text-text-muted">
        Awaiting first event on Base mainnet.
      </p>
      <p className="text-[13px] text-text-subtle">
        Or{' '}
        <a href="/demo" className="text-purple hover:underline underline-offset-4">
          run the demo →
        </a>
      </p>
    </div>
  );
}

function ErrorState({ error }: { error: Error }) {
  return (
    <div className="px-5 py-10 text-center">
      <p className="font-mono text-[12px] text-pink">
        Stream error: {error.message.slice(0, 80)}
      </p>
      <p className="text-[11px] text-text-subtle mt-1">
        Retrying on the next block. Check Basescan directly if this persists.
      </p>
    </div>
  );
}
