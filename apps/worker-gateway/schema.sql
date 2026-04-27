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
