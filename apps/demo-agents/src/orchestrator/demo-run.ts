import { randomUUID } from 'node:crypto';

import { TaskStatus, agentId } from '@sage/core';
import type { TaskId } from '@sage/core';

import { SseChannel, demoRegistry } from '../shared/sse.js';
import type { createSageFromConfig } from '../shared/config.js';

/**
 * A single end-to-end demo run, dispatched by mode.
 *
 *   pipeline  → Summarizer → Translator (2 stages)
 *   sentiment → Sentiment (1 stage)
 *   vision    → Vision (1 stage)
 *
 * Each stage emits stage_started → task_created → task_accepted → task_completed → task_paid.
 * Final `done` payload shape varies by mode (summary/translation, sentiment, description).
 */

export type DemoMode = 'pipeline' | 'sentiment' | 'vision';

interface StartDemoOptions {
  mode: DemoMode;
  text?: string | undefined;
  imageUrl?: string | undefined;
  summarizerAddress?: `0x${string}` | undefined;
  translatorAddress?: `0x${string}` | undefined;
  visionAddress?: `0x${string}` | undefined;
  sentimentAddress?: `0x${string}` | undefined;
  taskAmount: bigint;
}

type SageClientBundle = ReturnType<typeof createSageFromConfig>;

const DEADLINE_OFFSET = 3600;

export function startDemoRun(
  sageBundle: SageClientBundle,
  opts: StartDemoOptions,
): {
  demoRunId: string;
  streamUrl: string;
} {
  const demoRunId = randomUUID();
  const channel = demoRegistry.create(demoRunId);

  // Fire-and-forget — channel carries progress + errors out.
  void runDemo(demoRunId, channel, sageBundle, opts).catch((err) => {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[Orchestrator] demo ${demoRunId} failed:`, err);
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
  bundle: SageClientBundle,
  opts: StartDemoOptions,
): Promise<void> {
  const startedAt = Date.now();
  const txHashes: string[] = [];

  channel.emit('run_started', { demoRunId, mode: opts.mode, startedAt });

  switch (opts.mode) {
    case 'pipeline':
      await runPipeline(bundle, channel, opts, txHashes, startedAt);
      return;
    case 'sentiment':
      await runSentiment(bundle, channel, opts, txHashes, startedAt);
      return;
    case 'vision':
      await runVision(bundle, channel, opts, txHashes, startedAt);
      return;
    default: {
      const _exhaustive: never = opts.mode;
      throw new Error(`Unknown demo mode: ${String(_exhaustive)}`);
    }
  }
}

// ── Mode runners ────────────────────────────────────────────────────────

async function runPipeline(
  bundle: SageClientBundle,
  channel: SseChannel,
  opts: StartDemoOptions,
  txHashes: string[],
  startedAt: number,
): Promise<void> {
  if (!opts.text) throw new Error('pipeline mode requires `text`');
  if (!opts.summarizerAddress) throw new Error('pipeline mode requires summarizerAddress');
  if (!opts.translatorAddress) throw new Error('pipeline mode requires translatorAddress');

  const { result: summary } = await runStage(bundle, channel, txHashes, {
    stage: 'summarize',
    executor: opts.summarizerAddress,
    specUri: opts.text,
    amount: opts.taskAmount,
  });

  const { result: translation } = await runStage(bundle, channel, txHashes, {
    stage: 'translate',
    executor: opts.translatorAddress,
    specUri: summary,
    amount: opts.taskAmount,
  });

  channel.close({
    mode: 'pipeline',
    summary,
    translation,
    txHashes,
    durationMs: Date.now() - startedAt,
    totalUsdcSettled: (opts.taskAmount * 2n).toString(),
  });
}

async function runSentiment(
  bundle: SageClientBundle,
  channel: SseChannel,
  opts: StartDemoOptions,
  txHashes: string[],
  startedAt: number,
): Promise<void> {
  if (!opts.text) throw new Error('sentiment mode requires `text`');
  if (!opts.sentimentAddress) throw new Error('sentiment mode requires sentimentAddress');

  const { result: sentiment } = await runStage(bundle, channel, txHashes, {
    stage: 'sentiment',
    executor: opts.sentimentAddress,
    specUri: opts.text,
    amount: opts.taskAmount,
  });

  channel.close({
    mode: 'sentiment',
    sentiment,
    txHashes,
    durationMs: Date.now() - startedAt,
    totalUsdcSettled: opts.taskAmount.toString(),
  });
}

async function runVision(
  bundle: SageClientBundle,
  channel: SseChannel,
  opts: StartDemoOptions,
  txHashes: string[],
  startedAt: number,
): Promise<void> {
  if (!opts.imageUrl) throw new Error('vision mode requires `imageUrl`');
  if (!opts.visionAddress) throw new Error('vision mode requires visionAddress');

  const { result: description } = await runStage(bundle, channel, txHashes, {
    stage: 'vision',
    executor: opts.visionAddress,
    specUri: opts.imageUrl,
    amount: opts.taskAmount,
  });

  channel.close({
    mode: 'vision',
    description,
    txHashes,
    durationMs: Date.now() - startedAt,
    totalUsdcSettled: opts.taskAmount.toString(),
  });
}

// ── Stage runner ────────────────────────────────────────────────────────

interface StageOptions {
  stage: string;
  executor: `0x${string}`;
  specUri: string;
  amount: bigint;
}

async function runStage(
  { sage, publicClient }: SageClientBundle,
  channel: SseChannel,
  txHashes: string[],
  { stage, executor, specUri, amount }: StageOptions,
): Promise<{ taskId: TaskId; result: string }> {
  channel.emit('stage_started', { stage });

  const deadline = Math.floor(Date.now() / 1000) + DEADLINE_OFFSET;
  const tid = await sage.tasks.createTask({
    executor: agentId(executor),
    deadline,
    amount,
    specUri,
  });
  channel.emit('task_created', {
    stage,
    taskId: tid.toString(),
    executor,
    amount: amount.toString(),
  });

  const resultUri = await waitForCompletion(sage, tid, channel, stage);
  const result = decodeResult(resultUri);

  const approveTx = await sage.tasks.approvePayment(tid);
  txHashes.push(approveTx);

  // Wait for the approvePayment receipt BEFORE emitting task_paid (code
  // review 2026-06-09, H3 / CR.12): a mined-but-reverted approvePayment must
  // surface as a run error, not a success event. The wait also keeps the next
  // sponsor-issued tx from reusing a still-pending nonce ("replacement
  // underpriced") — critical for multi-stage flows. Cost: task_paid arrives
  // one receipt-wait (~2-4s on Base) later than before.
  const receipt = await publicClient.waitForTransactionReceipt({
    hash: approveTx as `0x${string}`,
  });
  if (receipt.status === 'reverted') {
    throw new Error(`approvePayment for stage "${stage}" reverted on-chain (tx ${approveTx})`);
  }

  channel.emit('task_paid', {
    stage,
    taskId: tid.toString(),
    txHash: approveTx,
  });

  return { taskId: tid, result };
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
  stage: string,
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
  // Agents use data: URIs for synchronous testing; raw URLs / strings pass through.
  if (resultUri.startsWith('data:text/plain,')) {
    return decodeURIComponent(resultUri.replace('data:text/plain,', ''));
  }
  return resultUri;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
