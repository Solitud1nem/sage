import { randomUUID } from 'node:crypto';

import { TaskStatus } from '@sage/core';
import type { TaskId } from '@sage/core';

import { SseChannel, demoRegistry } from '../shared/sse.js';
import type { createSageFromConfig } from '../shared/config.js';

/**
 * A single end-to-end demo run: Orchestrator → Summarizer → Translator,
 * emitting lifecycle events to its SSE channel as each on-chain step lands.
 *
 * Flow:
 *   1. createTask(summarizer) → emit task_created
 *   2. Poll for TaskStatus.Completed → emit task_accepted + task_completed
 *   3. approvePayment(summaryTask) → emit task_paid
 *   4. Repeat for translator (createTask → ... → task_paid)
 *   5. emit done { summary, translation, txHashes, durationMs }
 */

interface StartDemoOptions {
  text: string;
  summarizerAddress: `0x${string}`;
  translatorAddress: `0x${string}`;
  taskAmount: bigint;
}

type SageClientBundle = ReturnType<typeof createSageFromConfig>;

export function startDemoRun(sageBundle: SageClientBundle, opts: StartDemoOptions): {
  demoRunId: string;
  streamUrl: string;
} {
  const demoRunId = randomUUID();
  const channel = demoRegistry.create(demoRunId);

  // Fire-and-forget — channel carries progress + errors out.
  void runDemo(demoRunId, channel, sageBundle, opts).catch((err) => {
    const message = err instanceof Error ? err.message : String(err);
    channel.emit('error', { message });
    channel.close({ error: message });
  });

  return {
    demoRunId,
    streamUrl: `/api/demo/stream/${demoRunId}`,
  };
}

async function runDemo(
  demoRunId: string,
  channel: SseChannel,
  { sage }: SageClientBundle,
  { text, summarizerAddress, translatorAddress, taskAmount }: StartDemoOptions,
): Promise<void> {
  const startedAt = Date.now();
  const txHashes: string[] = [];
  const DEADLINE_OFFSET = 3600;

  channel.emit('run_started', { demoRunId, startedAt });

  // ── Stage 1: Summarize ─────────────────────────────────────────────
  channel.emit('stage_started', { stage: 'summarize' });
  const summaryDeadline = Math.floor(Date.now() / 1000) + DEADLINE_OFFSET;
  const summaryTaskId = await sage.tasks.createTask({
    executor: summarizerAddress,
    deadline: summaryDeadline,
    amount: taskAmount,
    specUri: text,
  });
  channel.emit('task_created', {
    stage: 'summarize',
    taskId: summaryTaskId.toString(),
    executor: summarizerAddress,
    amount: taskAmount.toString(),
  });

  const summaryResultUri = await waitForCompletion(sage, summaryTaskId, channel, 'summarize');
  const summary = decodeResult(summaryResultUri);

  const summaryApproveTx = await sage.tasks.approvePayment(summaryTaskId);
  txHashes.push(summaryApproveTx);
  channel.emit('task_paid', {
    stage: 'summarize',
    taskId: summaryTaskId.toString(),
    txHash: summaryApproveTx,
  });

  // ── Stage 2: Translate ─────────────────────────────────────────────
  channel.emit('stage_started', { stage: 'translate' });
  const translateDeadline = Math.floor(Date.now() / 1000) + DEADLINE_OFFSET;
  const translateTaskId = await sage.tasks.createTask({
    executor: translatorAddress,
    deadline: translateDeadline,
    amount: taskAmount,
    specUri: summary,
  });
  channel.emit('task_created', {
    stage: 'translate',
    taskId: translateTaskId.toString(),
    executor: translatorAddress,
    amount: taskAmount.toString(),
  });

  const translateResultUri = await waitForCompletion(sage, translateTaskId, channel, 'translate');
  const translation = decodeResult(translateResultUri);

  const translateApproveTx = await sage.tasks.approvePayment(translateTaskId);
  txHashes.push(translateApproveTx);
  channel.emit('task_paid', {
    stage: 'translate',
    taskId: translateTaskId.toString(),
    txHash: translateApproveTx,
  });

  const durationMs = Date.now() - startedAt;
  channel.close({
    summary,
    translation,
    txHashes,
    durationMs,
    totalUsdcSettled: (taskAmount * 2n).toString(),
  });
}

/**
 * Poll task status transitions and emit intermediate events.
 * Emits `task_accepted` when status flips to Accepted, `task_completed` on Completed.
 * Returns the resultUri once the task reaches Completed.
 */
async function waitForCompletion(
  sage: SageClientBundle['sage'],
  taskId: TaskId,
  channel: SseChannel,
  stage: 'summarize' | 'translate',
  timeoutMs = 120_000,
): Promise<string> {
  const start = Date.now();
  let lastStatus: TaskStatus | null = null;

  while (Date.now() - start < timeoutMs) {
    const task = await sage.tasks.getTask(taskId);
    if (!task) {
      // Task may not be indexed by the RPC node yet — retry instead of throwing
      await sleep(3000);
      continue;
    }

    if (task.status !== lastStatus) {
      lastStatus = task.status;
      if (task.status === TaskStatus.Accepted) {
        channel.emit('task_accepted', { stage, taskId: taskId.toString() });
      }
      if (task.status === TaskStatus.Completed) {
        channel.emit('task_completed', {
          stage,
          taskId: taskId.toString(),
          resultUri: task.resultUri,
        });
        return task.resultUri;
      }
    }

    if (
      task.status === TaskStatus.Paid ||
      task.status === TaskStatus.Expired ||
      task.status === TaskStatus.Refunded ||
      task.status === TaskStatus.Disputed
    ) {
      throw new Error(`Task ${taskId} ended unexpectedly in status ${task.status}`);
    }

    await sleep(2000);
  }

  throw new Error(`Task ${taskId} timed out after ${timeoutMs}ms`);
}

function decodeResult(resultUri: string): string {
  // Summarizer/translator mock agents use data: URIs for synchronous testing.
  if (resultUri.startsWith('data:text/plain,')) {
    return decodeURIComponent(resultUri.replace('data:text/plain,', ''));
  }
  return resultUri;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
