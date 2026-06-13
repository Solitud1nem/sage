/**
 * Research-pipeline handlers (M12.2.1): searcher (SERP merge/rank) /
 * extractor (guarded fetch, HTML→text, verbatim-quote verification) /
 * synthesizer (dossier reassembly, citation re-verification), plus the full
 * keyless chain composed exactly the way the plan-runner chains results
 * through ADR-0018 inputs.
 */
import { describe, it, expect } from 'vitest';

import { serperSearch } from '../../src/worker/serp.js';
import { searcherHandler, parseQueries, rankSources } from '../../src/worker/handlers/searcher.js';
import {
  extractorHandler,
  fetchPublicPage,
  htmlToText,
  parseExtraction,
} from '../../src/worker/handlers/extractor.js';
import {
  synthesizerHandler,
  splitMaterialParts,
  collectDossier,
  checkCitations,
  fabricateStaleCitations,
  MIN_VALID_CITATIONS,
} from '../../src/worker/handlers/synthesizer.js';
import { makeFactCheckerHandler } from '../../src/worker/handlers/fact-checker.js';
import { decodeVerdict } from '../../src/shared/evaluation.js';
import {
  RESEARCH_SOURCE_COUNT,
  RESEARCH_FAILURE_DEMO_MARKER,
  parseResearchReportDoc,
  parseSearcherResult,
  parseSourceExtract,
  quoteAppearsIn,
  sourceIndexFromSpec,
  type ResearchReportDoc,
  type SourceExtract,
} from '../../src/shared/research.js';
import { encodeEvaluationCase } from '../../src/shared/evaluation.js';
import {
  sha256Hex,
  decodeArtifactResult,
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

const fakeFetch = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  (async () =>
    new Response(typeof body === 'string' ? body : JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json', ...headers },
    })) as unknown as typeof fetch;

describe('serperSearch', () => {
  it('maps organic results and tolerates partial rows', async () => {
    const fetchImpl = fakeFetch(200, {
      organic: [
        { link: 'https://a.example/1', title: 'A', snippet: 's1', position: 1 },
        { link: 42, title: 'broken' }, // dropped
        { link: 'https://b.example/2', title: 'B' }, // position defaults to index+1
      ],
    });
    const results = await serperSearch('q', { apiKey: 'k', fetchImpl });
    expect(results).toHaveLength(2);
    expect(results[0]).toEqual({ url: 'https://a.example/1', title: 'A', snippet: 's1', position: 1 });
    expect(results[1]!.position).toBe(3);
  });

  it('throws on HTTP error and on a shapeless payload', async () => {
    await expect(
      serperSearch('q', { apiKey: 'k', fetchImpl: fakeFetch(403, { message: 'bad key' }) }),
    ).rejects.toThrow(/bad key/);
    await expect(
      serperSearch('q', { apiKey: 'k', fetchImpl: fakeFetch(200, {}) }),
    ).rejects.toThrow(/no organic results/);
  });
});

describe('searcher helpers', () => {
  it('parseQueries caps at 5 and rejects an empty set', () => {
    expect(parseQueries(JSON.stringify({ queries: ['a', ' b ', '', 'c', 'd', 'e', 'f'] }))).toEqual(
      ['a', 'b', 'c', 'd', 'e'],
    );
    expect(() => parseQueries(JSON.stringify({ queries: [] }))).toThrow(/zero usable/);
    expect(() => parseQueries(JSON.stringify({}))).toThrow(/no queries/);
  });

  it('rankSources dedupes across queries (hash stripped) and prefers multi-query hits', () => {
    const a = { url: 'https://a.example/page', title: 'A', snippet: '', position: 3 };
    const aHash = { ...a, url: 'https://a.example/page#section' };
    const b = { url: 'https://b.example/', title: 'B', snippet: '', position: 1 };
    const ftp = { url: 'ftp://c.example/', title: 'C', snippet: '', position: 1 };
    const ranked = rankSources([[a, b, ftp], [aHash]], 4);
    // A appears for two queries → outranks B despite worse position.
    expect(ranked.map((s) => s.title)).toEqual(['A', 'B']);
  });
});

describe('searcher handler', () => {
  it('keyless (no SERPER_API_KEY): exactly N deterministic mock sources, question rides along', async () => {
    const out = await searcherHandler({ spec: 'search', material: 'Что нового в ERC-8183?' }, ctx());
    const parsed = parseSearcherResult(out);
    expect(parsed).not.toBeNull();
    expect(parsed!.question).toBe('Что нового в ERC-8183?');
    expect(parsed!.sources).toHaveLength(RESEARCH_SOURCE_COUNT);
  });

  it('throws on an empty question', async () => {
    await expect(searcherHandler({ spec: '  ', material: null }, ctx())).rejects.toThrow(
      /needs a research question/,
    );
  });
});

