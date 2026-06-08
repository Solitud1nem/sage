import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { TaskStatus, taskId as makeTaskId, agentId } from '@sage/core';
import type { Plan, SubTask, TaskId, TaskRecord, TaskSpec } from '@sage/core';
import { runPlan, topoSort, __testing } from '../../src/parent/plan-runner.js';
import { decodeParentId, decodeSpec, decodeEnvelope } from '../../src/parent/parent-id-codec.js';
import { SseChannel } from '../../src/shared/sse.js';

// ─── helpers ─────────────────────────────────────────────────────────────

function makeSubtask(p: Partial<SubTask> & { id: number }): SubTask {
  return {
    type: p.type ?? 'translate-text',
    estimated_cost_units: p.estimated_cost_units ?? 100_000n,
    deadline_offset_s: p.deadline_offset_s ?? 600,
    spec: p.spec ?? 'do the thing',
    executor_address: p.executor_address ?? '0xa61b00000000000000000000000000000000001c',
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

/**
 * Captures all events emitted on an SseChannel. Wraps a real SseChannel so the
 * close + buffer mechanics are exercised, but routes events to a list for
 * assertions.
 */
class CaptureChannel {
  readonly channel: SseChannel;
  readonly events: Array<{ event: string; data: unknown }> = [];
  constructor() {
    this.channel = new SseChannel('test-run');
    const origEmit = this.channel.emit.bind(this.channel);
    this.channel.emit = (event: string, data: unknown) => {
      this.events.push({ event, data });
      origEmit(event, data);
    };
  }
}

interface FakeTaskState {
  record: TaskRecord;
  /** Number of getTask calls so far on this id. */
  polls: number;
}

/**
 * Build a fake SageClientBundle whose `getTask` auto-advances through
 * Created → Accepted → Completed across consecutive polls. createTask /
 * approvePayment return synthesized tx hashes.
 */
function makeFakeBundle(opts: {
  /** Override status sequence per taskId; default Created/Accepted/Completed. */
  sequence?: TaskStatus[];
  /** If set, createTask throws this error to simulate adapter failure. */
  createError?: Error;
  /** If set, getTask returns this status forever — useful for stall tests. */
  stallStatus?: TaskStatus;
} = {}) {
  const sequence = opts.sequence ?? [
    TaskStatus.Created,
    TaskStatus.Accepted,
    TaskStatus.Completed,
  ];
  let nextNumericId = 1;
  const tasks = new Map<string, FakeTaskState>();

  return {
    sage: {
      tasks: {
        async createTask(spec: TaskSpec): Promise<TaskId> {
          if (opts.createError) throw opts.createError;
          const id = String(nextNumericId++);
          const record: TaskRecord = {
            id: makeTaskId(id),
            client: agentId('0x0000000000000000000000000000000000000000'),
            executor: spec.executor,
            amount: spec.amount,
            deadline: spec.deadline,
            status: TaskStatus.Created,
            specUri: spec.specUri,
            resultUri: '',
            completedAt: 0,
          };
          tasks.set(id, { record, polls: 0 });
          return makeTaskId(id);
        },
        async getTask(id: TaskId): Promise<TaskRecord | null> {
          const state = tasks.get(id);
          if (!state) return null;
          if (opts.stallStatus !== undefined) {
            state.record = { ...state.record, status: opts.stallStatus };
            return state.record;
          }
          const idx = Math.min(state.polls, sequence.length - 1);
          const status = sequence[idx] ?? TaskStatus.Completed;
          state.polls += 1;
          const completedAt = status === TaskStatus.Completed ? Math.floor(Date.now() / 1000) : 0;
          const resultUri =
            status === TaskStatus.Completed
              ? `data:text/plain,${encodeURIComponent(`<mock result for ${id}>`)}`
              : '';
          state.record = { ...state.record, status, completedAt, resultUri };
          return state.record;
        },
        async approvePayment(id: TaskId): Promise<string> {
          const state = tasks.get(id);
          if (state) state.record = { ...state.record, status: TaskStatus.Paid };
          return `0xapprove_${id}`;
        },
      },
    },
    publicClient: {
      async waitForTransactionReceipt({ hash }: { hash: `0x${string}` }) {
        return { status: 'success', transactionHash: hash };
      },
    },
    // Tests probe internal state via this back-door:
    __tasks: tasks,
  };
}

// ─── topoSort ────────────────────────────────────────────────────────────

describe('topoSort', () => {
  it('returns linear chain in dependency order', () => {
    const subs = [
      makeSubtask({ id: 2, depends_on: [1] }),
      makeSubtask({ id: 3, depends_on: [2] }),
      makeSubtask({ id: 1 }),
    ];
    const out = topoSort(subs).map((s) => s.id);
    expect(out).toEqual([1, 2, 3]);
  });

  it('handles diamond DAG (1 → 2,3 → 4)', () => {
    const subs = [
      makeSubtask({ id: 1 }),
      makeSubtask({ id: 2, depends_on: [1] }),
      makeSubtask({ id: 3, depends_on: [1] }),
      makeSubtask({ id: 4, depends_on: [2, 3] }),
    ];
    const out = topoSort(subs).map((s) => s.id);
    expect(out[0]).toBe(1);
    expect(out[3]).toBe(4);
    expect(new Set(out.slice(1, 3))).toEqual(new Set([2, 3]));
  });

  it('detects cycles', () => {
    const subs = [
      makeSubtask({ id: 1, depends_on: [2] }),
      makeSubtask({ id: 2, depends_on: [1] }),
    ];
    expect(() => topoSort(subs)).toThrow(/cycle/);
  });

  it('emits ready nodes in ascending id order (stable)', () => {
    const subs = [
      makeSubtask({ id: 3 }),
      makeSubtask({ id: 1 }),
      makeSubtask({ id: 2 }),
    ];
    expect(topoSort(subs).map((s) => s.id)).toEqual([1, 2, 3]);
  });
});

describe('validatePlan', () => {
  const { validatePlan } = __testing;

  it('rejects empty plans', () => {
    expect(() => validatePlan(makePlan([]))).toThrow(/no subtasks/);
  });

  it('rejects duplicate ids', () => {
    expect(() =>
      validatePlan(makePlan([makeSubtask({ id: 1 }), makeSubtask({ id: 1 })])),
    ).toThrow(/duplicate/);
  });

  it('rejects unknown dependency ids', () => {
    expect(() =>
      validatePlan(makePlan([makeSubtask({ id: 1, depends_on: [99] })])),
    ).toThrow(/unknown id 99/);
  });

  it('rejects self-dependency', () => {
    expect(() =>
      validatePlan(makePlan([makeSubtask({ id: 1, depends_on: [1] })])),
    ).toThrow(/itself/);
  });
});

describe('decodeResult', () => {
  const { decodeResult } = __testing;

  it('decodes data:text/plain URI', () => {
    expect(decodeResult('data:text/plain,hello%20world')).toBe('hello world');
  });

  it('passes through raw URIs', () => {
    expect(decodeResult('https://example.com/result')).toBe('https://example.com/result');
  });
});

// ─── runPlan integration ─────────────────────────────────────────────────

describe('runPlan — happy path', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('executes a single-subtask plan end-to-end', async () => {
    const cap = new CaptureChannel();
    const bundle = makeFakeBundle();
    const plan = makePlan([makeSubtask({ id: 1, spec: 'translate me' })]);

    const promise = runPlan(plan, cap.channel, bundle, { runId: 'run-1' });
    // Each getTask transitions one step; need 3 advances to hit Completed.
    await vi.advanceTimersByTimeAsync(30_000);
    await promise;

    const names = cap.events.map((e) => e.event);
    expect(names[0]).toBe('plan_started');
    expect(names).toContain('subtask_created');
    expect(names).toContain('subtask_accepted');
    expect(names).toContain('subtask_completed');
    expect(names).toContain('subtask_paid');
    expect(names).toContain('plan_completed');
    expect(names[names.length - 1]).toBe('done'); // SseChannel.close emits 'done'
  });

  it('encodes parent_id into specUri of every spawned task', async () => {
    const cap = new CaptureChannel();
    const bundle = makeFakeBundle();
    const plan = makePlan([
      makeSubtask({ id: 1, spec: 'step one' }),
      makeSubtask({ id: 2, depends_on: [1], spec: 'step two' }),
    ]);

    const promise = runPlan(plan, cap.channel, bundle, { runId: 'run-42' });
    await vi.advanceTimersByTimeAsync(120_000);
    await promise;

    for (const state of bundle.__tasks.values()) {
      const pid = decodeParentId(state.record.specUri);
      expect(pid?.run).toBe('run-42');
      expect([1, 2]).toContain(pid?.sub);
      const spec = decodeSpec(state.record.specUri);
      expect(spec).toMatch(/step (one|two)/);
    }
  });

  it('attaches source (brief) to root sub-tasks and inputs (upstream result) to dependents (ADR-0018)', async () => {
    const cap = new CaptureChannel();
    const bundle = makeFakeBundle();
    const plan = makePlan([
      makeSubtask({ id: 1, spec: 'translate' }),
      makeSubtask({ id: 2, depends_on: [1], spec: 'summarize' }),
    ]);

    const promise = runPlan(plan, cap.channel, bundle, { runId: 'run-content' });
    await vi.advanceTimersByTimeAsync(120_000);
    await promise;

    // taskId is the insertion order: id "1" = sub#1 (root), "2" = sub#2 (dependent).
    const root = decodeEnvelope(bundle.__tasks.get('1')!.record.specUri);
    const dependent = decodeEnvelope(bundle.__tasks.get('2')!.record.specUri);

    // Root sub-task carries the original brief verbatim as source, no inputs.
    expect(root?.source).toBe('demo brief');
    expect(root?.inputs).toBeUndefined();

    // Dependent sub-task carries the upstream result as inputs[1], no source.
    expect(dependent?.inputs).toEqual({ 1: '<mock result for 1>' });
    expect(dependent?.source).toBeUndefined();
  });

  it('executes sub-tasks in topological order (sequential)', async () => {
    const cap = new CaptureChannel();
    const bundle = makeFakeBundle();
    const plan = makePlan([
      makeSubtask({ id: 2, depends_on: [1] }),
      makeSubtask({ id: 1 }),
      makeSubtask({ id: 3, depends_on: [2] }),
    ]);

    const promise = runPlan(plan, cap.channel, bundle, { runId: 'run-3' });
    await vi.advanceTimersByTimeAsync(180_000);
    await promise;

    const createdOrder = cap.events
      .filter((e) => e.event === 'subtask_created')
      .map((e) => (e.data as { subId: number }).subId);
    expect(createdOrder).toEqual([1, 2, 3]);
  });

  it('plan_started carries the topo order so the frontend can render upfront', async () => {
    const cap = new CaptureChannel();
    const bundle = makeFakeBundle();
    const plan = makePlan([
      makeSubtask({ id: 1 }),
      makeSubtask({ id: 2, depends_on: [1] }),
    ]);
    const promise = runPlan(plan, cap.channel, bundle, { runId: 'run-x' });
    await vi.advanceTimersByTimeAsync(60_000);
    await promise;
    const started = cap.events.find((e) => e.event === 'plan_started')!;
    expect((started.data as { order: number[] }).order).toEqual([1, 2]);
  });
});

describe('runPlan — failure paths', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('emits plan_failed when a sub-task has no executor_address', async () => {
    const cap = new CaptureChannel();
    const bundle = makeFakeBundle();
    const sub: SubTask = {
      id: 1,
      type: 'unknown',
      estimated_cost_units: 100_000n,
      deadline_offset_s: 600,
      spec: 'no executor',
      // no executor_address
    };
    const plan = makePlan([sub]);

    await runPlan(plan, cap.channel, bundle, { runId: 'r' });

    const names = cap.events.map((e) => e.event);
    expect(names).toContain('subtask_errored');
    expect(names).toContain('plan_failed');
    expect(names).not.toContain('plan_completed');
  });

  it('emits plan_failed when createTask throws', async () => {
    const cap = new CaptureChannel();
    const bundle = makeFakeBundle({ createError: new Error('rpc down') });
    const plan = makePlan([makeSubtask({ id: 1 })]);

    await runPlan(plan, cap.channel, bundle, { runId: 'r' });

    const failed = cap.events.find((e) => e.event === 'plan_failed');
    expect(failed).toBeDefined();
    expect((failed!.data as { error: string }).error).toMatch(/rpc down/);
  });

  it('retries createTask once on a "TaskCreated event not found" revert, then succeeds', async () => {
    const cap = new CaptureChannel();
    const bundle = makeFakeBundle();
    const original = bundle.sage.tasks.createTask;
    let calls = 0;
    bundle.sage.tasks.createTask = async (spec: TaskSpec): Promise<TaskId> => {
      calls += 1;
      // Mimic the adapter's mined-but-reverted symptom on the first attempt.
      if (calls === 1) throw new Error('TaskCreated event not found in receipt');
      return original(spec);
    };
    const plan = makePlan([makeSubtask({ id: 1 })]);

    const promise = runPlan(plan, cap.channel, bundle, { runId: 'retry-create' });
    await vi.advanceTimersByTimeAsync(5_000); // retry backoff
    await vi.advanceTimersByTimeAsync(30_000); // poll Created → Completed
    await promise;

    expect(calls).toBe(2); // failed once, retried once
    const names = cap.events.map((e) => e.event);
    expect(names).toContain('subtask_created');
    expect(names).toContain('subtask_paid');
    expect(names).toContain('plan_completed');
  });

  it('does NOT retry a non-revert createTask error', async () => {
    const cap = new CaptureChannel();
    let calls = 0;
    const bundle = makeFakeBundle();
    bundle.sage.tasks.createTask = async (): Promise<TaskId> => {
      calls += 1;
      throw new Error('rpc down');
    };
    const plan = makePlan([makeSubtask({ id: 1 })]);

    await runPlan(plan, cap.channel, bundle, { runId: 'no-retry' });

    expect(calls).toBe(1); // not retried — error doesn't match the revert signature
    expect(cap.events.some((e) => e.event === 'plan_failed')).toBe(true);
  });

  it('aborts before downstream sub-tasks when an upstream one errors', async () => {
    const cap = new CaptureChannel();
    let calls = 0;
    const bundle = {
      sage: {
        tasks: {
          async createTask(spec: TaskSpec): Promise<TaskId> {
            calls += 1;
            if (calls === 1) throw new Error('first task explodes');
            return makeTaskId(String(calls));
          },
          async getTask() {
            return null;
          },
          async approvePayment() {
            return '0xnope';
          },
        },
      },
      publicClient: {
        async waitForTransactionReceipt() {
          return { status: 'success' };
        },
      },
    } as unknown as ReturnType<typeof makeFakeBundle>;
    const plan = makePlan([
      makeSubtask({ id: 1 }),
      makeSubtask({ id: 2, depends_on: [1] }),
    ]);

    await runPlan(plan, cap.channel, bundle, { runId: 'r' });

    const createdSubIds = cap.events
      .filter((e) => e.event === 'subtask_created')
      .map((e) => (e.data as { subId: number }).subId);
    // First subtask errored before subtask_created (throw was in createTask),
    // so neither id should appear in subtask_created events.
    expect(createdSubIds).toEqual([]);
    expect(calls).toBe(1); // second sub-task never tried
  });

  it('times out a subtask that never reaches Completed', async () => {
    const cap = new CaptureChannel();
    const bundle = makeFakeBundle({ stallStatus: TaskStatus.Accepted });
    const plan = makePlan([makeSubtask({ id: 1 })]);

    const promise = runPlan(plan, cap.channel, bundle, {
      runId: 'r',
      subtaskTimeoutMs: 30_000,
    });
    await vi.advanceTimersByTimeAsync(40_000);
    await promise;

    const failed = cap.events.find((e) => e.event === 'plan_failed');
    expect(failed).toBeDefined();
    expect((failed!.data as { error: string }).error).toMatch(/timed out/);
  });
});

describe('runPlan — polling interval guard', () => {
  it('POLL_INTERVAL_MS is at least 10 seconds (per GOTCHAS 2026-05-13)', () => {
    expect(__testing.POLL_INTERVAL_MS).toBeGreaterThanOrEqual(10_000);
  });
});
