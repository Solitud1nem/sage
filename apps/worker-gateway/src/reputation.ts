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

const CHAIN = 'base';
const CHUNK_BLOCKS = 5_000n;
/** Bound a single cron invocation under the Worker subrequest cap; the first
 *  backfill catches up over several runs, steady-state is 1–2 chunks. */
const DEFAULT_MAX_CHUNKS = 45;

const SUCCESS_STATUS = new Set(['paid', 'resolved_paid', 'resolved_split']);
const FAILURE_STATUS = new Set(['refunded', 'resolved_refunded', 'expired']);

interface RpcLog {
  topics: string[];
  data: string;
  blockNumber: string;
  logIndex: string;
}

async function rpc(env: Env, method: string, params: unknown[]): Promise<unknown> {
  if (!env.ALCHEMY_KEY) throw new Error('ALCHEMY_KEY unset');
  const res = await fetch(`${env.ALCHEMY_BASE_URL}/${env.ALCHEMY_KEY}`, {
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

export interface IndexResult {
  indexed: number;
  fromBlock: number;
  toBlock: number;
  caughtUp: boolean;
}

/** Read new escrow events into D1, resuming from the stored cursor. */
export async function indexReputation(env: Env, opts: { maxChunks?: number } = {}): Promise<IndexResult> {
  const escrow = env.ESCROW_ADDRESS;
  if (!escrow) return { indexed: 0, fromBlock: 0, toBlock: 0, caughtUp: true };
  const floor = BigInt(env.ESCROW_FROM_BLOCK || '0');

  const cursor = await env.DB.prepare('SELECT last_block FROM index_cursor WHERE chain = ?')
    .bind(CHAIN)
    .first<{ last_block: number }>();
  let from = cursor ? BigInt(cursor.last_block) + 1n : floor;
  if (from < floor) from = floor;

  const latest = BigInt((await rpc(env, 'eth_blockNumber', [])) as string);
  const maxChunks = opts.maxChunks ?? DEFAULT_MAX_CHUNKS;

  let indexed = 0;
  let chunks = 0;
  let lastTo = from > 0n ? from - 1n : 0n;
  while (from <= latest && chunks < maxChunks) {
    const to = from + CHUNK_BLOCKS - 1n > latest ? latest : from + CHUNK_BLOCKS - 1n;
    const logs =
      ((await rpc(env, 'eth_getLogs', [
        {
          address: escrow,
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
          ).bind(CHAIN, taskId, topicToAddress(lg.topics[3])),
        );
      } else if (t0 === TOPIC.paid) {
        stmts.push(env.DB.prepare(`UPDATE task_index SET status = 'paid' WHERE chain = ? AND task_id = ?`).bind(CHAIN, taskId));
      } else if (t0 === TOPIC.disputed) {
        stmts.push(env.DB.prepare(`UPDATE task_index SET disputed = 1 WHERE chain = ? AND task_id = ?`).bind(CHAIN, taskId));
      } else if (t0 === TOPIC.expired) {
        stmts.push(env.DB.prepare(`UPDATE task_index SET status = 'expired' WHERE chain = ? AND task_id = ?`).bind(CHAIN, taskId));
      } else if (t0 === TOPIC.resolved) {
        const outcome = Number(BigInt(`0x${lg.data.slice(2, 66) || '0'}`));
        const status =
          outcome === OUTCOME_REFUNDED ? 'resolved_refunded' : outcome === OUTCOME_SPLIT ? 'resolved_split' : 'resolved_paid';
        stmts.push(env.DB.prepare(`UPDATE task_index SET status = ?, disputed = 1 WHERE chain = ? AND task_id = ?`).bind(status, CHAIN, taskId));
      }
    }
    stmts.push(
      env.DB.prepare(
        `INSERT INTO index_cursor (chain, last_block) VALUES (?, ?) ON CONFLICT(chain) DO UPDATE SET last_block = excluded.last_block`,
      ).bind(CHAIN, Number(to)),
    );
    await env.DB.batch(stmts);

    indexed += logs.length;
    lastTo = to;
    from = to + 1n;
    chunks++;
  }
  return { indexed, fromBlock: Number(floor), toBlock: Number(lastTo), caughtUp: from > latest };
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

/** Aggregate the per-task index into a per-executor reputation score. */
export async function getReputation(env: Env): Promise<AgentReputation[]> {
  const rows = await env.DB.prepare(`SELECT executor, status, disputed FROM task_index WHERE chain = ?`)
    .bind(CHAIN)
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
  try {
    return jsonResponse(200, { agents: await getReputation(env) }, { 'cache-control': 'public, max-age=60' });
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
