import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { TaskStatus, taskId as makeTaskId, agentId } from '@sage/core';
import type { TaskId, TaskRecord } from '@sage/core';

import { scheduleReclaim, __testing } from '../../src/parent/escrow-reclaim.js';

const { reclaimOne } = __testing;

// ─── helpers ─────────────────────────────────────────────────────────────

function makeReclaimBundle(opts: {
  /** Status getTask reports; `null` → task not found. */
  status: TaskStatus | null;
  refundReceiptStatus?: 'success' | 'reverted';
  refundError?: Error;
}) {
  const calls = {
    getTask: 0,
    refund: 0,
    receipts: [] as string[],
  };
  const bundle = {
    sage: {
      tasks: {
        async getTask(id: TaskId): Promise<TaskRecord | null> {
          calls.getTask += 1;
          if (opts.status === null) return null;
          return {
            id,
            client: agentId('0x0000000000000000000000000000000000000000'),
            executor: agentId('0xa61b00000000000000000000000000000000001c'),
            amount: 100_000n,
            deadline: 0,
            status: opts.status,
            specUri: '',
            resultUri: '',
            completedAt: 0,
          };
        },
        async refundExpired(id: TaskId): Promise<string> {
          calls.refund += 1;
          if (opts.refundError) throw opts.refundError;
          return `0xrefund_${id}`;
        },
      },
    },
    publicClient: {
      async waitForTransactionReceipt({ hash }: { hash: `0x${string}` }) {
        calls.receipts.push(hash);
        return { status: opts.refundReceiptStatus ?? 'success', transactionHash: hash };
      },
    },
  };
  return { bundle, calls };
}

function stranded(deadline = Math.floor(Date.now() / 1000) - 100) {
  return { subId: 1, taskId: makeTaskId('7'), deadline };
}

// ─── reclaimOne — per-status behavior ────────────────────────────────────

describe('escrow-reclaim — reclaimOne', () => {
  it('refunds a task stuck in Created', async () => {
    const { bundle, calls } = makeReclaimBundle({ status: TaskStatus.Created });
    await reclaimOne(bundle, stranded(), { runId: 'r' });
    expect(calls.refund).toBe(1);
    expect(calls.receipts).toEqual(['0xrefund_7']);
  });

  it('refunds a task stuck in Accepted', async () => {
    const { bundle, calls } = makeReclaimBundle({ status: TaskStatus.Accepted });
    await reclaimOne(bundle, stranded(), { runId: 'r' });
    expect(calls.refund).toBe(1);
  });

  it('routes a Disputed task to the stranded resolver, not refundExpired', async () => {
    const { bundle, calls } = makeReclaimBundle({ status: TaskStatus.Disputed });
    const resolveStranded = vi.fn(async () => '0xresolve');
    await reclaimOne(bundle, stranded(), { runId: 'r', resolveStranded });
    expect(resolveStranded).toHaveBeenCalledOnce();
    expect(calls.refund).toBe(0);
  });

  it('skips a Disputed task when no resolver is wired', async () => {
    const { bundle, calls } = makeReclaimBundle({ status: TaskStatus.Disputed });
    await reclaimOne(bundle, stranded(), { runId: 'r' });
    expect(calls.refund).toBe(0);
  });

  it('leaves a Completed task alone (executor claims auto-release)', async () => {
    const { bundle, calls } = makeReclaimBundle({ status: TaskStatus.Completed });
    await reclaimOne(bundle, stranded(), { runId: 'r' });
    expect(calls.refund).toBe(0);
  });

  it('leaves a terminal (Paid) task alone', async () => {
    const { bundle, calls } = makeReclaimBundle({ status: TaskStatus.Paid });
    await reclaimOne(bundle, stranded(), { runId: 'r' });
    expect(calls.refund).toBe(0);
  });

  it('does nothing when the task is not found', async () => {
    const { bundle, calls } = makeReclaimBundle({ status: null });
    await reclaimOne(bundle, stranded(), { runId: 'r' });
    expect(calls.refund).toBe(0);
  });

  it('logs (never throws) when refundExpired throws', async () => {
    const { bundle, calls } = makeReclaimBundle({
      status: TaskStatus.Created,
      refundError: new Error('RPC down'),
    });
    await expect(reclaimOne(bundle, stranded(), { runId: 'r' })).resolves.toBeUndefined();
    expect(calls.refund).toBe(1);
  });

  it('logs (never throws) when the refund tx reverts', async () => {
    const { bundle } = makeReclaimBundle({
      status: TaskStatus.Created,
      refundReceiptStatus: 'reverted',
    });
    await expect(reclaimOne(bundle, stranded(), { runId: 'r' })).resolves.toBeUndefined();
  });

  it('logs (never throws) when the stranded resolver fails', async () => {
    const { bundle } = makeReclaimBundle({ status: TaskStatus.Disputed });
    const resolveStranded = vi.fn(async () => {
      throw new Error('resolveDispute reverted');
    });
    await expect(
      reclaimOne(bundle, stranded(), { runId: 'r', resolveStranded }),
    ).resolves.toBeUndefined();
  });
});

// ─── scheduleReclaim — timing ────────────────────────────────────────────

describe('escrow-reclaim — scheduleReclaim', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('fires only after deadline + margin', async () => {
    const { bundle, calls } = makeReclaimBundle({ status: TaskStatus.Created });
    const deadline = Math.floor(Date.now() / 1000) + 100;
    scheduleReclaim(bundle, [{ subId: 1, taskId: makeTaskId('7'), deadline }], {
      runId: 'r',
      marginMs: 5_000,
    });

    // Due at deadline (100s out) + 5s margin = 105s.
    await vi.advanceTimersByTimeAsync(104_000);
    expect(calls.refund).toBe(0);

    await vi.advanceTimersByTimeAsync(2_000);
    expect(calls.refund).toBe(1);
  });

  it('fires immediately for a deadline already in the past', async () => {
    const { bundle, calls } = makeReclaimBundle({ status: TaskStatus.Accepted });
    const deadline = Math.floor(Date.now() / 1000) - 600;
    scheduleReclaim(bundle, [{ subId: 1, taskId: makeTaskId('7'), deadline }], {
      runId: 'r',
      marginMs: 5_000,
    });

    await vi.advanceTimersByTimeAsync(1);
    expect(calls.refund).toBe(1);
  });
});
