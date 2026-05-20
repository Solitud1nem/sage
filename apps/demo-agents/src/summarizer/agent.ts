/**
 * Summarizer agent — dual-mode capability.
 *
 *   - 3-mode `/demo` path: specUri = raw article text → produce a concise
 *     summary (existing behavior, unchanged for back-compat).
 *
 *   - Composite `/demo/composite` path: specUri = `data:application/json,`
 *     envelope from `parent-id-codec` carrying `{parent, spec}`. The `spec`
 *     is an INSTRUCTION ("research flights to Tokyo for a 7-day trip"),
 *     not content. We detect the envelope, extract `spec`, and switch the
 *     prompt to execution-style so gpt-4o-mini performs the task rather
 *     than summarizing the instruction back at us.
 *
 * This is the M10.W3 tactical fix per CHANGELOG 2026-05-20: the existing
 * worker prompt assumed `specUri = content`; composite needed `specUri =
 * instruction`. Dual-mode dispatch closes the gap without splitting into
 * a new worker process.
 */

import { loadConfig, createSageFromConfig } from '../shared/config.js';
import { BaseAgent } from '../shared/base-agent.js';
import { decodeCompositeSpec } from '../shared/composite-codec.js';
import { taskId } from '@sage/core';
import { taskEscrowAbi, base, baseSepolia } from '@sage/adapter-evm';

// Multi-process Fly: each process inherits the same env, so workers read a
// role-specific override before falling back to the shared PRIVATE_KEY.
if (process.env.SUMMARIZER_PRIVATE_KEY) {
  process.env.PRIVATE_KEY = process.env.SUMMARIZER_PRIVATE_KEY;
}

const config = loadConfig(3001);
const { sage, publicClient, account } = createSageFromConfig(config);
const escrowAddress = config.chain === 'mainnet'
  ? base.contracts.taskEscrow
  : baseSepolia.contracts.taskEscrow;

// Composite-envelope detection is shared across all four worker agents.
// See `apps/demo-agents/src/shared/composite-codec.ts` — the worker
// bundle pulls it from `src/shared/`, not from `src/parent/`, so the
// worker stays independent of the parent module.

async function callOpenAI(systemPrompt: string, userText: string, maxTokens: number): Promise<string> {
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.openaiApiKey}`,
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userText },
      ],
      max_tokens: maxTokens,
    }),
  });
  const data = (await res.json()) as { choices: Array<{ message: { content: string } }> };
  return data.choices[0]?.message?.content ?? 'Result unavailable';
}

const COMPOSITE_SYSTEM_PROMPT =
  'You are a generalist task executor. The user message describes a single task to perform — research, comparison, drafting, analysis, or writing. ' +
  'Execute the task using your training data and return the result directly. Do not echo the instruction back. Do not say "the task is to…". ' +
  'Just produce the deliverable: the report, the list, the comparison, the summary — whatever the task asks for. Keep it concise but useful (target 100-250 words unless the task explicitly asks for longer).';

async function executeOrSummarize(specUri: string): Promise<string> {
  const compositeSpec = decodeCompositeSpec(specUri);

  if (config.openaiApiKey) {
    if (compositeSpec !== null) {
      // Composite path: spec is an instruction, execute it.
      return callOpenAI(COMPOSITE_SYSTEM_PROMPT, compositeSpec, 600);
    }
    // 3-mode path: specUri is content, summarize it (existing behavior).
    return callOpenAI('Summarize the following text concisely.', specUri, 200);
  }

  // Mock fallback — different shapes for each path.
  if (compositeSpec !== null) {
    return `[MOCK COMPOSITE RESULT] for task: ${compositeSpec.slice(0, 100)}…`;
  }
  return `[MOCK SUMMARY] ${specUri.slice(0, 100)}...`;
}

async function handleTaskCreated(taskIdBigInt: bigint, _client: `0x${string}`, executor: `0x${string}`) {
  if (executor.toLowerCase() !== account.address.toLowerCase()) return;

  const id = taskId(taskIdBigInt.toString());
  console.error(`[Summarizer] Task ${id} assigned to us, accepting...`);

  try {
    const acceptHash = await sage.tasks.acceptTask(id);
    const receipt = await publicClient.waitForTransactionReceipt({ hash: acceptHash as `0x${string}` });
    if (receipt.status === 'reverted') {
      console.error(`[Summarizer] Task ${id} accept reverted (another agent got it first)`);
      return;
    }
    console.error(`[Summarizer] Task ${id} accepted (tx: ${acceptHash}), working...`);

    // Wait for state propagation before reading/writing
    await new Promise(r => setTimeout(r, 2000));

    const task = await sage.tasks.getTask(id);
    if (!task) {
      console.error(`[Summarizer] Task ${id} not found after accept — skipping`);
      return;
    }
    console.error(`[Summarizer] Task ${id} status: ${task.status}, specUri: ${task.specUri.slice(0,50)}`);

    const result = await executeOrSummarize(task.specUri);
    const resultUri = `data:text/plain,${encodeURIComponent(result)}`;

    console.error(`[Summarizer] Task ${id} submitting completeTask...`);
    await sage.tasks.completeTask(id, resultUri);
    console.error(`[Summarizer] Task ${id} completed`);
  } catch (err) {
    console.error(`[Summarizer] Error handling task ${id}:`, err);
  }
}

const agent = new BaseAgent({
  name: 'Summarizer',
  port: config.port,
  async onStart() {
    console.error('[Summarizer] Watching for TaskCreated events...');

    publicClient.watchContractEvent({
      address: escrowAddress,
      abi: taskEscrowAbi,
      eventName: 'TaskCreated',
      onLogs(logs) {
        for (const log of logs) {
          handleTaskCreated(
            log.args.taskId!,
            log.args.client!,
            log.args.executor!,
          ).catch(console.error);
        }
      },
    });
  },
});

agent.start().catch(console.error);
