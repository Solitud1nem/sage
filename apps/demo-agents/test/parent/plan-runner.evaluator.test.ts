/**
 * Evaluator role (M12.0.3, ADR-0020 п.5): paid verdict step between a
 * sub-task's completion and its payment — pass releases, fail raises the
 * dispute hook, breakage degrades to the legacy approve path.
 */
import { describe, it, expect } from 'vitest';
import { TaskStatus, agentId, taskId, type TaskRecord, type TaskId } from '@sage/core';
import type { Plan, SubTask } from '@sage/core';

import { runPlan } from '../../src/parent/plan-runner.js';
import { decodeEnvelope } from '../../src/parent/parent-id-codec.js';
import {
  decodeEvaluationCase,
  encodeVerdict,
  type EvaluationVerdict,
} from '../../src/shared/evaluation.js';
import { SseChannel } from '../../src/shared/sse.js';

const WORKER = '0xaaaa000000000000000000000000000000000001';
const EVALUATOR = '0xbbbb000000000000000000000000000000000002';

function sub(p: Partial<SubTask> & { id: number }): SubTask {
  return {
    type: p.type ?? 'copywrite',
    estimated_cost_units: p.estimated_cost_units ?? 100_000n,
    deadline_offset_s: 600,
    spec: p.spec ?? 'write the page',
    executor_address: p.executor_address ?? WORKER,
    ...(p.depends_on ? { depends_on: p.depends_on } : {}),
    ...(p.evaluates !== undefined ? { evaluates: p.evaluates } : {}),
    id: p.id,
  };
}

function plan(subtasks: SubTask[]): Plan {
  return {
    brief: 'demo brief',
    decomposability: 'composite',
    stakes: 'low',
    subtasks,
    estimated_total_cost_units: subtasks.reduce((s, x) => s + x.estimated_cost_units, 0n),
    estimated_duration_ms: 30_000,
  };
}

/**
 * Fake bundle: per-executor canned results. Tasks complete on first poll with
 * the result configured for their executor; createTask/approve recorded.
 */
function makeHarness(resultByExecutor: Record<string, string>) {
  const events: Array<{ event: string; data: Record<string, unknown> }> = [];
  const channel = new SseChannel('eval-test');
  const origEmit = channel.emit.bind(channel);
  channel.emit = (event: string, data: unknown) => {
    events.push({ event, data: data as Record<string, unknown> });
    origEmit(event, data);
  };

  let nextId = 500;
  const created: Array<{ id: string; executor: string; amount: bigint; specUri: string }> = [];
  const approved: string[] = [];
  const byTask = new Map<string, { executor: string; specUri: string }>();
  const disputes: Array<{ taskId: string; reason: string }> = [];

  const bundle = {
    sage: {
      tasks: {
        createTask: async (spec: { executor: string; amount: bigint; specUri: string }) => {
          const id = String(nextId++);
          created.push({ id, executor: spec.executor, amount: spec.amount, specUri: spec.specUri });
          byTask.set(id, { executor: spec.executor, specUri: spec.specUri });
          return taskId(id);
        },
        getTask: async (tid: TaskId) => {
          const t = byTask.get(String(tid))!;
          const result = resultByExecutor[t.executor.toLowerCase()] ?? 'default result';
          const rec: TaskRecord = {
            id: tid,
            client: agentId('0xcccc000000000000000000000000000000000003'),
            executor: agentId(t.executor),
            amount: 100_000n,
            deadline: Math.floor(Date.now() / 1000) + 3600,
            status: TaskStatus.Completed,
            specUri: t.specUri,
            resultUri: `data:text/plain,${encodeURIComponent(result)}`,
            completedAt: 0,
            executorShare: 0n,
          };
          return rec;
        },
        approvePayment: async (tid: TaskId) => {
          approved.push(String(tid));
          return `0xapprove${tid}`;
        },
      },
    },
    publicClient: { waitForTransactionReceipt: async () => ({ status: 'success' }) },
  } as never;

  const disputeFlow = async (args: { taskId: TaskId; reason: string }) => {
    disputes.push({ taskId: String(args.taskId), reason: args.reason });
    return {
      verdict: { outcome: 'client' as const, reasoning: 'council sided with client' },
      outcome: 'client' as const,
      executorShare: 0n,
    };
  };

  return { channel, events, bundle, created, approved, disputes, disputeFlow };
}

const verdict = (v: EvaluationVerdict) => encodeVerdict(v);

describe('evaluator pass path', () => {
  it('spawns the evaluator after completion, pays both, plan completes', async () => {
    const h = makeHarness({
      [WORKER]: 'the page content',
      [EVALUATOR]: verdict({ pass: true, reasons: ['looks right'], score: 91 }),
    });
    await runPlan(
      plan([sub({ id: 1 }), sub({ id: 2, evaluates: 1, executor_address: EVALUATOR, type: 'qa' })]),
      h.channel,
      h.bundle,
      { runId: 'run-pass' },
    );

    // Worker task first, evaluator second; both paid; no disputes.
    expect(h.created.map((c) => c.executor)).toEqual([WORKER, EVALUATOR]);
    expect(h.approved).toHaveLength(2);
    expect(h.disputes ?? []).toEqual([]);
    expect(h.events.some((e) => e.event === 'plan_completed')).toBe(true);

    const v = h.events.find((e) => e.event === 'subtask_verdict')!.data;
    expect(v).toMatchObject({ subId: 1, evaluatorSubId: 2, pass: true, score: 91 });
  });

  it('hands the evaluator the judged instruction + result via the inputs channel', async () => {
    const h = makeHarness({
      [WORKER]: 'the page content',
      [EVALUATOR]: verdict({ pass: true, reasons: [] }),
    });
    await runPlan(
      plan([sub({ id: 1, spec: 'write the page' }), sub({ id: 2, evaluates: 1, executor_address: EVALUATOR })]),
      h.channel,
      h.bundle,
      { runId: 'run-case' },
    );

    const evalSpecUri = h.created[1]!.specUri;
    const env = decodeEnvelope(evalSpecUri)!;
    expect(env.parent).toMatchObject({ run: 'run-case', sub: 2, depth: 1 });
    const evalCase = decodeEvaluationCase(env.inputs![1]!)!;
    expect(evalCase).toEqual({ instruction: 'write the page', result: 'the page content' });
  });
});

