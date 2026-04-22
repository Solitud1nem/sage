# Runbook: Deploy to Base Sepolia

Deploys `AgentRegistry` and `TaskEscrow` to Base Sepolia testnet via CreateX + CREATE3.

## Pre-flight checklist

- [ ] Foundry installed: `forge --version` returns 1.x+
- [ ] `.env` file exists in `packages/contracts/` with:
  ```
  DEPLOYER_PRIVATE_KEY=0x...         # Funded deployer EOA
  USDC_ADDRESS=0x036CbD53842c5426634e7929541eC2318f3dCF7e  # USDC on Base Sepolia
  REGISTRY_OWNER=0x...               # Owner for emergency pause (can be deployer)
  BASE_SEPOLIA_RPC=https://sepolia.base.org
  BASESCAN_API_KEY=...               # For verification
  ```
- [ ] Deployer has ≥ 0.01 ETH on Base Sepolia (for gas)
  ```bash
  cast balance $DEPLOYER_ADDRESS --rpc-url $BASE_SEPOLIA_RPC
  ```
- [ ] If deployer needs testnet ETH: https://www.coinbase.com/faucets/base-ethereum-goerli-faucet
- [ ] Contracts compile cleanly:
  ```bash
  cd packages/contracts
  forge build
  ```
- [ ] All tests pass:
  ```bash
  forge test -vvv
  ```

## Deploy

```bash
cd packages/contracts

# Load env
source .env

# Deploy with broadcast + auto-verify
forge script script/Deploy.s.sol \
  --rpc-url $BASE_SEPOLIA_RPC \
  --broadcast \
  --verify \
  --etherscan-api-key $BASESCAN_API_KEY \
  -vvvv
```

Expected output includes:
- `AgentRegistry deployed at: 0x...`
- `TaskEscrow deployed at: 0x...`
- `=== Deployment Summary ===` with both addresses

## Post-flight verification

### 1. Verify contracts are live

```bash
# Check AgentRegistry — should return deployer address (owner)
cast call $REGISTRY_ADDRESS "owner()" --rpc-url $BASE_SEPOLIA_RPC

# Check TaskEscrow — should return USDC address
cast call $ESCROW_ADDRESS "USDC()" --rpc-url $BASE_SEPOLIA_RPC

# Check TaskEscrow grace period — should return 300
cast call $ESCROW_ADDRESS "GRACE_PERIOD()" --rpc-url $BASE_SEPOLIA_RPC
```

### 2. Verify on Basescan

If `--verify` didn't work automatically (common with CREATE3 deploys):

```bash
# AgentRegistry
forge verify-contract $REGISTRY_ADDRESS \
  src/AgentRegistry.sol:AgentRegistry \
  --constructor-args $(cast abi-encode "constructor(address)" $REGISTRY_OWNER) \
  --chain-id 84532 \
  --etherscan-api-key $BASESCAN_API_KEY

# TaskEscrow
forge verify-contract $ESCROW_ADDRESS \
  src/TaskEscrow.sol:TaskEscrow \
  --constructor-args $(cast abi-encode "constructor(address)" $USDC_ADDRESS) \
  --chain-id 84532 \
  --etherscan-api-key $BASESCAN_API_KEY
```

### 3. Smoke test — register an agent

```bash
cast send $REGISTRY_ADDRESS \
  "registerAgent(string)" "https://test-agent.sage.dev" \
  --private-key $DEPLOYER_PRIVATE_KEY \
  --rpc-url $BASE_SEPOLIA_RPC

# Read back
cast call $REGISTRY_ADDRESS \
  "getAgent(address)" $DEPLOYER_ADDRESS \
  --rpc-url $BASE_SEPOLIA_RPC
```

### 4. Update chain registry

After successful deploy, update `docs/architecture/chain-registry.md` with:
- Chain: Base Sepolia
- Chain ID: 84532
- AgentRegistry address
- TaskEscrow address
- USDC address used
- Deploy tx hashes

## Rollback

Base Sepolia is a testnet — no rollback needed. If something is wrong, redeploy with a new salt version (e.g. `sage:registry:v2`).

## Troubleshooting

| Issue | Solution |
|-------|----------|
| `EvmError: Revert` on CreateX call | Verify CreateX exists on Base Sepolia at `0xba5Ed...`. Check deployer has enough ETH. |
| `CREATE3: salt already used` | Contract already deployed at this salt. Use `computeCreate3Address` to check. |
| Verification fails | Use manual `forge verify-contract` commands above. Ensure compiler settings match `foundry.toml`. |
| `insufficient funds` | Fund deployer with testnet ETH from Base faucet. |
