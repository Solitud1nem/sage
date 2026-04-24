# Runbook: Deploy demo-agents to Fly.io

Three-process Fly app (`sage-demo-agents`) running orchestrator + summarizer + translator. Per [ADR-0006](../adr/0006-web-integration-topology.md).

## Pre-flight checklist

- [ ] `flyctl` installed locally (`brew install flyctl` or [install docs](https://fly.io/docs/hands-on/install-flyctl/)).
- [ ] Fly account authenticated: `fly auth login`.
- [ ] Three funded EOAs on Base mainnet:
  - Orchestrator sponsor wallet — ≥ $20 USDC (per ADR-0006), plus small ETH for gas.
  - Summarizer wallet — registered in AgentRegistry, small ETH for gas.
  - Translator wallet — registered in AgentRegistry, small ETH for gas.
- [ ] Both worker agents registered on `AgentRegistry` with their HTTPS/IPFS endpoints.
- [ ] `OPENAI_API_KEY` (gpt-4o-mini tier fine).
- [ ] Repo on a clean branch; `pnpm --filter @sage/demo-agents build` passes locally.

## First deploy

```bash
# From repo root.
cd apps/demo-agents

# 1. Create the Fly app (no deploy yet).
fly launch --no-deploy --name sage-demo-agents --region iad

# 2. Set secrets (three EOAs + OpenAI).
fly secrets set \
  PRIVATE_KEY=0x<orchestrator_key> \
  SUMMARIZER_PRIVATE_KEY=0x<summarizer_key> \
  TRANSLATOR_PRIVATE_KEY=0x<translator_key> \
  OPENAI_API_KEY=<openai_key> \
  SUMMARIZER_ADDRESS=0x<summarizer_addr> \
  TRANSLATOR_ADDRESS=0x<translator_addr> \
  RPC_URL=https://base-mainnet.g.alchemy.com/v2/<alchemy_key>

# 3. Deploy.
fly deploy
```

Expected: three machines spin up (one per process), orchestrator gets a public URL like `https://sage-demo-agents.fly.dev`.

## Verification

```bash
# Health check.
curl https://sage-demo-agents.fly.dev/health
# → { "status": "ok", "agent": "Orchestrator", "activeDemoRuns": 0 }

# Kick off a demo run (use a small test prompt).
curl -X POST https://sage-demo-agents.fly.dev/api/demo/start \
  -H 'Content-Type: application/json' \
  -H 'Origin: https://sage.xyz' \
  -d '{"text":"Agents are autonomous economic actors now."}'
# → { "demoRunId": "uuid", "streamUrl": "/api/demo/stream/uuid" }

# Stream the lifecycle (leave running for ~30s).
curl -N https://sage-demo-agents.fly.dev/api/demo/stream/<uuid>
# → id: 1
#   event: run_started
#   data: { "demoRunId": "...", "startedAt": 1766... }
#   ...
```

Should see events in order: `run_started → stage_started(summarize) → task_created → task_accepted → task_completed → task_paid → stage_started(translate) → ... → done`.

Check that two real transactions landed on Base mainnet:

```bash
# Replace with real tx hashes from the stream.
cast tx 0x<hash> --rpc-url https://mainnet.base.org
```

## Log monitoring

```bash
fly logs                      # tail all processes
fly logs -i <machine_id>      # one machine
fly logs --no-tail --first    # post-mortem
```

## Scale / resize

```bash
# Scale to two orchestrator instances (for failover).
fly scale count orchestrator=2

# Upgrade RAM on the orchestrator (SSE holds open connections).
fly scale memory 1024 -g orchestrator
```

## Sponsor wallet monitoring

> M-INT.7 adds automated balance monitoring. Until then, check manually weekly.

```bash
# Query USDC balance of orchestrator EOA on Base.
cast call 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913 \
  "balanceOf(address)(uint256)" \
  <orchestrator_addr> \
  --rpc-url https://mainnet.base.org
```

Divide by `1e6` for USDC amount. Top up via any Base-USDC transfer when below $5.

## Rollback

```bash
# List recent releases.
fly releases

# Roll back to release N.
fly releases rollback N
```

Immutable contracts → deployment rollback is **only for the off-chain orchestrator**. On-chain tasks that landed during a bad release stay on-chain; clean them up via `refundExpired()` after deadline expires.

## Rotate deployer / agent keys

1. Generate new EOA with `cast wallet new`.
2. Fund new EOA (ETH + USDC).
3. If it's a worker, register new address on `AgentRegistry` via `cast send`.
4. Update Fly secret:
   ```bash
   fly secrets set PRIVATE_KEY=0x<new_key>
   ```
   Fly rolls machines automatically.
5. Burn old EOA (send remaining balance to treasury).

## Common failure modes

| Symptom | Likely cause | Fix |
|---|---|---|
| `/health` returns `activeDemoRuns` stuck at N > 0 after idle | SSE clients disconnected without triggering GC | Restart via `fly machine restart <id>` — channels auto-expire after 5min |
| `task timed out after 120_000ms` | Worker agent offline or out of gas | Check worker logs (`fly logs -g summarizer`) |
| CORS error in browser console | Frontend origin not in `ALLOWED_ORIGINS` | Update via `fly secrets set ALLOWED_ORIGINS=...` and redeploy |
| `Missing required env var: PRIVATE_KEY` on boot | Secret not set or misspelled | Re-run `fly secrets set` and check `fly secrets list` |
| 503 on demo start | (Planned M-INT.7) sponsor balance below threshold | Top up USDC, or bypass temporarily by unsetting `SPONSOR_MIN_BALANCE_USDC` |
