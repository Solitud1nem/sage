#!/usr/bin/env bash
# One-shot operator script: deploy AgentRegistryV2 + TaskEscrowV2(WMON) to
# Monad testnet per ADR-0026 / docs/runbooks/deploy-monad-testnet.md.
#
# Runs in WSL Ubuntu:  wsl -d Ubuntu bash /mnt/d/Sage/packages/contracts/script/deploy-monad-testnet.sh
#
# Custody: the private key is prompted with `read -s` (hidden, not echoed,
# not persisted to shell history or any file). Nothing in this script prints
# or stores the key. Post-deploy steps (verify, smokes) don't need it.

set -euo pipefail
cd "$(dirname "$0")/.."   # packages/contracts

export PATH="$HOME/.foundry/bin:$PATH"
command -v forge >/dev/null || { echo "forge not found in ~/.foundry/bin"; exit 1; }

export MONAD_TESTNET_RPC="https://testnet-rpc.monad.xyz"
export REGISTRY_OWNER="0x6D8aCa48c1E064e71078656f7fB946e52cd8376d"
export INITIAL_OWNER="$REGISTRY_OWNER"
export INITIAL_ARBITER="$REGISTRY_OWNER"
export WMON_ADDRESS="0xFb8bf4c1CC7a94c73D209a149eA2AbEa852BC541"
EXPECTED_REGISTRY="0x8df78599868ec740c26f0eb0b660519b166cdd9e"
EXPECTED_DEPLOYER="0x6d8aca48c1e064e71078656f7fb946e52cd8376d"

read -r -s -p "DEPLOYER_PRIVATE_KEY (hidden): " DEPLOYER_PRIVATE_KEY; echo
export DEPLOYER_PRIVATE_KEY

# Sanity: the key must resolve to the Base deployer, or CREATE3 addresses drift.
ACTUAL=$(cast wallet address --private-key "$DEPLOYER_PRIVATE_KEY" | tr '[:upper:]' '[:lower:]')
if [ "$ACTUAL" != "$EXPECTED_DEPLOYER" ]; then
  echo "ABORT: key resolves to $ACTUAL, expected $EXPECTED_DEPLOYER (guarded salt is deployer-bound)."
  exit 1
fi
echo "Deployer OK: $ACTUAL"

echo; echo "=== DRY-RUN (fork, free) ==="
forge script script/DeployRegistryV2.s.sol --fork-url "$MONAD_TESTNET_RPC" | tee /tmp/dry-registry.log
forge script script/DeployEscrowWmon.s.sol --fork-url "$MONAD_TESTNET_RPC" | tee /tmp/dry-escrow.log

grep -qi "$EXPECTED_REGISTRY" /tmp/dry-registry.log || {
  echo "ABORT: dry-run registry address != $EXPECTED_REGISTRY (Base parity broken)."; exit 1; }
echo; echo "Dry-run OK: registry address matches Base ($EXPECTED_REGISTRY)."

echo
if [ "${YES:-}" = "1" ]; then
  echo "YES=1 set — skipping confirmation."
else
  read -r -p "Broadcast to Monad testnet (chain 10143)? Costs ~0.5-1 MON. [y/N] " GO
  GO=$(printf '%s' "$GO" | tr -d '[:space:]\r' | tr '[:upper:]' '[:lower:]')
  case "$GO" in y|yes) ;; *) echo "Cancelled (got: '$GO')."; exit 0 ;; esac
fi

echo; echo "=== DEPLOY: AgentRegistryV2 ==="
forge script script/DeployRegistryV2.s.sol --rpc-url "$MONAD_TESTNET_RPC" --broadcast

echo; echo "=== DEPLOY: TaskEscrowV2 (WMON) ==="
forge script script/DeployEscrowWmon.s.sol --rpc-url "$MONAD_TESTNET_RPC" --broadcast

echo
echo "=== DONE ==="
echo "Broadcast journals (no secrets inside — safe for the assistant to read):"
ls -1 broadcast/DeployRegistryV2.s.sol/10143/run-latest.json broadcast/DeployEscrowWmon.s.sol/10143/run-latest.json 2>/dev/null || true
echo "Next: tell the assistant 'задеплоено' — verification, smokes and docs are keyless."
