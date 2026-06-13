/**
 * Fact-checker evaluator (M12.2.2): re-resolves citations against the live
 * web, judges trust, returns an EvaluationVerdict. Input-quality fails vs
 * harness-breakage throws; the "nothing resolves" deterministic blocker; the
 * keyless mock judge; verdict envelope shape.
 */
import { describe, it, expect } from 'vitest';

import {
  makeFactCheckerHandler,
  resolveCitations,
  MAX_CITATIONS_CHECKED,
  type PageFetcher,
} from '../../src/worker/handlers/fact-checker.js';
import { MOCK_FAIL_MARKER } from '../../src/worker/handlers/evaluator.js';
import { encodeEvaluationCase, decodeVerdict } from '../../src/shared/evaluation.js';
import { encodeArtifactResult, sha256Hex, type ArtifactStore } from '../../src/worker/artifacts.js';
import type { ResearchCitation, ResearchReportDoc } from '../../src/shared/research.js';
import type { HandlerContext } from '../../src/worker/handlers/index.js';

function makeFakeStore() {
  const objects = new Map<string, Uint8Array>();
  const store: ArtifactStore = {
    async upload(bytes, mime) {
      const sha256 = sha256Hex(bytes);
      objects.set(sha256, bytes);
      return { sha256, size: bytes.byteLength, mime, url: `https://gw.example/api/artifacts/${sha256}` };
    },
    async download(ref) {
      const b = objects.get(ref.sha256);
      if (!b) throw new Error('artifact download failed (HTTP 404)');
      return b;
    },
  };
  return { store };
}

const ctx = (over: Partial<HandlerContext> = {}): HandlerContext => ({
  identityId: 'fact-checker',
  capability: 'fact-check',
  openaiApiKey: undefined,
  ...over,
});

const citation = (id: number, url: string, quote: string): ResearchCitation => ({
  id,
  claim: `claim ${id}`,
  url,
  quote,
});

const reportDoc = (citations: ResearchCitation[], markdown = '# Report\nFindings [1].'): ResearchReportDoc => ({
  question: 'Q?',
  report_markdown: markdown,
  citations,
  sources: citations.map((c) => ({ url: c.url, title: c.url, status: 'ok' as const })),
  generated_at: '2026-06-13T00:00:00Z',
});

/** Upload a report doc and return the EvaluationCase material a synthesizer
 * step would hand the evaluator. */
async function caseFor(store: ArtifactStore, doc: ResearchReportDoc): Promise<string> {
  const ref = await store.upload(new TextEncoder().encode(JSON.stringify(doc)), 'application/json');
  return encodeEvaluationCase({ instruction: 'synthesize the report', result: encodeArtifactResult(ref) });
}

/** Page fetcher returning canned HTML per URL; throws for "dead" URLs. */
const pageFetcherFrom = (pages: Record<string, string | Error>): PageFetcher => async (url) => {
  const page = pages[url];
  if (page === undefined || page instanceof Error) {
    throw page instanceof Error ? page : new Error('HTTP 404');
  }
  return page;
};

describe('resolveCitations', () => {
  it('classifies resolved / quote_mismatch / dead_url and caps the count', async () => {
    const citations = Array.from({ length: MAX_CITATIONS_CHECKED + 2 }, (_, i) =>
      citation(i + 1, `https://s${i}.example/`, 'the settled quote'),
    );
    const fetchPage = pageFetcherFrom({
      'https://s0.example/': '<p>the settled quote lives here</p>',
      'https://s1.example/': '<p>a paraphrase that does not match</p>',
      // s2 missing → dead_url; rest resolve so the cap is what we assert
      'https://s3.example/': '<p>the settled quote</p>',
      'https://s4.example/': '<p>the settled quote</p>',
      'https://s5.example/': '<p>the settled quote</p>',
      'https://s6.example/': '<p>the settled quote</p>',
      'https://s7.example/': '<p>the settled quote</p>',
    });
    const checks = await resolveCitations(citations, fetchPage);
    expect(checks).toHaveLength(MAX_CITATIONS_CHECKED); // capped
    expect(checks[0]!.status).toBe('resolved');
    expect(checks[1]!.status).toBe('quote_mismatch');
    expect(checks[2]!.status).toBe('dead_url');
  });
});

