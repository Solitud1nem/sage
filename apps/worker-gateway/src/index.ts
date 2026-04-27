/**
 * Sage gateway — Cloudflare Worker entry point.
 *
 * Routes:
 *   POST /api/rpc         → Alchemy proxy (hides ALCHEMY_KEY)
 *   POST /api/demo/start  → rate-limited passthrough to Fly.io orchestrator
 *   GET  /api/demo/stream/:id  → SSE passthrough (no rate limit)
 *   GET  /health          → orchestrator /health passthrough
 *   *                     → 404
 *
 * All responses get CORS headers for the frontend origin allow-list.
 */

import { handleRpc } from './rpc-proxy';
import { handleOrchestrator } from './orchestrator-proxy';
import { applyCors, corsPreflight } from './cors';

export interface Env {
  DB: D1Database;
  ORCHESTRATOR_URL: string;
  ALCHEMY_BASE_URL: string;
  ALCHEMY_KEY: string;
  DAILY_LIMIT: string;
  ALLOWED_ORIGINS: string;
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

    if (url.pathname === '/health' || url.pathname.startsWith('/api/demo/')) {
      return applyCors(await handleOrchestrator(req, env, ctx), req, env);
    }

    return applyCors(new Response('Not found', { status: 404 }), req, env);
  },
};
