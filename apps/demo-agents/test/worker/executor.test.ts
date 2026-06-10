import { describe, it, expect } from 'vitest';
import { TaskStatus, agentId, taskId, type TaskRecord } from '@sage/core';

import {
  ActivityTracker,
  executeTask,
  rejectReason,
  decodeJob,
  type ExecutorOptions,
} from '../../src/worker/executor.js';
import type { IdentityRuntime } from '../../src/worker/runtime.js';
import type { CapabilityHandler } from '../../src/worker/handlers/index.js';

const ADDR = '0xaaaa000000000000000000000000000000000001';
const CLIENT = '0xcccc000000000000000000000000000000000003';

function makeTask(p: Partial<TaskRecord> = {}): TaskRecord {
  return {
    id: taskId('7'),
    client: agentId(CLIENT),
    executor: agentId(ADDR),
    amount: p.amount ?? 100_000n,
    deadline: p.deadline ?? Math.floor(Date.now() / 1000) + 3600,
    status: p.status ?? TaskStatus.Created,
    specUri: p.specUri ?? 'do the thing',
    resultUri: '',
    completedAt: 0,
    executorShare: 0n,
    ...p,
  };
}

/**
 * Fake identity runtime: records accept/complete calls per instance, so a
 * multi-identity test can assert WHICH wallet signed. `getTask` reads back
 * Accepted immediately (executeTask's awaitTaskState resolves on first poll).
 */
function makeRuntime(id = 'echo', capability = 'echo', priceUnits = 10_000n) {
  const calls = { accept: [] as string[], complete: [] as Array<{ id: string; resultUri: string }> };
  let acceptReverts = false;
  const rt = {
    identity: { id, capability, priceUnits, privateKey: '0x01' as const },
    address: ADDR as `0x${string}`,
    bundle: {
      sage: {
        tasks: {
          async acceptTask(tid: unknown) {
            calls.accept.push(String(tid));
            return '0xaccept';
          },
          async getTask() {
            return makeTask({ status: TaskStatus.Accepted });
          },
          async completeTask(tid: unknown, resultUri: string) {
            calls.complete.push({ id: String(tid), resultUri });
            return '0xcomplete';
          },
        },
      },
      publicClient: {
        async waitForTransactionReceipt({ hash }: { hash: string }) {
          return { status: hash === '0xaccept' && acceptReverts ? 'reverted' : 'success' };
        },
      },
    },
  } as unknown as IdentityRuntime;
  return { rt, calls, setAcceptReverts: () => (acceptReverts = true) };
}

function opts(overrides: Partial<ExecutorOptions> = {}): ExecutorOptions {
  return {
    activity: new ActivityTracker(),
    openaiApiKey: undefined,
    sleep: async () => {},
    log: () => {},
    ...overrides,
  };
}

const okHandler: CapabilityHandler = async (job) => `done: ${job.spec}`;

describe('rejectReason (pre-accept guards)', () => {
  it('rejects underpayment against the identity price', () => {
    expect(rejectReason({ amount: 9_999n, deadline: 10_000 }, 10_000n, 120, 0)).toMatch(/pays/);
  });
  it('rejects a deadline inside the margin', () => {
    expect(rejectReason({ amount: 10_000n, deadline: 100 }, 10_000n, 120, 0)).toMatch(/deadline/);
  });
  it('passes a viable task', () => {
    expect(rejectReason({ amount: 10_000n, deadline: 121 }, 10_000n, 120, 0)).toBeNull();
  });
});

describe('decodeJob (ADR-0018 envelope)', () => {
  it('extracts spec + material from a composite envelope', () => {
    const uri =
      'data:application/json,' +
      encodeURIComponent(JSON.stringify({ parent: { run: 'r', sub: 1 }, spec: 'write it', source: 'the brief' }));
    expect(decodeJob(uri, 100)).toEqual({ spec: 'write it', material: 'the brief' });
  });
  it('falls back to raw specUri with no material on the legacy path', () => {
    expect(decodeJob('summarize this text', 100)).toEqual({ spec: 'summarize this text', material: null });
  });
  it('caps hostile material size', () => {
    const uri =
      'data:application/json,' +
      encodeURIComponent(JSON.stringify({ parent: { run: 'r', sub: 1 }, spec: 's', source: 'x'.repeat(50) }));
    expect(decodeJob(uri, 10).material).toHaveLength(10);
  });
});

