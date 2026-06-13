/**
 * Minimal Serper.dev client (M12.2.1 — provider choice fixed by Alex
 * 2026-06-12: real Google SERP, cheapest per query; see
 * docs/research/pipeline-economics.md §1).
 *
 * Same throw-semantics as the sibling LLM clients (`llm.ts`,
 * `shared/anthropic.ts`): any API/HTTP/shape failure THROWS and the
 * executor's retry machinery deals with it.
 */

const SERPER_ENDPOINT = 'https://google.serper.dev/search';

export interface SerpResult {
  readonly url: string;
  readonly title: string;
  readonly snippet: string;
  /** 1-based rank within its query's organic results. */
  readonly position: number;
}

export interface SerperSearchOptions {
  readonly apiKey: string;
  /** Organic results to request per query. Default 10. */
  readonly num?: number;
  /** Test seam. */
  readonly fetchImpl?: typeof fetch;
}

export async function serperSearch(query: string, opts: SerperSearchOptions): Promise<SerpResult[]> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const res = await fetchImpl(SERPER_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-API-KEY': opts.apiKey,
    },
    body: JSON.stringify({ q: query, num: opts.num ?? 10 }),
  });

  const data = (await res.json().catch(() => null)) as {
    organic?: Array<{ link?: unknown; title?: unknown; snippet?: unknown; position?: unknown }>;
    message?: string;
  } | null;
  if (!res.ok) {
    throw new Error(`Serper error: ${data?.message ?? `HTTP ${res.status}`}`);
  }
  if (!Array.isArray(data?.organic)) {
    throw new Error('Serper returned no organic results array');
  }

  const out: SerpResult[] = [];
  for (const [i, r] of data.organic.entries()) {
    if (typeof r?.link !== 'string' || typeof r?.title !== 'string') continue;
    out.push({
      url: r.link,
      title: r.title,
      snippet: typeof r.snippet === 'string' ? r.snippet : '',
      position: typeof r.position === 'number' ? r.position : i + 1,
    });
  }
  return out;
}
