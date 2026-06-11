/**
 * Artifact store endpoints (M12.0.3): auth, sha256-as-contract, size cap,
 * mime allow-list, idempotent uploads, immutable downloads.
 *
 * Runs in plain Node (vitest): Request/Response and crypto.subtle are
 * globals since Node 19+, and the R2 bucket is a Map-backed fake — no
 * miniflare needed for this logic.
 */
import { describe, it, expect, beforeEach } from 'vitest';

import {
  handleArtifacts,
  parseArtifactPath,
  isValidSha256,
  MAX_ARTIFACT_BYTES,
} from '../src/artifacts';
import type { Env } from '../src/index';

const KEY = 'test-backend-key';

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes.buffer as ArrayBuffer);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

interface StoredObject {
  bytes: ArrayBuffer;
  contentType: string;
}

function makeEnv() {
  const store = new Map<string, StoredObject>();
  let puts = 0;
  const env = {
    SAGE_BACKEND_KEY: KEY,
    ARTIFACTS: {
      async get(key: string) {
        const obj = store.get(key);
        if (!obj) return null;
        return { body: obj.bytes, httpMetadata: { contentType: obj.contentType } };
      },
      async head(key: string) {
        return store.has(key) ? {} : null;
      },
      async put(key: string, bytes: ArrayBuffer, opts: { httpMetadata: { contentType: string } }) {
        puts += 1;
        store.set(key, { bytes, contentType: opts.httpMetadata.contentType });
      },
    },
  } as unknown as Env;
  return { env, store, putCount: () => puts };
}

function putRequest(sha: string, body: Uint8Array, headers: Record<string, string> = {}) {
  return new Request(`https://gw.example/api/artifacts/${sha}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/zip', 'x-sage-backend': KEY, ...headers },
    body: body as unknown as BodyInit,
  });
}

const BYTES = new TextEncoder().encode('PK fake zip bytes');
let SHA = '';
beforeEach(async () => {
  SHA = await sha256Hex(BYTES);
});

describe('path validation', () => {
  it('accepts exactly 64 lowercase hex chars', () => {
    expect(parseArtifactPath(`/api/artifacts/${'a'.repeat(64)}`)).toBe('a'.repeat(64));
    expect(parseArtifactPath(`/api/artifacts/${'A'.repeat(64)}`)).toBeNull();
    expect(parseArtifactPath('/api/artifacts/short')).toBeNull();
    expect(parseArtifactPath(`/api/artifacts/${'a'.repeat(64)}/extra`)).toBeNull();
    expect(isValidSha256('z'.repeat(64))).toBe(false);
  });
});

describe('upload (PUT)', () => {
  it('stores matching bytes and returns the ref', async () => {
    const { env, store } = makeEnv();
    const res = await handleArtifacts(putRequest(SHA, BYTES), env);
    expect(res.status).toBe(201);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toMatchObject({ sha256: SHA, size: BYTES.byteLength, mime: 'application/zip' });
    expect(String(body['url'])).toBe(`https://gw.example/api/artifacts/${SHA}`);
    expect(store.has(SHA)).toBe(true);
  });

  it('rejects a missing or wrong backend key', async () => {
    const { env } = makeEnv();
    const noKey = new Request(`https://gw.example/api/artifacts/${SHA}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/zip' },
      body: BYTES as unknown as BodyInit,
    });
    expect((await handleArtifacts(noKey, env)).status).toBe(401);
    expect(
      (await handleArtifacts(putRequest(SHA, BYTES, { 'x-sage-backend': 'wrong' }), env)).status,
    ).toBe(401);
  });

  it('rejects when the env has no backend key configured (fail closed)', async () => {
    const { env } = makeEnv();
    (env as { SAGE_BACKEND_KEY?: string }).SAGE_BACKEND_KEY = undefined as never;
    expect((await handleArtifacts(putRequest(SHA, BYTES), env)).status).toBe(401);
  });

  it('rejects a sha256 that does not match the body — the hash is the contract', async () => {
    const { env, store } = makeEnv();
    const wrongSha = await sha256Hex(new TextEncoder().encode('other bytes'));
    const res = await handleArtifacts(putRequest(wrongSha, BYTES), env);
    expect(res.status).toBe(422);
    expect(store.size).toBe(0);
  });

  it('rejects disallowed mime types and empty bodies', async () => {
    const { env } = makeEnv();
    expect(
      (
        await handleArtifacts(
          putRequest(SHA, BYTES, { 'content-type': 'application/x-msdownload' }),
          env,
        )
      ).status,
    ).toBe(415);
    const emptySha = await sha256Hex(new Uint8Array());
    expect((await handleArtifacts(putRequest(emptySha, new Uint8Array()), env)).status).toBe(400);
  });

  it('rejects an oversize declared content-length up front', async () => {
    const { env } = makeEnv();
    const res = await handleArtifacts(
      putRequest(SHA, BYTES, { 'content-length': String(MAX_ARTIFACT_BYTES + 1) }),
      env,
    );
    expect(res.status).toBe(413);
  });

  it('is idempotent: re-uploading the same bytes does not rewrite', async () => {
    const { env, putCount } = makeEnv();
    expect((await handleArtifacts(putRequest(SHA, BYTES), env)).status).toBe(201);
    expect((await handleArtifacts(putRequest(SHA, BYTES), env)).status).toBe(200);
    expect(putCount()).toBe(1);
  });
});

describe('download (GET)', () => {
  it('serves stored bytes with immutable caching, 404s the unknown', async () => {
    const { env } = makeEnv();
    await handleArtifacts(putRequest(SHA, BYTES), env);

    const res = await handleArtifacts(
      new Request(`https://gw.example/api/artifacts/${SHA}`),
      env,
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/zip');
    expect(res.headers.get('cache-control')).toContain('immutable');
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(BYTES);

    const missing = await handleArtifacts(
      new Request(`https://gw.example/api/artifacts/${'0'.repeat(64)}`),
      env,
    );
    expect(missing.status).toBe(404);
  });

  it('GET requires no auth — artifacts are public by hash', async () => {
    const { env } = makeEnv();
    await handleArtifacts(putRequest(SHA, BYTES), env);
    const res = await handleArtifacts(new Request(`https://gw.example/api/artifacts/${SHA}`), env);
    expect(res.status).toBe(200);
  });
});