describe('extractor: fetchPublicPage guards', () => {
  const cases: Array<[string, string, RegExp]> = [
    ['http (not https)', 'http://example.com/x', /only https/],
    ['localhost', 'https://localhost/x', /not a public research source/],
    ['loopback ip', 'https://127.0.0.1/x', /not a public research source/],
    ['rfc1918 10.x', 'https://10.1.2.3/x', /not a public research source/],
    ['rfc1918 172.16', 'https://172.16.0.1/x', /not a public research source/],
    ['rfc1918 192.168', 'https://192.168.1.1/x', /not a public research source/],
    ['link-local', 'https://169.254.1.1/x', /not a public research source/],
    ['ipv6 literal', 'https://[::1]/x', /not a public research source/],
    ['.internal', 'https://gateway.internal/x', /not a public research source/],
    ['garbage', 'not a url', /invalid URL/],
  ];
  for (const [name, url, pattern] of cases) {
    it(`rejects ${name}`, async () => {
      await expect(fetchPublicPage(url)).rejects.toThrow(pattern);
    });
  }

  it('rejects non-OK status and non-text content types', async () => {
    await expect(
      fetchPublicPage('https://ok.example/x', { fetchImpl: fakeFetch(404, 'nope', { 'content-type': 'text/html' }) }),
    ).rejects.toThrow(/HTTP 404/);
    await expect(
      fetchPublicPage('https://ok.example/x', {
        fetchImpl: fakeFetch(200, 'PDFDATA', { 'content-type': 'application/pdf' }),
      }),
    ).rejects.toThrow(/unsupported content-type/);
  });

  it('returns the decoded body for a sane HTML page', async () => {
    const html = '<html><body><p>Привет</p></body></html>';
    const body = await fetchPublicPage('https://ok.example/x', {
      fetchImpl: fakeFetch(200, html, { 'content-type': 'text/html; charset=utf-8' }),
    });
    expect(body).toBe(html);
  });
});

describe('extractor: htmlToText', () => {
  it('drops script/style, breaks on blocks, decodes entities, collapses whitespace', () => {
    const html =
      '<head><style>body{color:red}</style></head>' +
      '<script>alert(1)</script>' +
      '<h1>Title&nbsp;&amp;&#160;more</h1>' +
      '<p>First   line</p><p>Second &laquo;quoted&raquo;</p>';
    const text = htmlToText(html);
    expect(text).not.toContain('alert');
    expect(text).not.toContain('color:red');
    expect(text).toContain('Title & more');
    expect(text.split('\n')).toContain('Second «quoted»');
  });

  it('quote verification is whitespace-insensitive but not paraphrase-tolerant', () => {
    const text = htmlToText('<p>The protocol   settles\nin USDC on Base.</p>');
    expect(quoteAppearsIn('The protocol settles in USDC on Base.', text)).toBe(true);
    expect(quoteAppearsIn('The protocol settles in USD Coin on Base.', text)).toBe(false);
  });
});

describe('extractor handler', () => {
  const searchMaterial = JSON.stringify({
    question: 'Q?',
    sources: [
      { url: 'https://a.example/1', title: 'A', snippet: 'snippet A' },
      { url: 'https://b.example/2', title: 'B', snippet: 'snippet B' },
    ],
  });

  it('parseExtraction caps lists and drops non-strings', () => {
    const { keyPoints, quotes } = parseExtraction(
      JSON.stringify({ key_points: ['a', 1, 'b', '', 'c', 'd', 'e', 'f', 'g'], quotes: ['q1', null] }),
    );
    expect(keyPoints).toEqual(['a', 'b', 'c', 'd', 'e', 'f']);
    expect(quotes).toEqual(['q1']);
  });

  it('keyless: uploads an ok-extract for its source_index, envelope-only on chain', async () => {
    const { store, objects } = makeFakeStore();
    const out = await extractorHandler(
      { spec: 'extract source_index=2 from the results', material: searchMaterial },
      ctx({ artifacts: store }),
    );
    const ref = decodeArtifactResult(out);
    expect(ref).not.toBeNull();
    expect(out.length).toBeLessThan(500);
    const extract = parseSourceExtract(
      JSON.parse(new TextDecoder().decode(objects.get(ref!.sha256)!.bytes)),
    );
    expect(extract).not.toBeNull();
    expect(extract!.url).toBe('https://b.example/2');
    expect(extract!.status).toBe('ok');
    expect(extract!.quotes.length).toBeGreaterThan(0);
  });

  it('an empty slot (searcher under-delivered) is an honest status:missing, not a throw', async () => {
    const { store, objects } = makeFakeStore();
    const out = await extractorHandler(
      { spec: 'extract source_index=4', material: searchMaterial },
      ctx({ artifacts: store }),
    );
    const ref = decodeArtifactResult(out)!;
    const extract = parseSourceExtract(JSON.parse(new TextDecoder().decode(objects.get(ref.sha256)!.bytes)))!;
    expect(extract.status).toBe('missing');
    expect(extract.error).toMatch(/slot 4 is empty/);
  });

  it('throws without store / material / source_index token', async () => {
    const { store } = makeFakeStore();
    await expect(
      extractorHandler({ spec: 'extract source_index=1', material: searchMaterial }, ctx()),
    ).rejects.toThrow(/artifact store unavailable/);
    await expect(
      extractorHandler({ spec: 'extract source_index=1', material: null }, ctx({ artifacts: store })),
    ).rejects.toThrow(/needs material/);
    await expect(
      extractorHandler({ spec: 'extract the second source', material: searchMaterial }, ctx({ artifacts: store })),
    ).rejects.toThrow(/no source_index/);
    await expect(
      extractorHandler({ spec: 'extract source_index=1', material: 'not json' }, ctx({ artifacts: store })),
    ).rejects.toThrow(/not a searcher result/);
  });
});

