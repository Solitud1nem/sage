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
import { decodeCompositeEnvelope, materialFromEnvelope } from '../shared/composite-codec.js';
import { pollNewTasks } from '../shared/task-poller.js';
import { awaitTaskState } from '../shared/await-task-state.js';
import { TaskStatus, taskId } from '@sage/core';
import { taskEscrowAbi } from '@sage/adapter-evm';

// Multi-process Fly: each process inherits the same env, so workers read a
// role-specific override before falling back to the shared PRIVATE_KEY.
if (process.env.SUMMARIZER_PRIVATE_KEY) {
  process.env.PRIVATE_KEY = process.env.SUMMARIZER_PRIVATE_KEY;
}

const config = loadConfig(3001);
const { sage, publicClient, account, chainConfig } = createSageFromConfig(config);
const escrowAddress = chainConfig.contracts.taskEscrow;

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
  // OpenAI returns `{ error }` without `choices` on 429/5xx; a bare cast to
  // `{ choices: [...] }` made `data.choices[0]` throw, stranding the task in
  // Accepted (CR.2). Mirror the vision/sentiment handling: surface an honest
  // failure result so completeTask still runs and the escrow settles.
  const data = (await res.json().catch(() => null)) as {
    choices?: Array<{ message: { content: string } }>;
    error?: { message: string };
  } | null;
  if (!res.ok || data?.error) {
    const detail = data?.error?.message ?? `HTTP ${res.status}`;
    console.error(`[Summarizer] OpenAI error: ${detail}`);
    return `Summary failed: ${detail}`;
  }
  return data?.choices?.[0]?.message?.content ?? 'Result unavailable';
}

const COMPOSITE_SYSTEM_PROMPT =
  'You are a generalist task executor in a multi-step plan. The user message has an INSTRUCTION section (the task — summarize, research, compare, draft, analyze, or write) and may have a MATERIAL section (the content to apply it to). ' +
  'When MATERIAL is present, apply the instruction to it (e.g. summarize THAT content), not to your training data; the MATERIAL may be the original request framing or an upstream step\'s output. When no MATERIAL is present, execute the instruction directly. ' +
  'Return the deliverable only — no preamble, no "the task is to…". Keep it concise but useful (target 100-250 words unless the task explicitly asks for longer).';

async function executeOrSummarize(specUri: string): Promise<string> {
  const env = decodeCompositeEnvelope(specUri);

  if (config.openaiApiKey) {
    if (env !== null) {
      // Composite path: spec is the instruction; material (source/inputs) is
      // the content to apply it to (ADR-0018). Material absent on legacy
      // envelopes — fall back to spec-only.
      const material = materialFromEnvelope(env);
      const userText =
        material !== null ? `INSTRUCTION:\n${env.spec}\n\nMATERIAL:\n${material}` : env.spec;
      return callOpenAI(COMPOSITE_SYSTEM_PROMPT, userText, 600);
    }
    // 3-mode path: specUri is content, summarize it (existing behavior).
    return callOpenAI('Summarize the following text concisely.', specUri, 200);
  }

  // Mock fallback — different shapes for each path.
  if (env !== null) {
    return `[MOCK COMPOSITE RESULT] for task: ${env.spec.slice(0, 100)}…`;
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

    // Wait for the RPC read replica to reflect Accepted state before reading
    // specUri. Bounded retry replaces a flat 2s sleep that silently abandoned
    // the task whenever the replica lagged longer. See await-task-state.ts.
    const task = await awaitTaskState((tid) => sage.tasks.getTask(tid), id, TaskStatus.Accepted);
    if (!task) {
      console.error(`[Summarizer] Task ${id} state did not become Accepted within 10s — skipping`);
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

    // Direct nextTaskId polling instead of `watchContractEvent`. viem's
    // event watchers (filter + poll modes) both fail to deliver
    // TaskCreated on Arc testnet RPC, even though raw `eth_getLogs`
    // works for address-only filters. See GOTCHAS 2026-05-22 +
    // shared/task-poller.ts header.
    pollNewTasks({
      publicClient,
      escrowAddress,
      abi: taskEscrowAbi,
      myAddress: account.address,
      pollIntervalMs: 15_000,
      tag: 'Summarizer',
      onTaskForMe: (id, clientAddr, executor) => {
        handleTaskCreated(id, clientAddr, executor).catch(console.error);
      },
    });
  },
});

agent.start().catch(console.error);
