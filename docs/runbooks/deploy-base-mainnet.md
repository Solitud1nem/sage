# Runbook: Deploy to Base Mainnet

Deploys `AgentRegistry` and `TaskEscrow` to Base mainnet via CreateX + CREATE3.

**This is a production deployment with real funds. Double-check everything.**

## Pre-flight checklist

- [ ] **All tests pass:**
  ```bash
  cd packages/contracts
  forge test -vvv
  ```
- [ ] **Slither clean** (0 high/medium):
  ```bash
  slither src/ --solc-remaps "@openzeppelin/contracts/=lib/openzeppelin-contracts/contracts/ forge-std/=lib/forge-std/src/" --filter-paths "lib/"
  ```
- [ ] **Invariant suite 10k runs pass:**
  ```bash
  FOUNDRY_INVARIANT_RUNS=10000 forge test --match-path 'test/invariants/**'
  ```
- [ ] **Base Sepolia deployment verified and tested** (M3.5 complete)
- [ ] **Security checklist reviewed** (`docs/architecture/security-checklist.md`)
- [ ] `.env` file exists in `packages/contracts/` with mainnet values:
  ```
  DEPLOYER_PRIVATE_KEY=0x...
  USDC_ADDRESS=0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913
  REGISTRY_OWNER=0x...          # Multisig or deployer for emergency pause
  BASE_MAINNET_RPC=https://mainnet.base.org
  BASESCAN_API_KEY=...
  ```
- [ ] Deployer has ≥ 0.005 ETH on Base mainnet:
  ```bash
  source .env
  cast balance $(cast wallet address $DEPLOYER_PRIVATE_KEY) --rpc-url $BASE_MAINNET_RPC --ether
  ```
- [ ] **REGISTRY_OWNER decision made:**
  - For launch: deployer EOA is acceptable
  - Post-launch: migrate to multisig (Gnosis Safe on Base)
- [ ] **Git is clean** — no uncommitted changes:
  ```bash
  git status
  ```
- [ ] **Consider using hardware wallet** for deployer key (Ledger/Trezor via `cast wallet` or Frame)

## Deploy

```bash
cd packages/contracts
source .env

# Deploy with broadcast + auto-verify
forge script script/Deploy.s.sol \
  --rpc-url $BASE_MAINNET_RPC \
  --broadcast \
  --verify \
  --etherscan-api-key $BASESCAN_API_KEY \
  -vvvv
```

Expected output:
- `AgentRegistry deployed at: 0x...`
- `TaskEscrow deployed at: 0x...`
- `=== Deployment Summary ===`

**Save the deployed addresses immediately.**

## Post-flight verification

### 1. Verify contracts are live

```bash
export REGISTRY_ADDRESS=<deployed address>
export ESCROW_ADDRESS=<deployed address>

# AgentRegistry — should return REGISTRY_OWNER
cast call $REGISTRY_ADDRESS "owner()" --rpc-url $BASE_MAINNET_RPC

# TaskEscrow — should return USDC address
cast call $ESCROW_ADDRESS "USDC()" --rpc-url $BASE_MAINNET_RPC

# TaskEscrow grace period — should return 300
cast call $ESCROW_ADDRESS "GRACE_PERIOD()" --rpc-url $BASE_MAINNET_RPC

# TaskEscrow next task id — should be 0
cast call $ESCROW_ADDRESS "nextTaskId()" --rpc-url $BASE_MAINNET_RPC
```

### 2. Verify on Basescan

If `--verify` didn't work:

```bash
# AgentRegistry
forge verify-contract $REGISTRY_ADDRESS \
  src/AgentRegistry.sol:AgentRegistry \
  --constructor-args $(cast abi-encode "constructor(address)" $REGISTRY_OWNER) \
  --chain-id 8453 \
  --etherscan-api-key $BASESCAN_API_KEY

# TaskEscrow
forge verify-contract $ESCROW_ADDRESS \
  src/TaskEscrow.sol:TaskEscrow \
  --constructor-args $(cast abi-encode "constructor(address)" $USDC_ADDRESS) \
  --chain-id 8453 \
  --etherscan-api-key $BASESCAN_API_KEY
```

### 3. Smoke test — register an agent

```bash
cast send $REGISTRY_ADDRESS \
  "registerAgent(string)" "https://sage-deployer.example.com" \
  --private-key $DEPLOYER_PRIVATE_KEY \
  --rpc-url $BASE_MAINNET_RPC

cast call $REGISTRY_ADDRESS \
  "getAgent(address)" $(cast wallet address $DEPLOYER_PRIVATE_KEY) \
  --rpc-url $BASE_MAINNET_RPC
```

### 4. Update chain registry and SDK

1. Update `docs/architecture/overview.md` chain table with mainnet addresses
2. Update `packages/adapter-evm/src/chains/base.ts`:
   ```typescript
   agentRegistry: '0x<DEPLOYED_ADDRESS>',
   taskEscrow: '0x<DEPLOYED_ADDRESS>',
   ```
3. Commit and push

### 5. Tag release

```bash
git tag v2.0.0
git push origin v2.0.0
```

## Rollback

**There is no on-chain rollback for immutable contracts.**

If a critical bug is found post-deploy:
1. **Pause AgentRegistry** (owner only): `cast send $REGISTRY_ADDRESS "pause()" --private-key $DEPLOYER_PRIVATE_KEY --rpc-url $BASE_MAINNET_RPC`
2. **Do NOT create tasks** — communicate via README/social
3. Deploy fixed contracts with new salt (e.g. `sage:registry:v2`, `sage:escrow:v2`)
4. Update SDK to point to new addresses
5. Release new SDK version

If USDC is locked in escrow during incident:
- Tasks in `Created`/`Accepted` can be refunded after deadline via `refundExpired()`
- Tasks in `Completed` can be approved by client or auto-released after grace period
- Tasks in `Disputed` — USDC remains locked (v2 has no dispute resolution)

## Post-deploy tasks

- [ ] Create GitHub release with changelog
- [ ] Update CLAUDE.md status to "v2.0 deployed"
- [ ] Update KB dossier (`D:\knowledge\projects\project-sage.md`)
- [ ] Run demo end-to-end with real USDC (M8.3)
