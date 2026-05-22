# Deploy Sage demo-agents on Arc testnet (separate Fly app)

Per [ADR-0015](../adr/0015-arc-deploy-bridge.md). Sets up
`sage-demo-agents-arc` as a sibling Fly app to the existing
`sage-demo-agents` (Base mainnet). Same image, same 5 processes, different
env (`CHAIN_ID=5042002`, Arc RPC). Topology choice rationale: production
isolation — an Arc-path bug can't take down Base mainnet — and no
per-chain dual-paths in `orchestrator/server.ts`.

Audience: maintainer with `fly auth` configured locally and access to the
sponsor + worker EOAs private keys.

## Pre-deploy: faucet 4 worker EOAs on Arc

Worker EOAs need ~20 USDC each on Arc to cover `acceptTask` /
`completeTask` gas (paid in USDC on Arc — see ADR-0015) across ~100 task
lifecycles. Sponsor was faucet'd during the contract deploy step; these
four are still empty.

| Wallet | Address | Faucet to | Why |
|--------|---------|-----------|-----|
| Summarizer | `0x0DA5892C26222fF2992BEe22613d1f9C06a92593` | 20 USDC | Acceptance + completion txs. |
| Translator | `0xa61bd5efa704805B08970C34Cd639fA5D6Ce1c8c` | 20 USDC | Same. |
| Sentiment | `0x5218857Ef2631e0AC35fA8062671785954e918B5` | 20 USDC | Same. |
| Vision | `0xB889a7aAe3F9a5DC1CAC68459bc5e3118D9863Fb` | 20 USDC | Same. |

Faucet URL: <https://faucet.circle.com> → select Arc testnet → paste
address → drip. Same EOAs as Base per ADR-0002 single-EOA policy.

Verify with `cast`:

```bash
ARC_RPC="https://rpc.testnet.arc.network"
USDC="0x3600000000000000000000000000000000000000"
for ADDR in \
  0x0DA5892C26222fF2992BEe22613d1f9C06a92593 \
  0xa61bd5efa704805B08970C34Cd639fA5D6Ce1c8c \
  0x5218857Ef2631e0AC35fA8062671785954e918B5 \
  0xB889a7aAe3F9a5DC1CAC68459bc5e3118D9863Fb; do
  echo "$ADDR:"
  cast call --rpc-url "$ARC_RPC" "$USDC" "balanceOf(address)(uint256)" "$ADDR"
done
# Expect ~20_000_000 per address (20 USDC at 6-decimals ERC-20)
```

## Step 1 — Create Fly app

```bash
fly apps create sage-demo-agents-arc --org personal
```

DNS goes live as `sage-demo-agents-arc.fly.dev` once the first deploy
lands.

## Step 2 — Set secrets

Same EOAs as Base (single-EOA policy). Worker `SAGE_BACKEND_KEY` is
intentionally NOT set — Arc app talks to Arc public RPC directly, no
Cloudflare Worker proxy in the path.

```bash
fly secrets set --app sage-demo-agents-arc \
  PRIVATE_KEY=0x...                                  \
  SPONSOR_ADDRESS=0x6D8aCa48c1E064e71078656f7fB946e52cd8376d \
  SUMMARIZER_PRIVATE_KEY=0x...                       \
  SUMMARIZER_ADDRESS=0x0DA5892C26222fF2992BEe22613d1f9C06a92593 \
  TRANSLATOR_PRIVATE_KEY=0x...                       \
  TRANSLATOR_ADDRESS=0xa61bd5efa704805B08970C34Cd639fA5D6Ce1c8c \
  SENTIMENT_PRIVATE_KEY=0x...                        \
  SENTIMENT_ADDRESS=0x5218857Ef2631e0AC35fA8062671785954e918B5 \
  VISION_PRIVATE_KEY=0x...                           \
  VISION_ADDRESS=0xB889a7aAe3F9a5DC1CAC68459bc5e3118D9863Fb \
  OPENAI_API_KEY=sk-...                              \
  SPONSOR_MIN_BALANCE_USDC=1000000
```

`SPONSOR_MIN_BALANCE_USDC=1000000` is 1 USDC in base units (6 decimals).
The literal value `=1` would parse as 0.000001 USDC and effectively
disable the guard — see GOTCHAS 2026-04-29.

Sanity-check the set:

```bash
fly secrets list --app sage-demo-agents-arc
# Expected: 11 secrets above. Order doesn't matter.
```

## Step 3 — Deploy

From the repo root (Dockerfile expects monorepo context, see GOTCHAS
2026-04-29 entry on `.dockerignore`):

```bash
fly deploy . \
  --app sage-demo-agents-arc \
  --config apps/demo-agents/fly.arc.toml \
  --dockerfile apps/demo-agents/Dockerfile
```