describe('fact-checker handler', () => {
  it('keyless: passes when all citations resolve on the live page', async () => {
    const { store } = makeFakeStore();
    const doc = reportDoc([
      citation(1, 'https://a.example/', 'escrow releases after approval'),
      citation(2, 'https://b.example/', 'agents pay agents'),
    ]);
    const material = await caseFor(store, doc);
    const fetchPage = pageFetcherFrom({
      'https://a.example/': '<p>escrow releases after approval</p>',
      'https://b.example/': '<article>agents pay agents on chain</article>',
    });
    const out = await makeFactCheckerHandler({ fetchPage })({ spec: 'fact-check', material }, ctx({ artifacts: store }));
    const v = decodeVerdict(out)!;
    expect(v.pass).toBe(true);
    expect(v.score).toBe(100);
  });

  it('deterministic blocker: fails with score 0 when NOTHING resolves (no LLM needed)', async () => {
    const { store } = makeFakeStore();
    const doc = reportDoc([
      citation(1, 'https://dead.example/', 'never appears'),
      citation(2, 'https://gone.example/', 'also gone'),
    ]);
    const material = await caseFor(store, doc);
    const fetchPage = pageFetcherFrom({}); // every fetch throws
    // No API key, but the blocker short-circuits before any judge call.
    const out = await makeFactCheckerHandler({ fetchPage })({ spec: 'fact-check', material }, ctx({ artifacts: store }));
    const v = decodeVerdict(out)!;
    expect(v.pass).toBe(false);
    expect(v.score).toBe(0);
    expect(v.reasons.join(' ')).toMatch(/not one citation resolves/);
  });

  it('keyless mock judge: MOCK_FAIL_MARKER in the report fails even with a resolving citation', async () => {
    const { store } = makeFakeStore();
    const doc = reportDoc(
      [citation(1, 'https://a.example/', 'real quote')],
      `# Report ${MOCK_FAIL_MARKER}\nbody [1]`,
    );
    const material = await caseFor(store, doc);
    const fetchPage = pageFetcherFrom({ 'https://a.example/': '<p>real quote</p>' });
    const out = await makeFactCheckerHandler({ fetchPage })({ spec: 'fact-check', material }, ctx({ artifacts: store }));
    const v = decodeVerdict(out)!;
    expect(v.pass).toBe(false);
    expect(v.score).toBe(100); // citation resolved, but the judge rejected
    expect(v.reasons.join(' ')).toContain(MOCK_FAIL_MARKER);
  });

  it('input-quality fails (judging, not breakage): non-artifact result, invalid doc, no citations', async () => {
    const { store } = makeFakeStore();
    const fc = makeFactCheckerHandler({ fetchPage: pageFetcherFrom({}) });

    const notArtifact = encodeEvaluationCase({ instruction: 'x', result: 'just text' });
    const v1 = decodeVerdict(await fc({ spec: 'fc', material: notArtifact }, ctx({ artifacts: store })))!;
    expect(v1.pass).toBe(false);
    expect(v1.reasons.join(' ')).toMatch(/not an artifact envelope/);

    const badRef = await store.upload(new TextEncoder().encode('{"nope":1}'), 'application/json');
    const badDoc = encodeEvaluationCase({ instruction: 'x', result: encodeArtifactResult(badRef) });
    const v2 = decodeVerdict(await fc({ spec: 'fc', material: badDoc }, ctx({ artifacts: store })))!;
    expect(v2.pass).toBe(false);
    expect(v2.reasons.join(' ')).toMatch(/not a valid research report/);

    const noCites = await caseFor(store, reportDoc([]));
    const v3 = decodeVerdict(await fc({ spec: 'fc', material: noCites }, ctx({ artifacts: store })))!;
    expect(v3.pass).toBe(false);
    expect(v3.reasons.join(' ')).toMatch(/no citations/);
  });

  it('no decodable case → skipped (harness convention); no store → throw (breakage)', async () => {
    const fc = makeFactCheckerHandler({ fetchPage: pageFetcherFrom({}) });
    const skipped = await fc({ spec: 'fc', material: 'not a case' }, ctx({ artifacts: makeFakeStore().store }));
    expect(skipped).toMatch(/Evaluation skipped/);

    const { store } = makeFakeStore();
    const material = await caseFor(store, reportDoc([citation(1, 'https://a.example/', 'q')]));
    await expect(fc({ spec: 'fc', material }, ctx())).rejects.toThrow(/artifact store unavailable/);
  });

  it('sha-verification failure from the store propagates as breakage (throw)', async () => {
    const objects = new Map<string, Uint8Array>();
    const store: ArtifactStore = {
      async upload(bytes, mime) {
        const sha256 = sha256Hex(bytes);
        objects.set(sha256, bytes);
        return { sha256, size: bytes.byteLength, mime, url: `https://gw.example/a/${sha256}` };
      },
      async download() {
        throw new Error('artifact sha256 mismatch: tampered');
      },
    };
    const material = await caseFor(store, reportDoc([citation(1, 'https://a.example/', 'q')]));
    await expect(
      makeFactCheckerHandler({ fetchPage: pageFetcherFrom({}) })(
        { spec: 'fc', material },
        ctx({ artifacts: store }),
      ),
    ).rejects.toThrow(/sha256 mismatch/);
  });
});
