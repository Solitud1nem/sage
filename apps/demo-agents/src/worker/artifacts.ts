/**
 * Artifact upload + result envelope for generic-worker handlers (M12.0.3).
 *
 * Binary pipeline outputs (website zip, PDF report) don't ride the chain:
 * the worker uploads bytes to the gateway's content-addressed R2 store
 * (`PUT /api/artifacts/:sha256`, authed by the same SAGE_BACKEND_KEY the
 * worker already holds for RPC), and `completeTask` carries only the small
 * ArtifactRef envelope. The sha256 recorded on-chain makes the off-chain
 * bytes verifiable — anyone can fetch the URL and check the hash.
 *
 * Result envelope (inside the task's data:text/plain result):
 *   {"artifact": {"sha256": "...", "size": 123, "mime": "application/zip", "url": "https://..."}}
 *
 * Decoder is permissive-to-null like the sibling codecs (composite-codec,
 * evaluation): a non-artifact result is simply "not an artifact", never an
 * error — text results and artifact results coexist in the same pipelines.
 */

import { createHash } from 'node:crypto';

export interface ArtifactRef {
  readonly sha256: string;
  readonly size: number;
  readonly mime: string;
  readonly url: string;
}

export interface ArtifactUploadOptions {
  /** Gateway origin, e.g. https://sage-gateway.a-t-somnia.workers.dev */
  readonly gatewayUrl: string;
  /** Shared secret for the backend path (x-sage-backend). */
  readonly backendKey: string;
  /** Test seam. */
  readonly fetchImpl?: typeof fetch;
}

export function sha256Hex(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

/**
 * Upload artifact bytes to the gateway store. Idempotent: the key is the
 * content hash, so re-uploading the same bytes is a no-op server-side.
 * Throws on rejection (size cap, mime, auth) — the executor's handler-retry
 * wraps us, and a final failure becomes an honest `Task failed: …` result.
 */
export async function uploadArtifact(
  bytes: Uint8Array,
  mime: string,
  opts: ArtifactUploadOptions,
): Promise<ArtifactRef> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const sha = sha256Hex(bytes);
  const url = `${opts.gatewayUrl.replace(/\/+$/, '')}/api/artifacts/${sha}`;

  const res = await fetchImpl(url, {
    method: 'PUT',
    headers: {
      'Content-Type': mime,
      'x-sage-backend': opts.backendKey,
    },
    // Node's fetch accepts a Uint8Array body; the lib has no DOM BodyInit,
    // so go through the RequestInit field type instead of naming it
    // (NonNullable: exactOptionalPropertyTypes rejects the `| undefined` half).
    body: bytes as unknown as NonNullable<RequestInit['body']>,
  });
  const data = (await res.json().catch(() => null)) as
    | { sha256?: string; size?: number; mime?: string; url?: string; error?: string }
    | null;
  if (!res.ok) {
    throw new Error(`artifact upload failed (HTTP ${res.status}): ${data?.error ?? 'unknown'}`);
  }
  if (data?.sha256 !== sha) {
    throw new Error(`artifact upload returned wrong sha256 (${data?.sha256 ?? 'none'})`);
  }
  return { sha256: sha, size: bytes.byteLength, mime, url: data.url ?? url };
}

/**
 * Handler-facing artifact store (threaded through HandlerContext).
 * `download` verifies the fetched bytes against the ref's sha256 BEFORE
 * returning — a consumer (packager, future evaluators) only ever sees bytes
 * that match what the producer committed on-chain.
 */
export interface ArtifactStore {
  upload(bytes: Uint8Array, mime: string): Promise<ArtifactRef>;
  download(ref: ArtifactRef): Promise<Uint8Array>;
}

export function makeArtifactStore(opts: ArtifactUploadOptions): ArtifactStore {
  const fetchImpl = opts.fetchImpl ?? fetch;
  return {
    upload: (bytes, mime) => uploadArtifact(bytes, mime, opts),
    async download(ref) {
      const res = await fetchImpl(ref.url);
      if (!res.ok) {
        throw new Error(`artifact download failed (HTTP ${res.status}) for ${ref.sha256}`);
      }
      const bytes = new Uint8Array(await res.arrayBuffer());
      const actual = sha256Hex(bytes);
      if (actual !== ref.sha256) {
        throw new Error(`artifact sha256 mismatch: expected ${ref.sha256}, got ${actual}`);
      }
      return bytes;
    },
  };
}

/**
 * Derive the gateway origin from a proxied RPC_URL
 * (https://gw.example/api/rpc → https://gw.example). Returns null when the
 * RPC isn't gateway-shaped (direct node) — the caller then needs an explicit
 * ARTIFACTS_GATEWAY_URL.
 */
export function gatewayOriginFromRpcUrl(rpcUrl: string): string | null {
  try {
    const url = new URL(rpcUrl);
    return url.pathname.startsWith('/api/rpc') ? url.origin : null;
  } catch {
    return null;
  }
}

export function encodeArtifactResult(ref: ArtifactRef): string {
  return JSON.stringify({ artifact: ref });
}

export function decodeArtifactResult(text: string): ArtifactRef | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;
  const a = (parsed as { artifact?: unknown }).artifact;
  if (!a || typeof a !== 'object') return null;
  const { sha256, size, mime, url } = a as Record<string, unknown>;
  if (typeof sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(sha256)) return null;
  if (typeof size !== 'number' || !Number.isInteger(size) || size < 0) return null;
  if (typeof mime !== 'string' || typeof url !== 'string') return null;
  return { sha256, size, mime, url };
}
