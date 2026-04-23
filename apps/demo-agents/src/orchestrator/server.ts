/**
 * Orchestrator — HTTP server coordinating demo task-lifecycle flow.
 *
 * Endpoints:
 *   GET  /health                       Liveness check (Fly.io + CI).
 *   POST /api/demo/start               Create sponsored demo run, return { demoRunId, streamUrl }.
 *   GET  /api/demo/stream/:demoRunId   SSE stream of task-lifecycle events for a run.
 *   POST /process                      (legacy) Blocking demo — kept for backward compat via curl.
 *
 * Per ADR-0006: SSE over HTTP/2, CORS restricted to known origins, sponsor
 * balance check before new runs.
 */

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';

import { loadConfig, createSageFromConfig } from '../shared/config.js';
import { demoRegistry } from '../shared/sse.js';
import { loadOrchestratorEnv } from '../shared/env.js';
import { startDemoRun } from './demo-run.js';

const env = loadOrchestratorEnv();
const config = loadConfig(env.port);
const sageBundle = createSageFromConfig(config);

// ── CORS ──────────────────────────────────────────────────────────────
function applyCors(req: IncomingMessage, res: ServerResponse): boolean {
  const origin = req.headers.origin;
  if (origin && env.allowedOrigins.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Access-Control-Max-Age', '86400');
  }
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return true;
  }
  return false;
}

// ── Helpers ───────────────────────────────────────────────────────────
function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks).toString()));
    req.on('error', reject);
  });
}

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

// ── Routes ────────────────────────────────────────────────────────────
const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
  if (applyCors(req, res)) return;

  const { method, url = '/' } = req;

  // --- /health ---------------------------------------------------------
  if (url === '/health' && method === 'GET') {
    json(res, 200, {
      status: 'ok',
      agent: 'Orchestrator',
      activeDemoRuns: demoRegistry.size,
    });
    return;
  }

  // --- POST /api/demo/start -------------------------------------------
  if (url === '/api/demo/start' && method === 'POST') {
    try {
      const raw = await readBody(req);
      const body = raw ? (JSON.parse(raw) as { text?: string }) : {};
      if (!body.text || typeof body.text !== 'string') {
        json(res, 400, { error: 'Missing "text" field (string)' });
        return;
      }

      if (!env.summarizerAddress || !env.translatorAddress) {
        json(res, 500, {
          error:
            'Server misconfigured: SUMMARIZER_ADDRESS and TRANSLATOR_ADDRESS must be set in env',
        });
        return;
      }

      // TODO: M-INT.7 — sponsor-balance check against env.sponsorMinBalanceUsdc.
      // Currently demo always accepts. Rate-limit + balance-guard land in M-INT.7.

      const { demoRunId, streamUrl } = startDemoRun(sageBundle, {
        text: body.text,
        summarizerAddress: env.summarizerAddress,
        translatorAddress: env.translatorAddress,
        taskAmount: env.taskAmount,
      });

      json(res, 202, { demoRunId, streamUrl });
    } catch (err) {
      console.error('[Orchestrator] /api/demo/start error:', err);
      json(res, 500, { error: err instanceof Error ? err.message : String(err) });
    }
    return;
  }

  // --- GET /api/demo/stream/:id ---------------------------------------
  if (method === 'GET' && url.startsWith('/api/demo/stream/')) {
    const demoRunId = url.slice('/api/demo/stream/'.length);
    const channel = demoRegistry.get(demoRunId);
    if (!channel) {
      json(res, 404, { error: 'demo run not found or already expired' });
      return;
    }
    // Channel manages its own response lifecycle (keep-alive + flush).
    channel.attach(res);
    return;
  }

  // --- /process (legacy blocking) -------------------------------------
  if (url === '/process' && method === 'POST') {
    // Legacy shape: wait synchronously and return final result. Useful for curl demos.
    try {
      const raw = await readBody(req);
      const body = JSON.parse(raw) as { text?: string };
      if (!body.text) {
        json(res, 400, { error: 'Missing "text" field' });
        return;
      }
      if (!env.summarizerAddress || !env.translatorAddress) {
        json(res, 500, { error: 'SUMMARIZER_ADDRESS / TRANSLATOR_ADDRESS not set' });
        return;
      }

      const { demoRunId, streamUrl } = startDemoRun(sageBundle, {
        text: body.text,
        summarizerAddress: env.summarizerAddress,
        translatorAddress: env.translatorAddress,
        taskAmount: env.taskAmount,
      });

      // Subscribe internally and resolve when `done` arrives.
      const channel = demoRegistry.get(demoRunId);
      if (!channel) throw new Error('channel disappeared immediately');
      const result = await new Promise<unknown>((resolve, reject) => {
        const pollDone = setInterval(() => {
          if (channel.isClosed) {
            clearInterval(pollDone);
            // Pull final payload from the last emitted event — not ideal, but matches
            // legacy shape. New integrations should use /api/demo/start + SSE.
            resolve({ demoRunId, streamUrl, note: 'see SSE stream for payload' });
          }
        }, 500);
        // Hard timeout — legacy clients expect <3min.
        setTimeout(() => {
          clearInterval(pollDone);
          reject(new Error('Legacy /process timed out — use /api/demo/start for streaming'));
        }, 180_000);
      });

      json(res, 200, result);
    } catch (err) {
      console.error('[Orchestrator] /process error:', err);
      json(res, 500, { error: err instanceof Error ? err.message : String(err) });
    }
    return;
  }

  res.writeHead(404);
  res.end('Not found');
});

server.listen(env.port, () => {
  console.error(`[Orchestrator] listening on :${env.port}`);
  console.error(`[Orchestrator] allowed origins: ${env.allowedOrigins.join(', ')}`);
});

// ── Graceful shutdown ─────────────────────────────────────────────────
function shutdown(signal: string): void {
  console.error(`[Orchestrator] ${signal} received, closing server`);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
