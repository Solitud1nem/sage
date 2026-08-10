/**
 * Reputation indexer (M13.3, ADR-0023 §Layer 3.7).
 *
 * A scheduled job reads the TaskEscrow lifecycle events from chain into D1 —
 * one row per task (executor + latest terminal status + a disputed flag) — and
 * `getReputation()` aggregates them per executor into a [0,1] score. The
 * orchestrator uses that score to prefer better-behaved agents over the merely
 * cheapest one (M13.1.2), so a foreign agent that disputes or fails sinks in
 * the ranking.
 *
 * Dependency-free on purpose (the gateway is a lean CF Worker): raw
 * `eth_getLogs` + hand-decoded topics. taskId and executor are indexed
 * (topics[1] / topics[3]); only `TaskResolved.outcome` rides in `data`.
 */

import type { Env } from './index';

// keccak256(event signature). Recompute if the escrow ABI changes:
//   TaskCreated(uint256,address,address,uint256,uint64,string)
//   TaskPaid(uint256) / TaskDisputed(uint256,string) / TaskExpired(uint256)
//   TaskResolved(uint256,uint8,uint256,address)
const TOPIC = {
  created: '0x7407b0ef416b5ba5fe0caf5447bb4b7bbbd2adc61093638361dd31a28b14fc5c',
  paid: '0x357f3eae572babfa078658d7f9f741ecb1332b43f73f4fac3a67846cfd8355d4',
  disputed: '0x08824ea73fe0c710b8488bb1d0d50ab5b21b6019aa7eaebafbe0076e5f7ab945',
  resolved: '0x9e1d0a425505448e42bf1d9878d589bbefff724bbc2c881532fb9bcfd4856a04',
  expired: '0x7c2ecd5e2b7188ac57f3a370681639cb447c9cbfbbbace0c070adea6c73eaa54',
} as const;
const ALL_TOPICS = Object.values(TOPIC);

// TaskStatus enum (uint8) as emitted in TaskResolved.outcome. 3 = Paid (default).
const OUTCOME_REFUNDED = 5;
const OUTCOME_SPLIT = 7;

const DEFAULT_CHAIN = 'base';
/** Chains the endpoint will serve / the indexer may track. */
const KNOWN_CHAINS: ReadonlySet<string> = new Set(['base', 'arc', 'monad']);
const CHUNK_BLOCKS = 5_000n;
/** Bound a single cron invocation under the Worker subrequest cap. The budget is
 *  SHARED across chains (total chunks ≤ this), so adding a chain doesn't multiply
 *  subrequests; each backfill catches up over several runs, steady-state 1–2. */
const DEFAULT_MAX_CHUNKS = 45;

const SUCCESS_STATUS = new Set(['paid', 'resolved_paid', 'resolved_split']);
const FAILURE_STATUS = new Set(['refunded', 'resolved_refunded', 'expired']);

interface RpcLog {
  topics: string[];
  data: string;
  blockNumber: string;
  logIndex: string;
}

/** One chain the indexer tracks: its name, RPC endpoint, escrow, and backfill floor. */
interface ChainCfg {
  chain: string;
  rpcUrl: string;
  escrow: string;
  fromBlock: bigint;
  /** Per-chain eth_getLogs block-range cap. Defaults to CHUNK_BLOCKS; Monad's
   *  public RPCs reject ranges over 100 blocks (ADR-0026 recon §5). */
  chunkBlocks?: bigint;
}

/**
 * Build the chain list from env. Base reads through the Alchemy proxy URL; Arc
 * (per ADR-0015) reads its own public RPC. Each is opt-in — a chain only indexes
 * when both its RPC and escrow address are configured, so an unconfigured Arc is
 * simply skipped (Base-only, unchanged).
 */
function chainConfigs(env: Env): ChainCfg[] {
  const cfgs: ChainCfg[] = [];
  // BASE_INDEX_DISABLED — hibernation switch (ADR-0026): keeps the cron from
  // generating Alchemy traffic while Base prod sleeps. Reads stay served
  // from the frozen D1 rows.
  if (
    env.ESCROW_ADDRESS &&
    env.ALCHEMY_BASE_URL &&
    env.ALCHEMY_KEY &&
    env.BASE_INDEX_DISABLED !== 'true'
  ) {
    cfgs.push({
      chain: 'base',
      rpcUrl: `${env.ALCHEMY_BASE_URL}/${env.ALCHEMY_KEY}`,
      escrow: env.ESCROW_ADDRESS,
      fromBlock: BigInt(env.ESCROW_FROM_BLOCK || '0'),
    });
  }
  if (env.ARC_RPC_URL && env.ARC_ESCROW_ADDRESS) {
    cfgs.push({
      chain: 'arc',
      rpcUrl: env.ARC_RPC_URL,
      escrow: env.ARC_ESCROW_ADDRESS,
      fromBlock: BigInt(env.ARC_ESCROW_FROM_BLOCK || '0'),
    });
  }
  if (env.MONAD_RPC_URL && env.MONAD_ESCROW_ADDRESS) {
    cfgs.push({
      chain: 'monad',
      rpcUrl: env.MONAD_RPC_URL,
      escrow: env.MONAD_ESCROW_ADDRESS,
      fromBlock: BigInt(env.MONAD_ESCROW_FROM_BLOCK || '0'),
      // Monad public RPCs cap eth_getLogs at 100 blocks (~0.4s blocks); the
      // shared chunk budget still applies, so steady-state stays a few calls.
      chunkBlocks: 100n,
    });
  }
  return cfgs;
}

