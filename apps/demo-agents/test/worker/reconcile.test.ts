import { describe, it, expect } from 'vitest';
import { TaskStatus, agentId, taskId, type TaskRecord } from '@sage/core';

import { createReconciler, type TaskReader } from '../../src/worker/reconcile.js';

const OURS = '0xaaaa000000000000000000000000000000000001';
const OTHER = '0xbbbb000000000000000000000000000000000002';
const CLIENT = '0xcccc000000000000000000000000000000000003';

function makeTask(p: Partial<TaskRecord> & { id: bigint }): TaskRecord {
  return {
    id: taskId(p.id.toString()),
    client: agentId(CLIENT),
    executor: p.executor ?? agentId(OURS),
    amount: p.amount ?? 100_000n,
    deadline: p.deadline ?? Math.floor(Date.now() / 1000) + 3600,
    status: p.status ?? TaskStatus.Created,
    specUri: p.specUri ?? 'do the thing',
    resultUri: '',
    completedAt: 0,
    executorShare: 0n,
  };
}

/** In-memory escrow: tasks by id, nextTaskId = head. Instrumented. */
function makeReader(tasks: Map<bigint, TaskRecord>, head: bigint) {
  const calls = { nextTaskId: 0, getTask: [] as bigint[] };
  const reader: TaskReader = {
    async nextTaskId() {
      calls.nextTaskId += 1;
      return head;
    },
    async getTask(id: bigint) {
      calls.getTask.push(id);
      return tasks.get(id) ?? null;
    },
  };
  return { reader, calls };
}

type Dispatched = { id: bigint; resume: boolean };

function makeReconciler(
  reader: TaskReader,
  overrides: Partial<Parameters<typeof createReconciler>[0]> = {},
) {
  const dispatched: Dispatched[] = [];
  const reconciler = createReconciler({
    reader,
    addresses: new Set([OURS]),
    dispatch: async (id, _task, resume) => {
      dispatched.push({ id, resume });
    },
    minScanIntervalMs: 0,
    log: () => {},
    ...overrides,
  });
  return { reconciler, dispatched };
}

describe('reconciliation pass', () => {
  it('dispatches Created tasks for our identities (resume=false)', async () => {
    const tasks = new Map([[5n, makeTask({ id: 5n })]]);
    const { reader } = makeReader(tasks, 6n);
    const { reconciler, dispatched } = makeReconciler(reader, { bootScanBack: 10 });

    await reconciler.requestPass('boot');
    expect(dispatched).toEqual([{ id: 5n, resume: false }]);
  });

  it('resumes Accepted tasks for our identities (crash recovery, resume=true)', async () => {
    const tasks = new Map([[3n, makeTask({ id: 3n, status: TaskStatus.Accepted })]]);
    const { reader } = makeReader(tasks, 4n);
    const { reconciler, dispatched } = makeReconciler(reader, { bootScanBack: 10 });

    await reconciler.requestPass('boot');
    expect(dispatched).toEqual([{ id: 3n, resume: true }]);
  });

  it('ignores foreign executors and settled statuses', async () => {
    const tasks = new Map<bigint, TaskRecord>([
      [1n, makeTask({ id: 1n, executor: agentId(OTHER) })],
      [2n, makeTask({ id: 2n, status: TaskStatus.Completed })],
      [3n, makeTask({ id: 3n, status: TaskStatus.Paid })],
      [4n, makeTask({ id: 4n, status: TaskStatus.Expired })],
    ]);
    const { reader } = makeReader(tasks, 5n);
    const { reconciler, dispatched } = makeReconciler(reader, { bootScanBack: 10 });

    await reconciler.requestPass('boot');
    expect(dispatched).toEqual([]);
  });

  it('first pass starts bootScanBack behind head', async () => {
    const { reader, calls } = makeReader(new Map(), 300n);
    const { reconciler } = makeReconciler(reader, { bootScanBack: 200 });

    await reconciler.requestPass('boot');
    expect(calls.getTask[0]).toBe(100n);
    expect(calls.getTask.at(-1)).toBe(299n);
  });

  it('clamps the scan-back window at task 0', async () => {
    const { reader, calls } = makeReader(new Map(), 5n);
    const { reconciler } = makeReconciler(reader, { bootScanBack: 200 });

    await reconciler.requestPass('boot');
    expect(calls.getTask[0]).toBe(0n);
  });

  it('later passes resume from the cursor, not the scan-back window', async () => {
    const { reader, calls } = makeReader(new Map(), 10n);
    const { reconciler } = makeReconciler(reader, { bootScanBack: 5 });

    await reconciler.requestPass('boot'); // scans [5, 10)
    calls.getTask.length = 0;

    await reconciler.requestPass('wake'); // cursor=10, head=10 → nothing
    expect(calls.getTask).toEqual([]);
    expect(reconciler.cursor).toBe(10n);
  });

  it('parks the cursor AT a failing id so the task is retried, not skipped', async () => {
    const tasks = new Map([[8n, makeTask({ id: 8n })]]);
    let failOnce = true;
    const { reader } = makeReader(tasks, 9n);
    const failingReader: TaskReader = {
      nextTaskId: reader.nextTaskId,
      async getTask(id: bigint) {
        if (id === 8n && failOnce) {
          failOnce = false;
          throw new Error('rpc hiccup');
        }
        return reader.getTask(id);
      },
    };
    const { reconciler, dispatched } = makeReconciler(failingReader, { bootScanBack: 3 });

    await reconciler.requestPass('boot'); // fails at 8 → cursor parked at 8
    expect(reconciler.cursor).toBe(8n);
    expect(dispatched).toEqual([]);

    await reconciler.requestPass('wake'); // retries 8 successfully
    expect(dispatched).toEqual([{ id: 8n, resume: false }]);
    expect(reconciler.cursor).toBe(9n);
  });

  it('survives a nextTaskId failure and recovers on the next pass', async () => {
    const tasks = new Map([[0n, makeTask({ id: 0n })]]);
    let first = true;
    const reader: TaskReader = {
      async nextTaskId() {
        if (first) {
          first = false;
          throw new Error('rpc down');
        }
        return 1n;
      },
      async getTask(id: bigint) {
        return tasks.get(id) ?? null;
      },
    };
    const { reconciler, dispatched } = makeReconciler(reader, { bootScanBack: 10 });

    await expect(reconciler.requestPass('boot')).resolves.toBeUndefined();
    expect(dispatched).toEqual([]);

    await reconciler.requestPass('wake');
    expect(dispatched).toEqual([{ id: 0n, resume: false }]);
  });
});

