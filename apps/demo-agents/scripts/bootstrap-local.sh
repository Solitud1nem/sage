#!/usr/bin/env bash
# Bootstrap local demo-agents environment.
#
# Generates three fresh wallets (orchestrator-sponsor, summarizer, translator),
# writes per-service .env files, prints addresses that need funding and the
# registration commands for AgentRegistry.
#
# Requirements:
#   - foundry installed (cast on $PATH)
#   - run from the repo root or from apps/demo-agents/
#
# Run once:
#   pnpm --filter @sage/demo-agents bootstrap
#
# Does NOT overwrite existing .env.* files — if you want fresh keys, delete them first.

set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" &> /dev/null && pwd)"
cd "${SCRIPT_DIR}/.."

if ! command -v cast &> /dev/null; then
  echo "error: cast (Foundry) not found. Install: https://book.getfoundry.sh/"
  exit 1
fi

CHAIN_ID=84532
RPC_URL_DEFAULT="https://sepolia.base.org"
USDC_SEPOLIA="0x036CbD53842c5426634e7929541eC2318f3dCF7e"

BASE_SEPOLIA_REGISTRY="0x5e95f92feeb4d46249dc3525c58596856029c661"
BASE_SEPOLIA_ESCROW="0x12aef3529b8404709125b727ba3db40cd5453e1e"

gen() {
  local role="$1" port="$2" file=".env.${role}"
  if [[ -f "$file" ]]; then
    echo "skip: ${file} already exists"
    # shellcheck disable=SC1090
    local existing_addr
    existing_addr=$(grep -E '^AGENT_ADDRESS=' "$file" 2>/dev/null | cut -d= -f2 || true)
    echo "  ${role} address: ${existing_addr:-<unparsed>}"
    return
  fi

  local out pk addr
  out=$(cast wallet new)
  pk=$(echo "$out" | awk '/Private key:/ { print $3 }')
  addr=$(echo "$out" | awk '/Address:/ { print $2 }')

  cat > "$file" <<EOF
# ${role^} — generated $(date -u +%Y-%m-%dT%H:%M:%SZ)
PRIVATE_KEY=${pk}
AGENT_ADDRESS=${addr}
RPC_URL=${RPC_URL_DEFAULT}
PORT=${port}
ALLOWED_ORIGINS=http://localhost:3000,http://localhost:3001
EOF

  echo "created: ${file}  ${addr}"
}

echo "=== Bootstrapping local demo-agents env ==="
gen orchestrator 3000
gen summarizer   3001
gen translator   3002
gen vision       3003
gen sentiment    3004

echo
echo "=== Addresses that need funding (Base Sepolia) ==="
orch_addr=$(grep -E '^AGENT_ADDRESS=' .env.orchestrator | cut -d= -f2)
summ_addr=$(grep -E '^AGENT_ADDRESS=' .env.summarizer   | cut -d= -f2)
tran_addr=$(grep -E '^AGENT_ADDRESS=' .env.translator   | cut -d= -f2)
vis_addr=$(grep -E '^AGENT_ADDRESS=' .env.vision       | cut -d= -f2)
sent_addr=$(grep -E '^AGENT_ADDRESS=' .env.sentiment    | cut -d= -f2)

echo "  orchestrator (sponsor):  ${orch_addr}"
echo "  summarizer:              ${summ_addr}"
echo "  translator:              ${tran_addr}"
echo "  vision:                  ${vis_addr}"
echo "  sentiment:               ${sent_addr}"

echo
echo "=== Fund with ETH (faucet) ==="
echo "  1. https://portal.cdp.coinbase.com/products/faucet  (Base Sepolia ETH)"
echo "     Each address needs ~0.001 ETH for gas."

echo
echo "=== Fund orchestrator with test USDC ==="
echo "  2. https://faucet.circle.com  (select Base Sepolia)"
echo "     Send ≥ 0.1 USDC to ${orch_addr} (enough for ~50 demo runs)."

echo
echo "=== Register agents in AgentRegistry (optional) ==="
echo "  3. Once ETH is in addresses, run (registry is for discoverability;"
echo "     TaskEscrow does not require registration):"
echo
for role in summarizer:3001 translator:3002 vision:3003 sentiment:3004; do
  name="${role%%:*}"
  port="${role##*:}"
  printf '     cast send %s "registerAgent(string)" "http://localhost:%s" \\\n' \
    "$BASE_SEPOLIA_REGISTRY" "$port"
  printf '       --rpc-url %s \\\n' "$RPC_URL_DEFAULT"
  printf '       --private-key $(grep PRIVATE_KEY .env.%s | cut -d= -f2)\n' "$name"
  echo
done

echo "=== Add to orchestrator env ==="
echo "  4. Append to .env.orchestrator:"
echo "     SUMMARIZER_ADDRESS=${summ_addr}"
echo "     TRANSLATOR_ADDRESS=${tran_addr}"
echo "     VISION_ADDRESS=${vis_addr}"
echo "     SENTIMENT_ADDRESS=${sent_addr}"
echo "     OPENAI_API_KEY=sk-...  # optional — agents use mocks without it"

echo
echo "=== Run all five services (five terminals) ==="
echo "  pnpm --filter @sage/demo-agents dev:summarizer"
echo "  pnpm --filter @sage/demo-agents dev:translator"
echo "  pnpm --filter @sage/demo-agents dev:vision"
echo "  pnpm --filter @sage/demo-agents dev:sentiment"
echo "  pnpm --filter @sage/demo-agents dev:orchestrator"

echo
echo "=== Run web app ==="
echo "  pnpm --filter @sage/web dev"
echo "  → http://localhost:3000/demo"

echo
echo "Note: these wallets are local-dev only. Do not reuse for mainnet."
