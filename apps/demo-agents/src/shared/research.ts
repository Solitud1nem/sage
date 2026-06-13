/**
 * Shared contracts of the research pipeline (M12.2.1, ADR-0020 п.1).
 *
 * Lives in `src/shared/` because both bundles consume it: the generic worker
 * (searcher / extractor / synthesizer handlers — M12.2.2 adds fact-checker)
 * and the orchestrator (research-plan template). The shapes here ARE the
 * pipeline's joints, designed so that every citation in the final report is
 * machine-checkable by the fact-checker evaluator:
 *
 *   searcher  → {question, sources[]}            (inline JSON, small)
 *   extractor → SourceExtract                    (R2 artifact per source)
 *   synthesizer → ResearchReportDoc              (R2 artifact; citations
 *                 carry VERBATIM quotes traceable to a fetched page)
 *
 * Decoders are permissive-to-null like the sibling codecs (composite-codec,
 * evaluation): malformed input is "not a searcher result", never a crash.
 */

/** How many sources the pipeline researches. The plan template spawns one
 * extract sub-task per source, so this number is baked into the plan shape —
 * changing it means changing the deterministic plan, not just a handler. */
export const RESEARCH_SOURCE_COUNT = 4;

export interface SearchSource {
  readonly url: string;
  readonly title: string;
  readonly snippet: string;
}

/** Searcher's on-chain result. Carries the question forward so downstream
 * steps (which only ever see upstream inputs, per ADR-0018) keep the research
 * goal without re-reading the root brief. */
export interface SearcherResult {
  readonly question: string;
  readonly sources: readonly SearchSource[];
}

export function parseSearcherResult(text: string): SearcherResult | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;
  const { question, sources } = parsed as { question?: unknown; sources?: unknown };
  if (typeof question !== 'string' || question.length === 0) return null;
  if (!Array.isArray(sources)) return null;
  const out: SearchSource[] = [];
  for (const s of sources as Array<Record<string, unknown>>) {
    if (typeof s?.['url'] !== 'string' || typeof s?.['title'] !== 'string') return null;
    out.push({
      url: s['url'],
      title: s['title'],
      snippet: typeof s['snippet'] === 'string' ? s['snippet'] : '',
    });
  }
  return { question, sources: out };
}

/**
 * The extract sub-task specs are deterministic-template text; the ONLY
 * machine-readable part is the `source_index=N` token telling the extractor
 * which of the searcher's sources is its job. 1-based.
 */
export function sourceIndexFromSpec(spec: string): number | null {
  const m = /source_index=(\d+)/.exec(spec);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isInteger(n) && n >= 1 ? n : null;
}

/** Per-source extract — the R2 artifact an extract sub-task produces. */
export interface SourceExtract {
  readonly url: string;
  readonly title: string;
  /** 'ok' = fetched and extracted; 'unreachable' = honest fetch failure;
   * 'missing' = searcher returned fewer sources than the plan has slots. */
  readonly status: 'ok' | 'unreachable' | 'missing';
  readonly fetched_at: string;
  /** Why status !== 'ok', for the report's limitations section. */
  readonly error?: string;
  readonly key_points: readonly string[];
  /** VERBATIM substrings of the fetched page text (verified by the extractor
   * before upload — see `quoteAppearsIn`). The synthesizer may cite ONLY
   * these; the fact-checker re-fetches the URL and re-checks the same way. */
  readonly quotes: readonly string[];
}

export function parseSourceExtract(raw: unknown): SourceExtract | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (typeof r['url'] !== 'string' || typeof r['title'] !== 'string') return null;
  const status = r['status'];
  if (status !== 'ok' && status !== 'unreachable' && status !== 'missing') return null;
  const keyPoints = Array.isArray(r['key_points'])
    ? (r['key_points'] as unknown[]).filter((p): p is string => typeof p === 'string')
    : [];
  const quotes = Array.isArray(r['quotes'])
    ? (r['quotes'] as unknown[]).filter((q): q is string => typeof q === 'string')
    : [];
  return {
    url: r['url'],
    title: r['title'],
    status,
    fetched_at: typeof r['fetched_at'] === 'string' ? r['fetched_at'] : '',
    ...(typeof r['error'] === 'string' ? { error: r['error'] } : {}),
    key_points: keyPoints,
    quotes,
  };
}

export interface ResearchCitation {
  /** 1-based id, referenced from the report markdown as [n]. */
  readonly id: number;
  /** The claim the report makes, in the report's own words. */
  readonly claim: string;
  readonly url: string;
  /** Verbatim quote from the source page backing the claim. */
  readonly quote: string;
}

/** Synthesizer's R2 artifact — the deliverable the user takes away. */
export interface ResearchReportDoc {
  readonly question: string;
  readonly report_markdown: string;
  readonly citations: readonly ResearchCitation[];
  readonly sources: ReadonlyArray<{
    readonly url: string;
    readonly title: string;
    readonly status: SourceExtract['status'];
  }>;
  readonly generated_at: string;
}

/**
 * Whitespace-insensitive quote matching, shared by the extractor (verify
 * before upload) and the fact-checker (re-verify against the LIVE page,
 * M12.2.2). HTML→text inevitably reflows whitespace; everything else must
 * match exactly — fuzzier matching would let paraphrase pass as "verbatim".
 */
export function normalizeForQuoteMatch(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

export function quoteAppearsIn(quote: string, text: string): boolean {
  const q = normalizeForQuoteMatch(quote);
  if (q.length === 0) return false;
  return normalizeForQuoteMatch(text).includes(q);
}
