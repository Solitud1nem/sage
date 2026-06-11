/**
 * Artifact store — R2-backed binary delivery for pipeline outputs
 * (M12.0.3, ADR-0020; supersedes "inline base64" per Alex 2026-06-10).
 *
 * The on-chain `resultUri` stays small and inspectable: it carries
 * `{artifact: {sha256, size, mime, url}}` while the bytes live here. The
 * sha256 doubles as the object key, which makes uploads idempotent,
 * collisions impossible, and the artifact verifiable end-to-end: anyone can
 * fetch the bytes and check them against the hash recorded on-chain
 * (ADR-0007 inspectability, extended to binary outputs).
 *
 *   PUT /api/artifacts/:sha256   — workers only (x-sage-backend shared
 *       secret, same channel as the /api/rpc backend path). The gateway
 *       re-hashes the body and rejects a mismatch, so a worker cannot pin
 *       wrong bytes under a hash — the hash IS the contract.
 *   GET /api/artifacts/:sha256   — public, immutable-cached (content is
 *       content-addressed; it can never change under a key).
 *
 * Bounded on purpose: 10MB cap and a mime allow-list keep the sponsored
 * demo's storage surface from becoming a free CDN. R2 lifecycle (30-day
 * expiry) is configured on the bucket, not here — see wrangler.toml header.
 */

import type { Env } from './index';

export const MAX_ARTIFACT_BYTES = 10 * 1024 * 1024; // 10MB

/** Pipeline outputs we expect: archives, reports, previews. */
export const ALLOWED_MIME = new Set([
  'application/zip',
  'application/json',
  'application/pdf',
  'text/plain',
  'text/html',
  'text/markdown',
  'image/png',
  'image/jpeg',
]);

const SHA256_HEX = /^[0-9a-f]{64}$/;

export function parseArtifactPath(pathname: string): string | null {
  const m = /^\/api\/artifacts\/([0-9a-f]{64})$/.exec(pathname);
  return m?.[1] ?? null;
}

export function isValidSha256(s: string): boolean {
  return SHA256_HEX.test(s);
}

async function sha256Hex(bytes: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export async function handleArtifacts(req: Request, env: Env): Promise<Response> {
  const sha = parseArtifactPath(new URL(req.url).pathname);
  if (!sha) {
    return json(400, { error: 'artifact path must be /api/artifacts/<64-char lowercase sha256>' });
  }

  if (req.method === 'GET') {
    const obj = await env.ARTIFACTS.get(sha);
    if (!obj) return json(404, { error: 'artifact not found (expired or never uploaded)' });
    return new Response(obj.body, {
      status: 200,
      headers: {
        'Content-Type': obj.httpMetadata?.contentType ?? 'application/octet-stream',
        // Content-addressed → the bytes under this key can never change.
        'Cache-Control': 'public, max-age=31536000, immutable',
        ETag: `"${sha}"`,
      },
    });
  }

  if (req.method === 'PUT') {
    // Same trust channel as the /api/rpc backend path: workers are Node
    // clients without an Origin, they prove themselves via the shared secret.
    if (!env.SAGE_BACKEND_KEY || req.headers.get('x-sage-backend') !== env.SAGE_BACKEND_KEY) {
      return json(401, { error: 'artifact upload requires the backend key' });
    }

    const mime = req.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase() ?? '';
    if (!ALLOWED_MIME.has(mime)) {
      return json(415, { error: `content-type "${mime}" not allowed`, allowed: [...ALLOWED_MIME] });
    }

    const declaredLength = Number(req.headers.get('content-length') ?? NaN);
    if (Number.isFinite(declaredLength) && declaredLength > MAX_ARTIFACT_BYTES) {
      return json(413, { error: `artifact exceeds ${MAX_ARTIFACT_BYTES} bytes` });
    }

    const bytes = await req.arrayBuffer();
    if (bytes.byteLength === 0) return json(400, { error: 'empty artifact body' });
    if (bytes.byteLength > MAX_ARTIFACT_BYTES) {
      return json(413, { error: `artifact exceeds ${MAX_ARTIFACT_BYTES} bytes` });
    }

    // The hash IS the contract — recompute server-side, reject mismatches.
    const actual = await sha256Hex(bytes);
    if (actual !== sha) {
      return json(422, { error: 'sha256 mismatch between path and body', expected: sha, actual });
    }

    // Idempotent by construction: same key ⇒ same bytes. Skip the write when
    // the object already exists (retries, duplicate pipeline runs).
    const existing = await env.ARTIFACTS.head(sha);
    if (!existing) {
      await env.ARTIFACTS.put(sha, bytes, { httpMetadata: { contentType: mime } });
    }

    return json(existing ? 200 : 201, {
      sha256: sha,
      size: bytes.byteLength,
      mime,
      url: `${new URL(req.url).origin}/api/artifacts/${sha}`,
    });
  }

  return json(405, { error: 'method not allowed' });
}
