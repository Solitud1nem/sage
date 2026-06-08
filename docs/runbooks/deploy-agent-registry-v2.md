# Runbook: Deploy AgentRegistryV2

Deploys the V2 agent registry (capability + price + rich-profile layer per ADR-0008 amendment 2026-06-04, M11.2) via CreateX + CREATE3 with the `sage:registry:v2` salt. The v1 `AgentRegistry` at `0x5e95F92F…29c661` stays canonical for legacy agents; v2 is parallel.

`TaskEscrow` v3.0 stays untouched — this is a registry-only deploy.

## Launch posture

Registry `owner` (emergency-pause authority) is **same EOA** as TaskEscrowV2 owner and as sponsor — `0x6D8aCa48c1E064e71078656f7fB946e52cd8376d`. M11.2 keeps the launch posture coherent across all V3-era contracts; transferOwnership to a Safe is the same future task.

## Pre-flight checklist

- [ ] `forge --version` returns 1.x+
- [ ] `.env` in `packages/contracts/` has:
  ```
  DEPLOYER_PRIVATE_KEY=0x...        # Same key as TaskEscrowV2 deploy
  REGISTRY_OWNER=0x6D8aCa48c1E064e71078656f7fB946e52cd8376d
  BASE_SEPOLIA_RPC=https://sepolia.base.org
  BASE_MAINNET_RPC=https://mainnet.base.org
  BASESCAN_API_KEY=...
  ```
- [ ] Deployer has ≥ 0.001 ETH on the target chain (~$0.0001 at 0.006 gwei × 2.1M gas).
- [ ] Contracts compile + V2 registry tests pass:
  ```bash
  cd packages/contracts && forge test --match-contract AgentRegistryV2Test
  ```

## Dry-run

```bash
cd packages/contracts && source .env
forge script script/DeployRegistryV2.s.sol --fork-url $BASE_SEPOLIA_RPC -vvvv
```

Should print the registry address + post-deploy sanity reads (owner, paused=false, agentCount=0).

## Deploy on Base Sepolia

```bash
forge script script/DeployRegistryV2.s.sol \
  --rpc-url $BASE_SEPOLIA_RPC \
  --broadcast \
  --verify \
  --etherscan-api-key $BASESCAN_API_KEY \
  -vvvv
```

Capture the deployed address.

## Post-deploy verification

```bash
# Owner
cast call $REGISTRY_V2_ADDRESS "owner()(address)" --rpc-url $BASE_SEPOLIA_RPC
# Pausable state
cast call $REGISTRY_V2_ADDRESS "paused()(bool)" --rpc-url $BASE_SEPOLIA_RPC
# Initial count
cast call $REGISTRY_V2_ADDRESS "agentCount()(uint256)" --rpc-url $BASE_SEPOLIA_RPC
```

Expect: owner = sponsor, paused = false, agentCount = 0.

## Deploy on Base mainnet

Same script, change RPC:

```bash
forge script script/DeployRegistryV2.s.sol \
  --rpc-url $BASE_MAINNET_RPC \
  --broadcast \
  --verify \
  --etherscan-api-key $BASESCAN_API_KEY \
  -vvvv
```

Same-address invariant per ADR-0001 — mainnet address will match Sepolia.

## Update SDK + frontend

After both Sepolia + mainnet deploys verified:

1. `packages/adapter-evm/src/chains/base.ts` — add `agentRegistryV2: '0x...'` to both `base` and `baseSepolia` (or replace `agentRegistry` if the cutover plan calls for that — see M11.2.13).
2. `apps/web/chains/base.ts` — same.
3. Rebuild + redeploy Fly orchestrator + Cloudflare Pages.

## Register demo-agents

The 4 demo-agent EOAs (summarizer / translator / vision / sentiment) need to register in v2 with their capabilities + prices. One-time script — see `packages/contracts/script/RegisterDemoAgents.s.sol` (TBD, M11.2.11).

## Rollback

- **Sepolia**: redeploy at a new salt if broken.
- **Mainnet**: v2 is parallel to v1 — both live. Don't update SDK chain config until v2 is verified.

## References

- Contract: `packages/contracts/src/AgentRegistryV2.sol`
- ABI: `packages/adapter-evm/src/abi/agent-registry-v2.ts`
- Deploy script: `packages/contracts/script/DeployRegistryV2.s.sol`
- ADR-0008 amendment 2026-06-04 (platform layer rationale)
- Companion runbook for TaskEscrowV2: `docs/runbooks/deploy-task-escrow-v2.md`
