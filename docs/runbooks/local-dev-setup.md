# Runbook: local dev setup

Two paths — pick based on what you want to see.

## Path A — Web UI only (no backend)

Home page works fully without any orchestrator. LiveStream pulls real events from Base mainnet directly via public RPC. `/demo` renders but will error on "Run task" (no orchestrator).

```bash
cd /mnt/d/Sage
pnpm install           # first time only
pnpm --filter @sage/web dev
```

Open http://localhost:3000 — full landing page. Good enough to iterate on UI, show someone, take screenshots.

## Path B — Full demo loop locally

End-to-end Watch-live flow against **Base Sepolia** (test-net, real contracts). Requires three funded wallets and two registered agents.

### 1. Generate wallets

```bash
pnpm --filter @sage/demo-agents bootstrap
```

This runs `apps/demo-agents/scripts/bootstrap-local.sh` which:
- Generates three fresh wallets via `cast wallet new` (Foundry required).
- Writes `.env.orchestrator` / `.env.summarizer` / `.env.translator` with private keys + addresses.
- Prints addresses to fund + registration commands + next steps.

Re-running is safe — it skips files that already exist.

### 2. Fund wallets (Base Sepolia)

For each generated address:

| Asset | Where | Amount |
|---|---|---|
| ETH (gas) | [CDP faucet](https://portal.cdp.coinbase.com/products/faucet) → Base Sepolia | ~0.001 ETH per address |
| USDC (orchestrator sponsor only) | [Circle faucet](https://faucet.circle.com) → Base Sepolia | ≥ 0.1 USDC |

Wait ~30 seconds for faucet transfers to confirm.

### 3. Register agent addresses on AgentRegistry

Bootstrap script prints the exact `cast send` commands. They look like:

```bash
cast send 0x5e95...c661 "registerAgent(string)" "http://localhost:3001" \
  --rpc-url https://sepolia.base.org \
  --private-key $(grep PRIVATE_KEY apps/demo-agents/.env.summarizer | cut -d= -f2)
```

(Run once per agent — summarizer + translator.)

### 4. Tell orchestrator about its agents

Append to `apps/demo-agents/.env.orchestrator`:

```
SUMMARIZER_ADDRESS=0x<summarizer_addr>
TRANSLATOR_ADDRESS=0x<translator_addr>
OPENAI_API_KEY=sk-...            # optional — mock responses without it
```

### 5. Run all four processes

Four terminals (or use tmux/zellij):

```bash
# Terminal 1
pnpm --filter @sage/demo-agents dev:summarizer

# Terminal 2
pnpm --filter @sage/demo-agents dev:translator

# Terminal 3
pnpm --filter @sage/demo-agents dev:orchestrator

# Terminal 4
NEXT_PUBLIC_ORCHESTRATOR_URL=http://localhost:3000 \
  pnpm --filter @sage/web dev
```

Web dev server runs on port 3001 (because orchestrator took 3000). Open http://localhost:3001/demo, click Run task, watch the step-tracker.

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `Missing required env var: PRIVATE_KEY` | `.env.*` file missing for the service you started | Re-run `pnpm bootstrap` |
| `insufficient funds for gas` | ETH faucet didn't land yet | Wait 30s, retry. Check balance: `cast balance 0x... --rpc-url https://sepolia.base.org --ether` |
| `execution reverted: NotRegistered` | Agent address not registered in AgentRegistry | Run step 3 registration |
| Web shows "Connection to orchestrator lost" | Orchestrator not running, or `NEXT_PUBLIC_ORCHESTRATOR_URL` misconfigured | Check orchestrator terminal; set env explicitly |
| Task times out after 120s | Summarizer or translator offline / out of gas | Check their logs; top up the one that's failing |
| Summarizer/Translator logs show OpenAI errors | `OPENAI_API_KEY` set but invalid | Unset it — agents fall back to mocked output |

## Reset

```bash
# Drop local wallets + envs (keeps Foundry, pnpm, node_modules).
rm apps/demo-agents/.env.orchestrator apps/demo-agents/.env.summarizer apps/demo-agents/.env.translator
pnpm --filter @sage/demo-agents bootstrap
# Re-fund + re-register.
```

## Production

For real Base mainnet deploy of the orchestrator, see [`deploy-demo-agents-flyio.md`](./deploy-demo-agents-flyio.md).
