/**
 * Sentiment agent — capability: "sentiment-classify"
 * Listens for TaskCreated events, classifies sentiment of text via OpenAI, completes task.
 *
 * specUri is raw text input.
 * Result format (plain text):
 *   <LABEL> (<score 0..1>)
 *   <blank>
 *   <1-2 sentence rationale>
 */

import { loadConfig, createSageFromConfig } from '../shared/config.js';
import { BaseAgent } from '../shared/base-agent.js';
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

async function classify(text: string): Promise<string> {
  if (config.openaiApiKey) {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.openaiApiKey}`,
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          {
            role: 'system',
            content:
              'You are a sentiment analyzer. Classify the user text as POSITIVE, NEGATIVE, or NEUTRAL. ' +
              'Output exactly three lines:\n' +
              'Line 1: <LABEL> (<score between 0.00 and 1.00, two decimals>)\n' +
              'Line 2: <blank>\n' +
              'Line 3: 1–2 sentences explaining which cues led to the label. No preamble.',
          },
          { role: 'user', content: text },
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

  // Mock fallback
  return `NEUTRAL (0.50)\n\n[MOCK SENTIMENT] Mock classifier returns neutral by default; no OpenAI key configured.`;
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

    const result = await classify(task.specUri);
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
