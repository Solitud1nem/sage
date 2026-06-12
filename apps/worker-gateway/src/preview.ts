/**
 * Hosted site preview (M12.1.7, ADR-0020 amendment 2026-06-12 — approved by
 * Alex): serves the files of a QA-passed website straight from its R2
 * manifest artifact, giving the user a live, shareable URL right after the
 * run — no download/unpack required.
 *
 *   GET /preview/:sha256/            → index.html
 *   GET /preview/:sha256/<path>      → that file from the manifest
 *
 * Containment posture (the reason live-deploy was deferred in ADR-0020, made
 * acceptable here): content is addressed by hash (no vanity URLs), expires
 * with the artifact (R2 lifecycle, 30 days), carries `X-Robots-Tag: noindex`
 * and a CSP `sandbox allow-scripts` (no cookies/storage/origin powers on the
 * gateway origin), and only exists for manifests that came through the
 * pipeline — i.e. passed the QA evaluator.
 */

import { ALLOWED_MIME } from './artifacts';

interface PreviewEnv {
  ARTIFACTS: R2Bucket;
}

const SHA_RE = /^[0-9a-f]{64}$/;

const MIME_BY_EXT: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.md': 'text/markdown; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
};

function contentTypeFor(path: string): string {
  const dot = path.lastIndexOf('.');
  return MIME_BY_EXT[dot >= 0 ? path.slice(dot).toLowerCase() : ''] ?? 'application/octet-stream';
}

function err(status: number, message: string): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

export async function handlePreview(req: Request, env: PreviewEnv): Promise<Response> {
  if (req.method !== 'GET' && req.method !== 'HEAD') return err(405, 'GET only');

  const url = new URL(req.url);
  // /preview/<sha>[/<path...>]
  const rest = url.pathname.slice('/preview/'.length);
  const slash = rest.indexOf('/');
  const sha = (slash === -1 ? rest : rest.slice(0, slash)).toLowerCase();
  if (!SHA_RE.test(sha)) return err(400, 'bad sha256');
  // Canonicalize /preview/<sha> → /preview/<sha>/ so relative links resolve.
  if (slash === -1) {
    return Response.redirect(`${url.origin}/preview/${sha}/`, 301);
  }
  const rawPath = decodeURIComponent(rest.slice(slash + 1));
  const filePath = rawPath === '' ? 'index.html' : rawPath;

  const obj = await env.ARTIFACTS.get(sha);
  if (!obj) return err(404, 'artifact not found (expired or never uploaded)');
  const mime = obj.httpMetadata?.contentType ?? '';
  if (!mime.startsWith('application/json') || !ALLOWED_MIME.has('application/json')) {
    return err(404, 'artifact is not a previewable site manifest');
  }

  let manifest: { files?: Array<{ path?: unknown; content?: unknown }> };
  try {
    manifest = await obj.json<{ files?: Array<{ path?: unknown; content?: unknown }> }>();
  } catch {
    return err(404, 'artifact is not a previewable site manifest');
  }
  const files = Array.isArray(manifest.files) ? manifest.files : [];
  // Exact-match lookup against builder-validated paths — no traversal surface.
  const file = files.find(
    (f) => typeof f?.path === 'string' && f.path.toLowerCase() === filePath.toLowerCase(),
  );
  if (!file || typeof file.content !== 'string') return err(404, `no "${filePath}" in this site`);

  return new Response(file.content, {
    status: 200,
    headers: {
      'content-type': contentTypeFor(filePath),
      // Content-addressed → immutable; the R2 lifecycle (30d) bounds the life.
      'cache-control': 'public, max-age=86400, immutable',
      'x-robots-tag': 'noindex, nofollow',
      // No cookies/storage/origin powers on the gateway origin; scripts of the
      // generated site itself still run.
      'content-security-policy': 'sandbox allow-scripts',
    },
  });
}
