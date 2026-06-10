/**
 * ADR-0007 run-level guards (M12.0.3): actual-spend ledger, task-count
 * circuit breaker, max-depth recursion brake, dispute-retry cap, and the
 * depth field in the parent-id envelope.
 */
import { describe, it, expect } from 'vitest';
import { TaskStatus, agentId, taskId, type TaskRecord } from '@sage/core';
import type { Plan, SubTask } from '@sage/core';

import { runPlan, DEFAULT_RUN_CAPS, __testing } from '../../src/parent/plan-runner.js';
import { encodeParentId, decodeParentId } from '../../src/parent/parent-id-codec.js';
import { SseChannel } from '../../src/shared/sse.js';

const EXECUTOR = '0xaaaa000000000000000000000000000000000001';

function makeSubtask(p: Partial<SubTask> & { id: number }): SubTask {
  return {
    type: p.type ?? 'summarize-text',
    estimated_cost_units: p.estimated_cost_units ?? 100_000n,
    deadline_offset_s: p.deadline_offset_s ?? 600,
    spec: p.spec ?? 'do the thing',
    executor_address: p.executor_address ?? EXECUTOR,
    ...(p.depends_on ? { depends_on: p.depends_on } : {}),
    id: p.id,
  };
}

function makePlan(subtasks: SubTask[]): Plan {
  return {
    brief: 'demo brief',
    decomposability: 'composite',
    stakes: 'low',
    subtasks,
    estimated_total_cost_units: subtasks.reduce((s, x) => s + x.estimated_cost_units, 0n),
    estimated_duration_ms: 30_000,
  };
}

/** Capture channel + auto-completing fake bundle (Completed on first poll). */
function makeHarness() {
  const events: Array<{ event: string; data: unknown }> = [];
  const channel = new SseChannel('guards-test');
  const origEmit = channel.emit.bind(channel);
  channel.emit = (event: string, data: unknown) => {
    events.push({ event, data });
    origEmit(event, data);
  };

  let nextId = 100;
  const created: Array<{ amount: bigint; specUri: string }> = [];
  const record = (id: string): TaskRecord => ({
    id: taskId(id),
    client: agentId('0xcccc000000000000000000000000000000000003'),
    executor: agentId(EXECUTOR),
    amount: 100_000n,
    deadline: Math.floor(Date.now() / 1000) + 3600,
    status: TaskStatus.Completed,
    specUri: 'spec',
    resultUri: 'data:text/plain,done',
    completedAt: 0,
    executorShare: 0n,
  });
  const bundle = {
    sage: {
      tasks: {
        createTask: async (spec: { amount: bigint; specUri: string }) => {
          created.push({ amount: spec.amount, specUri: spec.specUri });
          return taskId(String(nextId++));
        },
        getTask: async (tid: unknown) => record(String(tid)),
        approvePayment: async () => '0xapprove',
      },
    },
    publicClient: {
      waitForTransactionReceipt: async () => ({ status: 'success' }),
    },
  } as never;

  return { channel, events, bundle, created };
}

function failure(events: Array<{ event: string; data: unknown }>) {
  return events.find((e) => e.event === 'plan_failed')?.data as
    | { error: string; failedSubId: number }
    | undefined;
}

describe('budget cap (actual-spend ledger)', () => {
  it('fails the plan BEFORE the createTask that would breach maxRunSpendUnits', async () => {
    const { channel, events, bundle, created } = makeHarness();
    const plan = makePlan([
      makeSubtask({ id: 1, estimated_cost_units: 1_000_000n }),
      makeSubtask({ id: 2, estimated_cost_units: 1_000_000n }),
      makeSubtask({ id: 3, estimated_cost_units: 1_000_000n }),
    ]);

    await runPlan(plan, channel, bundle, {
      runId: 'run-budget',
      caps: { maxRunSpendUnits: 2_500_000n },
    });

    expect(created).toHaveLength(2); // sub 3 never reached the chain
    const fail = failure(events);
    expect(fail?.failedSubId).toBe(3);
    expect(fail?.error).toMatch(/budget cap/);
  });

  it('completes untouched when under the cap', async () => {
    const { channel, events, bundle, created } = makeHarness();
    const plan = makePlan([makeSubtask({ id: 1 }), makeSubtask({ id: 2 })]);

    await runPlan(plan, channel, bundle, { runId: 'run-ok' });

    expect(created).toHaveLength(2);
    expect(failure(events)).toBeUndefined();
    expect(events.some((e) => e.event === 'plan_completed')).toBe(true);
  });
});