describe('evaluator fail path', () => {
  it('pays the evaluator, disputes the judged task with the verdict reasons', async () => {
    const h = makeHarness({
      [WORKER]: 'broken output',
      [EVALUATOR]: verdict({ pass: false, reasons: ['citation does not resolve', 'tone off'] }),
    });
    await runPlan(
      plan([sub({ id: 1 }), sub({ id: 2, evaluates: 1, executor_address: EVALUATOR })]),
      h.channel,
      h.bundle,
      { runId: 'run-fail', disputeFlow: h.disputeFlow as never },
    );

    // Evaluator's task (created second) was paid; the WORKER task went to dispute.
    expect(h.approved).toEqual([h.created[1]!.id]);
    expect(h.disputes).toHaveLength(1);
    expect(h.disputes[0]).toMatchObject({ taskId: h.created[0]!.id });
    expect(h.disputes[0]!.reason).toContain('citation does not resolve');

    const v = h.events.find((e) => e.event === 'subtask_verdict')!.data;
    expect(v).toMatchObject({ subId: 1, pass: false });
    // Council refunded the client → plan fails (ADR-0019 v1 semantics).
    expect(h.events.some((e) => e.event === 'plan_failed')).toBe(true);
  });
});

describe('evaluator degradation', () => {
  it('an undecodable verdict degrades to the legacy approve path', async () => {
    const h = makeHarness({
      [WORKER]: 'fine output',
      [EVALUATOR]: 'Evaluation failed: judge returned no verdict call.',
    });
    await runPlan(
      plan([sub({ id: 1 }), sub({ id: 2, evaluates: 1, executor_address: EVALUATOR })]),
      h.channel,
      h.bundle,
      { runId: 'run-degrade' },
    );

    // Both paid (evaluator paid-for-verdict-attempt, worker via degrade-approve).
    expect(h.approved).toHaveLength(2);
    expect(h.events.some((e) => e.event === 'plan_completed')).toBe(true);
    const v = h.events.find((e) => e.event === 'subtask_verdict')!.data;
    expect(v).toMatchObject({ subId: 1, degraded: true });
  });

  it('an evaluator without executor_address degrades without spawning', async () => {
    const h = makeHarness({ [WORKER]: 'fine output' });
    const evalRow = { ...sub({ id: 2, evaluates: 1 }) } as { executor_address?: string };
    delete evalRow.executor_address;
    await runPlan(
      plan([sub({ id: 1 }), evalRow as SubTask]),
      h.channel,
      h.bundle,
      { runId: 'run-noexec' },
    );

    expect(h.created).toHaveLength(1); // only the worker task
    expect(h.approved).toHaveLength(1);
    expect(h.events.some((e) => e.event === 'plan_completed')).toBe(true);
  });

  it('an evaluator createTask that would breach the budget cap fails the plan (caps outrank evaluation)', async () => {
    const h = makeHarness({
      [WORKER]: 'fine output',
      [EVALUATOR]: verdict({ pass: true, reasons: [] }),
    });
    await runPlan(
      plan([
        sub({ id: 1, estimated_cost_units: 100_000n }),
        sub({ id: 2, evaluates: 1, executor_address: EVALUATOR, estimated_cost_units: 100_000n }),
      ]),
      h.channel,
      h.bundle,
      { runId: 'run-evalcap', caps: { maxRunSpendUnits: 150_000n } },
    );

    expect(h.created).toHaveLength(1); // evaluator never spawned
    const fail = h.events.find((e) => e.event === 'plan_failed')!.data;
    expect(String(fail['error'])).toMatch(/budget cap/);
  });
});

describe('plan validation for evaluator rows', () => {
  const cases: Array<[string, SubTask[], RegExp]> = [
    ['unknown target', [sub({ id: 1 }), sub({ id: 2, evaluates: 9 })], /unknown id 9/],
    ['self-evaluation', [sub({ id: 1 }), sub({ id: 2, evaluates: 2 })], /evaluates itself/],
    [
      'evaluator-of-evaluator',
      [sub({ id: 1 }), sub({ id: 2, evaluates: 1 }), sub({ id: 3, evaluates: 2 })],
      /nested evaluation/,
    ],
    [
      'double evaluation',
      [sub({ id: 1 }), sub({ id: 2, evaluates: 1 }), sub({ id: 3, evaluates: 1 })],
      /more than one evaluator/,
    ],
    [
      'depending on an evaluator',
      [sub({ id: 1 }), sub({ id: 2, evaluates: 1 }), sub({ id: 3, depends_on: [2] })],
      /not chainable/,
    ],
    [
      'evaluator with depends_on',
      [sub({ id: 1 }), sub({ id: 2, evaluates: 1, depends_on: [1] })],
      /must not declare depends_on/,
    ],
  ];

  for (const [name, subtasks, pattern] of cases) {
    it(`rejects ${name}`, async () => {
      const h = makeHarness({});
      await expect(
        runPlan(plan(subtasks), h.channel, h.bundle, { runId: `run-${name}` }),
      ).rejects.toThrow(pattern);
    });
  }
});
