#!/usr/bin/env bash
# One-shot operator script: resolve the stranded rework task #25 on Monad
# (failure-demo run 2026-08-10 died on a dropped tx; task stuck in Completed).
# Honest resolution: dispute -> arbiter resolves as Refunded (the rework was
# the staged fabrication — client gets the 1.0 WMON back). Sponsor EOA is
# both client and arbiter on Monad launch posture.
# Run: bash /mnt/d/Sage/packages/contracts/script/reclaim-task25-monad.sh
set -euo pipefail
export PATH="$HOME/.foundry/bin:$PATH"
RPC="https://testnet-rpc.monad.xyz"
E="0xcc01a4F195f9c991A7BEB2c513cc30267fFfdAac"
SPONSOR="0x6d8aca48c1e064e71078656f7fb946e52cd8376d"

read -r -s -p "Private key of 0x6D8a...376d (hidden): " PK; echo
ACTUAL=$(cast wallet address --private-key "$PK" | tr '[:upper:]' '[:lower:]')
[ "$ACTUAL" = "$SPONSOR" ] || { echo "ABORT: wrong key ($ACTUAL)"; exit 1; }

echo "disputeTask(25)..."
cast send --rpc-url "$RPC" --private-key "$PK" "$E" "disputeTask(uint256,string)" 25 "stranded rework after dropped tx" | grep -E "status|transactionHash"
echo "resolveDispute(25, Refunded, 0)..."
cast send --rpc-url "$RPC" --private-key "$PK" "$E" "resolveDispute(uint256,uint8,uint256)" 25 5 0 | grep -E "status|transactionHash"
echo "task #25 now:"
cast call --rpc-url "$RPC" "$E" "getTask(uint256)((address,address,uint256,uint64,uint8,string,string,uint256))" 25 | head -c 200; echo
echo "sponsor WMON:"
cast call --rpc-url "$RPC" 0xFb8bf4c1CC7a94c73D209a149eA2AbEa852BC541 "balanceOf(address)(uint256)" "$SPONSOR"
