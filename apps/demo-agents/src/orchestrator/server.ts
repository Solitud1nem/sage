/**
 * Orchestrator — HTTP server coordinating demo task-lifecycle flow.
 *
 * Endpoints:
 *   GET  /health                              Liveness check (Fly.io + CI).
 *   POST /api/demo/start                      Sponsored demo run, return { demoRunId, streamUrl }.
 *   GET  /api/demo/stream/:demoRunId          SSE stream for a 3-mode demo run.
 *   POST /api/demo/composite/classify         Classify a brief → ClassificationResult.
 *   POST /api/demo/composite/execute          Spawn an approved Plan → { runId, streamUrl }.
 *   GET  /api/demo/composite/stream/:runId    SSE stream for a composite plan run.
 *   POST /process                             (legacy) Blocking demo — back-compat curl.
 *
 * Per ADR-0006: SSE over HTTP/2, CORS restricted to known origins, sponsor
 * balance check before new runs.
 */

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';

import { loadConfig, createSageFromConfig } from '../shared/config.js';
import { demoRegistry } from '../shared/sse.js';
import { loadOrchestratorEnv } from '../shared/env.js';
import { checkSponsorStatus, formatUsdc } from './guards.js';
import { startDemoRun, type DemoMode } from './demo-run.js';
import { classifyBrief, executePlan } from '../parent/index.js';
import type { Plan, SubTask } from '@sage/core';

const env = loadOrchestratorEnv();
const config = loadConfig(env.port);
const sageBundle = createSageFromConfig(config);

// Discover which chain this orchestrator is talking to. Resolved once at boot
// and echoed back on /health + /api/demo/start so the frontend can label the
// demo run truthfully regardless of the user's wallet chain.
let chainInfo: { chainId: number; displayName: string; explorerUrl: string } = {
  chainId: 0,
  displayName: 'unknown',
  explorerUrl: '',
};

const EXPLORERS: Record<number, { displayName: string; url: string }> = {
  8453: { displayName: 'Base', url: 'https://basescan.org' },
  84532: { displayName: 'Base Sepolia', url: 'https://sepolia.basescan.org' },
};

async function resolveChainInfo(): Promise<void> {
  try {
    const id = await sageBundle.publicClient.getChainId();
    const known = EXPLORERS[id];
    chainInfo = {
      chainId: id,
      displayName: known?.displayName ?? `chain ${id}`,
      explorerUrl: known?.url ?? '',
    };
    console.error(`[Orchestrator] chain: ${chainInfo.displayName} (${id})`);
  } catch (err) {
    console.error('[Orchestrator] failed to resolve chainId at boot:', err);
  }
}

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

/**
 * JSON.stringify variant that serializes `bigint` as decimal strings.
 * Used by composite endpoints whose payloads carry USDC base-unit amounts
 * (`estimated_cost_units`, `estimated_total_cost_units`) — JSON has no
 * native bigint, so the wire format is a decimal string the frontend parses
 * back with `BigInt()`.
 */
function jsonWithBigints(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(
    JSON.stringify(body, (_k, v) => (typeof v === 'bigint' ? v.toString() : v)),
  );
}

/**
 * Parse and validate a Plan from a JSON request body. The wire format is
 * the `Plan` shape from `@sage/core` with `estimated_*cost_units` carried
 * as decimal strings. Throws a string error on validation failure — the
 * caller wraps it in a 400.
 */
function parsePlanFromBody(raw: unknown): Plan {
  if (!raw || typeof raw !== 'object') throw 'body must be a JSON object';
  const r = raw as Record<string, unknown>;
  if (typeof r['brief'] !== 'string' || r['brief'].length === 0) {
    throw 'brief must be a non-empty string';
  }
  if (r['decomposability'] !== 'one-shot' && r['decomposability'] !== 'composite') {
    throw 'decomposability must be "one-shot" or "composite"';
  }
  if (r['stakes'] !== 'low' && r['stakes'] !== 'high') {
    throw 'stakes must be "low" or "high"';
  }
  if (!Array.isArray(r['subtasks']) || r['subtasks'].length === 0) {
    throw 'subtasks must be a non-empty array';
  }
  if (typeof r['estimated_total_cost_units'] !== 'string') {
    throw 'estimated_total_cost_units must be a decimal string';
  }
  if (typeof r['estimated_duration_ms'] !== 'number') {
    throw 'estimated_duration_ms must be a number';
  }

  const subtasks: SubTask[] = r['subtasks'].map((s, i) => parseSubTask(s, i));

  return {
    brief: r['brief'],
    decomposability: r['decomposability'],
    stakes: r['stakes'],
    subtasks,
    estimated_total_cost_units: BigInt(r['estimated_total_cost_units']),
    estimated_duration_ms: r['estimated_duration_ms'],
  };
}

