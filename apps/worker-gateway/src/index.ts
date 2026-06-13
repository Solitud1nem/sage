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

    if (url.pathname === '/health' || url.pathname.startsWith('/api/demo/')) {
      return applyCors(await handleOrchestrator(req, env, ctx), req, env);
    }

    return applyCors(new Response('Not found', { status: 404 }), req, env);
  },
};
