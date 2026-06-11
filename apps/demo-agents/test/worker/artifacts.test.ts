/**
 * Worker-side artifact helper (M12.0.3): hashing, upload contract, and the
 * artifact result envelope.
 */
import { describe, it, expect } from 'vitest';

import {
  sha256Hex,
  uploadArtifact,
  encodeArtifactResult,
  decodeArtifactResult,
  type ArtifactRef,
} from '../../src/worker/artifacts.js';

const BYTES = new TextEncoder().encode('PK fake zip bytes');
const OPTS = { gatewayUrl: 'https://gw.example/', backendKey: 'k' };

function gatewayFetch(respond: (sha: string) => { status: number; body: unknown }) {
  const calls: Array<{ url: string; headers: Record<string, string> }> = [];
  const fetchImpl = (async (url: unknown, init?: { headers?: Record<string, string> }) => {
    calls.push({ url: String(url), headers: init?.headers ?? {} });
    const sha = String(url).split('/').pop()!;
    const r = respond(sha);
    return {
      ok: r.status < 400,
      status: r.status,
      json: async () => r.body,
    } as Response;
  }) as typeof fetch;
  return { calls, fetchImpl };
}

describe('uploadArtifact', () => {
  it('PUTs to the content-addressed path with the backend key and returns the ref', async () => {
    const { calls, fetchImpl } = gatewayFetch((sha) => ({
      status: 201,
      body: { sha256: sha, size: BYTES.byteLength, mime: 'application/zip', url: `https://gw.example/api/artifacts/${sha}` },
    }));

    const ref = await uploadArtifact(BYTES, 'application/zip', { ...OPTS, fetchImpl });

    const sha = sha256Hex(BYTES);
    expect(ref).toEqual({
      sha256: sha,
      size: BYTES.byteLength,
      mime: 'application/zip',
      url: `https://gw.example/api/artifacts/${sha}`,
    });
    // Trailing slash on gatewayUrl must not produce a double slash.
    expect(calls[0]!.url).toBe(`https://gw.example/api/artifacts/${sha}`);
    expect(calls[0]!.headers['x-sage-backend']).toBe('k');
    expect(calls[0]!.headers['Content-Type']).toBe('application/zip');
  });

  it('throws with the gateway error on rejection (handler retry wraps us)', async () => {
    const { fetchImpl } = gatewayFetch(() => ({ status: 413, body: { error: 'too big' } }));
    await expect(uploadArtifact(BYTES, 'application/zip', { ...OPTS, fetchImpl })).rejects.toThrow(
      /413.*too big/,
    );
  });

  it('throws when the gateway echoes a different sha256', async () => {
    const { fetchImpl } = gatewayFetch(() => ({ status: 201, body: { sha256: 'f'.repeat(64) } }));
    await expect(uploadArtifact(BYTES, 'application/zip', { ...OPTS, fetchImpl })).rejects.toThrow(
      /wrong sha256/,
    );
  });
});

describe('artifact result envelope', () => {
  const ref: ArtifactRef = {
    sha256: 'a'.repeat(64),
    size: 1234,
    mime: 'application/zip',
    url: 'https://gw.example/api/artifacts/' + 'a'.repeat(64),
  };

  it('round-trips', () => {
    expect(decodeArtifactResult(encodeArtifactResult(ref))).toEqual(ref);
  });

  it('returns null for non-artifact results (text results coexist)', () => {
    expect(decodeArtifactResult('plain text result')).toBeNull();
    expect(decodeArtifactResult('{"verdict":{"pass":true,"reasons":[]}}')).toBeNull();
    expect(decodeArtifactResult(JSON.stringify({ artifact: { sha256: 'short' } }))).toBeNull();
    expect(
      decodeArtifactResult(JSON.stringify({ artifact: { ...ref, size: -1 } })),
    ).toBeNull();
  });
});
