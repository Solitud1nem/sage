import { describe, it, expect } from 'vitest';
import type { PublicClient } from 'viem';

import { listActiveAgentsV2 } from '../src/agent-registry-v2.js';

const REGISTRY = '0x5e95F92FeEb4D46249DC3525C58596856029c661' as const;

function rawAgent(i: number, active = true) {
  return {
    owner: `0x${(i + 1).toString(16).padStart(40, '0')}` as `0x${string}`,
    endpoint: `https://agent-${i}.example`,
    profileUri: '',
    capabilities: [],
    registeredAt: 0n,
    active,
  };
}

/** Paged mock: `pages[i]` is returned for the i-th listAgents call. */
function pagedClient(pages: Array<{ agents: ReturnType<typeof rawAgent>[]; next: bigint }>) {
  let call = 0;
  return {
    async readContract() {
      const page = pages[Math.min(call, pages.length - 1)]!;
      call += 1;
      return [page.agents, page.next];
    },
    get calls() {
      return call;
    },
  } as unknown as PublicClient & { calls: number };
}

describe('listActiveAgentsV2 — maxAgents cap (CR.13)', () => {
  it('never returns more than maxAgents, even mid-page', async () => {
    const client = pagedClient([
      { agents: Array.from({ length: 50 }, (_, i) => rawAgent(i)), next: 50n },
      { agents: Array.from({ length: 50 }, (_, i) => rawAgent(50 + i)), next: 0n },
    ]);

    const result = await listActiveAgentsV2(client, REGISTRY, { maxAgents: 60 });

    // Pre-fix this returned 100: the while-guard only checked between pages.
    expect(result).toHaveLength(60);
  });

  it('returns everything when under the cap and stops at nextCursor 0', async () => {
    const client = pagedClient([
      { agents: Array.from({ length: 3 }, (_, i) => rawAgent(i)), next: 0n },
    ]);

    const result = await listActiveAgentsV2(client, REGISTRY, {});
    expect(result).toHaveLength(3);
  });

  it('skips inactive agents without counting them toward the cap', async () => {
    const client = pagedClient([
      {
        agents: [rawAgent(0), rawAgent(1, false), rawAgent(2), rawAgent(3)],
        next: 0n,
      },
    ]);

    const result = await listActiveAgentsV2(client, REGISTRY, { maxAgents: 3 });
    expect(result).toHaveLength(3);
    expect(result.map((a) => a.endpoint)).toEqual([
      'https://agent-0.example',
      'https://agent-2.example',
      'https://agent-3.example',
    ]);
  });
});