Expected: builder image ~73 MB, 5 machines come up in `iad`
(orchestrator x2 HA + 1 each of summarizer / translator / vision /
sentiment, plus standby copies as Fly schedules). Rolling strategy
means the first orchestrator machine accepting health checks unblocks
the deploy.

## Step 4 — Verify /health

```bash
curl -s https://sage-demo-agents-arc.fly.dev/health | jq
```

Expected shape:

```json
{
  "ok": true,
  "chainId": 5042002,
  "chainDisplayName": "Arc Testnet",
  "explorerUrl": "https://testnet.arcscan.app",
  "sponsor": {
    "address": "0x6D8aCa48c1E064e71078656f7fB946e52cd8376d",
    "balanceUsdc": "19.96...",
    "minBalanceUsdc": "1.000",
    "accepting": true
  }
}
```

If `chainId: 0` — orchestrator boot is still in flight, retry in ~1s.
If it stays at 0 after 30s, check `fly logs --app sage-demo-agents-arc`
— likely RPC URL is wrong or unreachable, or the EOAs aren't funded.

## Step 5 — Wire worker-gateway

The Cloudflare Worker proxy needs to route `?chain=arc` traffic to the
new app. Code changes ship via `wrangler deploy`; the value is stored
as a `[vars]` entry in `wrangler.toml`:

```bash
cd apps/worker-gateway
# wrangler.toml already declares ORCHESTRATOR_URL_ARC — verify:
grep ORCHESTRATOR_URL_ARC wrangler.toml
# Expected: ORCHESTRATOR_URL_ARC = "https://sage-demo-agents-arc.fly.dev"

pnpm run deploy   # or: npx wrangler deploy
```

Smoke the routing without going through the frontend:

```bash
# Base path — should hit sage-demo-agents.fly.dev (existing behaviour)
curl -s "https://sage-gateway.a-t-somnia.workers.dev/health" | jq .chainId
# Expected: 8453

# Arc path — should hit sage-demo-agents-arc.fly.dev
curl -s "https://sage-gateway.a-t-somnia.workers.dev/health?chain=arc" | jq .chainId
# Expected: 5042002
```

## Step 6 — Frontend deploy

Push the chain-picker + URL-state changes; Pages auto-deploys on the
canonical alias. Once live, navigate to:

```
https://sage-protocol.pages.dev/demo/composite?chain=arc
```

Submit a composite brief, approve the plan, watch the graph fill in.
Tx links in the per-node drawer should point at
`https://testnet.arcscan.app/tx/...`. Run-header should read
"on Arc Testnet".

## Rollback

If Arc traffic misbehaves, the path-of-least-damage is:

1. Worker gateway: clear `ORCHESTRATOR_URL_ARC` or set it back to the
   Base orchestrator. `?chain=arc` requests will hit Base, returning
   `chainId: 8453` which the frontend will surface as a chain-mismatch
   error in the run-header (better than a crashed run on Arc).
2. Arc Fly app: `fly scale count 0 --app sage-demo-agents-arc` stops
   all machines without deleting the app. Resume with
   `fly scale count 1 --app sage-demo-agents-arc`.
3. Full teardown (if Arc is being permanently retired in favour of the
   native-wrap path per ADR-0014 migration trigger):
   `fly apps destroy sage-demo-agents-arc`. Deployed contracts stay
   live (per ADR-0015 maintenance commitment) so any in-flight tasks
   finish.

## Common failure modes

- **`/health` returns `chainId: 0` for >30s.** Orchestrator can't reach
  `https://rpc.testnet.arc.network`. Check `fly logs` for connection
  errors. The RPC is public — no key needed — but is flaky during
  testnet maintenance windows. Retry deploy in ~5min.

- **Workers report "Failed to accept task: insufficient funds".** Worker
  EOA wasn't faucet'd. Re-run the Step 0 cast probe; faucet via
  <https://faucet.circle.com>.

- **Sponsor guard returns `accepting: false` after first run.** Sponsor
  spent down through the 1 USDC threshold (each composite plan costs
  ~0.01-0.05 USDC including gas). Top up via faucet. Re-check
  `/health.sponsor.balanceUsdc` post-faucet.

- **Tasks created on Base accidentally.** Frontend `chainId` state
  drifted — verify `?chain=arc` is preserved through the run. The
  `useCompositeDemo` hook freezes `chainId` at the classify call, so
  if the URL had `?chain=arc` at brief-submission, every subsequent
  request stays on Arc even if the user toggles after.

## References

- [ADR-0015 — Arc testnet bridge](../adr/0015-arc-deploy-bridge.md)
- [Deploy Sage contracts to Arc testnet](./deploy-arc-testnet.md) —
  the upstream step that produced the deployed addresses
- [`apps/demo-agents/fly.arc.toml`](../../apps/demo-agents/fly.arc.toml)
  — the config this runbook drives
- GOTCHAS — sponsor guard base-units, Dockerfile monorepo context