describe('synthesizer helpers', () => {
  const okExtract = (url: string, quotes: string[]): SourceExtract => ({
    url,
    title: url,
    status: 'ok',
    fetched_at: '2026-06-12T00:00:00Z',
    key_points: ['kp'],
    quotes,
  });

  it('splitMaterialParts splits on blank lines (materialFromEnvelope contract)', () => {
    expect(splitMaterialParts('a\n\nb\n\n\nc')).toEqual(['a', 'b', 'c']);
  });

  it('checkCitations keeps verbatim-backed citations and drops pretenders', () => {
    const extracts = [okExtract('https://a.example/1', ['Escrow releases funds after approval.'])];
    const { valid, dropped } = checkCitations(
      [
        { id: 1, claim: 'c1', url: 'https://a.example/1', quote: 'Escrow releases   funds after approval.' },
        { id: 2, claim: 'c2', url: 'https://a.example/1', quote: 'Escrow instantly releases funds.' },
        { id: 3, claim: 'c3', url: 'https://other.example/', quote: 'Escrow releases funds after approval.' },
        { id: 4, claim: 'c4', url: 'https://a.example/1', quote: '   ' },
      ],
      extracts,
    );
    expect(valid.map((c) => c.id)).toEqual([1]);
    expect(dropped.map((c) => c.id)).toEqual([2, 3, 4]);
  });

  it('collectDossier reassembles search + extracts and rejects a contract-breaking artifact', async () => {
    const { store } = makeFakeStore();
    const search = JSON.stringify({ question: 'Q?', sources: [] });
    const goodRef = await store.upload(
      new TextEncoder().encode(JSON.stringify(okExtract('https://a.example/1', ['q']))),
      'application/json',
    );
    const dossier = await collectDossier(
      `${search}\n\n${JSON.stringify({ artifact: goodRef })}`,
      store,
    );
    expect(dossier.search.question).toBe('Q?');
    expect(dossier.extracts).toHaveLength(1);

    const badRef = await store.upload(new TextEncoder().encode('{"nope":1}'), 'application/json');
    await expect(
      collectDossier(`${search}\n\n${JSON.stringify({ artifact: badRef })}`, store),
    ).rejects.toThrow(/fails the SourceExtract contract/);
    await expect(collectDossier(search, store)).rejects.toThrow(/no extract artifacts/);
    await expect(
      collectDossier(JSON.stringify({ artifact: goodRef }), store),
    ).rejects.toThrow(/no searcher result/);
  });
});

