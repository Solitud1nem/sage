#!/bin/bash
# Run all 3 demo agents locally with a single private key.
# Usage: bash scripts/run-local.sh
set -euo pipefail

DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$DIR"

source /mnt/d/Sage/packages/contracts/.env
DEPLOYER=$(cast wallet address $DEPLOYER_PRIVATE_KEY)

export PRIVATE_KEY=$DEPLOYER_PRIVATE_KEY
export RPC_URL=https://mainnet.base.org
export NODE_PATH="$DIR/node_modules:/mnt/d/Sage/node_modules"

echo "Deployer: $DEPLOYER"
echo "Starting agents from $DIR ..."

PORT=3001 tsx "$DIR/src/summarizer/agent.ts" &
PID_SUM=$!

PORT=3002 tsx "$DIR/src/translator/agent.ts" &
PID_TRANS=$!

SUMMARIZER_ADDRESS=$DEPLOYER \
TRANSLATOR_ADDRESS=$DEPLOYER \
TASK_AMOUNT=10000 \
ALLOWED_ORIGINS=http://localhost:3000 \
PORT=3000 tsx "$DIR/src/orchestrator/server.ts" &
PID_ORCH=$!

echo "PIDs: Summarizer=$PID_SUM Translator=$PID_TRANS Orchestrator=$PID_ORCH"

trap "kill $PID_SUM $PID_TRANS $PID_ORCH 2>/dev/null; echo 'Agents stopped'" EXIT

wait
