/**
 * Sage gateway — Cloudflare Worker entry point.
 *
 * Routes:
 *   POST /api/rpc         → Alchemy proxy (hides ALCHEMY_KEY)
 *   POST /api/demo/start  → rate-limited passthrough to Fly.io orchestrator
 *   GET  /api/demo/stream/:id  → SSE passthrough (no rate limit)
 *   PUT  /api/artifacts/:sha256 → R2 artifact upload (workers, backend key)
 *   GET  /api/artifacts/:sha256 → R2 artifact download (public, immutable)
 *   GET  /preview/:sha256/*       → hosted site preview from a manifest artifact (M12.1.7)
 *   GET  /health          → orchestrator /health passthrough
 *   *                     → 404
 *
 * All responses get CORS headers for the frontend origin allow-list.
 */

import { handleRpc } from './rpc-proxy';
import { handleOrchestrator } from './orchestrator-proxy';
import { handleArtifacts } from './artifacts';
import { handlePreview } from './preview';
import { handleReport } from './report';
import { handleReputation, indexReputation } from './reputation';
import { applyCors, corsPreflight } from './cors';

export interface Env {
  DB: D1Database;
  /** R2 bucket for pipeline artifacts (M12.0.3) — see artifacts.ts. */
  ARTIFACTS: R2Bucket;
  ORCHESTRATOR_URL: string;
  /**
   * Arc-testnet orchestrator URL (per ADR-0015). Optional — empty/unset
   * means `?chain=arc` requests fall through to the Base orchestrator
   * (which will return chainId 8453 and the frontend can surface that
   * as a chain-mismatch).
   */
  ORCHESTRATOR_URL_ARC: string;
  ALCHEMY_BASE_URL: string;
  ALCHEMY_KEY: string;
  /** TaskEscrow address whose lifecycle events feed the reputation index (M13.3). */
  ESCROW_ADDRESS: string;
  /** Block the escrow was deployed at — the indexer's backfill floor. */
  ESCROW_FROM_BLOCK: string;
  /**
   * Arc-testnet reputation index (ADR-0015). All optional — the indexer tracks
   * Arc only when `ARC_RPC_URL` *and* `ARC_ESCROW_ADDRESS` are both set;
   * otherwise it stays Base-only. Arc isn't on Alchemy, so it reads its own
   * public RPC directly rather than the `/api/rpc` proxy.
   */
  ARC_RPC_URL?: string;
  ARC_ESCROW_ADDRESS?: string;
  ARC_ESCROW_FROM_BLOCK?: string;
  /**
   * Monad-testnet orchestrator URL (ADR-0026 / M14.4). Optional — same
   * fall-through semantics as ORCHESTRATOR_URL_ARC for `?chain=monad`.
   */
  ORCHESTRATOR_URL_MONAD?: string;
  /**
   * Monad-testnet reputation index (ADR-0026). Same opt-in shape as Arc:
   * both MONAD_RPC_URL and MONAD_ESCROW_ADDRESS must be set to index.
   * Monad's public RPCs cap eth_getLogs at ≤100 blocks per call (recon §5),
   * so the Monad chain config carries its own small chunk size.
   */
  MONAD_RPC_URL?: string;
  MONAD_ESCROW_ADDRESS?: string;
  MONAD_ESCROW_FROM_BLOCK?: string;
  /**
   * Hibernation switch (ADR-0026): "true" removes Base from the indexer's
   * chain list so the cron stops generating Alchemy traffic while Base prod
   * sleeps. `?chain=base` reputation reads keep serving the frozen D1 data.
   */
  BASE_INDEX_DISABLED?: string;
  DAILY_LIMIT: string;
  ALLOWED_ORIGINS: string;
  /**
   * Shared secret for the backend (Fly orchestrator) path on /api/rpc.
   * Browsers prove themselves via the Origin header (allow-list); the
   * orchestrator is a Node client without Origin, so it sends this key in
   * `x-sage-backend`. Set with `wrangler secret put SAGE_BACKEND_KEY`.
   */
  SAGE_BACKEND_KEY: string;
  /**
   * Shared secret for the reverse hop: gateway → Fly orchestrator. Attached
   * as `x-sage-gateway` to forwarded demo requests; the orchestrator (when
   * its DEMO_GATEWAY_KEY is set) rejects state-changing POSTs without it, so
   * direct-to-Fly callers can't bypass this Worker's rate limit. Optional —
   * unset means the header isn't attached (staged rollout / local dev).
   * Set with `wrangler secret put SAGE_GATEWAY_KEY`.
   */
  SAGE_GATEWAY_KEY?: string;
}

export default {
  async fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(req.url);

    if (req.method === 'OPTIONS') {
      return corsPreflight(req, env);
    }

    if (url.pathname === '/api/rpc') {
      return applyCors(await handleRpc(req, env), req, env);
    }

    if (url.pathname.startsWith('/api/artifacts/')) {
      return applyCors(await handleArtifacts(req, env), req, env);
    }

    // M12.1.7: hosted site preview — public GET, no CORS needed (top-level
    // navigation), deliberately outside the demo rate-limit bucket (cheap R2
    // reads of QA-passed content).
    if (url.pathname.startsWith('/preview/')) {
      return handlePreview(req, env);
    }

    // M12.2.3: hosted research report — same posture as /preview (public GET,
    // iframe-rendered deliverable, noindex, outside the rate-limit bucket).
    if (url.pathname.startsWith('/report/')) {
      return handleReport(req, env);
    }

    // M13.3: per-agent reputation (GET, read by the orchestrator's resolver)
    // + a backend-key-gated reindex trigger. Outside the demo rate-limit bucket.
    if (url.pathname.startsWith('/api/agents/')) {
      return applyCors(await handleReputation(req, env), req, env);
    }

    if (url.pathname === '/health' || url.pathname.startsWith('/api/demo/')) {
      return applyCors(await handleOrchestrator(req, env, ctx), req, env);
    }

    return applyCors(new Response('Not found', { status: 404 }), req, env);
  },

  // M13.3: scheduled reputation indexer — pulls new escrow events into D1.
  // Bounded per run; the first backfill catches up over several invocations.
  scheduled(_event: ScheduledEvent, env: Env, ctx: ExecutionContext): void {
    ctx.waitUntil(
      indexReputation(env).catch((err: unknown) => {
        console.error('[reputation] scheduled index failed:', err);
      }),
    );
  },
};
