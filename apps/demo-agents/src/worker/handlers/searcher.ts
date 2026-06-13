/**
 * Searcher — root step of the research pipeline (M12.2.1, ADR-0020).
 *
 * Input: the research question (envelope `source` → job.material; falls back
 * to the spec). The handler formulates 3–5 web search queries, runs them
 * against a LIVE SERP (Serper.dev — real Google results, the whole point of
 * the «протухшая память» narrative), deduplicates, ranks, and returns exactly
 * `RESEARCH_SOURCE_COUNT` sources as inline JSON {question, sources}.
 *
 * The question rides INSIDE the result on purpose: downstream steps only see
 * upstream inputs (ADR-0018), and both the extractors and the synthesizer
 * need the research goal.
 *
 * Result is small (≈1–2KB) — stays inline on-chain; artifacts start at the
 * extract steps.
 */

import { chat } from '../llm.js';
import { serperSearch, type SerpResult } from '../serp.js';
import {
  RESEARCH_SOURCE_COUNT,
  type SearchSource,
  type SearcherResult,
} from '../../shared/research.js';
import type { CapabilityHandler } from './index.js';

const QUERY_PROMPT =
  'You turn a research question into web search queries. ' +
  'Respond with a JSON object {"queries": ["...", ...]} of 3-5 short, distinct Google queries ' +
  'that together cover the question: core terms, a recency-flavored variant when timeliness ' +
  'matters, and one alternative phrasing. Queries in the most useful language for the topic ' +
  '(usually English, or the question\'s language for local topics). JSON only.';

export function parseQueries(rawText: string): string[] {
  const parsed = JSON.parse(rawText) as { queries?: unknown };
  if (!Array.isArray(parsed.queries)) throw new Error('LLM returned no queries array');
  const queries = parsed.queries
    .filter((q): q is string => typeof q === 'string')
    .map((q) => q.trim())
    .filter((q) => q.length > 0)
    .slice(0, 5);
  if (queries.length === 0) throw new Error('LLM returned zero usable queries');
  return queries;
}

/**
 * Merge per-query SERPs into one ranked source list: dedupe by URL
 * (hash stripped), score by appearance count first (a result surfacing for
 * several distinct queries is on-topic), then by best position. Caps at
 * `limit` and keeps only http(s) URLs.
 */
export function rankSources(perQuery: readonly SerpResult[][], limit: number): SearchSource[] {
  interface Tally {
    readonly result: SerpResult;
    appearances: number;
    bestPosition: number;
  }
  const byUrl = new Map<string, Tally>();
  for (const results of perQuery) {
    for (const r of results) {
      let key: string;
      try {
        const u = new URL(r.url);
        if (u.protocol !== 'https:' && u.protocol !== 'http:') continue;
        u.hash = '';
        key = u.toString();
      } catch {
        continue;
      }
      const existing = byUrl.get(key);
      if (existing) {
        existing.appearances += 1;
        existing.bestPosition = Math.min(existing.bestPosition, r.position);
      } else {
        byUrl.set(key, { result: r, appearances: 1, bestPosition: r.position });
      }
    }
  }
  return [...byUrl.entries()]
    .sort(
      ([, a], [, b]) => b.appearances - a.appearances || a.bestPosition - b.bestPosition,
    )
    .slice(0, limit)
    .map(([url, t]) => ({ url, title: t.result.title, snippet: t.result.snippet }));
}

/** Keyless deterministic sources — local dev / unit tests (same discipline
 * as the website handlers: the mock path is fully offline). */
function mockSources(question: string): SearchSource[] {
  return Array.from({ length: RESEARCH_SOURCE_COUNT }, (_, i) => ({
    url: `https://example.com/mock-source-${i + 1}`,
    title: `Mock source ${i + 1} (no SERPER_API_KEY)`,
    snippet: `Deterministic keyless result for: ${question.slice(0, 100)}`,
  }));
}

export const searcherHandler: CapabilityHandler = async (job, ctx) => {
  const question = (job.material ?? job.spec).trim();
  if (question.length === 0) throw new Error('searcher needs a research question');

  let sources: SearchSource[];
  if (!ctx.serperApiKey) {
    sources = mockSources(question);
  } else {
    // Query formulation is mini-class work; without an LLM key the question
    // itself is still an honest single query — the SERP stays real.
    let queries: string[];
    if (ctx.openaiApiKey) {
      const rawText = await chat({
        apiKey: ctx.openaiApiKey,
        system: QUERY_PROMPT,
        user: `RESEARCH QUESTION:\n${question}`,
        maxTokens: 300,
        json: true,
      });
      queries = parseQueries(rawText);
    } else {
      queries = [question];
    }

    const serperApiKey = ctx.serperApiKey;
    const perQuery = await Promise.all(queries.map((q) => serperSearch(q, { apiKey: serperApiKey })));
    sources = rankSources(perQuery, RESEARCH_SOURCE_COUNT);
    if (sources.length === 0) {
      throw new Error(`SERP returned zero usable sources for ${queries.length} queries`);
    }
  }

  const result: SearcherResult = { question, sources };
  return JSON.stringify(result);
};
