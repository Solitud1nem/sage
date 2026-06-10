import { checkDailyRateLimit } from './rate-limit';
import type { Env } from './index';

/**
 * Passthrough to the Fly.io orchestrator with a rate-limit guard on every
 * POST that spends sponsor funds or OpenAI tokens. SSE stream endpoints,
 * /health and /review-decision are not rate-limited — a client that
 * successfully created a run is allowed to finish watching (and reviewing)
 * it even after hitting the daily cap.
 */

/**
 * POSTs that draw the shared daily budget (code review 2026-06-09, A1):
 * start + composite classify/execute/retry all spend sponsor USDC, gas or
 * OpenAI tokens. One bucket (`demo_start`) across all of them — a composite
 * run shouldn't multiply the allowance. `/review-decision` is deliberately
 * absent: it resolves a pause that an already-counted execute opened, and
 * denying it would strand a legitimately paused run.
 */
const RATE_LIMITED_POSTS = new Set([
  '/api/demo/start',
  '/api/demo/composite/classify',
  '/api/demo/composite/execute',
  '/api/demo/composite/retry-subtask',
]);

export async function handleOrchestrator(
  req: Request,
  env: Env,
  _ctx: ExecutionContext,
): Promise<Response> {
  const url = new URL(req.url);

  if (RATE_LIMITED_POSTS.has(url.pathname) && req.method === 'POST') {
    const ip = clientIp(req);
    const rl = await checkDailyRateLimit(env, 'demo_start', ip);
    if (!rl.ok) {
      return new Response(
        JSON.stringify({
          error: 'rate_limited',
          message: `You can run up to ${rl.limit} sponsored demos per day. Switch to "Try with wallet" to run without limits, or come back tomorrow.`,
          count: rl.count,
          limit: rl.limit,
          resetAt: rl.resetAt,
        }),
        {
          status: 429,
          headers: {
            'Content-Type': 'application/json',
            'Retry-After': String(rl.resetAt - Math.floor(Date.now() / 1000)),
            'X-RateLimit-Limit': String(rl.limit),
            'X-RateLimit-Remaining': '0',
            'X-RateLimit-Reset': String(rl.resetAt),
          },
        },
      );
    }
  }

  // Chain selection: `?chain=arc` routes to the Arc Fly app per ADR-0015.
  // Everything else (default, `?chain=base`, malformed values) goes to the
  // Base mainnet app. We intentionally keep the rate limit shared across
  // chains — a prototype-stage chain switch shouldn't double the budget.
  const chainParam = url.searchParams.get('chain');
  const upstreamBase =
    chainParam === 'arc' && env.ORCHESTRATOR_URL_ARC
      ? env.ORCHESTRATOR_URL_ARC
      : env.ORCHESTRATOR_URL;

  // Forward to Fly.io. Strip the `chain` param from the forwarded URL so
  // the orchestrator sees clean paths; it already knows which chain it's
  // talking to from its own CHAIN_ID env.
  const forwardSearch = new URLSearchParams(url.search);
  forwardSearch.delete('chain');
  const forwardQs = forwardSearch.toString();
  const upstream = new URL(
    url.pathname + (forwardQs ? `?${forwardQs}` : ''),
    upstreamBase,
  );
  const forwardHeaders = stripHopByHop(req.headers);
  // Gateway hop marker (code review 2026-06-09, A1): when the shared secret
  // is configured, the orchestrator rejects state-changing POSTs without it —
  // closing the direct-to-Fly bypass of the rate limit above. Same pattern as
  // SAGE_BACKEND_KEY on /api/rpc.
  if (env.SAGE_GATEWAY_KEY) forwardHeaders.set('x-sage-gateway', env.SAGE_GATEWAY_KEY);
  const upstreamReq = new Request(upstream.toString(), {
    method: req.method,
    headers: forwardHeaders,
    body: req.method === 'GET' || req.method === 'HEAD' ? null : req.body,
    // SSE responses stream — don't buffer.
    // @ts-expect-error — Cloudflare extension
    duplex: 'half',
  });

  try {
    const upstreamRes = await fetch(upstreamReq);
    return new Response(upstreamRes.body, {
      status: upstreamRes.status,
      statusText: upstreamRes.statusText,
      headers: stripHopByHop(upstreamRes.headers),
    });
  } catch (err) {
    // Log the detail server-side (observability is enabled) but don't leak it
    // to the client — fetch errors can carry internal hostnames.
    console.error('[gateway] orchestrator unreachable:', err);
    return new Response(
      JSON.stringify({
        error: 'orchestrator_unreachable',
        message: 'The demo backend is temporarily unavailable. Try again in a moment.',
      }),
      { status: 502, headers: { 'Content-Type': 'application/json' } },
    );
  }
}

/**
 * Client IP for rate-limiting. Trust ONLY Cloudflare's `CF-Connecting-IP` —
 * the `X-Real-IP` / `X-Forwarded-For` fallbacks are attacker-controlled and
 * would be a free rate-limit bypass if this Worker were ever fronted
 * differently. On the CF edge the header is always set.
 */
function clientIp(req: Request): string {
  return req.headers.get('CF-Connecting-IP') ?? 'unknown';
}

const HOP_BY_HOP = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailers',
  'transfer-encoding',
  'upgrade',
]);

function stripHopByHop(headers: Headers): Headers {
  const out = new Headers();
  for (const [k, v] of headers) {
    if (!HOP_BY_HOP.has(k.toLowerCase())) out.set(k, v);
  }
  return out;
}
