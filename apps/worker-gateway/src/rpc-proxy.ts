import type { Env } from './index';

/**
 * JSON-RPC proxy to Alchemy. Keeps ALCHEMY_KEY out of the client bundle.
 * The frontend calls `https://api.sage.xyz/rpc` → this handler forwards to
 * `${ALCHEMY_BASE_URL}/${ALCHEMY_KEY}` with the original POST body untouched.
 *
 * We don't validate the JSON-RPC method — it's a trusted upstream and
 * Alchemy itself enforces quota + method allow-list.
 *
 * Access is gated: requests must either originate from an allow-listed
 * browser origin (Origin header) OR carry a shared backend key (Fly
 * orchestrator path). Anonymous Node clients hit nothing — this closes
 * the open-RPC-proxy leech that burned the Workers daily quota on
 * 2026-05-13. See ADR/CHANGELOG entry for that date.
 */
function isAuthorized(req: Request, env: Env): boolean {
  // Backend path: shared key via custom header (orchestrator → Worker).
  const headerKey = req.headers.get('x-sage-backend');
  if (headerKey && env.SAGE_BACKEND_KEY && headerKey === env.SAGE_BACKEND_KEY) {
    return true;
  }
  // Browser path: cross-origin POST always carries an Origin header.
  const origin = req.headers.get('origin');
  if (origin) {
    const allowed = (env.ALLOWED_ORIGINS ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    if (allowed.includes(origin)) return true;
  }
  return false;
}

export async function handleRpc(req: Request, env: Env): Promise<Response> {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  if (!isAuthorized(req, env)) {
    return new Response(JSON.stringify({ error: 'forbidden' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  if (!env.ALCHEMY_KEY) {
    return new Response(
      JSON.stringify({ error: 'RPC proxy misconfigured: ALCHEMY_KEY secret not set' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } },
    );
  }

  const upstream = `${env.ALCHEMY_BASE_URL}/${env.ALCHEMY_KEY}`;
  const body = await req.text();

  try {
    const res = await fetch(upstream, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
    });

    return new Response(res.body, {
      status: res.status,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    return new Response(
      JSON.stringify({ error: 'upstream_unreachable', message: String(err) }),
      { status: 502, headers: { 'Content-Type': 'application/json' } },
    );
  }
}
