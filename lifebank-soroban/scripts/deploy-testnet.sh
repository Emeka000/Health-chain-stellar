#!/bin/bash

set -e

# Configuration
NETWORK="testnet"
IDENTITY=${STELLAR_IDENTITY:-default}  # Override via STELLAR_IDENTITY env var; falls back to "default" for local dev

echo "🚀 Deploying Lifebank contracts to ${NETWORK}..."
echo ""

# Check if stellar CLI is installed
if ! command -v stellar &> /dev/null; then
    echo "❌ Error: stellar CLI not found. Please install it first."
    echo "   cargo install --locked stellar-cli"
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

    CONTRACT_ID=$(stellar contract deploy \
        --wasm target/wasm32-unknown-unknown/release/${contract}_contract.wasm \
        --source ${IDENTITY} \
        --network ${NETWORK})

    CONTRACT_IDS[$contract]=$CONTRACT_ID

    echo "  ✅ ${contract}: ${CONTRACT_ID}"
    echo ""
done

# Save contract IDs to testnet-specific file
echo "💾 Saving contract IDs to .contract-ids.testnet.json..."

OUTPUT_FILE=".contract-ids.testnet.json"

# Initialize the JSON file
echo "{}" > "${OUTPUT_FILE}"

# Add each contract ID
for contract in "${!CONTRACT_IDS[@]}"; do
    jq --arg contract "$contract" --arg id "${CONTRACT_IDS[$contract]}" \
      '.[$contract] = $id' "${OUTPUT_FILE}" > "${OUTPUT_FILE}.tmp"
    mv "${OUTPUT_FILE}.tmp" "${OUTPUT_FILE}"
done

echo ""
echo "✅ Deployment complete!"
echo ""
echo "📝 Contract IDs saved to ${OUTPUT_FILE}"

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
