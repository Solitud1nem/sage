/**
 * Multi-identity dispatch — reconciler + executor integration: one process,
 * two identities, on-chain tasks routed to the right handler signed by the
 * right wallet (M12.0.2 DoD).
 */
import { it, expect } from 'vitest';
import { TaskStatus, agentId, taskId, type TaskRecord } from '@sage/core';

import { createReconciler, type TaskReader } from '../../src/worker/reconcile.js';
import { ActivityTracker, executeTask } from '../../src/worker/executor.js';
import type { IdentityRuntime } from '../../src/worker/runtime.js';
import type { CapabilityHandler } from '../../src/worker/handlers/index.js';

const COPY_ADDR = '0xaaaa000000000000000000000000000000000001';
const FACT_ADDR = '0xbbbb000000000000000000000000000000000002';
const OTHER_ADDR = '0xdddd000000000000000000000000000000000004';
const CLIENT = '0xcccc000000000000000000000000000000000003';

function makeTask(id: bigint, executor: string, p: Partial<TaskRecord> = {}): TaskRecord {
  return {
    id: taskId(id.toString()),
    client: agentId(CLIENT),
    executor: agentId(executor),
    amount: 100_000n,
    deadline: Math.floor(Date.now() / 1000) + 3600,
    status: TaskStatus.Created,
    specUri: `spec for task ${id}`,
    resultUri: '',
    completedAt: 0,
    executorShare: 0n,
    ...p,
  };
}

function makeRuntime(id: string, capability: string, address: string) {
  const calls = { accept: [] as string[], complete: [] as string[] };
  const rt = {
    identity: { id, capability, priceUnits: 10_000n, privateKey: '0x01' as const },
    address: address as `0x${string}`,
    bundle: {
      sage: {
        tasks: {
          async acceptTask(tid: unknown) {
            calls.accept.push(String(tid));
            return '0xaccept';
          },
          async getTask(tid: unknown) {
            return makeTask(BigInt(String(tid)), address, { status: TaskStatus.Accepted });
          },
          async completeTask(tid: unknown) {
            calls.complete.push(String(tid));
            return '0xcomplete';
          },
        },
      },
      publicClient: {
        async waitForTransactionReceipt() {
          return { status: 'success' };
        },
      },
    },
  } as unknown as IdentityRuntime;
  return { rt, calls };
}

it('routes each task to its identity: correct handler, correct signer', async () => {
  const copy = makeRuntime('copywriter', 'copywrite', COPY_ADDR);
  const fact = makeRuntime('fact-checker', 'fact-check', FACT_ADDR);

  const handled: Record<string, string[]> = { copywrite: [], 'fact-check': [] };
  const handlers: Record<string, CapabilityHandler> = {
    copywrite: async (job, ctx) => {
      handled[ctx.capability]!.push(job.spec);
      return 'copy done';
    },
    'fact-check': async (job, ctx) => {
      handled[ctx.capability]!.push(job.spec);
      return 'facts checked';
    },
  };

  const byAddress = new Map<string, { rt: IdentityRuntime }>([
    [COPY_ADDR, { rt: copy.rt }],
    [FACT_ADDR, { rt: fact.rt }],
  ]);

  // Chain state: #10 → copywriter (fresh), #11 → fact-checker (Accepted by a
  // previous, crashed process), #12 → somebody else's task, #13 → settled.
  const chain = new Map<bigint, TaskRecord>([
    [10n, makeTask(10n, COPY_ADDR)],
    [11n, makeTask(11n, FACT_ADDR, { status: TaskStatus.Accepted })],
    [12n, makeTask(12n, OTHER_ADDR)],
    [13n, makeTask(13n, COPY_ADDR, { status: TaskStatus.Paid })],
  ]);
  const reader: TaskReader = {
    async nextTaskId() {
      return 14n;
    },
    async getTask(id: bigint) {
      return chain.get(id) ?? null;
    },
  };

  const activity = new ActivityTracker();
  const reconciler = createReconciler({
    reader,
    addresses: new Set(byAddress.keys()),
    bootScanBack: 10,
    minScanIntervalMs: 0,
    log: () => {},
    dispatch: (id, task, resume) => {
      const entry = byAddress.get(String(task.executor).toLowerCase())!;
      const handler = handlers[entry.rt.identity.capability]!;
      return executeTask(entry.rt, handler, id, task, {
        activity,
        openaiApiKey: undefined,
        sleep: async () => {},
        log: () => {},
      }, resume);
    },
  });

  await reconciler.requestPass('boot');

  // Copywriter's wallet accepted + completed exactly its own task.
  expect(copy.calls.accept).toEqual(['10']);
  expect(copy.calls.complete).toEqual(['10']);
  // Fact-checker resumed (no accept — already Accepted) and completed its own.
  expect(fact.calls.accept).toEqual([]);
  expect(fact.calls.complete).toEqual(['11']);
  // Each handler saw only its capability's spec.
  expect(handled['copywrite']).toEqual(['spec for task 10']);
  expect(handled['fact-check']).toEqual(['spec for task 11']);
  // Foreign + settled tasks untouched; nothing left in flight.
  expect(activity.inFlight).toBe(0);
});
