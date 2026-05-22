/**
 * Translator agent — dual-mode capability.
 *
 *   - 3-mode `/demo` path: specUri = raw text → translate EN↔RU (existing
 *     behavior, unchanged for back-compat).
 *
 *   - Composite `/demo/composite` path: specUri = `data:application/json,`
 *     envelope from `parent-id-codec` carrying `{parent, spec}`. The `spec`
 *     is an instruction like "translate the previous paragraph to French"
 *     or "переведи этот текст на испанский". We detect the envelope,
 *     extract `spec`, and switch the prompt to execution-style — the LLM
 *     produces the translation directly instead of summarizing the
 *     instruction back at us.
 *
 * M10.5.B (2026-05-21): mirrors the summarizer dual-mode fix landed in
 * M10.W3, so composite plans routed to the translator (via stem-matcher
 * on `translat*` types) produce real translations instead of echo-style
 * "the task is to translate…" output.
 */

import { loadConfig, createSageFromConfig } from '../shared/config.js';
import { BaseAgent } from '../shared/base-agent.js';
import { decodeCompositeSpec } from '../shared/composite-codec.js';
import { pollNewTasks } from '../shared/task-poller.js';
import { taskId } from '@sage/core';
import { taskEscrowAbi } from '@sage/adapter-evm';

// Multi-process Fly: each process inherits the same env, so workers read a
// role-specific override before falling back to the shared PRIVATE_KEY.
if (process.env.TRANSLATOR_PRIVATE_KEY) {
  process.env.PRIVATE_KEY = process.env.TRANSLATOR_PRIVATE_KEY;
}

const config = loadConfig(3002);
const { sage, publicClient, account, chainConfig } = createSageFromConfig(config);
const escrowAddress = chainConfig.contracts.taskEscrow;

const RAW_SYSTEM_PROMPT =
  'Translate the following text. If it is in English, translate to Russian. If in Russian, translate to English.';

const COMPOSITE_SYSTEM_PROMPT =
  'You are a translation executor. The user message is a translation instruction — it specifies the target language and either includes the source text inline or references it. ' +
  'Produce ONLY the translated text — no preamble, no commentary, no "the task is to translate…". ' +
  'If the source text is not present in the instruction (e.g. it refers to "the previous step"), output a single line stating "Translation requires source text in the spec" so the operator can fix the plan.';

async function callOpenAI(systemPrompt: string, userText: string): Promise<string> {
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
      max_tokens: 500,
    }),
  });
  const data = (await res.json()) as { choices: Array<{ message: { content: string } }> };
  return data.choices[0]?.message?.content ?? 'Translation unavailable';
}

async function translateOrExecute(specUri: string): Promise<string> {
  const compositeSpec = decodeCompositeSpec(specUri);

  if (config.openaiApiKey) {
    if (compositeSpec !== null) {
      return callOpenAI(COMPOSITE_SYSTEM_PROMPT, compositeSpec);
    }
    return callOpenAI(RAW_SYSTEM_PROMPT, specUri);
  }

  // Mock fallback — different shapes for each path.
  if (compositeSpec !== null) {
    return `[MOCK COMPOSITE TRANSLATION] for instruction: ${compositeSpec.slice(0, 100)}…`;
  }
  return `[MOCK TRANSLATION] ${specUri}`;
}

async function handleTaskCreated(taskIdBigInt: bigint, _client: `0x${string}`, executor: `0x${string}`) {
  if (executor.toLowerCase() !== account.address.toLowerCase()) return;

  const id = taskId(taskIdBigInt.toString());
  console.error(`[Translator] Task ${id} assigned to us, accepting...`);

  try {
    const acceptHash = await sage.tasks.acceptTask(id);
    const receipt = await publicClient.waitForTransactionReceipt({ hash: acceptHash as `0x${string}` });
    if (receipt.status === 'reverted') {
      console.error(`[Translator] Task ${id} accept reverted (another agent got it first)`);
      return;
    }
    console.error(`[Translator] Task ${id} accepted (tx: ${acceptHash}), working...`);

    await new Promise(r => setTimeout(r, 2000));

    const task = await sage.tasks.getTask(id);
    if (!task) {
      console.error(`[Translator] Task ${id} not found after accept — skipping`);
      return;
    }
    console.error(`[Translator] Task ${id} status: ${task.status}, specUri: ${task.specUri.slice(0,50)}`);

    const result = await translateOrExecute(task.specUri);
    const resultUri = `data:text/plain,${encodeURIComponent(result)}`;

    console.error(`[Translator] Task ${id} submitting completeTask...`);
    await sage.tasks.completeTask(id, resultUri);
    console.error(`[Translator] Task ${id} completed`);
  } catch (err) {
    console.error(`[Translator] Error handling task ${id}:`, err);
  }
}

const agent = new BaseAgent({
  name: 'Translator',
  port: config.port,
  async onStart() {
    console.error('[Translator] Watching for TaskCreated events...');

    // Direct polling — viem event watchers fail on Arc, see
    // GOTCHAS 2026-05-22 + shared/task-poller.ts.
    pollNewTasks({
      publicClient,
      escrowAddress,
      abi: taskEscrowAbi,
      myAddress: account.address,
      pollIntervalMs: 15_000,
      tag: 'Translator',
      onTaskForMe: (id, clientAddr, executor) => {
        handleTaskCreated(id, clientAddr, executor).catch(console.error);
      },
    });
  },
});

agent.start().catch(console.error);
