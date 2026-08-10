#!/usr/bin/env bash
# One-shot operator script: wrap sponsor MON -> WMON on Monad testnet
# (deploy-monad-testnet.md step 7). Key is prompted hidden, never echoed
# or persisted. Run: bash /mnt/d/Sage/packages/contracts/script/wrap-wmon-monad.sh
set -euo pipefail
export PATH="$HOME/.foundry/bin:$PATH"
command -v cast >/dev/null || { echo "cast not found in ~/.foundry/bin (run in WSL 'Ubuntu')"; exit 1; }

RPC="https://testnet-rpc.monad.xyz"
WMON="0xFb8bf4c1CC7a94c73D209a149eA2AbEa852BC541"
SPONSOR="0x6d8aca48c1e064e71078656f7fb946e52cd8376d"
AMOUNT="${1:-8ether}"   # default 8 MON; override: wrap-wmon-monad.sh 5ether

read -r -s -p "Private key of 0x6D8a...376d (hidden): " PK; echo

ACTUAL=$(cast wallet address --private-key "$PK" | tr '[:upper:]' '[:lower:]')
if [ "$ACTUAL" != "$SPONSOR" ]; then
  echo "ABORT: key resolves to $ACTUAL, expected $SPONSOR."
  exit 1
fi

echo "Wrapping $AMOUNT MON -> WMON..."
cast send --rpc-url "$RPC" --private-key "$PK" "$WMON" "deposit()" --value "$AMOUNT"

echo
echo "WMON balance now:"
cast call --rpc-url "$RPC" "$WMON" "balanceOf(address)(uint256)" "$SPONSOR"
echo "MON balance now:"
cast balance --rpc-url "$RPC" "$SPONSOR"
