/**
 * Website-pipeline handlers (M12.1.1): copywriter / builder (manifest
 * validation + artifact discipline) / packager (verified download → zip),
 * plus the full chain composed exactly the way the plan-runner chains
 * results through ADR-0018 inputs.
 */
import { describe, it, expect } from 'vitest';

import { copywriterHandler } from '../../src/worker/handlers/copywriter.js';
import {
  builderHandler,
  validateManifest,
  mockManifest,
  MAX_FILES,
  MAX_TOTAL_BYTES,
} from '../../src/worker/handlers/builder.js';
import { packagerHandler, buildReadme, unzipSync } from '../../src/worker/handlers/packager.js';
import {
  sha256Hex,
  decodeArtifactResult,
  type ArtifactRef,
  type ArtifactStore,
} from '../../src/worker/artifacts.js';
import type { HandlerContext } from '../../src/worker/handlers/index.js';

/** In-memory ArtifactStore honoring the sha-verification contract. */
function makeFakeStore() {
  const objects = new Map<string, { bytes: Uint8Array; mime: string }>();
  const store: ArtifactStore = {
    async upload(bytes, mime) {
      const sha256 = sha256Hex(bytes);
      objects.set(sha256, { bytes, mime });
      return { sha256, size: bytes.byteLength, mime, url: `https://gw.example/api/artifacts/${sha256}` };
    },
    async download(ref) {
      const obj = objects.get(ref.sha256);
      if (!obj) throw new Error('artifact download failed (HTTP 404)');
      if (sha256Hex(obj.bytes) !== ref.sha256) throw new Error('artifact sha256 mismatch');
      return obj.bytes;
    },
  };
  return { store, objects };
}

const ctx = (over: Partial<HandlerContext> = {}): HandlerContext => ({
  identityId: 'x',
  capability: 'x',
  openaiApiKey: undefined,
  ...over,
});

const file = (path: string, content = 'x') => ({ path, content });
const okManifest = { files: [file('index.html', '<title>T</title>'), file('styles.css')] };

describe('validateManifest', () => {
  it('accepts a sane manifest', () => {
    expect(validateManifest(okManifest).files).toHaveLength(2);
  });

  const bad: Array<[string, unknown, RegExp]> = [
    ['no files', {}, /non-empty array/],
    ['missing index.html', { files: [file('about.html')] }, /index\.html/],
    ['path traversal', { files: [file('index.html'), file('../evil.html')] }, /unsafe file path/],
    ['absolute path', { files: [file('index.html'), file('/etc/passwd.txt')] }, /unsafe file path/],
    ['bad extension', { files: [file('index.html'), file('run.exe')] }, /extension not allowed/],
    ['duplicate path', { files: [file('index.html'), file('INDEX.html')] }, /duplicate/],
    [
      'too many files',
      { files: [file('index.html'), ...Array.from({ length: MAX_FILES }, (_, i) => file(`f${i}.css`))] },
      /max 12/,
    ],
    [
      'oversize total',
      { files: [file('index.html', 'x'.repeat(MAX_TOTAL_BYTES + 1))] },
      /max 262144/,
    ],
  ];
  for (const [name, manifest, pattern] of bad) {
    it(`rejects ${name}`, () => {
      expect(() => validateManifest(manifest)).toThrow(pattern);
    });
  }
});