describe('executeTask — fresh dispatch', () => {
  it('accepts, runs the handler, completes with a data:text/plain result', async () => {
    const { rt, calls } = makeRuntime();
    await executeTask(rt, okHandler, 7n, makeTask(), opts(), false);

    expect(calls.accept).toEqual(['7']);
    expect(calls.complete).toEqual([
      { id: '7', resultUri: `data:text/plain,${encodeURIComponent('done: do the thing')}` },
    ]);
  });

  it('skips guard-rejected tasks without spending gas', async () => {
    const { rt, calls } = makeRuntime();
    await executeTask(rt, okHandler, 7n, makeTask({ amount: 1n }), opts(), false);

    expect(calls.accept).toEqual([]);
    expect(calls.complete).toEqual([]);
  });

  it('stops after a reverted accept (another agent won the race)', async () => {
    const { rt, calls, setAcceptReverts } = makeRuntime();
    setAcceptReverts();
    const activity = new ActivityTracker();
    await executeTask(rt, okHandler, 7n, makeTask(), opts({ activity }), false);

    expect(calls.complete).toEqual([]);
    expect(activity.inFlight).toBe(0);
  });

  it('retries the handler, then completes with an honest failure result', async () => {
    const { rt, calls } = makeRuntime();
    let attempts = 0;
    const flaky: CapabilityHandler = async () => {
      attempts += 1;
      throw new Error('llm down');
    };
    await executeTask(rt, flaky, 7n, makeTask(), opts({ handlerRetries: 2 }), false);

    expect(attempts).toBe(3);
    expect(calls.complete).toHaveLength(1);
    expect(decodeURIComponent(calls.complete[0]!.resultUri)).toContain('Task failed: llm down');
  });

  it('recovers on a retry when the handler succeeds the second time', async () => {
    const { rt, calls } = makeRuntime();
    let attempts = 0;
    const flaky: CapabilityHandler = async (job) => {
      attempts += 1;
      if (attempts === 1) throw new Error('transient');
      return `ok: ${job.spec}`;
    };
    await executeTask(rt, flaky, 7n, makeTask(), opts(), false);

    expect(attempts).toBe(2);
    expect(calls.complete[0]!.resultUri).toBe(`data:text/plain,${encodeURIComponent('ok: do the thing')}`);
  });
});

describe('executeTask — resume path (boot reconciliation)', () => {
  it('skips guards + accept and goes straight to execute → complete', async () => {
    const { rt, calls } = makeRuntime();
    // amount below price — guards MUST NOT run on resume: the escrow is
    // already committed to us, backing out only strands the client.
    const task = makeTask({ status: TaskStatus.Accepted, amount: 1n });
    await executeTask(rt, okHandler, 7n, task, opts(), true);

    expect(calls.accept).toEqual([]);
    expect(calls.complete).toHaveLength(1);
  });
});

describe('in-flight accounting (drain/idle-exit substrate)', () => {
  it('spans accept→complete and returns to zero', async () => {
    const { rt } = makeRuntime();
    const activity = new ActivityTracker();
    let inFlightDuringHandler = -1;
    const probe: CapabilityHandler = async () => {
      inFlightDuringHandler = activity.inFlight;
      return 'x';
    };
    await executeTask(rt, probe, 7n, makeTask(), opts({ activity }), false);

    expect(inFlightDuringHandler).toBe(1);
    expect(activity.inFlight).toBe(0);
  });

  it('returns to zero even when the chain write throws', async () => {
    const { rt } = makeRuntime();
    (rt.bundle.sage.tasks as { completeTask: unknown }).completeTask = async () => {
      throw new Error('rpc exploded');
    };
    const activity = new ActivityTracker();
    await expect(
      executeTask(rt, okHandler, 7n, makeTask(), opts({ activity }), false),
    ).resolves.toBeUndefined(); // never throws — contract with reconcile.ts
    expect(activity.inFlight).toBe(0);
  });

  it('ActivityTracker idleForMs resets on touch', () => {
    const activity = new ActivityTracker();
    expect(activity.idleForMs()).toBeLessThan(1000);
    activity.begin();
    expect(activity.inFlight).toBe(1);
    activity.end();
    expect(activity.inFlight).toBe(0);
    activity.end(); // floor at zero
    expect(activity.inFlight).toBe(0);
  });
});
