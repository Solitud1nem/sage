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
import { checkSponsorStatus, formatUsdc } from './guards.js';
import { startDemoRun } from './demo-run.js';

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
        text: body.text,
        summarizerAddress: env.summarizerAddress,
        translatorAddress: env.translatorAddress,
        taskAmount: env.taskAmount,
      });

      json(res, 202, {
        demoRunId,
        streamUrl,
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
