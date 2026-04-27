import type { Env } from './index';

export function corsPreflight(req: Request, env: Env): Response {
  const origin = req.headers.get('Origin');
  const allowed = parseAllowedOrigins(env);

  const headers = new Headers();
  if (origin && (allowed.includes(origin) || allowed.includes('*'))) {
    headers.set('Access-Control-Allow-Origin', origin);
    headers.set('Vary', 'Origin');
    headers.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    headers.set('Access-Control-Allow-Headers', 'Content-Type');
    headers.set('Access-Control-Max-Age', '86400');
  }
  return new Response(null, { status: 204, headers });
}

export function applyCors(res: Response, req: Request, env: Env): Response {
  const origin = req.headers.get('Origin');
  if (!origin) return res;

  const allowed = parseAllowedOrigins(env);
  if (!allowed.includes(origin) && !allowed.includes('*')) return res;

  // Response objects may be immutable if streamed (e.g. SSE). Clone headers defensively.
  const headers = new Headers(res.headers);
  headers.set('Access-Control-Allow-Origin', origin);
  headers.set('Vary', 'Origin');
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
}

function parseAllowedOrigins(env: Env): string[] {
  return env.ALLOWED_ORIGINS.split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}
