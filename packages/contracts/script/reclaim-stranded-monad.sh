#!/usr/bin/env bash
# Generic operator script: resolve a task stranded in Completed on the Monad
# escrow (a dropped tx killed the run before its evaluator/payment step —
# GOTCHAS "Monad: транзакция может быть молча дропнута").
# Usage: bash reclaim-stranded-monad.sh <taskId> <pay|refund>
#   pay    — approvePayment: worker delivered, pay them (client's call)
#   refund — disputeTask + arbiter resolveDispute(Refunded): funds back to client
set -euo pipefail
export PATH="$HOME/.foundry/bin:$PATH"
RPC="https://testnet-rpc.monad.xyz"
E="0xcc01a4F195f9c991A7BEB2c513cc30267fFfdAac"
SPONSOR="0x6d8aca48c1e064e71078656f7fb946e52cd8376d"
TASK="${1:?usage: reclaim-stranded-monad.sh <taskId> <pay|refund>}"
MODE="${2:?usage: reclaim-stranded-monad.sh <taskId> <pay|refund>}"

read -r -s -p "Private key of 0x6D8a...376d (hidden): " PK; echo
ACTUAL=$(cast wallet address --private-key "$PK" | tr '[:upper:]' '[:lower:]')
[ "$ACTUAL" = "$SPONSOR" ] || { echo "ABORT: wrong key ($ACTUAL)"; exit 1; }

echo "task #$TASK before:"
cast call --rpc-url "$RPC" "$E" "getTask(uint256)((address,address,uint256,uint64,uint8,string,string,uint256))" "$TASK" | head -c 160; echo
case "$MODE" in
  pay)
    echo "approvePayment($TASK)..."
    cast send --rpc-url "$RPC" --private-key "$PK" "$E" "approvePayment(uint256)" "$TASK" | grep -E "status|transactionHash" ;;
  refund)
    echo "disputeTask($TASK) + resolveDispute(Refunded)..."
    cast send --rpc-url "$RPC" --private-key "$PK" "$E" "disputeTask(uint256,string)" "$TASK" "stranded after dropped tx" | grep -E "status|transactionHash"
    cast send --rpc-url "$RPC" --private-key "$PK" "$E" "resolveDispute(uint256,uint8,uint256)" "$TASK" 5 0 | grep -E "status|transactionHash" ;;
  *) echo "MODE must be pay|refund"; exit 1 ;;
esac
echo "task #$TASK after:"
cast call --rpc-url "$RPC" "$E" "getTask(uint256)((address,address,uint256,uint64,uint8,string,string,uint256))" "$TASK" | head -c 160; echo
echo "sponsor WMON:"
cast call --rpc-url "$RPC" 0xFb8bf4c1CC7a94c73D209a149eA2AbEa852BC541 "balanceOf(address)(uint256)" "$SPONSOR"
