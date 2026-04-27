# @sage/worker-gateway

Cloudflare Worker fronting the Sage demo backend. Per [ADR-0006](../../docs/adr/0006-web-integration-topology.md).

Two responsibilities:

1. **`/api/rpc`** — JSON-RPC proxy to Alchemy. Hides `ALCHEMY_KEY` from the client bundle.
2. **`/api/demo/*`** — Passthrough to the Fly.io orchestrator. Enforces **3 sponsored demo runs per IP per UTC day** via D1-backed counter. SSE `/stream/:id` is not rate-limited (clients can watch an already-started run to completion).

## Deploy

See [`docs/runbooks/deploy-cloudflare-worker.md`](../../docs/runbooks/deploy-cloudflare-worker.md) for the full procedure.

TL;DR:

```bash
# One-time: create D1 database, copy its id into wrangler.toml
wrangler d1 create sage-rate-limits
# → edit wrangler.toml [[d1_databases]] database_id = "<uuid>"

# Apply schema
pnpm --filter @sage/worker-gateway db:init

# Store Alchemy key as a secret (not committed)
wrangler secret put ALCHEMY_KEY

# Deploy
pnpm --filter @sage/worker-gateway deploy
```

## Local dev

```bash
pnpm --filter @sage/worker-gateway dev
# Worker runs on http://localhost:8787
```

`wrangler dev` spins up a local D1 and Miniflare runtime. Use `--local=false` to hit the real Cloudflare edge if needed.

## Env + secrets

| Var | Type | Source | Notes |
|---|---|---|---|
| `ORCHESTRATOR_URL` | var | wrangler.toml | Fly.io orchestrator base URL |
| `ALCHEMY_BASE_URL` | var | wrangler.toml | e.g. `https://base-mainnet.g.alchemy.com/v2` |
| `ALCHEMY_KEY` | **secret** | `wrangler secret put` | Alchemy API key; never commit |
| `DAILY_LIMIT` | var | wrangler.toml | Max `/api/demo/start` calls per IP per day |
| `ALLOWED_ORIGINS` | var | wrangler.toml | Comma-separated list of frontend origins |
| `DB` | D1 binding | wrangler.toml | Rate-limit counters |

## Observability

With `[observability]` enabled in wrangler.toml, all logs go to the Cloudflare dashboard. Tail locally:

```bash
wrangler tail
```
