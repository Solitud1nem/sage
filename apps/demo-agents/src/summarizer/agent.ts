/**
 * Summarizer agent — capability: "summarize"
 * Listens for TaskCreated events, summarizes text via OpenAI (or mock), completes task.
 */

import { loadConfig, createSageFromConfig } from '../shared/config.js';
import { BaseAgent } from '../shared/base-agent.js';
import { taskId } from '@sage/core';
import { taskEscrowAbi, base, baseSepolia } from '@sage/adapter-evm';

const config = loadConfig(3001);
const { sage, publicClient, account } = createSageFromConfig(config);
const escrowAddress = config.chain === 'mainnet'
  ? base.contracts.taskEscrow
  : baseSepolia.contracts.taskEscrow;

async function summarize(text: string): Promise<string> {
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
          { role: 'system', content: 'Summarize the following text concisely.' },
          { role: 'user', content: text },
        ],
        max_tokens: 200,
      }),
    });
    const data = (await res.json()) as { choices: Array<{ message: { content: string } }> };
    return data.choices[0]?.message?.content ?? 'Summary unavailable';
  }

  // Mock fallback
  return `[MOCK SUMMARY] ${text.slice(0, 100)}...`;
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

    const result = await summarize(task.specUri);
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