describe('copywriter', () => {
  it('keyless mock produces a self-contained markdown deck from the material', async () => {
    const out = await copywriterHandler({ spec: 'write copy', material: 'Coffee shop in Lisbon' }, ctx());
    expect(out).toMatch(/^# /m);
    expect(out).toContain('Coffee shop in Lisbon');
    expect(out).toMatch(/## Contact/);
  });
});

describe('builder', () => {
  it('throws without an artifact store (no silent on-chain inlining)', async () => {
    await expect(builderHandler({ spec: 'build', material: '# Copy' }, ctx())).rejects.toThrow(
      /artifact store unavailable/,
    );
  });

  it('throws without upstream copy material', async () => {
    const { store } = makeFakeStore();
    await expect(builderHandler({ spec: 'build', material: null }, ctx({ artifacts: store }))).rejects.toThrow(
      /needs material/,
    );
  });

  it('keyless: uploads the mock manifest and returns only the small envelope', async () => {
    const { store, objects } = makeFakeStore();
    const out = await builderHandler({ spec: 'build', material: '# My Site' }, ctx({ artifacts: store }));

    const ref = decodeArtifactResult(out);
    expect(ref).not.toBeNull();
    expect(ref!.mime).toBe('application/json');
    expect(out.length).toBeLessThan(500); // envelope, not the site
    const stored = JSON.parse(new TextDecoder().decode(objects.get(ref!.sha256)!.bytes)) as {
      files: Array<{ path: string }>;
    };
    expect(stored.files.some((f) => f.path === 'index.html')).toBe(true);
  });

  it('the keyless mock manifest satisfies its own validation gate', () => {
    // The LLM path goes parse → validateManifest → upload; the mock path must
    // hold the same invariant so both feed the packager identically.
    expect(() => validateManifest(mockManifest('# T') as unknown)).not.toThrow();
  });
});

describe('packager', () => {
  it('verified-downloads the manifest, zips with README, uploads the final artifact', async () => {
    const { store } = makeFakeStore();
    const builderOut = await builderHandler(
      { spec: 'build', material: '# Zip Me' },
      ctx({ artifacts: store }),
    );

    const out = await packagerHandler({ spec: 'package', material: builderOut }, ctx({ artifacts: store }));
    const parsed = JSON.parse(out) as {
      artifact: ArtifactRef;
      manifest: { title: string; files: Array<{ path: string; bytes: number }> };
    };
    expect(parsed.artifact.mime).toBe('application/zip');
    expect(parsed.manifest.files.some((f) => f.path === 'index.html')).toBe(true);

    // The uploaded zip round-trips and carries README + site files.
    const zipBytes = await store.download(parsed.artifact);
    const unzipped = unzipSync(zipBytes);
    expect(Object.keys(unzipped).sort()).toEqual(['README.md', 'index.html', 'styles.css']);
    const readme = new TextDecoder().decode(unzipped['README.md']);
    expect(readme).toContain('Deploy');
    expect(readme).toContain('index.html');
  });

  it('rejects material that is not an artifact envelope', async () => {
    const { store } = makeFakeStore();
    await expect(
      packagerHandler({ spec: 'package', material: 'just text' }, ctx({ artifacts: store })),
    ).rejects.toThrow(/not an artifact envelope/);
  });

  it('propagates a sha-verification failure from the store (tampered artifact)', async () => {
    const { store, objects } = makeFakeStore();
    const builderOut = await builderHandler(
      { spec: 'build', material: '# Tamper' },
      ctx({ artifacts: store }),
    );
    const ref = decodeArtifactResult(builderOut)!;
    // Tamper with the stored bytes — download() must now refuse.
    objects.set(ref.sha256, { bytes: new TextEncoder().encode('{"files":[]}'), mime: 'application/json' });

    await expect(
      packagerHandler({ spec: 'package', material: builderOut }, ctx({ artifacts: store })),
    ).rejects.toThrow(/sha256 mismatch/);
  });

  it('README template lists files and deploy targets', () => {
    const readme = buildReadme(okManifest, 'T');
    expect(readme).toContain('`index.html`');
    expect(readme).toContain('Cloudflare Pages');
  });
});

describe('full chain (brief → copy → site → zip) through ADR-0018 material passing', () => {
  it('composes end-to-end keyless with a fake store', async () => {
    const { store } = makeFakeStore();

    // Step 1: copywriter gets the brief as source-material.
    const copy = await copywriterHandler(
      { spec: 'write the copy deck', material: 'Бариста-кофейня у моря' },
      ctx({ identityId: 'copywriter', capability: 'copywrite' }),
    );
    // Step 2: builder gets copywriter's result as inputs-material.
    const builderOut = await builderHandler(
      { spec: 'build the site', material: copy },
      ctx({ identityId: 'builder', capability: 'build-website', artifacts: store }),
    );
    // Step 3: packager gets builder's result as inputs-material.
    const out = await packagerHandler(
      { spec: 'package it', material: builderOut },
      ctx({ identityId: 'packager', capability: 'package-archive', artifacts: store }),
    );

    const parsed = JSON.parse(out) as { artifact: ArtifactRef };
    const zip = unzipSync(await store.download(parsed.artifact));
    expect(Object.keys(zip)).toContain('README.md');
    expect(Object.keys(zip)).toContain('index.html');
    // Every on-chain payload in the chain stays envelope-small except the copy.
    expect(builderOut.length).toBeLessThan(500);
    expect(out.length).toBeLessThan(1000);
  });
});
