/**
 * Orchestrator agent — HTTP server that coordinates Summarizer + Translator.
 *
 * POST /process { text } →
 *   1. Create escrow task for Summarizer, wait for completion
 *   2. Create escrow task for Translator, wait for completion
 *   3. Return { summary, translation, txHashes }
 */

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { loadConfig, createSageFromConfig } from '../shared/config.js';
import { taskId as makeTaskId, TaskStatus } from '@sage/core';
import type { TaskId } from '@sage/core';

const config = loadConfig(3000);
const { sage } = createSageFromConfig(config);

const SUMMARIZER_ADDRESS = process.env['SUMMARIZER_ADDRESS'] as `0x${string}` | undefined;
const TRANSLATOR_ADDRESS = process.env['TRANSLATOR_ADDRESS'] as `0x${string}` | undefined;
const TASK_AMOUNT = BigInt(process.env['TASK_AMOUNT'] ?? '1000'); // 0.001 USDC default

async function waitForCompletion(id: TaskId, timeoutMs = 120_000): Promise<string> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const task = await sage.tasks.getTask(id);
    if (task && task.status === TaskStatus.Completed) {
      return task.resultUri;
    }
    if (task && (task.status === TaskStatus.Paid || task.status === TaskStatus.Expired || task.status === TaskStatus.Refunded)) {
      throw new Error(`Task ${id} ended in unexpected status: ${task.status}`);
    }
    await new Promise((r) => setTimeout(r, 3000));
  }
  throw new Error(`Task ${id} timed out after ${timeoutMs}ms`);
}

async function processText(text: string) {
  const txHashes: string[] = [];

  if (!SUMMARIZER_ADDRESS || !TRANSLATOR_ADDRESS) {
    throw new Error('SUMMARIZER_ADDRESS and TRANSLATOR_ADDRESS must be set');
  }

  const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600);

  // Step 1: Summarize
  console.error('[Orchestrator] Creating summary task...');
  const summaryTaskId = await sage.tasks.createTask({
    executor: SUMMARIZER_ADDRESS as any,
    deadline: Number(deadline),
    amount: TASK_AMOUNT,
    specUri: text,
  });
  console.error(`[Orchestrator] Summary task created: ${summaryTaskId}`);

  const summaryResult = await waitForCompletion(summaryTaskId);
  const summary = decodeURIComponent(summaryResult.replace('data:text/plain,', ''));

  // Approve payment
  const approveTx1 = await sage.tasks.approvePayment(summaryTaskId);
  txHashes.push(approveTx1);
  console.error(`[Orchestrator] Summary approved: ${approveTx1}`);

  // Step 2: Translate
  console.error('[Orchestrator] Creating translation task...');
  const translateTaskId = await sage.tasks.createTask({
    executor: TRANSLATOR_ADDRESS as any,
    deadline: Number(deadline),
    amount: TASK_AMOUNT,
    specUri: summary,
  });
  console.error(`[Orchestrator] Translation task created: ${translateTaskId}`);

  const translationResult = await waitForCompletion(translateTaskId);
  const translation = decodeURIComponent(translationResult.replace('data:text/plain,', ''));

  const approveTx2 = await sage.tasks.approvePayment(translateTaskId);
  txHashes.push(approveTx2);
  console.error(`[Orchestrator] Translation approved: ${approveTx2}`);

  return { summary, translation, txHashes };
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks).toString()));
    req.on('error', reject);
  });
}

const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
  if (req.url === '/health' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', agent: 'Orchestrator' }));
    return;
  }

  if (req.url === '/process' && req.method === 'POST') {
    try {
      const body = JSON.parse(await readBody(req)) as { text?: string };
      if (!body.text) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Missing "text" field' }));
        return;
      }

      const result = await processText(body.text);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(result));
    } catch (err) {
      console.error('[Orchestrator] Error:', err);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: String(err) }));
    }
    return;
  }

  res.writeHead(404);
  res.end('Not found');
});

server.listen(config.port, () => {
  console.error(`[Orchestrator] listening on port ${config.port}`);
});

process.on('SIGINT', () => { server.close(); process.exit(0); });
process.on('SIGTERM', () => { server.close(); process.exit(0); });