function parseSubTask(raw: unknown, idx: number): SubTask {
  if (!raw || typeof raw !== 'object') throw `subtasks[${idx}] must be an object`;
  const s = raw as Record<string, unknown>;
  if (typeof s['id'] !== 'number' || !Number.isInteger(s['id']) || s['id'] < 1) {
    throw `subtasks[${idx}].id must be a positive integer`;
  }
  if (typeof s['type'] !== 'string' || s['type'].length === 0) {
    throw `subtasks[${idx}].type must be a non-empty string`;
  }
  if (typeof s['estimated_cost_units'] !== 'string' || !/^\d+$/.test(s['estimated_cost_units'])) {
    throw `subtasks[${idx}].estimated_cost_units must be a non-negative decimal string`;
  }
  if (typeof s['deadline_offset_s'] !== 'number' || s['deadline_offset_s'] < 0) {
    throw `subtasks[${idx}].deadline_offset_s must be a non-negative number`;
  }
  if (typeof s['spec'] !== 'string') {
    throw `subtasks[${idx}].spec must be a string`;
  }

  const out: SubTask = {
    id: s['id'],
    type: s['type'],
    estimated_cost_units: BigInt(s['estimated_cost_units']),
    deadline_offset_s: s['deadline_offset_s'],
    spec: s['spec'],
    ...(typeof s['executor_address'] === 'string' &&
    /^0x[a-fA-F0-9]{40}$/.test(s['executor_address'])
      ? { executor_address: s['executor_address'] as `0x${string}` }
      : {}),
    ...(Array.isArray(s['depends_on']) &&
    s['depends_on'].every((d) => typeof d === 'number' && Number.isInteger(d))
      ? { depends_on: (s['depends_on'] as number[]).slice() }
      : {}),
  };
  return out;
}

