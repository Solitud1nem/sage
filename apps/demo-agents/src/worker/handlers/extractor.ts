/**
 * Extractor — per-source step of the research pipeline (M12.2.1, ADR-0020).
 *
 * Input: the searcher's {question, sources} JSON (inputs chaining); the
 * `source_index=N` token in the spec selects THIS step's source. The handler
 * fetches the real page (guarded — see `fetchPublicPage`), reduces HTML to
 * text, has a mini-class LLM pick key points + candidate quotes, then keeps
 * ONLY quotes that verify as verbatim substrings of the page text
 * (`quoteAppearsIn`). That verification is the pipeline's citation contract:
 * the synthesizer may cite nothing the extractor didn't verify, and the
 * fact-checker (M12.2.2) re-checks the same predicate against the live URL.
 *
 * An unreachable page is an HONEST partial result (status:'unreachable'),
 * not a failed task — the web rots, and a research run must survive one dead
 * link (рамка M12.1.4: «не падать от мелочи»).
 *
 * Output: SourceExtract as an R2 artifact (on-chain — only the envelope).
 */

import { chat } from '../llm.js';
import { encodeArtifactResult } from '../artifacts.js';
import {
  parseSearcherResult,
  parseSourceExtract,
  quoteAppearsIn,
  sourceIndexFromSpec,
  type SearchSource,
  type SourceExtract,
} from '../../shared/research.js';
import type { CapabilityHandler } from './index.js';
import { fetchPublicPage } from '../net.js';

// fetchPublicPage + the SSRF/egress guard moved to the shared `worker/net.ts`
// (M13.2.1, ADR-0023 §Layer 4) so the fact-checker and any foreign-agent fork
// reuse the exact same defenses — and so redirect targets + resolved IPs are
// now re-validated, not just the hostname string. Re-exported for existing
// import sites (fact-checker, tests).
export { fetchPublicPage };
export { FETCH_TIMEOUT_MS, MAX_PAGE_BYTES } from '../net.js';

/** Text handed to the LLM — ~10k tokens; mini's context dwarfs it, the
 * envelope/cost discipline doesn't. */
export const MAX_TEXT_CHARS = 40_000;

const STRIP_BLOCKS = /<(script|style|noscript|svg|template|iframe)\b[\s\S]*?<\/\1\s*>/gi;
const ENTITIES: Readonly<Record<string, string>> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
  '&apos;': "'",
  '&nbsp;': ' ',
  '&mdash;': '—',
  '&ndash;': '–',
  '&hellip;': '…',
  '&laquo;': '«',
  '&raquo;': '»',
};

/**
 * Dependency-free HTML→text: drop non-content blocks, break on block-level
 * boundaries, strip tags, decode the common entities, collapse whitespace
 * per line. Deliberately naive — quotes are verified against THIS text, and
 * the fact-checker will reduce the live page the same way, so the reduction
 * only has to be deterministic, not perfect.
 */
export function htmlToText(html: string): string {
  const withoutBlocks = html.replace(STRIP_BLOCKS, ' ');
  const withBreaks = withoutBlocks.replace(
    /<\/(p|div|li|h[1-6]|tr|section|article|blockquote|br)\s*>|<br\s*\/?>/gi,
    '\n',
  );
  const stripped = withBreaks.replace(/<[^>]+>/g, ' ');
  const decoded = stripped
    .replace(/&[a-zA-Z#0-9]+;/g, (e) => {
      if (ENTITIES[e]) return ENTITIES[e];
      const num = /^&#(\d+);$/.exec(e);
      if (num) {
        const code = Number(num[1]);
        if (code >= 32 && code <= 0x10ffff) return String.fromCodePoint(code);
      }
      return ' ';
    });
  return decoded
    .split('\n')
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter((line) => line.length > 0)
    .join('\n');
}