describe('full chain (question → search → extract×N → report) through ADR-0018 material passing', () => {
  it('composes end-to-end keyless with a fake store and survives citation re-verification', async () => {
    const { store, objects } = makeFakeStore();

    // Step 1: searcher gets the question as source-material.
    const searchOut = await searcherHandler(
      { spec: 'search', material: 'Как устроен task escrow в Sage?' },
      ctx({ identityId: 'searcher', capability: 'web-search' }),
    );

    // Steps 2..N+1: one extractor per source, each handed the searcher result.
    const extractOuts: string[] = [];
    for (let i = 1; i <= RESEARCH_SOURCE_COUNT; i++) {
      extractOuts.push(
        await extractorHandler(
          { spec: `extract source_index=${i}`, material: searchOut },
          ctx({ identityId: 'extractor', capability: 'extract-content', artifacts: store }),
        ),
      );
    }

    // Final step: synthesizer gets searcher + all extracts joined the way
    // materialFromEnvelope does.
    const out = await synthesizerHandler(
      { spec: 'synthesize the report', material: [searchOut, ...extractOuts].join('\n\n') },
      ctx({ identityId: 'synthesizer', capability: 'synthesize-report', artifacts: store }),
    );

    const ref = decodeArtifactResult(out);
    expect(ref).not.toBeNull();
    expect(out.length).toBeLessThan(500); // envelope, not the report
    const doc = JSON.parse(new TextDecoder().decode(objects.get(ref!.sha256)!.bytes)) as ResearchReportDoc;
    expect(doc.question).toBe('Как устроен task escrow в Sage?');
    expect(doc.report_markdown).toMatch(/^# /);
    expect(doc.citations.length).toBeGreaterThanOrEqual(MIN_VALID_CITATIONS);
    expect(doc.sources).toHaveLength(RESEARCH_SOURCE_COUNT);
    // Every shipped citation is verbatim-backed by its source's extract.
    const extracts = new Map(doc.sources.map((s) => [s.url, s]));
    for (const c of doc.citations) {
      expect(extracts.has(c.url)).toBe(true);
      expect(c.quote.trim().length).toBeGreaterThan(0);
    }
  });

  it('spec token parsing matches the plan template convention', () => {
    expect(sourceIndexFromSpec('Fetch and extract source_index=3 of the search results')).toBe(3);
    expect(sourceIndexFromSpec('no token here')).toBeNull();
    expect(sourceIndexFromSpec('source_index=0')).toBeNull();
  });
});

describe('failure-demo (M12.2.3): synthesizer fabricates, fact-checker catches it live', () => {
  it('fabricateStaleCitations keeps URLs but replaces quotes with non-verbatim paraphrase', () => {
    const fab = fabricateStaleCitations([
      { id: 1, claim: 'escrow releases after approval', url: 'https://a.example/', quote: 'real verbatim' },
    ]);
    expect(fab[0]!.url).toBe('https://a.example/');
    expect(fab[0]!.quote).not.toBe('real verbatim');
    expect(fab[0]!.quote).toContain('escrow releases after approval');
  });

  it('end-to-end: a failure-demo report is rejected by the fact-checker on the live web', async () => {
    const { store, objects } = makeFakeStore();

    // Build a real dossier keylessly: each extract's verbatim quote is the
    // source's snippet (mockExtract uses source.snippet).
    const searchOut = await searcherHandler(
      { spec: 'search', material: 'What is task escrow?' },
      ctx({ identityId: 'searcher', capability: 'web-search' }),
    );
    const extractOuts: string[] = [];
    for (let i = 1; i <= RESEARCH_SOURCE_COUNT; i++) {
      extractOuts.push(
        await extractorHandler(
          { spec: `extract source_index=${i}`, material: searchOut },
          ctx({ identityId: 'extractor', capability: 'extract-content', artifacts: store }),
        ),
      );
    }

    // Synthesize in FAILURE-DEMO mode: spec carries the marker.
    const synthOut = await synthesizerHandler(
      {
        spec: `synthesize the report ${RESEARCH_FAILURE_DEMO_MARKER}`,
        material: [searchOut, ...extractOuts].join('\n\n'),
      },
      ctx({ identityId: 'synthesizer', capability: 'synthesize-report', artifacts: store }),
    );
    const ref = decodeArtifactResult(synthOut)!;
    const doc = parseResearchReportDoc(JSON.parse(new TextDecoder().decode(objects.get(ref.sha256)!.bytes)))!;
    // Fabricated: quotes are NOT the verbatim extract snippets anymore.
    expect(doc.citations.length).toBeGreaterThanOrEqual(MIN_VALID_CITATIONS);

    // Fact-checker re-resolves against a LIVE page that contains the REAL
    // extract quote (the snippet) but not the fabricated paraphrase.
    const liveBody: Record<string, string> = {};
    const search = parseSearcherResult(searchOut)!;
    for (const s of search.sources) liveBody[s.url] = `<p>${s.snippet}</p>`;
    const fetchPage = async (u: string): Promise<string> => {
      const b = liveBody[u];
      if (b === undefined) throw new Error('HTTP 404');
      return b;
    };

    const material = encodeEvaluationCase({ instruction: 'synthesize', result: synthOut });
    const verdictText = await makeFactCheckerHandler({ fetchPage })(
      { spec: 'fact-check', material },
      ctx({ identityId: 'fact-checker', capability: 'fact-check', artifacts: store }),
    );
    const verdict = decodeVerdict(verdictText)!;
    // Every fabricated quote mismatches the live page → nothing resolves →
    // deterministic blocker → fail. This is the controlled failed run.
    expect(verdict.pass).toBe(false);
    expect(verdict.score).toBe(0);
    expect(verdict.reasons.join(' ')).toMatch(/not one citation resolves/);
  });
});
