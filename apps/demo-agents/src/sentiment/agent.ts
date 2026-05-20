/**
 * Sentiment agent — dual-mode capability.
 *
 *   - 3-mode `/demo` path: specUri = raw text → classify sentiment of that
 *     text (existing behavior, unchanged for back-compat).
 *
 *   - Composite `/demo/composite` path: specUri = `data:application/json,`
 *     envelope from `parent-id-codec` carrying `{parent, spec}`. The `spec`
 *     is an instruction like "classify the emotional tone of this customer
 *     review: [text]". We detect the envelope, extract `spec`, and switch
 *     the prompt to execution-style — the LLM produces the LABEL+score
 *     +rationale directly instead of summarizing the instruction.
 *
 * Output format is identical across both paths: three lines (LABEL (score)
 * / blank / rationale). M10.5.B (2026-05-21) — mirrors summarizer +
 * translator dual-mode rollout so composite plans routed to sentiment
 * (via `sentiment` / `classif` / `emotion` / `tone` / `mood` stems)
 * produce real classifications rather than echo-style output.
 */

import { loadConfig, createSageFromConfig } from '../shared/config.js';
import { BaseAgent } from '../shared/base-agent.js';
import { decodeCompositeSpec } from '../shared/composite-codec.js';
import { taskId } from '@sage/core';
import { taskEscrowAbi, base, baseSepolia } from '@sage/adapter-evm';

if (process.env.SENTIMENT_PRIVATE_KEY) {
  process.env.PRIVATE_KEY = process.env.SENTIMENT_PRIVATE_KEY;
}

const config = loadConfig(3004);
const { sage, publicClient, account } = createSageFromConfig(config);
const escrowAddress = config.chain === 'mainnet'
  ? base.contracts.taskEscrow
  : baseSepolia.contracts.taskEscrow;

const RAW_SYSTEM_PROMPT =
  'You are a sentiment analyzer. Classify the user text as POSITIVE, NEGATIVE, or NEUTRAL. ' +
  'Output exactly three lines:\n' +
  'Line 1: <LABEL> (<score between 0.00 and 1.00, two decimals>)\n' +
  'Line 2: <blank>\n' +
  'Line 3: 1–2 sentences explaining which cues led to the label. No preamble.';

const COMPOSITE_SYSTEM_PROMPT =
  'You are a sentiment analyzer executing a sub-task in a multi-step plan. ' +
  'The user message is an instruction that includes the text to classify (or references it). Extract the text being asked about and classify it as POSITIVE, NEGATIVE, or NEUTRAL. ' +
  'If the instruction does not include any text to classify (it refers to "the previous step"), classify the instruction wording itself but say so on the rationale line.\n' +
  'Output exactly three lines, regardless of input:\n' +
  'Line 1: <LABEL> (<score between 0.00 and 1.00, two decimals>)\n' +
  'Line 2: <blank>\n' +
  'Line 3: 1–2 sentences explaining which cues led to the label. No preamble, no "the task is to classify…".';

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
      max_tokens: 200,
    }),
  });
  const data = (await res.json()) as {
    choices?: Array<{ message: { content: string } }>;
    error?: { message: string };
  };
  if (data.error) {
    console.error(`[Sentiment] OpenAI error: ${data.error.message}`);
    return `Sentiment failed: ${data.error.message}`;
  }
  return data.choices?.[0]?.message?.content ?? 'Sentiment unavailable';
}

async function classifyOrExecute(specUri: string): Promise<string> {
  const compositeSpec = decodeCompositeSpec(specUri);

  if (config.openaiApiKey) {
    if (compositeSpec !== null) {
      return callOpenAI(COMPOSITE_SYSTEM_PROMPT, compositeSpec);
    }
    return callOpenAI(RAW_SYSTEM_PROMPT, specUri);
  }

  // Mock fallback — same 3-line shape both paths.
  const note =
    compositeSpec !== null
      ? `[MOCK COMPOSITE SENTIMENT] No OpenAI key; instruction was: ${compositeSpec.slice(0, 80)}…`
      : '[MOCK SENTIMENT] Mock classifier returns neutral by default; no OpenAI key configured.';
  return `NEUTRAL (0.50)\n\n${note}`;
}

async function handleTaskCreated(
  taskIdBigInt: bigint,
  _client: `0x${string}`,
  executor: `0x${string}`,
) {
  if (executor.toLowerCase() !== account.address.toLowerCase()) return;

  const id = taskId(taskIdBigInt.toString());
  console.error(`[Sentiment] Task ${id} assigned to us, accepting...`);

  try {
    const acceptHash = await sage.tasks.acceptTask(id);
    const receipt = await publicClient.waitForTransactionReceipt({
      hash: acceptHash as `0x${string}`,
    });
    if (receipt.status === 'reverted') {
      console.error(`[Sentiment] Task ${id} accept reverted (another agent got it first)`);
      return;
    }
    console.error(`[Sentiment] Task ${id} accepted (tx: ${acceptHash}), working...`);

    await new Promise((r) => setTimeout(r, 2000));

    const task = await sage.tasks.getTask(id);
    if (!task) {
      console.error(`[Sentiment] Task ${id} not found after accept — skipping`);
      return;
    }
    console.error(
      `[Sentiment] Task ${id} status: ${task.status}, specUri: ${task.specUri.slice(0, 50)}`,
    );

    const result = await classifyOrExecute(task.specUri);
    const resultUri = `data:text/plain,${encodeURIComponent(result)}`;

    console.error(`[Sentiment] Task ${id} submitting completeTask...`);
    await sage.tasks.completeTask(id, resultUri);
    console.error(`[Sentiment] Task ${id} completed`);
  } catch (err) {
    console.error(`[Sentiment] Error handling task ${id}:`, err);
  }
}

const agent = new BaseAgent({
  name: 'Sentiment',
  port: config.port,
  async onStart() {
    console.error('[Sentiment] Watching for TaskCreated events...');

    publicClient.watchContractEvent({
      address: escrowAddress,
      abi: taskEscrowAbi,
      eventName: 'TaskCreated',
      onLogs(logs) {
        for (const log of logs) {
          handleTaskCreated(log.args.taskId!, log.args.client!, log.args.executor!).catch(
            console.error,
          );
        }
      },
    });
  },
});

agent.start().catch(console.error);
