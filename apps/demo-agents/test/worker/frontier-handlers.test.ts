/**
 * Frontier-model paths in website handlers + council (M12.1.6): the Anthropic
 * key routes builder → Opus 4.8, copywriter/qa-judge/council → Sonnet 4.6;
 * absence falls back to the OpenAI/mock behavior covered by existing suites.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';

import { builderHandler } from '../../src/worker/handlers/builder.js';
import { copywriterHandler } from '../../src/worker/handlers/copywriter.js';
import { sha256Hex, decodeArtifactResult, type ArtifactStore } from '../../src/worker/artifacts.js';
import { judgeDispute } from '../../src/parent/council.js';
import type { HandlerContext } from '../../src/worker/handlers/index.js';

afterEach(() => {
  vi.unstubAllGlobals();
});

function makeFakeStore() {
  const objects = new Map<string, { bytes: Uint8Array; mime: string }>();
  const store: ArtifactStore = {
    async upload(bytes, mime) {
      const sha256 = sha256Hex(bytes);
      objects.set(sha256, { bytes, mime });
      return { sha256, size: bytes.byteLength, mime, url: `https://gw.example/api/artifacts/${sha256}` };
    },
    async download(ref) {
      return objects.get(ref.sha256)!.bytes;
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

function anthropicOk(text: string) {
  return {
    ok: true,
    status: 200,
    json: async () => ({ content: [{ type: 'text', text }], stop_reason: 'end_turn' }),
  } as Response;
}

describe('builder frontier path', () => {
  it('prefers Opus 4.8 over the OpenAI path and accepts a raw brief as material', async () => {
    const { store, objects } = makeFakeStore();
    const manifest = JSON.stringify({
      files: [{ path: 'index.html', content: '<!DOCTYPE html><html lang="en"><head><title>T</title></head><body>ok</body></html>' }],
    });
    const calls: Array<Record<string, unknown>> = [];
    vi.stubGlobal('fetch', (async (_url: unknown, init: unknown) => {
      calls.push(JSON.parse(String((init as RequestInit).body)) as Record<string, unknown>);
      return anthropicOk(manifest);
    }) as typeof fetch);

    const out = await builderHandler(
      // site-author shape: material = raw client brief (envelope source)
      { spec: 'author and build', material: 'A wine bar in Porto — warm tone' },
      ctx({ anthropicApiKey: 'sk-ant', openaiApiKey: 'sk-oai', artifacts: store }),
    );

    expect(calls[0]!['model']).toBe('claude-opus-4-8');
    expect(calls[0]!['output_config']).toMatchObject({ format: { type: 'json_schema' } });
    const ref = decodeArtifactResult(out)!;
    expect(objects.has(ref.sha256)).toBe(true);
  });

  it('manifest from the frontier path still goes through validateManifest', async () => {
    const { store } = makeFakeStore();
    vi.stubGlobal('fetch', (async () => anthropicOk(JSON.stringify({ files: [] }))) as typeof fetch);
    await expect(
      builderHandler({ spec: 'b', material: 'brief' }, ctx({ anthropicApiKey: 'k', artifacts: store })),
    ).rejects.toThrow(/non-empty array/);
  });
});

describe('copywriter frontier path', () => {
  it('routes to Sonnet 4.6 when the Anthropic key is present', async () => {
    const calls: Array<Record<string, unknown>> = [];
    vi.stubGlobal('fetch', (async (_url: unknown, init: unknown) => {
      calls.push(JSON.parse(String((init as RequestInit).body)) as Record<string, unknown>);
      return anthropicOk('# Deck');
    }) as typeof fetch);

    const out = await copywriterHandler(
      { spec: 'write', material: 'brief' },
      ctx({ anthropicApiKey: 'k', openaiApiKey: 'also-set' }),
    );
    expect(out).toBe('# Deck');
    expect(calls[0]!['model']).toBe('claude-sonnet-4-6');
  });
});

describe('council frontier path', () => {
  it('judges via Sonnet structured outputs and validates the verdict', async () => {
    const calls: Array<Record<string, unknown>> = [];
    const fetchImpl = (async (_url: unknown, init: unknown) => {
      calls.push(JSON.parse(String((init as RequestInit).body)) as Record<string, unknown>);
      return anthropicOk(JSON.stringify({ outcome: 'split', executor_share_pct: 250, reasoning: 'partial' }));
    }) as typeof fetch;

    const v = await judgeDispute(
      { spec: 'do x', result: 'half of x', reason: 'incomplete' },
      { anthropicApiKey: 'k', openaiApiKey: 'also-set', fetchImpl },
    );
    expect(calls[0]!['model']).toBe('claude-sonnet-4-6');
    expect(v.outcome).toBe('split');
    expect(v.executorSharePct).toBe(99); // clamped by validateVerdict
  });

  it('degrades to client refund after two Anthropic failures', async () => {
    const fetchImpl = (async () =>
      ({ ok: false, status: 500, json: async () => null }) as Response) as typeof fetch;
    const v = await judgeDispute(
      { spec: 's', result: 'r', reason: 'x' },
      { anthropicApiKey: 'k', fetchImpl },
    );
    expect(v.outcome).toBe('client');
    expect(v.reasoning).toMatch(/Council unavailable/);
  });
});
