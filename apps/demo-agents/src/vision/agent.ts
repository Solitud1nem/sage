/**
 * Vision agent — capability: "vision-describe"
 * Listens for TaskCreated events, describes image (URL) via OpenAI gpt-4o-mini, completes task.
 *
 * specUri is the raw image URL (http(s)://...).
 * Result is a plain-text description, capped at 500 chars.
 */

import { loadConfig, createSageFromConfig } from '../shared/config.js';
import { BaseAgent } from '../shared/base-agent.js';
import { taskId } from '@sage/core';
import { taskEscrowAbi, base, baseSepolia } from '@sage/adapter-evm';

if (process.env.VISION_PRIVATE_KEY) {
  process.env.PRIVATE_KEY = process.env.VISION_PRIVATE_KEY;
}

const config = loadConfig(3003);
const { sage, publicClient, account } = createSageFromConfig(config);
const escrowAddress = config.chain === 'mainnet'
  ? base.contracts.taskEscrow
  : baseSepolia.contracts.taskEscrow;

const MAX_DESCRIPTION_CHARS = 500;

async function describe(imageUrl: string): Promise<string> {
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
            role: 'user',
            content: [
              {
                type: 'text',
                text: `Describe this image in ${MAX_DESCRIPTION_CHARS} characters or less. Be specific about subjects, composition, colors, and mood. No preamble — just the description.`,
              },
              { type: 'image_url', image_url: { url: imageUrl } },
            ],
          },
        ],
        max_tokens: 200,
      }),
    });
    const data = (await res.json()) as {
      choices?: Array<{ message: { content: string } }>;
      error?: { message: string };
    };
    if (data.error) {
      console.error(`[Vision] OpenAI error: ${data.error.message}`);
      return `Vision failed: ${data.error.message}`.slice(0, MAX_DESCRIPTION_CHARS);
    }
    const description = data.choices?.[0]?.message?.content ?? 'Description unavailable';
    return description.slice(0, MAX_DESCRIPTION_CHARS);
  }

  // Mock fallback
  return `[MOCK VISION] Image at ${imageUrl} — mock describes a placeholder scene with neutral tone.`.slice(
    0,
    MAX_DESCRIPTION_CHARS,
  );
}

async function handleTaskCreated(
  taskIdBigInt: bigint,
  _client: `0x${string}`,
  executor: `0x${string}`,
) {
  if (executor.toLowerCase() !== account.address.toLowerCase()) return;

  const id = taskId(taskIdBigInt.toString());
  console.error(`[Vision] Task ${id} assigned to us, accepting...`);

  try {
    const acceptHash = await sage.tasks.acceptTask(id);
    const receipt = await publicClient.waitForTransactionReceipt({
      hash: acceptHash as `0x${string}`,
    });
    if (receipt.status === 'reverted') {
      console.error(`[Vision] Task ${id} accept reverted (another agent got it first)`);
      return;
    }
    console.error(`[Vision] Task ${id} accepted (tx: ${acceptHash}), working...`);

    await new Promise((r) => setTimeout(r, 2000));

    const task = await sage.tasks.getTask(id);
    if (!task) {
      console.error(`[Vision] Task ${id} not found after accept — skipping`);
      return;
    }
    console.error(
      `[Vision] Task ${id} status: ${task.status}, specUri: ${task.specUri.slice(0, 80)}`,
    );

    const result = await describe(task.specUri);
    const resultUri = `data:text/plain,${encodeURIComponent(result)}`;

    console.error(`[Vision] Task ${id} submitting completeTask...`);
    await sage.tasks.completeTask(id, resultUri);
    console.error(`[Vision] Task ${id} completed`);
  } catch (err) {
    console.error(`[Vision] Error handling task ${id}:`, err);
  }
}

const agent = new BaseAgent({
  name: 'Vision',
  port: config.port,
  async onStart() {
    console.error('[Vision] Watching for TaskCreated events...');

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
