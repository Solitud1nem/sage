# Deploy Sage contracts to Arc testnet

Per [ADR-0015](../adr/0015-arc-deploy-bridge.md). One-time deploy of
`AgentRegistry` + `TaskEscrow` on Arc testnet (chainId 5042002) via the
Arachnid CREATE2 deployer. After the deploy lands, paste the resulting
addresses into `packages/adapter-evm/src/chains/arc.ts` +
`apps/web/chains/arc.ts`.

## Pre-deploy

USDC interface on Arc verified (see
[`arc-testnet-verification-2026-05-21.md`](./arc-testnet-verification-2026-05-21.md)).
Deploy script compiled (`packages/contracts/script/DeployArc.s.sol`).

### Faucet

Gas on Arc is paid in USDC. The deployer needs ~0.02 USDC for the two
deploys; load extra to cover post-deploy verification, an end-to-end
smoke (createTask → acceptTask → completeTask → approvePayment), and any
re-runs.

**Step 1 — Faucet the sponsor/deployer EOA now:**

| Wallet | Address | Faucet to | Why |
|--------|---------|-----------|-----|
| **Sponsor / Deployer** | `0x6D8aCa48c1E064e71078656f7fB946e52cd8376d` | 40 USDC (20 × 2 visits) | Deploys both contracts + funds initial task lifecycle smoke. |

Faucet URL: <https://faucet.circle.com> (select Arc testnet, paste address, drip).

**Step 2 — Faucet worker EOAs (do this when ready to smoke; deploy itself doesn't need them):**

| Wallet | Address | Faucet to | Why |
|--------|---------|-----------|-----|
| Summarizer | `0x0DA5…2593` (full address required — Alex confirm) | 20-40 USDC | Acceptance + completion txs on assigned tasks. |
| Translator | `0xa61b…1c8c` (full address required — Alex confirm) | 20-40 USDC | Same. |
| Sentiment | `0x5218857Ef2631e0AC35fA8062671785954e918B5` | 20-40 USDC | Same. |
| Vision | `0xB889a7aAe3F9a5DC1CAC68459bc5e3118D9863Fb` | 20-40 USDC | Same. |

Verify balance via cast after dripping:

```bash
ARC_RPC="https://rpc.testnet.arc.network"
USDC="0x3600000000000000000000000000000000000000"
SPONSOR="0x6D8aCa48c1E064e71078656f7fB946e52cd8376d"
cast call --rpc-url "$ARC_RPC" "$USDC" "balanceOf(address)(uint256)" "$SPONSOR"
# Expect roughly 40_000_000 (= 40 USDC at 6 decimals) after two faucet drips
```

## Deploy

From the repo root:

```bash
cd packages/contracts

# Required env vars (set the sponsor's private key — same EOA as Base):
export DEPLOYER_PRIVATE_KEY=0x<sponsor private key>
export USDC_ADDRESS=0x3600000000000000000000000000000000000000
export REGISTRY_OWNER=0x6D8aCa48c1E064e71078656f7fB946e52cd8376d

# Dry-run first (no broadcast):
forge script script/DeployArc.s.sol \
  --rpc-url https://rpc.testnet.arc.network

# If dry-run logs look sane, broadcast:
forge script script/DeployArc.s.sol \
  --rpc-url https://rpc.testnet.arc.network \
  --broadcast
```

Expected output (last lines):

```
=== Deployment Summary ===
Chain ID:        5042002
AgentRegistry:   0x<addr>
TaskEscrow:      0x<addr>
USDC:            0x3600000000000000000000000000000000000000
Registry Owner: 0x6D8aCa48c1E064e71078656f7fB946e52cd8376d
```

Save both addresses — they go into the chain configs in the next step.

## Post-deploy verification

Cast probes the deployed contracts:

```bash
ARC_RPC="https://rpc.testnet.arc.network"
ESCROW=0x<TaskEscrow address from deploy output>
REGISTRY=0x<AgentRegistry address from deploy output>

# TaskEscrow points at the right USDC?
cast call --rpc-url "$ARC_RPC" "$ESCROW" "usdc()(address)"
# Expect: 0x3600000000000000000000000000000000000000

# TaskEscrow has GRACE_PERIOD constant?
cast call --rpc-url "$ARC_RPC" "$ESCROW" "GRACE_PERIOD()(uint256)"
# Expect: 300 (5 minutes)

# AgentRegistry owner = REGISTRY_OWNER?
cast call --rpc-url "$ARC_RPC" "$REGISTRY" "owner()(address)"
# Expect: 0x6D8aCa48c1E064e71078656f7fB946e52cd8376d

# Both addresses verified on the block explorer:
echo "https://testnet.arcscan.app/address/$ESCROW"
echo "https://testnet.arcscan.app/address/$REGISTRY"
```

## What to send back

After deploy succeeds, paste back to Claude:

```
Arc deploy complete.
AgentRegistry: 0x<addr>
TaskEscrow:    0x<addr>
Deploy tx (registry):  https://testnet.arcscan.app/tx/0x<hash>
Deploy tx (escrow):    https://testnet.arcscan.app/tx/0x<hash>
Sponsor balance after deploy: <X> USDC
```

Claude then:

1. Fills the addresses into `packages/adapter-evm/src/chains/arc.ts` (replace the two `0x0000…` sentinels).
2. Flips `apps/web/chains/arc.ts` from `PlannedChainConfig` to live `SageChainConfig`, fold into `SAGE_CHAINS`.
3. Updates `packages/adapter-arc/README.md` with the bridge-state note.
4. Updates the chain row in `/docs/architecture` from `Planned · ADR-0014` to `Live · ADR-0015`.
5. Writes CHANGELOG entry.

## Rollback / re-deploy

The Arachnid CREATE2 deployment is deterministic per salt — re-running
the script with the same `DEPLOYER_PRIVATE_KEY` + same salts will hit
the same address and revert (the address already has code). To redeploy
intentionally, bump the salt suffix in `script/DeployArc.s.sol` (e.g.
`"sage:arc:registry:v1"` → `"sage:arc:registry:v2"`), commit the bump,
re-run. Document the bump reason in a follow-up CHANGELOG entry.

## Gotchas

- **Gas paid in USDC.** Standard Foundry / Forge workflows assume ETH;
  Arc shows native balance in USDC. `forge script` handles this
  transparently — the deployer's USDC balance decreases instead of an
  ETH balance.
- **Block timestamp non-monotonicity** (per
  `arc-testnet-verification-2026-05-21.md`). Doesn't affect deploy but
  is noted for lifecycle smoke — `TaskEscrow.refundExpired` and
  `claimAutoRelease` use `block.timestamp` for deadlines; with `>=300s`
  windows, the occasional shared-timestamp block is below the noise
  floor.
- **SELFDESTRUCT restriction.** Arc disallows `SELFDESTRUCT` at deploy
  time. Our contracts don't use it, so this is a non-issue, but if a
  future contract adds it the Arc deploy will fail.
- **`address.code.length > 0` check** in `DeployArc.s.sol` catches the
  "Arachnid returned ok but no code at the computed address" failure
  mode. If this assert fires, the cause is usually a salt collision
  (someone else already deployed at this `(salt, initCodeHash)` pair via
  Arachnid) — bump the salt suffix and retry.