async function rpc(rpcUrl: string, method: string, params: unknown[]): Promise<unknown> {
  const res = await fetch(rpcUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
  const body = await res.json<{ result?: unknown; error?: { message?: string } }>();
  if (body.error) throw new Error(`${method}: ${body.error.message ?? 'rpc error'}`);
  return body.result;
}

function topicToAddress(topic: string): string {
  return `0x${topic.slice(26)}`.toLowerCase();
}

export interface ChainIndexResult {
  chain: string;
  indexed: number;
  fromBlock: number;
  toBlock: number;
  caughtUp: boolean;
  chunks: number;
  error?: string;
}

export interface IndexResult {
  indexed: number;
  chains: ChainIndexResult[];
}

/** Read new escrow events for one chain into D1, resuming from its cursor. */
async function indexChain(env: Env, cfg: ChainCfg, maxChunks: number): Promise<ChainIndexResult> {
  const cursor = await env.DB.prepare('SELECT last_block FROM index_cursor WHERE chain = ?')
    .bind(cfg.chain)
    .first<{ last_block: number }>();
  let from = cursor ? BigInt(cursor.last_block) + 1n : cfg.fromBlock;
  if (from < cfg.fromBlock) from = cfg.fromBlock;

  const latest = BigInt((await rpc(cfg.rpcUrl, 'eth_blockNumber', [])) as string);

  let indexed = 0;
  let chunks = 0;
  let lastTo = from > 0n ? from - 1n : 0n;
  const chunkBlocks = cfg.chunkBlocks ?? CHUNK_BLOCKS;
  while (from <= latest && chunks < maxChunks) {
    const to = from + chunkBlocks - 1n > latest ? latest : from + chunkBlocks - 1n;
    const logs =
      ((await rpc(cfg.rpcUrl, 'eth_getLogs', [
        {
          address: cfg.escrow,
          fromBlock: `0x${from.toString(16)}`,
          toBlock: `0x${to.toString(16)}`,
          topics: [ALL_TOPICS],
        },
      ])) as RpcLog[] | null) ?? [];

    logs.sort((a, b) => {
      const bd = Number(BigInt(a.blockNumber) - BigInt(b.blockNumber));
      return bd !== 0 ? bd : Number(BigInt(a.logIndex) - BigInt(b.logIndex));
    });

    const stmts: D1PreparedStatement[] = [];
    for (const lg of logs) {
      const t0 = lg.topics[0];
      if (!lg.topics[1]) continue;
      const taskId = BigInt(lg.topics[1]).toString();
      if (t0 === TOPIC.created) {
        if (!lg.topics[3]) continue;
        stmts.push(
          env.DB.prepare(
            `INSERT INTO task_index (chain, task_id, executor, status, disputed) VALUES (?, ?, ?, 'created', 0)
             ON CONFLICT(chain, task_id) DO UPDATE SET executor = excluded.executor`,
          ).bind(cfg.chain, taskId, topicToAddress(lg.topics[3])),
        );
      } else if (t0 === TOPIC.paid) {
        stmts.push(env.DB.prepare(`UPDATE task_index SET status = 'paid' WHERE chain = ? AND task_id = ?`).bind(cfg.chain, taskId));
      } else if (t0 === TOPIC.disputed) {
        stmts.push(env.DB.prepare(`UPDATE task_index SET disputed = 1 WHERE chain = ? AND task_id = ?`).bind(cfg.chain, taskId));
      } else if (t0 === TOPIC.expired) {
        stmts.push(env.DB.prepare(`UPDATE task_index SET status = 'expired' WHERE chain = ? AND task_id = ?`).bind(cfg.chain, taskId));
      } else if (t0 === TOPIC.resolved) {
        const outcome = Number(BigInt(`0x${lg.data.slice(2, 66) || '0'}`));
        const status =
          outcome === OUTCOME_REFUNDED ? 'resolved_refunded' : outcome === OUTCOME_SPLIT ? 'resolved_split' : 'resolved_paid';
        stmts.push(env.DB.prepare(`UPDATE task_index SET status = ?, disputed = 1 WHERE chain = ? AND task_id = ?`).bind(status, cfg.chain, taskId));
      }
    }
    stmts.push(
      env.DB.prepare(
        `INSERT INTO index_cursor (chain, last_block) VALUES (?, ?) ON CONFLICT(chain) DO UPDATE SET last_block = excluded.last_block`,
      ).bind(cfg.chain, Number(to)),
    );
    await env.DB.batch(stmts);

    indexed += logs.length;
    lastTo = to;
    from = to + 1n;
    chunks++;
  }
  return { chain: cfg.chain, indexed, fromBlock: Number(cfg.fromBlock), toBlock: Number(lastTo), caughtUp: from > latest, chunks };
}

/**
 * Read new escrow events into D1 across every configured chain, resuming from
 * each chain's cursor. The chunk budget is shared, and a single chain's RPC
 * failure is isolated (recorded, doesn't abort the others) so an Arc-testnet RPC
 * hiccup never stalls Base indexing.
 */
export async function indexReputation(env: Env, opts: { maxChunks?: number } = {}): Promise<IndexResult> {
  let remaining = opts.maxChunks ?? DEFAULT_MAX_CHUNKS;
  const chains: ChainIndexResult[] = [];
  let indexed = 0;
  for (const cfg of chainConfigs(env)) {
    if (remaining <= 0) {
      chains.push({ chain: cfg.chain, indexed: 0, fromBlock: Number(cfg.fromBlock), toBlock: 0, caughtUp: false, chunks: 0 });
      continue;
    }
    try {
      const r = await indexChain(env, cfg, remaining);
      chains.push(r);
      indexed += r.indexed;
      remaining -= r.chunks;
    } catch (err) {
      chains.push({
        chain: cfg.chain,
        indexed: 0,
        fromBlock: Number(cfg.fromBlock),
        toBlock: 0,
        caughtUp: false,
        chunks: 0,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return { indexed, chains };
}

export interface AgentReputation {
  address: string;
  total: number;
  success: number;
  failure: number;
  disputed: number;
  completionRate: number | null;
  disputeRate: number;
  score: number;
}

/** Aggregate one chain's per-task index into a per-executor reputation score. */
export async function getReputation(env: Env, chain: string = DEFAULT_CHAIN): Promise<AgentReputation[]> {
  const rows = await env.DB.prepare(`SELECT executor, status, disputed FROM task_index WHERE chain = ?`)
    .bind(chain)
    .all<{ executor: string; status: string; disputed: number }>();

  const agg = new Map<string, { total: number; success: number; failure: number; disputed: number }>();
  for (const r of rows.results ?? []) {
    const e = (r.executor || '').toLowerCase();
    if (!e) continue;
    const a = agg.get(e) ?? { total: 0, success: 0, failure: 0, disputed: 0 };
    a.total++;
    if (SUCCESS_STATUS.has(r.status)) a.success++;
    else if (FAILURE_STATUS.has(r.status)) a.failure++;
    if (r.disputed) a.disputed++;
    agg.set(e, a);
  }

  const out: AgentReputation[] = [];
  for (const [address, a] of agg) {
    const settled = a.success + a.failure;
    const completionRate = settled > 0 ? a.success / settled : null;
    const disputeRate = a.total > 0 ? a.disputed / a.total : 0;
    // Neutral (0.5) when there's no settled history — neither boosted nor
    // buried; otherwise completion rate, penalized for a high dispute rate.
    const score = settled === 0 ? 0.5 : Math.max(0, (completionRate ?? 0) * (1 - Math.min(0.5, disputeRate)));
    out.push({ address, total: a.total, success: a.success, failure: a.failure, disputed: a.disputed, completionRate, disputeRate, score });
  }
  out.sort((x, y) => y.score - x.score);
  return out;
}

/** GET /api/agents/reputation (public) + POST /api/agents/reindex (backend-key). */
export async function handleReputation(req: Request, env: Env): Promise<Response> {
  const url = new URL(req.url);

  if (url.pathname === '/api/agents/reindex' && req.method === 'POST') {
    if (!env.SAGE_BACKEND_KEY || req.headers.get('x-sage-backend') !== env.SAGE_BACKEND_KEY) {
      return jsonResponse(401, { error: 'unauthorized' });
    }
    try {
      return jsonResponse(200, await indexReputation(env));
    } catch (err) {
      return jsonResponse(502, { error: err instanceof Error ? err.message : 'index failed' });
    }
  }

  if (req.method !== 'GET') return jsonResponse(405, { error: 'method not allowed' });
  // `?chain=` selects which chain's index to read (ADR-0015 multi-chain). Default
  // base; an unknown value is rejected rather than silently served as base.
  const chain = url.searchParams.get('chain') ?? DEFAULT_CHAIN;
  if (!KNOWN_CHAINS.has(chain)) {
    return jsonResponse(400, { error: `unknown chain "${chain}"` });
  }
  try {
    return jsonResponse(
      200,
      { chain, agents: await getReputation(env, chain) },
      { 'cache-control': 'public, max-age=60' },
    );
  } catch (err) {
    return jsonResponse(502, { error: err instanceof Error ? err.message : 'read failed' });
  }
}

function jsonResponse(status: number, body: unknown, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...extra },
  });
}
