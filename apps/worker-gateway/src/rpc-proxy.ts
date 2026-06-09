import type { Env } from './index';

/**
 * JSON-RPC proxy to Alchemy. Keeps ALCHEMY_KEY out of the client bundle.
 * The frontend calls `https://api.sage.xyz/rpc` → this handler forwards to
 * `${ALCHEMY_BASE_URL}/${ALCHEMY_KEY}` with the original POST body untouched.
 *
 * Access is gated two ways (code review 2026-06-09, finding A2):
 *   1. Caller must be an allow-listed browser origin OR carry the shared
 *      backend key (Fly orchestrator path). This closed the open-proxy leech
 *      that burned the Workers daily quota on 2026-05-13.
 *   2. The JSON-RPC `method` must not be in a billable enhanced family. An
 *      authorized caller (or a spoofed Origin) can no longer drive Alchemy's
 *      expensive APIs (`alchemy_*`, `trace_*`, `debug_*`) through our key.
 *
 * Why a denylist, not an allowlist: viem issues a wide, version-dependent set
 * of standard `eth_*` methods (fee estimation, the filter family behind
 * `watchContractEvent`, the several calls inside `waitForTransactionReceipt`),
 * and a missed entry would silently break the live demo. The abuse vector is
 * specifically the metered enhanced APIs, so denying those families closes it
 * without risking a legitimate standard method. (Code review 2026-06-09, A2.)
 *
 * No per-IP rate limit here on purpose: a single demo run legitimately makes
 * dozens of `eth_call`/`getTask` reads through this proxy, so a daily counter
 * would throttle real usage. The auth gate + method denylist are the controls.
 */

/** Billable / heavy enhanced-API families. Standard `eth_*` reads pass through. */
const RPC_METHOD_DENY_PREFIXES = ['alchemy_', 'trace_', 'debug_', 'erigon_', 'parity_'];

/**
 * Validate the JSON-RPC payload (single or batch). Returns null when no call
 * targets a denied family, or an error string to reject with. A malformed body
 * or any denied method in a batch fails the whole request.
 */
function checkRpcMethods(raw: string): string | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return 'request body is not valid JSON';
  }
  const calls = Array.isArray(parsed) ? parsed : [parsed];
  if (calls.length === 0) return 'empty batch';
  for (const call of calls) {
    const method = (call as { method?: unknown })?.method;
    if (typeof method !== 'string') return 'each call must carry a string "method"';
    const lower = method.toLowerCase();
    if (RPC_METHOD_DENY_PREFIXES.some((p) => lower.startsWith(p))) {
      return `method not allowed: ${method}`;
    }
  }
  return null;
}
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

  const body = await req.text();

  const methodError = checkRpcMethods(body);
  if (methodError) {
    return new Response(JSON.stringify({ error: 'method_not_allowed', message: methodError }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const upstream = `${env.ALCHEMY_BASE_URL}/${env.ALCHEMY_KEY}`;

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