// ── Routes ────────────────────────────────────────────────────────────
const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
  if (applyCors(req, res)) return;

  const { method, url = '/' } = req;

  // --- /health ---------------------------------------------------------
  if (url === '/health' && method === 'GET') {
    // Surface sponsor status best-effort — don't block /health on RPC failure.
    let sponsor: Awaited<ReturnType<typeof checkSponsorStatus>> | null = null;
    try {
      sponsor = await checkSponsorStatus(
        sageBundle.publicClient,
        sageBundle.account.address,
        env.sponsorMinBalanceUsdc,
      );
    } catch (err) {
      console.error('[Orchestrator] sponsor status check failed:', err);
    }
    json(res, 200, {
      status: sponsor?.level === 'critical' ? 'degraded' : 'ok',
      agent: 'Orchestrator',
      activeDemoRuns: demoRegistry.size,
      chainId: chainInfo.chainId,
      chainName: chainInfo.displayName,
      explorerUrl: chainInfo.explorerUrl,
      sponsor: sponsor
        ? {
            address: sageBundle.account.address,
            balanceUsdc: formatUsdc(sponsor.balance),
            minBalanceUsdc: formatUsdc(sponsor.minBalance),
            level: sponsor.level,
            accepting: sponsor.ok,
          }
        : { error: 'balance check failed' },
    });
    return;
  }

  // --- POST /api/demo/start -------------------------------------------
  if (url === '/api/demo/start' && method === 'POST') {
    try {
      const raw = await readBody(req);
      const body = raw
        ? (JSON.parse(raw) as { mode?: string; text?: string; imageUrl?: string })
        : {};
      const mode: DemoMode = (body.mode as DemoMode | undefined) ?? 'pipeline';

      // Validate mode
      if (mode !== 'pipeline' && mode !== 'sentiment' && mode !== 'vision') {
        json(res, 400, {
          error: `Invalid mode "${String(body.mode)}" — must be one of: pipeline, sentiment, vision`,
        });
        return;
      }

      // Validate input shape per mode
      if (mode === 'pipeline' || mode === 'sentiment') {
        if (!body.text || typeof body.text !== 'string') {
          json(res, 400, { error: `${mode} mode requires "text" field (string)` });
          return;
        }
      }
      if (mode === 'vision') {
        if (!body.imageUrl || typeof body.imageUrl !== 'string') {
          json(res, 400, { error: 'vision mode requires "imageUrl" field (string)' });
          return;
        }
        // Permit only http(s) — we don't fetch the URL ourselves (OpenAI does),
        // but reject obviously-broken URLs early so we don't burn USDC on a
        // task the agent will trivially fail.
        if (!/^https?:\/\//i.test(body.imageUrl)) {
          json(res, 400, { error: 'imageUrl must start with http:// or https://' });
          return;
        }
      }

      // Validate per-mode addresses are configured
      const addressErrors: string[] = [];
      if (mode === 'pipeline') {
        if (!env.summarizerAddress) addressErrors.push('SUMMARIZER_ADDRESS');
        if (!env.translatorAddress) addressErrors.push('TRANSLATOR_ADDRESS');
      } else if (mode === 'sentiment') {
        if (!env.sentimentAddress) addressErrors.push('SENTIMENT_ADDRESS');
      } else if (mode === 'vision') {
        if (!env.visionAddress) addressErrors.push('VISION_ADDRESS');
      }
      if (addressErrors.length > 0) {
        json(res, 500, {
          error: `Server misconfigured for ${mode} mode: missing env ${addressErrors.join(', ')}`,
        });
        return;
      }

      // Sponsor balance guard (ADR-0006 / M-INT.7).
      // Skip only when SPONSOR_MIN_BALANCE_USDC=0 explicitly (local dev).
      if (env.sponsorMinBalanceUsdc > 0n) {
        try {
          const sponsor = await checkSponsorStatus(
            sageBundle.publicClient,
            sageBundle.account.address,
            env.sponsorMinBalanceUsdc,
          );
          if (!sponsor.ok) {
            json(res, 503, {
              error: 'sponsor_exhausted',
              message: `Sponsor wallet is below the ${formatUsdc(
                env.sponsorMinBalanceUsdc,
              )} USDC floor. Watch-live mode is temporarily paused — try with your wallet instead.`,
              balanceUsdc: formatUsdc(sponsor.balance),
              minBalanceUsdc: formatUsdc(sponsor.minBalance),
            });
            return;
          }
        } catch (err) {
          console.error('[Orchestrator] sponsor guard failed, allowing through:', err);
          // Soft-fail: if the balance check errors (RPC flake), allow the demo.
          // The task itself will revert if sponsor actually has no USDC, so no
          // real fund risk — just worse UX.
        }
      }

      const { demoRunId, streamUrl } = startDemoRun(sageBundle, {
        mode,
        text: body.text,
        imageUrl: body.imageUrl,
        summarizerAddress: env.summarizerAddress,
        translatorAddress: env.translatorAddress,
        visionAddress: env.visionAddress,
        sentimentAddress: env.sentimentAddress,
        taskAmount: env.taskAmount,
      });

      json(res, 202, {
        demoRunId,
        streamUrl,
        mode,
        chainId: chainInfo.chainId,
        chainName: chainInfo.displayName,
        explorerUrl: chainInfo.explorerUrl,
      });
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

  // --- POST /api/demo/composite/classify ------------------------------
  if (url === '/api/demo/composite/classify' && method === 'POST') {
    try {
      const raw = await readBody(req);
      const body = raw ? (JSON.parse(raw) as { brief?: unknown }) : {};
      if (typeof body.brief !== 'string' || body.brief.length === 0) {
        json(res, 400, { error: 'brief must be a non-empty string' });
        return;
      }
      const classification = await classifyBrief(body.brief, {
        ...(config.openaiApiKey ? { openaiApiKey: config.openaiApiKey } : {}),
      });
      jsonWithBigints(res, 200, { classification });
    } catch (err) {
      console.error('[Orchestrator] /api/demo/composite/classify error:', err);
      json(res, 500, { error: err instanceof Error ? err.message : String(err) });
    }
    return;
  }

  // --- POST /api/demo/composite/execute -------------------------------
  if (url === '/api/demo/composite/execute' && method === 'POST') {
    try {
      const raw = await readBody(req);
      const body = raw ? (JSON.parse(raw) as unknown) : null;

      let plan: Plan;
      try {
        plan = parsePlanFromBody(body);
      } catch (validationErr) {
        json(res, 400, { error: String(validationErr) });
        return;
      }

      // Reuse the sponsor guard from the 3-mode flow — composite runs draw
      // from the same sponsor wallet, so the same balance floor applies.
      if (env.sponsorMinBalanceUsdc > 0n) {
        try {
          const sponsor = await checkSponsorStatus(
            sageBundle.publicClient,
            sageBundle.account.address,
            env.sponsorMinBalanceUsdc,
          );
          if (!sponsor.ok) {
            json(res, 503, {
              error: 'sponsor_exhausted',
              message: `Sponsor wallet is below the ${formatUsdc(
                env.sponsorMinBalanceUsdc,
              )} USDC floor. Composite execution is temporarily paused.`,
              balanceUsdc: formatUsdc(sponsor.balance),
              minBalanceUsdc: formatUsdc(sponsor.minBalance),
            });
            return;
          }
        } catch (guardErr) {
          console.error('[Orchestrator] composite sponsor guard failed, allowing through:', guardErr);
        }
      }

      const { runId, streamUrl } = executePlan(plan, sageBundle);
      jsonWithBigints(res, 202, {
        runId,
        streamUrl,
        chainId: chainInfo.chainId,
        chainName: chainInfo.displayName,
        explorerUrl: chainInfo.explorerUrl,
      });
    } catch (err) {
      console.error('[Orchestrator] /api/demo/composite/execute error:', err);
      json(res, 500, { error: err instanceof Error ? err.message : String(err) });
    }
    return;
  }

  // --- GET /api/demo/composite/stream/:runId --------------------------
  if (method === 'GET' && url.startsWith('/api/demo/composite/stream/')) {
    const runId = url.slice('/api/demo/composite/stream/'.length);
    const channel = demoRegistry.get(runId);
    if (!channel) {
      json(res, 404, { error: 'composite run not found or already expired' });
      return;
    }
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
        mode: 'pipeline',
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
  // Resolve the chain asynchronously — server starts accepting traffic immediately;
  // /health will just report chainId=0 until this completes (~100ms typical).
  void resolveChainInfo();
});

// ── Graceful shutdown ─────────────────────────────────────────────────
function shutdown(signal: string): void {
  console.error(`[Orchestrator] ${signal} received, closing server`);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
