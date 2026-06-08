# Runbook: Deploy TaskEscrowV2

Deploys the V2 escrow contract (arbitration layer per ADR-0017) via CreateX + CREATE3 with the `sage:escrow:v2` salt. The existing v1 `TaskEscrow` at `0x12aeF3…3E1e` remains canonical for in-flight v2 tasks; v3.0 deploys at a new deterministic address.

`AgentRegistry` is **not** touched in this deploy — the v1 registry continues to serve. Registry schema extension lands separately as M11.2.

## Launch posture (2026-06-08)

Three privileged roles collapse to one EOA on launch:

- **Deployer** = signs the CreateX deploy tx and funds gas.
- **Owner** = holds `setArbiter` authority (Ownable2Step).
- **Arbiter** = calls `resolveDispute` (only on `Disputed` tasks).

All three default to the existing sponsor address (`0x6D8a…0376d`) for simplicity. This concentrates key-compromise risk; the migration path is:

1. `transferOwnership(safeAddress)` from the deployer, then `acceptOwnership()` from the Safe (two-step). Owner now lives at a multisig.
2. `setArbiter(dedicatedArbiterEoa)` once a separate arbiter key exists (typically when council infra in M11.4 needs it isolated).

Until then, the deploy runbook treats the launch posture as a known temporary concentration. Document the migration step as a follow-up task in `TASKS.md` when applicable.

## Pre-flight checklist

- [ ] `forge --version` returns 1.x+
- [ ] `.env` in `packages/contracts/` has:
  ```
  DEPLOYER_PRIVATE_KEY=0x...           # Same key used for v1 deploy
  USDC_ADDRESS=0x036CbD53842c5426634e7929541eC2318f3dCF7e   # Base Sepolia
  # USDC_ADDRESS=0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913 # Base mainnet
  INITIAL_OWNER=0x6D8aCa48c1E064e71078656f7fB946e52cd8376d
  INITIAL_ARBITER=0x6D8aCa48c1E064e71078656f7fB946e52cd8376d
  BASE_SEPOLIA_RPC=https://sepolia.base.org
  BASE_MAINNET_RPC=https://mainnet.base.org
  BASESCAN_API_KEY=...
  ```
- [ ] Deployer has ≥ 0.01 ETH on the target chain
  ```bash
  cast balance 0x6D8aCa48c1E064e71078656f7fB946e52cd8376d --rpc-url $BASE_SEPOLIA_RPC
  ```
- [ ] Contracts compile + tests pass:
  ```bash
  cd packages/contracts && forge build && forge test --match-contract TaskEscrowV2Test
  ```

## Dry-run on a fork (recommended before broadcast)

```bash
cd packages/contracts
source .env

# Dry-run prints the deploy plan + computed address without sending tx
forge script script/DeployV2.s.sol --fork-url $BASE_SEPOLIA_RPC -vvvv
```

Expected log lines:

- `Deployer: 0x6D8a…0376d`
- `Initial owner: 0x6D8a…0376d`
- `Initial arbiter: 0x6D8a…0376d`
- `Escrow salt: 0x…`
- `=== TaskEscrowV2 Deployment Summary ===`

If the dry-run reverts, fix before broadcasting.

## Deploy on Base Sepolia

```bash
cd packages/contracts
source .env

forge script script/DeployV2.s.sol \
  --rpc-url $BASE_SEPOLIA_RPC \
  --broadcast \
  --verify \
  --etherscan-api-key $BASESCAN_API_KEY \
  -vvvv
```

The script's post-deploy sanity reads (`USDC()`, `owner()`, `arbiter()`) catch obvious miswiring before returning. Capture the deployed address — it goes in `.env` as `ESCROW_V2_ADDRESS`.

## Post-deploy verification

### 1. Live reads

