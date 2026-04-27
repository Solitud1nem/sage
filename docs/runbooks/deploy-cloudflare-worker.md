# Runbook: Deploy `apps/worker-gateway` to Cloudflare

Per [ADR-0006](../adr/0006-web-integration-topology.md). Hides Alchemy RPC key and rate-limits the sponsored demo endpoint.

## Pre-flight checklist

- [ ] Cloudflare account + authenticated CLI: `wrangler login`.
- [ ] Domain `sage.xyz` (or placeholder) added to Cloudflare. For first deploys you can skip the custom domain — Cloudflare gives you `<name>.<account>.workers.dev`.
- [ ] Alchemy account + Base API key (free tier).
- [ ] Orchestrator deployed to Fly.io and `ORCHESTRATOR_URL` matches the live URL.

## 1. Create the D1 database (one-time)

```bash
cd apps/worker-gateway
wrangler d1 create sage-rate-limits
# → output includes a `database_id = "..."` block. Copy it into wrangler.toml.
```

Edit `wrangler.toml`:

```toml
[[d1_databases]]
binding = "DB"
database_name = "sage-rate-limits"
database_id = "<PASTE_HERE>"
```

Apply the schema:

```bash
pnpm --filter @sage/worker-gateway db:init
# → creates the rate_limits table.
```

## 2. Set the Alchemy secret

```bash
wrangler secret put ALCHEMY_KEY
# → pastes the key when prompted (not stored in repo).
```

## 3. Adjust vars

In `wrangler.toml` confirm:

- `ORCHESTRATOR_URL` — live Fly.io URL (e.g. `https://sage-demo-agents.fly.dev`).
- `ALCHEMY_BASE_URL` — `https://base-mainnet.g.alchemy.com/v2` for mainnet.
- `DAILY_LIMIT` — default `3`. Tighten if abuse is observed.
- `ALLOWED_ORIGINS` — comma-separated list. Include your Cloudflare Pages preview URL pattern plus production domain.

If you don't yet have a custom domain, **remove** the `[[routes]]` block and Cloudflare will default to `sage-gateway.<account>.workers.dev`.

## 4. Deploy

```bash
pnpm --filter @sage/worker-gateway deploy
```

Output shows the public URL.

## 5. Verify

```bash
# Health passthrough
curl https://sage-gateway.<account>.workers.dev/health
# → { "status": "ok", ..., "sponsor": { "accepting": true, ... } }

# RPC proxy (example — eth_blockNumber)
curl -X POST https://sage-gateway.<account>.workers.dev/api/rpc \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"eth_blockNumber","params":[]}'

# Rate-limit behavior — 4th POST/day from the same IP returns 429.
for i in 1 2 3 4; do
  curl -X POST https://sage-gateway.<account>.workers.dev/api/demo/start \
    -H 'Content-Type: application/json' -H 'Origin: https://sage.xyz' \
    -d '{"text":"test"}' -i
done
```

Check the 4th request:

```
HTTP/1.1 429 Too Many Requests
Retry-After: 48321
X-RateLimit-Limit: 3
X-RateLimit-Remaining: 0
X-RateLimit-Reset: 1819324800
```

## 6. Point the frontend

In Cloudflare Pages (the `@sage/web` app), set:

```
NEXT_PUBLIC_ORCHESTRATOR_URL=https://sage-gateway.<account>.workers.dev
NEXT_PUBLIC_RPC_URL=https://sage-gateway.<account>.workers.dev/api/rpc
```

Redeploy the Pages project.

## 7. Operational

### Tail logs

```bash
wrangler tail
```

### Inspect rate-limit counters

```bash
wrangler d1 execute sage-rate-limits \
  --command 'SELECT key, count, datetime(created_at, "unixepoch") FROM rate_limits ORDER BY created_at DESC LIMIT 20;'
```

### Manually reset an IP (support)

```bash
wrangler d1 execute sage-rate-limits \
  --command "DELETE FROM rate_limits WHERE key LIKE 'demo_start:203.0.113.42:%';"
```

### GC old rows (run weekly)

```bash
wrangler d1 execute sage-rate-limits \
  --command "DELETE FROM rate_limits WHERE created_at < $(date -d '7 days ago' +%s);"
```

### Raise/lower the daily limit

Edit `DAILY_LIMIT` in `wrangler.toml` + redeploy. Applies immediately — new requests use the new value; existing counters keep accruing against the new threshold.

## 8. Rollback

```bash
wrangler deployments list
wrangler rollback [deployment-id]
```

D1 schema migrations are additive-only here (just one table). No rollback risk.

## Common failure modes

| Symptom | Cause | Fix |
|---|---|---|
| `500 RPC proxy misconfigured` | `ALCHEMY_KEY` secret missing | `wrangler secret put ALCHEMY_KEY` |
| `429` on very first request of the day | Clock skew between Worker and expected UTC midnight | Verify via `wrangler d1 execute` that the `created_at` column is sensible; usually resolves on its own within a minute |
| `502 orchestrator_unreachable` | Fly.io app down or URL wrong | `fly status` + double-check `ORCHESTRATOR_URL` |
| CORS errors in browser | Frontend origin not in `ALLOWED_ORIGINS` | Update wrangler.toml + redeploy |
| SSE stream breaks after 60s | Cloudflare flush/buffering | Check that upstream sets `X-Accel-Buffering: no` (orchestrator already does via `SseChannel`) |
