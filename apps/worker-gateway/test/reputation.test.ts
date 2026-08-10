/**
 * Reputation indexer (M13.3): event decode + enum mapping (indexReputation)
 * and per-executor scoring (getReputation). Fake D1 + stubbed fetch — no
 * miniflare; the SQL is asserted at the statement level.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';

import { getReputation, indexReputation } from '../src/reputation';
import type { Env } from '../src/index';

// keccak256(event signature) — must match src/reputation.ts.
const T = {
  created: '0x7407b0ef416b5ba5fe0caf5447bb4b7bbbd2adc61093638361dd31a28b14fc5c',
  paid: '0x357f3eae572babfa078658d7f9f741ecb1332b43f73f4fac3a67846cfd8355d4',
  disputed: '0x08824ea73fe0c710b8488bb1d0d50ab5b21b6019aa7eaebafbe0076e5f7ab945',
  resolved: '0x9e1d0a425505448e42bf1d9878d589bbefff724bbc2c881532fb9bcfd4856a04',
  expired: '0x7c2ecd5e2b7188ac57f3a370681639cb447c9cbfbbbace0c070adea6c73eaa54',
};

const tid = (n: number): string => `0x${n.toString(16).padStart(64, '0')}`;
const addrTopic = (a: string): string => `0x${'0'.repeat(24)}${a.slice(2)}`;
const u8 = (n: number): string => `0x${n.toString(16).padStart(64, '0')}`;

interface Stmt {
  sql: string;
  args: unknown[];
}

function fakeEnv(
  opts: { rows?: unknown[]; cursor?: number | null; arc?: boolean; monad?: boolean; baseDisabled?: boolean } = {},
): { env: Env; batched: Stmt[] } {
  const batched: Stmt[] = [];
  const DB = {
    prepare(sql: string) {
      return {
        bind(...args: unknown[]) {
          const stmt: Stmt = { sql, args };
          return {
            ...stmt,
            first: async () => (sql.includes('index_cursor') ? (opts.cursor == null ? null : { last_block: opts.cursor }) : null),
            all: async () => ({ results: opts.rows ?? [] }),
          };
        },
      };
    },
    batch: async (stmts: Stmt[]) => {
      batched.push(...stmts);
      return [];
    },
  };
  const env = {
    ALCHEMY_BASE_URL: 'https://rpc.example',
    ALCHEMY_KEY: 'k',
    ESCROW_ADDRESS: '0xescrow',
    ESCROW_FROM_BLOCK: '100',
    ...(opts.arc
      ? { ARC_RPC_URL: 'https://arc.example', ARC_ESCROW_ADDRESS: '0xarcescrow', ARC_ESCROW_FROM_BLOCK: '50' }
      : {}),
    ...(opts.monad
      ? { MONAD_RPC_URL: 'https://monad.example', MONAD_ESCROW_ADDRESS: '0xmonadescrow', MONAD_ESCROW_FROM_BLOCK: '1000' }
      : {}),
    ...(opts.baseDisabled ? { BASE_INDEX_DISABLED: 'true' } : {}),
    DB,
  } as unknown as Env;
  return { env, batched };
}

afterEach(() => vi.unstubAllGlobals());

describe('getReputation scoring', () => {
  it('scores success/failure/dispute and stays neutral with no settled data', async () => {
    const { env } = fakeEnv({
      rows: [
        { executor: '0xAAA', status: 'paid', disputed: 0 },
        { executor: '0xaaa', status: 'resolved_paid', disputed: 1 }, // case-folded to same agent
        { executor: '0xbbb', status: 'paid', disputed: 0 },
        { executor: '0xbbb', status: 'resolved_refunded', disputed: 1 },
        { executor: '0xccc', status: 'created', disputed: 0 },
      ],
    });
    const rep = await getReputation(env);
    const by = Object.fromEntries(rep.map((r) => [r.address, r]));

    // A: 2 successes, 0 failures → completion 1; disputed 1/2 → penalty 0.5 → score 0.5
    expect(by['0xaaa']!.success).toBe(2);
    expect(by['0xaaa']!.completionRate).toBe(1);
    expect(by['0xaaa']!.score).toBeCloseTo(0.5);
    // B: 1 success, 1 failure → completion 0.5
    expect(by['0xbbb']!.completionRate).toBe(0.5);
    // C: no settled outcomes → neutral
    expect(by['0xccc']!.completionRate).toBeNull();
    expect(by['0xccc']!.score).toBe(0.5);
    // sorted by score desc
    for (let i = 1; i < rep.length; i++) expect(rep[i - 1]!.score).toBeGreaterThanOrEqual(rep[i]!.score);
  });
});

describe('indexReputation decode + status mapping', () => {
  it('maps each event to the right write, decodes executor + outcome, advances cursor', async () => {
    const exec = '0x1111111111111111111111111111111111111111';
    const logs = [
      { topics: [T.created, tid(1), addrTopic('0x0000000000000000000000000000000000000009'), addrTopic(exec)], data: '0x', blockNumber: '0x65', logIndex: '0x0' },
      { topics: [T.paid, tid(1)], data: '0x', blockNumber: '0x66', logIndex: '0x0' },
      { topics: [T.disputed, tid(2)], data: '0x', blockNumber: '0x67', logIndex: '0x0' },
      { topics: [T.resolved, tid(2)], data: u8(5), blockNumber: '0x68', logIndex: '0x1' }, // outcome 5 = Refunded
      { topics: [T.expired, tid(3)], data: '0x', blockNumber: '0x69', logIndex: '0x0' },
    ];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init: { body: string }) => {
        const { method } = JSON.parse(init.body) as { method: string };
        const result = method === 'eth_blockNumber' ? '0x68' : logs; // latest beyond floor; one chunk
        return new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result }));
      }),
    );

    const { env, batched } = fakeEnv({ cursor: null });
    const out = await indexReputation(env, { maxChunks: 1 });
    expect(out.indexed).toBe(logs.length);

    const find = (needle: string) => batched.filter((s) => s.sql.includes(needle));

    // TaskCreated → insert with decoded executor (lowercased).
    const created = find('INSERT INTO task_index');
    expect(created).toHaveLength(1);
    expect(created[0]!.args).toEqual(['base', '1', exec.toLowerCase()]);
    // TaskPaid → status paid.
    expect(find("SET status = 'paid'")[0]!.args).toEqual(['base', '1']);
    // TaskDisputed → disputed flag only.
    expect(find('SET disputed = 1 WHERE')[0]!.args).toEqual(['base', '2']);
    // TaskResolved outcome 5 → resolved_refunded (+ disputed).
    const resolved = find('SET status = ?, disputed = 1');
    expect(resolved[0]!.args).toEqual(['resolved_refunded', 'base', '2']);
    // TaskExpired → expired.
    expect(find("SET status = 'expired'")[0]!.args).toEqual(['base', '3']);
    // cursor advanced to the chunk's toBlock.
    expect(find('INSERT INTO index_cursor')[0]!.args).toEqual(['base', 0x68]);
  });

  it('resumes from the stored cursor + 1', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init: { body: string }) => {
        const { method, params } = JSON.parse(init.body) as { method: string; params: Array<{ fromBlock: string }> };
        if (method === 'eth_getLogs') {
          // first chunk must start at cursor+1 = 0xc9 (201)
          expect(params[0]!.fromBlock).toBe('0xc9');
          return new Response(JSON.stringify({ result: [] }));
        }
        return new Response(JSON.stringify({ result: '0xca' }));
      }),
    );
    const { env } = fakeEnv({ cursor: 200 });
    await indexReputation(env, { maxChunks: 1 });
  });
});

describe('multi-chain indexing (Arc, ADR-0015)', () => {
  const exec = '0x2222222222222222222222222222222222222222';

  it('stays Base-only when Arc env is unset', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_u: string, init: { body: string }) => {
        const { method } = JSON.parse(init.body) as { method: string };
        return new Response(JSON.stringify({ result: method === 'eth_blockNumber' ? '0x66' : [] }));
      }),
    );
    const out = await indexReputation(fakeEnv({ cursor: null }).env, { maxChunks: 1 });
    expect(out.chains.map((c) => c.chain)).toEqual(['base']);
  });

  it('indexes Base and Arc when both configured, tagging each write per chain', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init: { body: string }) => {
        const { method } = JSON.parse(init.body) as { method: string };
        if (method === 'eth_blockNumber') return new Response(JSON.stringify({ result: '0x66' }));
        const onArc = url.includes('arc'); // ARC_RPC_URL contains "arc"; the Base URL doesn't
        const log = {
          topics: [T.created, tid(onArc ? 7 : 1), addrTopic('0x0000000000000000000000000000000000000009'), addrTopic(exec)],
          data: '0x',
          blockNumber: '0x64',
          logIndex: '0x0',
        };
        return new Response(JSON.stringify({ result: [log] }));
      }),
    );
    const { env, batched } = fakeEnv({ cursor: null, arc: true });
    const out = await indexReputation(env, { maxChunks: 2 });
    expect(out.chains.map((c) => c.chain).sort()).toEqual(['arc', 'base']);
    expect(out.indexed).toBe(2);
    const created = batched.filter((s) => s.sql.includes('INSERT INTO task_index'));
    expect(created.map((s) => s.args[0]).sort()).toEqual(['arc', 'base']);
    // Each chain's cursor advances under its own chain key.
    const cursors = batched.filter((s) => s.sql.includes('INSERT INTO index_cursor'));
    expect(cursors.map((s) => s.args[0]).sort()).toEqual(['arc', 'base']);
  });

  it('indexes Monad with ≤100-block getLogs chunks (ADR-0026)', async () => {
    const ranges: Array<{ from: bigint; to: bigint }> = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init: { body: string }) => {
        const { method, params } = JSON.parse(init.body) as {
          method: string;
          params: Array<{ fromBlock: string; toBlock: string }>;
        };
        if (method === 'eth_blockNumber') return new Response(JSON.stringify({ result: '0x5dc' })); // 1500
        if (url.includes('monad')) ranges.push({ from: BigInt(params[0]!.fromBlock), to: BigInt(params[0]!.toBlock) });
        return new Response(JSON.stringify({ result: [] }));
      }),
    );
    const out = await indexReputation(fakeEnv({ cursor: null, monad: true, baseDisabled: true }).env, {
      maxChunks: 3,
    });
    expect(out.chains.map((c) => c.chain)).toEqual(['monad']);
    expect(ranges.length).toBeGreaterThan(0);
    for (const r of ranges) expect(r.to - r.from + 1n).toBeLessThanOrEqual(100n);
    // fromBlock floor respected (MONAD_ESCROW_FROM_BLOCK = 1000).
    expect(ranges[0]!.from).toBe(1000n);
  });

  it('BASE_INDEX_DISABLED removes Base from the cron; other chains unaffected', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_u: string, init: { body: string }) => {
        const { method } = JSON.parse(init.body) as { method: string };
        return new Response(JSON.stringify({ result: method === 'eth_blockNumber' ? '0x66' : [] }));
      }),
    );
    const out = await indexReputation(fakeEnv({ cursor: null, arc: true, baseDisabled: true }).env, {
      maxChunks: 2,
    });
    expect(out.chains.map((c) => c.chain)).toEqual(['arc']);
  });

  it('isolates a chain RPC failure — Arc down, Base still indexes', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init: { body: string }) => {
        if (url.includes('arc')) throw new Error('arc rpc down');
        const { method } = JSON.parse(init.body) as { method: string };
        return new Response(JSON.stringify({ result: method === 'eth_blockNumber' ? '0x66' : [] }));
      }),
    );
    const out = await indexReputation(fakeEnv({ cursor: null, arc: true }).env, { maxChunks: 2 });
    expect(out.chains.find((c) => c.chain === 'arc')!.error).toContain('arc rpc down');
    expect(out.chains.find((c) => c.chain === 'base')!.error).toBeUndefined();
  });
});

describe('getReputation chain selection', () => {
  it('reads the requested chain (default base)', async () => {
    let bound: unknown;
    const DB = {
      prepare() {
        return {
          bind(...args: unknown[]) {
            bound = args[0];
            return { all: async () => ({ results: [] }) };
          },
        };
      },
    };
    const env = { DB } as unknown as Env;
    await getReputation(env, 'arc');
    expect(bound).toBe('arc');
    await getReputation(env, 'monad');
    expect(bound).toBe('monad');
    await getReputation(env);
    expect(bound).toBe('base');
  });
});