```bash
# Owner — should be 0x6D8a…0376d
cast call $ESCROW_V2_ADDRESS "owner()(address)" --rpc-url $BASE_SEPOLIA_RPC

# Arbiter — should be 0x6D8a…0376d
cast call $ESCROW_V2_ADDRESS "arbiter()(address)" --rpc-url $BASE_SEPOLIA_RPC

# USDC — chain-specific
cast call $ESCROW_V2_ADDRESS "USDC()(address)" --rpc-url $BASE_SEPOLIA_RPC

# pendingOwner — should be 0x0
cast call $ESCROW_V2_ADDRESS "pendingOwner()(address)" --rpc-url $BASE_SEPOLIA_RPC

# Grace period — should be 300
cast call $ESCROW_V2_ADDRESS "GRACE_PERIOD()(uint64)" --rpc-url $BASE_SEPOLIA_RPC

# nextTaskId — should be 0 on fresh deploy
cast call $ESCROW_V2_ADDRESS "nextTaskId()(uint256)" --rpc-url $BASE_SEPOLIA_RPC
```

### 2. Verify on Basescan if `--verify` didn't take

CREATE3 deploys occasionally trip auto-verification. Manual:

```bash
forge verify-contract $ESCROW_V2_ADDRESS \
  src/TaskEscrowV2.sol:TaskEscrowV2 \
  --constructor-args $(cast abi-encode "constructor(address,address,address)" \
    $USDC_ADDRESS $INITIAL_OWNER $INITIAL_ARBITER) \
  --chain-id 84532 \
  --etherscan-api-key $BASESCAN_API_KEY
```

For mainnet replace `--chain-id 8453`.

### 3. Live smoke — full lifecycle including Split

Use `cast send` from a test EOA (NOT the sponsor) with permit-signed createTask, then dispute, then resolve via the sponsor. Steps in `docs/runbooks/smoke-task-escrow-v2.md` (TBD — coming with M11.1.10).

### 4. Update SDK / orchestrator after smoke

Once Sepolia smoke green:

- Update `packages/adapter-evm/src/chains/base.ts` — add `taskEscrowV2` address per chain.
- Update orchestrator config to point new tasks at V2 address.
- Workers (4 demo agents) follow orchestrator config — they read `taskEscrow` from chain config.

Mainnet deploy follows the same flow with `--rpc-url $BASE_MAINNET_RPC`.

## Rollback

- **Sepolia**: testnet, no rollback needed. Redeploy with a new salt (`sage:escrow:v2.1`) if the v2 deploy is broken.
- **Mainnet**: V2 deploy is parallel to v1 — there's nothing to "roll back". Just don't switch the orchestrator config until ready. v1 contracts at `0x12aeF3…3E1e` continue working regardless.

## Troubleshooting

| Issue | Solution |
|-------|----------|
| `EvmError: Revert` on CreateX call | Confirm CreateX at `0xba5Ed099…` on the target chain. Check deployer ETH balance. |
| `CREATE3: salt already used` | V2 already deployed at this salt by this deployer. Use `cast call CREATEX "computeCreate3Address(bytes32,address)(address)" $SALT $DEPLOYER` to confirm. |
| Sanity reads in script revert with `DeployV2: arbiter mismatch` | Constructor accepted a different value than `INITIAL_ARBITER`. Check that the env var resolved (no shell expansion issues). |
| `ZeroArbiter` revert at deploy | `INITIAL_ARBITER=0x0` or empty — the contract refuses zero-address arbiter. Set it explicitly. |
| Verification fails on Basescan | Use the manual `forge verify-contract` command above with explicit constructor-args. Compiler settings must match `foundry.toml` (`solc 0.8.24`, `optimizer = true`, `optimizer_runs = 200`). |

## References

- Contract: `packages/contracts/src/TaskEscrowV2.sol`
- ABI: `packages/adapter-evm/src/abi/task-escrow-v2.ts`
- Deploy script: `packages/contracts/script/DeployV2.s.sol`
- ADR-0017 (rationale + decisions): `docs/adr/0017-task-escrow-arbitration.md`
- v1 runbook for comparison: `docs/runbooks/deploy-base-sepolia.md`
- Launch posture decision (session 2026-06-08): brainstorm log + ADR-0008 amendment
