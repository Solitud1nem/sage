'use client';

import { useEffect, useState } from 'react';
import { usePublicClient } from 'wagmi';
import type { Abi, ContractEventName, Log } from 'viem';

import { BASE_MAINNET } from '@/chains/base';
import {
  EVENT_TO_METHOD,
  taskEscrowEventsAbi,
  type TaskEscrowEventName,
} from '@/lib/abi/task-escrow-events';

export interface LiveTxEvent {
  txHash: `0x${string}`;
  blockNumber: bigint;
  eventName: TaskEscrowEventName;
  methodName: string;
  args: Record<string, unknown>;
  receivedAt: number;
}

interface UseLiveTxStreamOptions {
  /** Max rows to keep. Default 5. */
  limit?: number;
  /** How many past blocks to seed the stream from on mount. Default 10000 (~4h on Base at 2s blocks). */
  historyBlocks?: bigint;
}

/**
 * Subscribes to TaskEscrow events on Base mainnet + seeds with recent history.
 * Returns events newest-first, trimmed to `limit`.
 *
 * Client component only (uses wagmi hook context).
 */
export function useLiveTxStream({
  limit = 5,
  historyBlocks = 10_000n,
}: UseLiveTxStreamOptions = {}): {
  events: LiveTxEvent[];
  isLoading: boolean;
  error: Error | null;
} {
  const publicClient = usePublicClient({ chainId: BASE_MAINNET.chainId });
  const [events, setEvents] = useState<LiveTxEvent[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    if (!publicClient) return;
    let cancelled = false;

    // 1. Seed stream with recent history via getLogs.
    async function seed() {
      try {
        const head = await publicClient!.getBlockNumber();
        const fromBlock = head > historyBlocks ? head - historyBlocks : 0n;
        const logs = await publicClient!.getLogs({
          address: BASE_MAINNET.contracts.taskEscrow,
          events: taskEscrowEventsAbi,
          fromBlock,
          toBlock: head,
        });
        if (cancelled) return;
        const parsed = logs
          .map(toLiveEvent)
          .filter((e): e is LiveTxEvent => e !== null)
          .sort((a, b) => (b.blockNumber > a.blockNumber ? 1 : -1))
          .slice(0, limit);
        setEvents(parsed);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err : new Error(String(err)));
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }

    seed();

    // 2. Subscribe to new events going forward.
    const unwatch = publicClient.watchContractEvent({
      address: BASE_MAINNET.contracts.taskEscrow,
      abi: taskEscrowEventsAbi as Abi,
      onLogs(logs) {
        const fresh = logs
          .map(toLiveEvent)
          .filter((e): e is LiveTxEvent => e !== null);
        if (fresh.length === 0) return;
        setEvents((prev) => mergeTrim(fresh, prev, limit));
      },
      onError(err) {
        setError(err);
      },
    });

    return () => {
      cancelled = true;
      unwatch();
    };
  }, [publicClient, limit, historyBlocks]);

  return { events, isLoading, error };
}

function toLiveEvent(log: Log): LiveTxEvent | null {
  const eventName = (log as unknown as { eventName?: string }).eventName;
  const args = (log as unknown as { args?: Record<string, unknown> }).args;
  if (!eventName || !log.transactionHash || log.blockNumber === null) return null;
  if (!(eventName in EVENT_TO_METHOD)) return null;
  return {
    txHash: log.transactionHash,
    blockNumber: log.blockNumber,
    eventName: eventName as TaskEscrowEventName,
    methodName: EVENT_TO_METHOD[eventName as TaskEscrowEventName],
    args: args ?? {},
    receivedAt: Date.now(),
  };
}

function mergeTrim(fresh: LiveTxEvent[], existing: LiveTxEvent[], limit: number): LiveTxEvent[] {
  // Newest-first; fresh events from a single watchContractEvent batch are in chain order.
  const ordered = [...fresh].reverse();
  const seen = new Set(existing.map((e) => `${e.txHash}-${e.eventName}`));
  const deduped = ordered.filter((e) => !seen.has(`${e.txHash}-${e.eventName}`));
  return [...deduped, ...existing].slice(0, limit);
}

/**
 * Format an event for display in the TxRow component.
 * Returns the payload shown after the method name.
 */
export function formatEventPayload(ev: LiveTxEvent): string {
  switch (ev.eventName) {
    case 'TaskCreated': {
      const amount = ev.args.amount as bigint | undefined;
      return amount ? `${formatUsdc(amount)} USDC` : '—';
    }
    case 'TaskAccepted': {
      const exec = ev.args.executor as string | undefined;
      return exec ? shorten(exec) : '—';
    }
    case 'TaskCompleted': {
      const uri = ev.args.resultUri as string | undefined;
      return uri ? truncateUri(uri) : '—';
    }
    case 'TaskPaid':
      return '+USDC released';
    case 'TaskDisputed':
      return 'disputed';
    case 'TaskExpired':
      return 'refunded';
  }
}

function formatUsdc(amount: bigint): string {
  // USDC has 6 decimals. Show up to 3 fractional digits.
  const whole = amount / 1_000_000n;
  const frac = amount % 1_000_000n;
  const fracStr = frac.toString().padStart(6, '0').slice(0, 3);
  return `${whole.toString()}.${fracStr}`;
}

function shorten(addr: string): string {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

function truncateUri(uri: string): string {
  if (uri.length <= 22) return uri;
  return `${uri.slice(0, 10)}…${uri.slice(-6)}`;
}

export function relativeTime(fromMs: number): string {
  const secs = Math.max(1, Math.floor((Date.now() - fromMs) / 1000));
  if (secs < 60) return `${secs}s ago`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

// Hint to satisfy unused-import linter if ContractEventName types change upstream.
export type _EventName = ContractEventName<typeof taskEscrowEventsAbi>;
