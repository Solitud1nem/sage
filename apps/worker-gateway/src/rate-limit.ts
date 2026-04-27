import type { Env } from './index';

/**
 * D1-backed daily rate limiter.
 *
 * Key format: `<action>:<ip>:<yyyy-mm-dd-utc>` — naturally rolls over at UTC
 * midnight. Old rows aren't auto-GC'd inline; a cron Worker (optional) can
 * `DELETE FROM rate_limits WHERE created_at < ?` to keep the table small.
 */

export interface RateLimitResult {
  ok: boolean;
  count: number;
  limit: number;
  remaining: number;
  /** Unix seconds at which the counter resets (next UTC midnight). */
  resetAt: number;
}

export async function checkDailyRateLimit(
  env: Env,
  action: string,
  ip: string,
): Promise<RateLimitResult> {
  const limit = Number.parseInt(env.DAILY_LIMIT, 10) || 3;
  const day = utcDay();
  const key = `${action}:${ip}:${day}`;
  const now = Math.floor(Date.now() / 1000);

  // UPSERT and read the new count. D1 supports SQLite ON CONFLICT.
  const row = await env.DB.prepare(
    `INSERT INTO rate_limits (key, count, created_at) VALUES (?, 1, ?)
     ON CONFLICT(key) DO UPDATE SET count = count + 1
     RETURNING count`,
  )
    .bind(key, now)
    .first<{ count: number }>();

  const count = row?.count ?? 1;
  return {
    ok: count <= limit,
    count,
    limit,
    remaining: Math.max(0, limit - count),
    resetAt: nextUtcMidnight(),
  };
}

function utcDay(): string {
  const d = new Date();
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

function nextUtcMidnight(): number {
  const d = new Date();
  return Math.floor(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1, 0, 0, 0) / 1000,
  );
}

function pad(n: number): string {
  return n.toString().padStart(2, '0');
}