const EXTRACT_PROMPT =
  'You extract evidence from ONE web page for a research question. ' +
  'Respond with a JSON object {"key_points": ["..."], "quotes": ["..."]}.\n' +
  '- key_points: 3-6 short findings from THIS page relevant to the question, in your own words;\n' +
  '- quotes: 2-4 VERBATIM passages (1-3 sentences each) copied EXACTLY from the page text — ' +
  'character for character, no paraphrase, no fixing typos, no trimming words mid-sentence. ' +
  'Pick the passages that best back the key points. Every quote will be mechanically checked ' +
  'against the page; a non-verbatim quote is discarded.\n' +
  'If the page turns out to be irrelevant to the question, return {"key_points": [], "quotes": []}. ' +
  'JSON only.';

export function parseExtraction(rawText: string): { keyPoints: string[]; quotes: string[] } {
  const parsed = JSON.parse(rawText) as { key_points?: unknown; quotes?: unknown };
  const keyPoints = Array.isArray(parsed.key_points)
    ? parsed.key_points.filter((p): p is string => typeof p === 'string' && p.trim().length > 0)
    : [];
  const quotes = Array.isArray(parsed.quotes)
    ? parsed.quotes.filter((q): q is string => typeof q === 'string' && q.trim().length > 0)
    : [];
  return { keyPoints: keyPoints.slice(0, 6), quotes: quotes.slice(0, 4) };
}

/** Keyless deterministic extract — fully offline (no fetch, no LLM). */
function mockExtract(source: SearchSource): Pick<SourceExtract, 'key_points' | 'quotes'> {
  return {
    key_points: [`Keyless mock key point from "${source.title}"`],
    quotes: [source.snippet || 'Deterministic keyless quote'],
  };
}

export const extractorHandler: CapabilityHandler = async (job, ctx) => {
  if (!ctx.artifacts) {
    throw new Error('artifact store unavailable — extractor cannot deliver page extracts inline');
  }
  if (!job.material) {
    throw new Error('extractor needs material: the searcher result (inputs chaining)');
  }
  const search = parseSearcherResult(job.material);
  if (!search) {
    throw new Error('extractor material is not a searcher result {question, sources}');
  }
  const index = sourceIndexFromSpec(job.spec);
  if (index === null) {
    throw new Error('extractor spec carries no source_index=N token');
  }

  const source = search.sources[index - 1];
  let extract: SourceExtract;
  if (!source) {
    // The deterministic plan has a slot the searcher couldn't fill — honest
    // partial coverage, the synthesizer's limitations section reports it.
    extract = {
      url: '',
      title: `(no source for slot ${index})`,
      status: 'missing',
      fetched_at: new Date().toISOString(),
      error: `searcher returned ${search.sources.length} sources, slot ${index} is empty`,
      key_points: [],
      quotes: [],
    };
  } else if (!ctx.openaiApiKey) {
    extract = {
      url: source.url,
      title: source.title,
      status: 'ok',
      fetched_at: new Date().toISOString(),
      ...mockExtract(source),
    };
  } else {
    try {
      const html = await fetchPublicPage(source.url);
      const text = htmlToText(html).slice(0, MAX_TEXT_CHARS);
      const rawText = await chat({
        apiKey: ctx.openaiApiKey,
        system: EXTRACT_PROMPT,
        user: `RESEARCH QUESTION:\n${search.question}\n\nPAGE (${source.url}):\n${text}`,
        maxTokens: 900,
        json: true,
      });
      const { keyPoints, quotes } = parseExtraction(rawText);
      // The citation contract starts here: only mechanically-verified
      // verbatim quotes leave the extractor.
      const verified = quotes.filter((q) => quoteAppearsIn(q, text));
      extract = {
        url: source.url,
        title: source.title,
        status: 'ok',
        fetched_at: new Date().toISOString(),
        key_points: keyPoints,
        quotes: verified,
      };
    } catch (err) {
      extract = {
        url: source.url,
        title: source.title,
        status: 'unreachable',
        fetched_at: new Date().toISOString(),
        error: err instanceof Error ? err.message : String(err),
        key_points: [],
        quotes: [],
      };
    }
  }

  if (parseSourceExtract(extract) === null) {
    throw new Error('extractor produced an extract that fails its own contract');
  }
  const bytes = new TextEncoder().encode(JSON.stringify(extract));
  const ref = await ctx.artifacts.upload(bytes, 'application/json');
  return encodeArtifactResult(ref);
};
