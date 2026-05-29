#!/bin/bash

set -e

# Configuration
NETWORK="testnet"
IDENTITY="default"  # Your Stellar CLI identity

echo "🚀 Deploying Lifebank contracts to ${NETWORK}..."
echo ""

# Check if soroban CLI is installed
if ! command -v soroban &> /dev/null; then
    echo "❌ Error: soroban CLI not found. Please install it first."
    echo "   cargo install --locked soroban-cli"
    exit 1
fi

# Build all contracts first
echo "📦 Building contracts..."
./scripts/build-all.sh

echo ""
echo "🌐 Deploying to ${NETWORK}..."
echo ""

# Deployment order: coordinator first (it's a dependency for other contracts)
declare -A CONTRACT_IDS

for contract in coordinator identity inventory payments requests temperature matching reputation delivery analytics; do
    echo "Deploying ${contract} contract..."

    CONTRACT_ID=$(soroban contract deploy \
        --wasm target/wasm32-unknown-unknown/release/${contract}_contract.wasm \
        --source ${IDENTITY} \
        --network ${NETWORK})

    CONTRACT_IDS[$contract]=$CONTRACT_ID

    echo "  ✅ ${contract}: ${CONTRACT_ID}"
    echo ""
done

# Update contracts.json with deployed IDs
echo "💾 Updating contracts.json with deployed IDs..."

{
  # Start with testnet object
  jq --arg network "testnet" '.testnet = {}' contracts.json > contracts.json.tmp

  # Add each contract ID
  for contract in "${!CONTRACT_IDS[@]}"; do
    jq --arg contract "$contract" --arg id "${CONTRACT_IDS[$contract]}" \
      '.testnet[$contract] = $id' contracts.json.tmp > contracts.json.tmp2
    mv contracts.json.tmp2 contracts.json.tmp
  done

  mv contracts.json.tmp contracts.json
}

echo ""
echo "✅ Deployment complete!"
echo ""
echo "📝 Contract IDs saved to .contract-ids.json"

# ── Regenerate TypeScript bindings (issue #846) ────────────────────────────────
echo ""
echo "🔗 Regenerating TypeScript client bindings..."

# Export contract IDs so generate-bindings.sh can pick them up
export COORDINATOR_CONTRACT_ID="${CONTRACT_IDS[coordinator]:-}"
export INVENTORY_CONTRACT_ID="${CONTRACT_IDS[inventory]}"
export PAYMENTS_CONTRACT_ID="${CONTRACT_IDS[payments]}"
export REQUESTS_CONTRACT_ID="${CONTRACT_IDS[requests]}"
export TEMPERATURE_CONTRACT_ID="${CONTRACT_IDS[temperature]:-}"
export SOROBAN_NETWORK="${NETWORK}"

GENERATE_SCRIPT="$(cd "$(dirname "$0")/../.." && pwd)/scripts/generate-bindings.sh"

if [[ -f "${GENERATE_SCRIPT}" ]]; then
  bash "${GENERATE_SCRIPT}"
else
  echo "  ⚠️  generate-bindings.sh not found at ${GENERATE_SCRIPT} — skipping."
  echo "  Run scripts/generate-bindings.sh manually to regenerate TypeScript bindings."
fi
