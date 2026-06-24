-- Rate limiter counters (daily, per IP, per action).
-- Key format: "<action>:<ip>:<utc-date>"  e.g. "demo_start:203.0.113.42:2026-04-23"
-- GC: rows with created_at older than 7 days are deleted by the daily cron
-- (see src/cron.ts — added in a follow-up if needed; manual delete works for now).

CREATE TABLE IF NOT EXISTS rate_limits (
  key          TEXT PRIMARY KEY,
  count        INTEGER NOT NULL DEFAULT 0,
  created_at   INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_rl_created ON rate_limits (created_at);

-- Reputation indexer (M13.3, ADR-0023 §Layer 3.7). One row per escrow task:
-- the executor + the latest terminal status + whether it was ever disputed.
-- `getReputation()` aggregates these per executor into a [0,1] score.
-- status ∈ created | paid | expired | resolved_paid | resolved_refunded | resolved_split
CREATE TABLE IF NOT EXISTS task_index (
  chain      TEXT NOT NULL,
  task_id    TEXT NOT NULL,
  executor   TEXT NOT NULL,
  status     TEXT NOT NULL DEFAULT 'created',
  disputed   INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (chain, task_id)
);

CREATE INDEX IF NOT EXISTS idx_task_executor ON task_index (chain, executor);

-- Last block the indexer has processed, per chain. The scheduled job resumes
-- from last_block + 1.
CREATE TABLE IF NOT EXISTS index_cursor (
  chain      TEXT PRIMARY KEY,
  last_block INTEGER NOT NULL
);
