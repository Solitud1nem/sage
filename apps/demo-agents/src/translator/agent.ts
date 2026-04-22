/**
 * Translator agent — capability: "translate"
 * Listens for TaskCreated events, translates EN↔RU via OpenAI (or mock), completes task.
 */

import { loadConfig, createSageFromConfig } from '../shared/config.js';
import { BaseAgent } from '../shared/base-agent.js';
import { taskId } from '@sage/core';
import { taskEscrowAbi } from '@sage/adapter-evm';

const config = loadConfig(3002);
const { sage, publicClient, account } = createSageFromConfig(config);

async function translate(text: string): Promise<string> {
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
            content: 'Translate the following text. If it is in English, translate to Russian. If in Russian, translate to English.',
          },
          { role: 'user', content: text },
        ],
        max_tokens: 500,
      }),
    });
    const data = (await res.json()) as { choices: Array<{ message: { content: string } }> };
    return data.choices[0]?.message?.content ?? 'Translation unavailable';
  }

  // Mock fallback
  return `[MOCK TRANSLATION] ${text}`;
}

async function handleTaskCreated(taskIdBigInt: bigint, _client: `0x${string}`, executor: `0x${string}`) {
  if (executor.toLowerCase() !== account.address.toLowerCase()) return;

  const id = taskId(taskIdBigInt.toString());
  console.error(`[Translator] Task ${id} assigned to us, accepting...`);

  try {
    await sage.tasks.acceptTask(id);
    console.error(`[Translator] Task ${id} accepted, working...`);

    const task = await sage.tasks.getTask(id);
    if (!task) return;

    const result = await translate(task.specUri);
    const resultUri = `data:text/plain,${encodeURIComponent(result)}`;

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

    publicClient.watchContractEvent({
      address: '0x12aef3529b8404709125b727ba3db40cd5453e1e',
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
