import { checkDailyRateLimit } from './rate-limit';
import type { Env } from './index';

/**
 * Passthrough to the Fly.io orchestrator with a rate-limit guard on
 * `POST /api/demo/start` only. The SSE stream endpoint (`/api/demo/stream/:id`)
 * and /health are not rate-limited — a client that successfully created a run
 * is allowed to finish watching it even after hitting the daily cap.
 */
export async function handleOrchestrator(
  req: Request,
  env: Env,
  ctx: ExecutionContext,
): Promise<Response> {
  const url = new URL(req.url);

  // Rate limit only the expensive action.
  if (url.pathname === '/api/demo/start' && req.method === 'POST') {
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

  // Forward to Fly.io.
  const upstream = new URL(url.pathname + url.search, env.ORCHESTRATOR_URL);
  const upstreamReq = new Request(upstream.toString(), {
    method: req.method,
    headers: stripHopByHop(req.headers),
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
    return new Response(
      JSON.stringify({
        error: 'orchestrator_unreachable',
        message: 'The demo backend is temporarily unavailable. Try again in a moment.',
        detail: String(err),
      }),
      { status: 502, headers: { 'Content-Type': 'application/json' } },
    );
  }
}

function clientIp(req: Request): string {
  return (
    req.headers.get('CF-Connecting-IP') ??
    req.headers.get('X-Real-IP') ??
    req.headers.get('X-Forwarded-For')?.split(',')[0]?.trim() ??
    'unknown'
  );
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
