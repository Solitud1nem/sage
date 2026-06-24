/**
 * Reputation client (M13.1.2). Fetches per-agent scores from the gateway's
 * reputation endpoint (backed by the M13.3 indexer), cached in-process so a
 * classify call doesn't round-trip every time. Best-effort by design: any
 * failure (unset URL, network, bad body) returns an empty map, and the
 * resolver falls back to cheapest-first — reputation can never break selection.
 */

let cache: { at: number; map: ReadonlyMap<string, number> } | null = null;
const TTL_MS = 60_000;

export async function fetchReputation(
  url: string | undefined,
  fetchImpl: typeof fetch = fetch,
): Promise<ReadonlyMap<string, number>> {
  if (!url) return new Map();
  const now = Date.now();
  if (cache && now - cache.at < TTL_MS) return cache.map;
  try {
    const res = await fetchImpl(url, { signal: AbortSignal.timeout(5_000) });
    if (!res.ok) return cache?.map ?? new Map();
    const data = (await res.json()) as { agents?: Array<{ address?: unknown; score?: unknown }> };
    const map = new Map<string, number>();
    for (const a of data.agents ?? []) {
      if (typeof a.address === 'string' && typeof a.score === 'number' && Number.isFinite(a.score)) {
        map.set(a.address.toLowerCase(), a.score);
      }
    }
    cache = { at: now, map };
    return map;
  } catch {
    return cache?.map ?? new Map();
  }
}

/** Test seam: clear the in-process cache. */
export function __resetReputationCache(): void {
  cache = null;
}
