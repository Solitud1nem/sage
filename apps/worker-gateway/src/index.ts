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

/**
 * Account-level abuse guard. ASNs in this list are observed leeching
 * /api/rpc (free Alchemy proxy from a hosting/VPS network, not a real
 * visitor). Returning 403 at the very top short-circuits before any
 * downstream call, so blocked requests cost ~0 CPU.
 *
 * Incident 2026-05-13: AS396356 (Climax Media Inc., Ashburn) sustained
 * ~3.9 rps POST /api/rpc for ~10h overnight and burned the Cloudflare
 * Workers daily quota (100k req/day on Free). Real users come from
 * consumer ISPs, not from this ASN — block is surgical. Widen if abuse
 * shifts to another datacenter ASN; revert by removing the entry.
 */
const BLOCKED_ASNS = new Set<number>([396356]);

export default {
  async fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(req.url);

    const asn = req.cf?.asn;
    if (typeof asn === 'number' && BLOCKED_ASNS.has(asn)) {
      return new Response('Blocked', { status: 403 });
    }

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