describe('task-count circuit breaker', () => {
  it('fails the plan when the run would exceed maxRunTasks', async () => {
    const { channel, events, bundle, created } = makeHarness();
    const plan = makePlan([
      makeSubtask({ id: 1 }),
      makeSubtask({ id: 2 }),
      makeSubtask({ id: 3 }),
    ]);

    await runPlan(plan, channel, bundle, {
      runId: 'run-count',
      caps: { maxRunTasks: 2 },
    });

    expect(created).toHaveLength(2);
    expect(failure(events)?.error).toMatch(/circuit breaker/);
  });
});

describe('max-depth recursion brake', () => {
  it('refuses a run past maxDepth before spawning anything', async () => {
    const { channel, bundle, created } = makeHarness();
    const plan = makePlan([makeSubtask({ id: 1 })]);

    await expect(
      runPlan(plan, channel, bundle, { runId: 'run-deep', depth: 2 }),
    ).rejects.toThrow(/maxDepth/);
    expect(created).toHaveLength(0);
  });

  it('default depth 1 passes the default cap', async () => {
    const { channel, events, bundle } = makeHarness();
    await runPlan(makePlan([makeSubtask({ id: 1 })]), channel, bundle, { runId: 'run-d1' });
    expect(events.some((e) => e.event === 'plan_completed')).toBe(true);
  });

  it('DEFAULT_RUN_CAPS.maxDepth is 1 — nested delegation off by default', () => {
    expect(DEFAULT_RUN_CAPS.maxDepth).toBe(1);
  });
});

describe('depth in the parent-id envelope', () => {
  it('stamps depth into every spawned sub-task specUri', async () => {
    const { channel, bundle, created } = makeHarness();
    await runPlan(makePlan([makeSubtask({ id: 1 })]), channel, bundle, { runId: 'run-stamp' });

    expect(created).toHaveLength(1);
    expect(decodeParentId(created[0]!.specUri)).toEqual({ run: 'run-stamp', sub: 1, depth: 1 });
  });

  it('codec round-trips depth and tolerates its absence (legacy)', () => {
    const withDepth = encodeParentId({ run: 'r', sub: 2, depth: 1 }, 'spec');
    expect(decodeParentId(withDepth)).toEqual({ run: 'r', sub: 2, depth: 1 });

    const legacy = encodeParentId({ run: 'r', sub: 2 }, 'spec');
    expect(decodeParentId(legacy)).toEqual({ run: 'r', sub: 2 });
  });

  it('rejects a non-positive depth at encode time', () => {
    expect(() => encodeParentId({ run: 'r', sub: 1, depth: 0 }, 's')).toThrow(/depth/);
  });
});

describe('chargeLedger unit semantics', () => {
  it('accumulates and trips exactly at the boundary', () => {
    const caps = { maxRunSpendUnits: 250n, maxRunTasks: 2, maxDepth: 1 };
    const ledger = { spentUnits: 0n, tasksCreated: 0 };

    __testing.chargeLedger(ledger, caps, 100n, 'a');
    __testing.chargeLedger(ledger, caps, 150n, 'b'); // exactly at the cap — allowed
    expect(ledger).toEqual({ spentUnits: 250n, tasksCreated: 2 });

    expect(() => __testing.chargeLedger(ledger, caps, 1n, 'c')).toThrow(/circuit breaker/);
  });

  it('dispute-retry constant matches the documented cap', () => {
    expect(__testing.MAX_DISPUTE_RETRIES).toBe(2);
  });
});
