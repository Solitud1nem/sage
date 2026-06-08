import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { TaskStatus, taskId as makeTaskId, agentId } from '@sage/core';
import type { Plan, SubTask, TaskId, TaskRecord, TaskSpec } from '@sage/core';

import { runPlan } from '../../src/parent/plan-runner.js';
import { SseChannel } from '../../src/shared/sse.js';
import {
  resolveUserDecision,
  hasPendingDecision,
  __testing as registryTesting,
} from '../../src/parent/run-registry.js';

// ─── helpers (mirrored from plan-runner.test.ts, scoped to dispute paths) ──

const DEFAULT_EXECUTOR = '0xa61b00000000000000000000000000000000001c' as const;
const ALT_EXECUTOR = '0x5218857ef2631e0ac35fa8062671785954e918b5' as const;

function makeSubtask(p: Partial<SubTask> & { id: number }): SubTask {
  return {
    type: p.type ?? 'translate-text',
    estimated_cost_units: p.estimated_cost_units ?? 100_000n,
    deadline_offset_s: p.deadline_offset_s ?? 600,
    spec: p.spec ?? 'do the thing',
    executor_address: p.executor_address ?? DEFAULT_EXECUTOR,
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

class CaptureChannel {
  readonly channel: SseChannel;
  readonly events: Array<{ event: string; data: unknown }> = [];
  constructor() {
    this.channel = new SseChannel('dispute-test-run');
    const origEmit = this.channel.emit.bind(this.channel);
    this.channel.emit = (event: string, data: unknown) => {
      this.events.push({ event, data });
      origEmit(event, data);
    };
  }
}

interface PerTaskState {
  record: TaskRecord;
  polls: number;
  sequence: TaskStatus[];
}

/**
 * Per-task status-sequence fake bundle. Caller supplies a list of sequences
 * — first createTask gets the first sequence, second the second, etc.
 * `__spawnedExecutors` captures the executor address handed to each
 * createTask so tests can assert change-executor took effect.
 */
function makeDisputeBundle(sequencesByTaskIndex: TaskStatus[][]) {
  let nextNumericId = 1;
  const tasks = new Map<string, PerTaskState>();
  const spawnedExecutors: string[] = [];

  return {
    sage: {
      tasks: {
        async createTask(spec: TaskSpec): Promise<TaskId> {
          const idx = nextNumericId - 1;
          const id = String(nextNumericId++);
          const sequence = sequencesByTaskIndex[idx] ?? [
            TaskStatus.Created,
            TaskStatus.Accepted,
            TaskStatus.Completed,
          ];
          spawnedExecutors.push(String(spec.executor));
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
          tasks.set(id, { record, polls: 0, sequence });
          return makeTaskId(id);
        },
        async getTask(id: TaskId): Promise<TaskRecord | null> {
          const state = tasks.get(id);
          if (!state) return null;
          const idx = Math.min(state.polls, state.sequence.length - 1);
          const status = state.sequence[idx] ?? TaskStatus.Completed;
          state.polls += 1;
          const completedAt =
            status === TaskStatus.Completed ? Math.floor(Date.now() / 1000) : 0;
          const resultUri =
            status === TaskStatus.Completed
              ? `data:text/plain,${encodeURIComponent(`<result for ${id}>`)}`
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
    __spawnedExecutors: spawnedExecutors,
    __tasks: tasks,
  };
}

// ─── pause-on-dispute integration ──────────────────────────────────────

describe('runPlan — pause-on-dispute', () => {
  beforeEach(() => {
    registryTesting.clear();
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    registryTesting.clear();
  });

  it('pauses on dispute, retries on user resolution, finishes successfully', async () => {
    const cap = new CaptureChannel();
    // First task: Created → Disputed. Second task (retry): Created → Accepted → Completed.
    const bundle = makeDisputeBundle([
      [TaskStatus.Created, TaskStatus.Disputed],
      [TaskStatus.Created, TaskStatus.Accepted, TaskStatus.Completed],
    ]);
    const runId = 'run-pause-retry';
    const plan = makePlan([makeSubtask({ id: 1, spec: 'will dispute once' })]);

    const promise = runPlan(plan, cap.channel, bundle, { runId });

    // Advance enough to hit Created → poll → Disputed → throw → pause.
    await vi.advanceTimersByTimeAsync(15_000);
    expect(cap.events.some((e) => e.event === 'subtask_disputed')).toBe(true);
    expect(hasPendingDecision(runId)).toBe(true);

    // User picks Retry.
    expect(resolveUserDecision(runId, 1, { kind: 'retry' })).toBe('ok');

    // Now advance for the retry: 3 polls × 10s + receipt wait.
    await vi.advanceTimersByTimeAsync(60_000);
    await promise;

    const eventNames = cap.events.map((e) => e.event);
    expect(eventNames).toContain('subtask_disputed');
    expect(eventNames).toContain('subtask_retrying');
    expect(eventNames).toContain('subtask_completed');
    expect(eventNames).toContain('subtask_paid');
    expect(eventNames).toContain('plan_completed');

    // Both createTask invocations should have used the original executor.
    expect(bundle.__spawnedExecutors).toEqual([DEFAULT_EXECUTOR, DEFAULT_EXECUTOR]);
  });

  it('retry with newExecutor swaps the executor on re-spawn', async () => {
    const cap = new CaptureChannel();
    const bundle = makeDisputeBundle([
      [TaskStatus.Created, TaskStatus.Disputed],
      [TaskStatus.Created, TaskStatus.Accepted, TaskStatus.Completed],
    ]);
    const runId = 'run-pause-newexec';
    const plan = makePlan([makeSubtask({ id: 1 })]);

    const promise = runPlan(plan, cap.channel, bundle, { runId });

    await vi.advanceTimersByTimeAsync(15_000);
    expect(hasPendingDecision(runId)).toBe(true);

    resolveUserDecision(runId, 1, { kind: 'retry', newExecutor: ALT_EXECUTOR });

    await vi.advanceTimersByTimeAsync(60_000);
    await promise;

    expect(bundle.__spawnedExecutors).toEqual([DEFAULT_EXECUTOR, ALT_EXECUTOR]);
    const retrying = cap.events.find((e) => e.event === 'subtask_retrying');
    expect(retrying).toBeDefined();
    expect((retrying!.data as { executor: string }).executor).toBe(ALT_EXECUTOR);
    expect((retrying!.data as { attempt: number }).attempt).toBe(2);
  });

  it('cancel after dispute emits plan_failed with user_cancelled reason', async () => {
    const cap = new CaptureChannel();
    const bundle = makeDisputeBundle([[TaskStatus.Created, TaskStatus.Disputed]]);
    const runId = 'run-pause-cancel';
    const plan = makePlan([makeSubtask({ id: 1 })]);

    const promise = runPlan(plan, cap.channel, bundle, { runId });

    await vi.advanceTimersByTimeAsync(15_000);
    expect(hasPendingDecision(runId)).toBe(true);

    resolveUserDecision(runId, 1, { kind: 'cancel' });

    await promise;

    const failed = cap.events.find((e) => e.event === 'plan_failed');
    expect(failed).toBeDefined();
    expect((failed!.data as { reason?: string }).reason).toBe('user_cancelled_after_dispute');
    // No retry should have happened.
    expect(cap.events.some((e) => e.event === 'subtask_retrying')).toBe(false);
    expect(bundle.__spawnedExecutors).toEqual([DEFAULT_EXECUTOR]);
  });

  it('pause times out → plan_failed with pause_timeout reason', async () => {
    const cap = new CaptureChannel();
    const bundle = makeDisputeBundle([[TaskStatus.Created, TaskStatus.Disputed]]);
    const runId = 'run-pause-timeout';
    const plan = makePlan([makeSubtask({ id: 1 })]);

    const promise = runPlan(plan, cap.channel, bundle, { runId });

    await vi.advanceTimersByTimeAsync(15_000);
    expect(hasPendingDecision(runId)).toBe(true);

    // 2 min + buffer to trigger the default pause timeout.
    await vi.advanceTimersByTimeAsync(2 * 60 * 1000 + 100);
    await promise;

    const failed = cap.events.find((e) => e.event === 'plan_failed');
    expect(failed).toBeDefined();
    expect((failed!.data as { reason?: string }).reason).toBe('pause_timeout');
    expect(hasPendingDecision(runId)).toBe(false);
  });

  it('multi-sub-task plan: dispute on the second sub-task pauses without re-spawning the first', async () => {
    const cap = new CaptureChannel();
    const bundle = makeDisputeBundle([
      [TaskStatus.Created, TaskStatus.Accepted, TaskStatus.Completed], // sub #1 ok
      [TaskStatus.Created, TaskStatus.Disputed],                       // sub #2 disputes
      [TaskStatus.Created, TaskStatus.Accepted, TaskStatus.Completed], // sub #2 retry ok
    ]);
    const runId = 'run-pause-second';
    const plan = makePlan([
      makeSubtask({ id: 1 }),
      makeSubtask({ id: 2, depends_on: [1] }),
    ]);

    const promise = runPlan(plan, cap.channel, bundle, { runId });

    // Sub #1 completes (3 polls + receipt) before sub #2 starts.
    await vi.advanceTimersByTimeAsync(60_000);
    // Sub #2 disputes (2 polls).
    await vi.advanceTimersByTimeAsync(20_000);

    expect(hasPendingDecision(runId)).toBe(true);
    resolveUserDecision(runId, 2, { kind: 'retry' });

    await vi.advanceTimersByTimeAsync(60_000);
    await promise;

    const completedSubs = cap.events
      .filter((e) => e.event === 'subtask_paid')
      .map((e) => (e.data as { subId: number }).subId);
    expect(completedSubs.sort()).toEqual([1, 2]);
    // Three createTask calls total: sub #1, sub #2 (disputed), sub #2 (retry).
    expect(bundle.__spawnedExecutors.length).toBe(3);
  });

  it('retry that itself disputes can be cancelled', async () => {
    const cap = new CaptureChannel();
    const bundle = makeDisputeBundle([
      [TaskStatus.Created, TaskStatus.Disputed],
      [TaskStatus.Created, TaskStatus.Disputed],
    ]);
    const runId = 'run-pause-twice';
    const plan = makePlan([makeSubtask({ id: 1 })]);

    const promise = runPlan(plan, cap.channel, bundle, { runId });

    // First dispute.
    await vi.advanceTimersByTimeAsync(15_000);
    expect(hasPendingDecision(runId)).toBe(true);
    resolveUserDecision(runId, 1, { kind: 'retry' });

    // Second dispute after retry.
    await vi.advanceTimersByTimeAsync(15_000);
    expect(hasPendingDecision(runId)).toBe(true);
    resolveUserDecision(runId, 1, { kind: 'cancel' });

    await promise;

    const retrying = cap.events.filter((e) => e.event === 'subtask_retrying');
    expect(retrying.length).toBe(1);
    const disputed = cap.events.filter((e) => e.event === 'subtask_disputed');
    expect(disputed.length).toBe(2);
    expect(
      cap.events.find((e) => e.event === 'plan_failed')!.data,
    ).toMatchObject({ reason: 'user_cancelled_after_dispute' });
  });
});

// ─── review gate (ADR-0019) ────────────────────────────────────────────

describe('runPlan — review gate (ADR-0019)', () => {
  beforeEach(() => {
    registryTesting.clear();
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    registryTesting.clear();
  });

  const REVIEW_OPTS = { reviewTimeoutMs: 60_000 };

  function workerFlow() {
    return vi.fn(async () => ({
      verdict: { outcome: 'worker' as const, reasoning: 'result satisfies the instruction' },
      outcome: 'worker' as const,
      executorShare: 100_000n,
      disputeTxHash: '0xdispute',
      resolveTxHash: '0xresolve',
    }));
  }

  it('pauses each completed sub-task for review and approves on decision', async () => {
    const cap = new CaptureChannel();
    const bundle = makeDisputeBundle([[TaskStatus.Created, TaskStatus.Accepted, TaskStatus.Completed]]);
    const runId = 'review-approve';
    const plan = makePlan([makeSubtask({ id: 1 })]);
    const disputeFlow = workerFlow();

    const promise = runPlan(plan, cap.channel, bundle, { runId, reviewMode: true, disputeFlow, ...REVIEW_OPTS });

    await vi.advanceTimersByTimeAsync(30_000);
    expect(cap.events.some((e) => e.event === 'subtask_awaiting_review')).toBe(true);
    expect(hasPendingDecision(runId)).toBe(true);

    expect(resolveUserDecision(runId, 1, { kind: 'approve' })).toBe('ok');
    await vi.advanceTimersByTimeAsync(30_000);
    await promise;

    const names = cap.events.map((e) => e.event);
    expect(names).toContain('subtask_paid');
    expect(names).toContain('plan_completed');
    // Approve must NOT touch the dispute path.
    expect(disputeFlow).not.toHaveBeenCalled();
    expect(names).not.toContain('subtask_dispute_raised');
  });

  it('drives the council on dispute and continues when the verdict favors the worker', async () => {
    const cap = new CaptureChannel();
    const bundle = makeDisputeBundle([[TaskStatus.Created, TaskStatus.Accepted, TaskStatus.Completed]]);
    const runId = 'review-dispute-worker';
    const plan = makePlan([makeSubtask({ id: 1, spec: 'translate this' })]);
    const disputeFlow = workerFlow();

    const promise = runPlan(plan, cap.channel, bundle, { runId, reviewMode: true, disputeFlow, ...REVIEW_OPTS });

    await vi.advanceTimersByTimeAsync(30_000);
    expect(hasPendingDecision(runId)).toBe(true);
    expect(resolveUserDecision(runId, 1, { kind: 'dispute', reason: 'looks wrong' })).toBe('ok');
    await vi.advanceTimersByTimeAsync(30_000);
    await promise;

    expect(disputeFlow).toHaveBeenCalledOnce();
    const names = cap.events.map((e) => e.event);
    expect(names).toContain('subtask_dispute_raised');
    expect(names).toContain('subtask_dispute_resolved');
    expect(names).toContain('subtask_paid');
    expect(names).toContain('plan_completed');
    const resolved = cap.events.find((e) => e.event === 'subtask_dispute_resolved')!.data as {
      outcome: string;
      reasoning: string;
    };
    expect(resolved.outcome).toBe('worker');
  });

  it('fails the plan when the council refunds the client', async () => {
    const cap = new CaptureChannel();
    const bundle = makeDisputeBundle([[TaskStatus.Created, TaskStatus.Accepted, TaskStatus.Completed]]);
    const runId = 'review-dispute-client';
    const plan = makePlan([makeSubtask({ id: 1 })]);
    const disputeFlow = vi.fn(async () => ({
      verdict: { outcome: 'client' as const, reasoning: 'result is empty' },
      outcome: 'client' as const,
      executorShare: 0n,
      disputeTxHash: '0xd',
      resolveTxHash: '0xr',
    }));

    const promise = runPlan(plan, cap.channel, bundle, { runId, reviewMode: true, disputeFlow, ...REVIEW_OPTS });

    await vi.advanceTimersByTimeAsync(30_000);
    expect(hasPendingDecision(runId)).toBe(true);
    resolveUserDecision(runId, 1, { kind: 'dispute', reason: 'nothing returned' });
    await vi.advanceTimersByTimeAsync(30_000);
    await promise;

    const names = cap.events.map((e) => e.event);
    expect(names).toContain('subtask_refunded');
    expect(cap.events.find((e) => e.event === 'plan_failed')!.data).toMatchObject({
      reason: 'dispute_refunded',
    });
    expect(names).not.toContain('plan_completed');
  });

  it('treats a review-gate timeout as silent approval', async () => {
    const cap = new CaptureChannel();
    const bundle = makeDisputeBundle([[TaskStatus.Created, TaskStatus.Accepted, TaskStatus.Completed]]);
    const runId = 'review-timeout';
    const plan = makePlan([makeSubtask({ id: 1 })]);
    const disputeFlow = workerFlow();

    const promise = runPlan(plan, cap.channel, bundle, { runId, reviewMode: true, disputeFlow, ...REVIEW_OPTS });

    await vi.advanceTimersByTimeAsync(30_000);
    expect(hasPendingDecision(runId)).toBe(true);
    // Let the 60s review window lapse without a decision.
    await vi.advanceTimersByTimeAsync(70_000);
    await promise;

    const names = cap.events.map((e) => e.event);
    expect(names).toContain('subtask_paid');
    expect(names).toContain('plan_completed');
    expect(disputeFlow).not.toHaveBeenCalled();
  });
});
