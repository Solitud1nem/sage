/**
 * Reputation client (M13.1.2 / M13.2.4). Fetches per-agent reputation from the
 * gateway's endpoint (backed by the M13.3 indexer), cached in-process so a
 * classify/execute call doesn't round-trip every time. One cached fetch feeds
 * two views: a score map (best-rep selection) and a proven-agent set
 * (quarantine). Best-effort by design — any failure returns the last cache or
 * empty, so reputation can never break selection or wrongly quarantine.
 */

interface AgentRep {
  address: string;
  score: number;
  total: number;
}

let cache: { at: number; agents: AgentRep[] } | null = null;
const TTL_MS = 60_000;

async function load(url: string | undefined, fetchImpl: typeof fetch): Promise<AgentRep[]> {
  if (!url) return [];
  const now = Date.now();
  if (cache && now - cache.at < TTL_MS) return cache.agents;
  try {
    const res = await fetchImpl(url, { signal: AbortSignal.timeout(5_000) });
    if (!res.ok) return cache?.agents ?? [];
    const data = (await res.json()) as { agents?: Array<{ address?: unknown; score?: unknown; total?: unknown }> };
    const agents: AgentRep[] = [];
    for (const a of data.agents ?? []) {
      if (typeof a.address === 'string' && typeof a.score === 'number' && Number.isFinite(a.score)) {
        agents.push({
          address: a.address.toLowerCase(),
          score: a.score,
          total: typeof a.total === 'number' && Number.isFinite(a.total) ? a.total : 0,
        });
      }
    }
    cache = { at: now, agents };
    return agents;
  } catch {
    return cache?.agents ?? [];
  }
}

/** Address → reputation score in [0,1] (M13.1.2 best-rep selection). */
export async function fetchReputationScores(
  url: string | undefined,
  fetchImpl: typeof fetch = fetch,
): Promise<ReadonlyMap<string, number>> {
  return new Map((await load(url, fetchImpl)).map((a) => [a.address, a.score]));
}

/** Lowercased addresses with at least `minTasks` settled tasks — "proven"
 *  agents that are exempt from the quarantine value ceiling (M13.2.4). */
export async function fetchProvenAgents(
  url: string | undefined,
  minTasks: number,
  fetchImpl: typeof fetch = fetch,
): Promise<ReadonlySet<string>> {
  return new Set((await load(url, fetchImpl)).filter((a) => a.total >= minTasks).map((a) => a.address));
}

/** Test seam: clear the in-process cache. */
export function __resetReputationCache(): void {
  cache = null;
}