describe('single-flight + coalescing', () => {
  it('a wake during a running pass coalesces into one rerun, never a parallel scan', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    let concurrent = 0;
    let maxConcurrent = 0;
    let scans = 0;

    const reader: TaskReader = {
      async nextTaskId() {
        scans += 1;
        concurrent += 1;
        maxConcurrent = Math.max(maxConcurrent, concurrent);
        try {
          if (scans === 1) await gate;
          return 1n;
        } finally {
          concurrent -= 1;
        }
      },
      async getTask(id: bigint) {
        return makeTask({ id });
      },
    };
    const { reconciler, dispatched } = makeReconciler(reader, { bootScanBack: 1 });

    const p1 = reconciler.requestPass('boot');
    const p2 = reconciler.requestPass('wake'); // coalesces into p1's loop
    const p3 = reconciler.requestPass('wake'); // still one rerun flag
    expect(p2).toBe(p1);
    expect(p3).toBe(p1);

    release();
    await p1;

    expect(maxConcurrent).toBe(1);
    expect(scans).toBe(2); // initial pass + exactly one coalesced rerun
    expect(dispatched).toEqual([{ id: 0n, resume: false }]); // rerun found cursor==head
  });

  it('spaces scan starts by minScanIntervalMs', async () => {
    let clock = 0;
    const sleeps: number[] = [];
    const { reader } = makeReader(new Map(), 0n);
    const { reconciler } = makeReconciler(reader, {
      bootScanBack: 0,
      minScanIntervalMs: 3000,
      now: () => clock,
      sleep: async (ms) => {
        sleeps.push(ms);
        clock += ms;
      },
    });

    await reconciler.requestPass('boot');
    clock += 1000; // only 1s since last scan start
    await reconciler.requestPass('wake');

    expect(sleeps).toEqual([2000]); // throttled by the remaining 2s
  });
});

describe('drain interaction', () => {
  it('skips the pass entirely when draining', async () => {
    const { reader, calls } = makeReader(new Map([[0n, makeTask({ id: 0n })]]), 1n);
    const { reconciler, dispatched } = makeReconciler(reader, {
      bootScanBack: 5,
      isDraining: () => true,
    });

    await reconciler.requestPass('boot');
    expect(calls.getTask).toEqual([]);
    expect(dispatched).toEqual([]);
  });

  it('interrupts a running pass mid-scan and parks the cursor for the next boot', async () => {
    let draining = false;
    const dispatchedHere: Dispatched[] = [];
    const tasks = new Map([
      [0n, makeTask({ id: 0n })],
      [1n, makeTask({ id: 1n })],
    ]);
    const { reader } = makeReader(tasks, 2n);
    const { reconciler } = makeReconciler(reader, {
      bootScanBack: 5,
      isDraining: () => draining,
      dispatch: async (id, _task, resume) => {
        dispatchedHere.push({ id, resume });
        draining = true; // SIGTERM lands after the first dispatch
      },
    });

    await reconciler.requestPass('boot');
    expect(dispatchedHere).toEqual([{ id: 0n, resume: false }]);
    expect(reconciler.cursor).toBe(1n); // task 1 left for the next boot's pass
  });
});

describe('hostile/duplicate wakes', () => {
  it('N wakes at idle cost at most N bounded scans and zero dispatches', async () => {
    const { reader, calls } = makeReader(new Map(), 50n);
    const { reconciler, dispatched } = makeReconciler(reader, { bootScanBack: 0 });

    await reconciler.requestPass('boot');
    for (let i = 0; i < 5; i++) await reconciler.requestPass('wake');

    expect(dispatched).toEqual([]);
    expect(calls.getTask).toEqual([]); // cursor==head every time — reads bounded to nextTaskId
    expect(calls.nextTaskId).toBe(6);
  });
});
