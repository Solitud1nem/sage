import { describe, it, expect, vi } from 'vitest';
import { TaskStatus, agentId, taskId, type TaskRecord } from '@sage/core';
import type { AgentRecordV2, Plan } from '@sage/core';

import { createWaker, wakeUrl } from '../../src/parent/wake.js';
import { runPlan } from '../../src/parent/plan-runner.js';
import { SseChannel } from '../../src/shared/sse.js';

const EXECUTOR = '0xAAAA000000000000000000000000000000000001';

function makeAgent(p: Partial<AgentRecordV2> = {}): AgentRecordV2 {
  return {
    id: agentId(EXECUTOR),
    endpoint: 'https://sage-workers.fly.dev',
    registeredAt: 0,
    active: true,
    profileUri: '',
    capabilities: [{ name: 'copywrite' as AgentRecordV2['capabilities'][number]['name'], price: 10_000n }],
    ...p,
  };
}

type FetchCall = { url: string; body: unknown };

function makeFetch(status = 202) {
  const calls: FetchCall[] = [];
  const fetchImpl = (async (url: unknown, init?: { body?: unknown }) => {
    calls.push({ url: String(url), body: init?.body ? JSON.parse(String(init.body)) : null });
    return { ok: status < 400, status } as Response;
  }) as typeof fetch;
  return { calls, fetchImpl };
}

describe('wakeUrl', () => {
  it('appends /wake to an http(s) endpoint, idempotently', () => {
    expect(wakeUrl('https://sage-workers.fly.dev')).toBe('https://sage-workers.fly.dev/wake');
    expect(wakeUrl('https://sage-workers.fly.dev/')).toBe('https://sage-workers.fly.dev/wake');
    expect(wakeUrl('https://sage-workers.fly.dev/wake')).toBe('https://sage-workers.fly.dev/wake');
  });
  it('rejects non-http endpoints (ipfs, empty, placeholder text)', () => {
    expect(wakeUrl('ipfs://Qm123')).toBeNull();
    expect(wakeUrl('')).toBeNull();
    expect(wakeUrl('not-a-url')).toBeNull();
  });
});

describe('createWaker', () => {
  it('pings the registry endpoint with the taskId hint', async () => {
    const { calls, fetchImpl } = makeFetch();
    const wake = createWaker({ fetchAgents: async () => [makeAgent()], fetchImpl, log: () => {} });

    wake(EXECUTOR.toLowerCase(), { taskId: '42' });
    await vi.waitFor(() => expect(calls).toHaveLength(1));

    expect(calls[0]).toEqual({ url: 'https://sage-workers.fly.dev/wake', body: { taskId: '42' } });
  });

  it('is case-insensitive on the executor address', async () => {
    const { calls, fetchImpl } = makeFetch();
    const wake = createWaker({ fetchAgents: async () => [makeAgent()], fetchImpl, log: () => {} });

    wake(EXECUTOR.toUpperCase().replace('0X', '0x'));
    await vi.waitFor(() => expect(calls).toHaveLength(1));
  });

  it('fetches the registry once per waker across many pings (memoized)', async () => {
    const { calls, fetchImpl } = makeFetch();
    const fetchAgents = vi.fn(async () => [makeAgent()]);
    const wake = createWaker({ fetchAgents, fetchImpl, log: () => {} });

    wake(EXECUTOR);
    wake(EXECUTOR);
    wake(EXECUTOR);
    await vi.waitFor(() => expect(calls).toHaveLength(3));
    expect(fetchAgents).toHaveBeenCalledTimes(1);
  });

  it('never pings executors without an http endpoint (legacy demo workers)', async () => {
    const { calls, fetchImpl } = makeFetch();
    const wake = createWaker({
      fetchAgents: async () => [makeAgent({ endpoint: 'ipfs://legacy' })],
      fetchImpl,
      log: () => {},
    });

    wake(EXECUTOR);
    await new Promise((r) => setTimeout(r, 20));
    expect(calls).toHaveLength(0);
  });

  it('swallows registry-lookup failure — wakes disabled, nothing throws', async () => {
    const { calls, fetchImpl } = makeFetch();
    const wake = createWaker({
      fetchAgents: async () => {
        throw new Error('rpc down');
      },
      fetchImpl,
      log: () => {},
    });

    expect(() => wake(EXECUTOR)).not.toThrow();
    await new Promise((r) => setTimeout(r, 20));
    expect(calls).toHaveLength(0);
  });

  it('swallows ping failures and non-2xx responses', async () => {
    const failingFetch = (async () => {
      throw new Error('connect ECONNREFUSED');
    }) as typeof fetch;
    const wake = createWaker({ fetchAgents: async () => [makeAgent()], fetchImpl: failingFetch, log: () => {} });
    expect(() => wake(EXECUTOR)).not.toThrow();

    const { fetchImpl } = makeFetch(503);
    const wake503 = createWaker({ fetchAgents: async () => [makeAgent()], fetchImpl, log: () => {} });
    expect(() => wake503(EXECUTOR)).not.toThrow();
    await new Promise((r) => setTimeout(r, 20));
  });
});

describe('plan-runner wake integration', () => {
  it('fires the wake after createTask with the executor + on-chain taskId', async () => {
    const wakes: Array<{ executor: string; taskId?: string }> = [];
    const wake = (executor: string, hint?: { taskId?: string }) => {
      wakes.push({ executor, ...(hint?.taskId ? { taskId: hint.taskId } : {}) });
    };

    // Minimal bundle: createTask mints id 99; getTask reads back Completed
    // immediately so the poll loop returns without 10s sleeps.
    const record = (status: TaskStatus): TaskRecord => ({
      id: taskId('99'),
      client: agentId('0xcccc000000000000000000000000000000000003'),
      executor: agentId(EXECUTOR),
      amount: 100_000n,
      deadline: Math.floor(Date.now() / 1000) + 3600,
      status,
      specUri: 'spec',
      resultUri: 'data:text/plain,done',
      completedAt: 0,
      executorShare: 0n,
    });
    const bundle = {
      sage: {
        tasks: {
          createTask: async () => taskId('99'),
          getTask: async () => record(TaskStatus.Completed),
          approvePayment: async () => '0xapprove',
        },
      },
      publicClient: {
        waitForTransactionReceipt: async () => ({ status: 'success' }),
      },
    } as never;

    const plan: Plan = {
      brief: 'demo brief',
      decomposability: 'composite',
      stakes: 'low',
      subtasks: [
        {
          id: 1,
          type: 'copywrite',
          spec: 'write the page',
          estimated_cost_units: 100_000n,
          deadline_offset_s: 600,
          executor_address: EXECUTOR,
        },
      ],
      estimated_total_cost_units: 100_000n,
      estimated_duration_ms: 1000,
    };

    await runPlan(plan, new SseChannel('wake-test'), bundle, { runId: 'run-wake', wake });

    expect(wakes).toEqual([{ executor: EXECUTOR, taskId: '99' }]);
  });
});
