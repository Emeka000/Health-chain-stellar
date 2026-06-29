#!/bin/bash

set -e

# Configuration
NETWORK="testnet"
IDENTITY=${STELLAR_IDENTITY:-default}  # Override via STELLAR_IDENTITY env var; falls back to "default" for local dev
DRY_RUN="${1:-false}"  # Pass --dry-run as first argument to validate without deploying
CONTRACT_IDS_FILE=".contract-ids.json"

echo "🚀 Deploying Lifebank contracts to ${NETWORK}..."
[[ "$DRY_RUN" == "--dry-run" ]] && echo "ℹ️  DRY RUN MODE — will validate without deploying"
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

# ── Validation phase: Ensure all WASMs exist ─────────────────────────────────────
echo "✓ Validating WASM binaries..."
echo ""

CONTRACTS_TO_DEPLOY=(coordinator identity inventory payments requests temperature matching reputation delivery analytics)

for contract in "${CONTRACTS_TO_DEPLOY[@]}"; do
    WASM_FILE="target/wasm32-unknown-unknown/release/${contract}_contract.wasm"
    if [[ ! -f "$WASM_FILE" ]]; then
        echo "❌ Error: Missing WASM binary for $contract"
        echo "   Expected: $WASM_FILE"
        exit 1
    fi
    echo "  ✓ ${contract}: $WASM_FILE"
done

echo ""

# Exit early if dry-run mode
if [[ "$DRY_RUN" == "--dry-run" ]]; then
    echo "✅ Dry-run validation successful! All WASM binaries are present."
    echo "   Run without --dry-run to deploy contracts."
    exit 0
fi

# ── Deployment phase ─────────────────────────────────────────────────────────────
echo "🌐 Deploying to ${NETWORK}..."
echo ""

# Initialize contract IDs tracking file with partial status
{
  jq -n '{
    status: "partial",
    network: "'${NETWORK}'",
    deployed_at: "'$(date -Iseconds)'",
    deployments: {}
  }' > "${CONTRACT_IDS_FILE}"
}

declare -A CONTRACT_IDS
DEPLOYED_COUNT=0

# Set trap to log state on error
trap 'on_deploy_error' ERR

on_deploy_error() {
    local exit_code=$?
    echo ""
    echo "❌ Deployment failed!"
    echo ""
    echo "Partially deployed contracts ($DEPLOYED_COUNT of ${#CONTRACTS_TO_DEPLOY[@]}):"
    for contract in "${CONTRACTS_TO_DEPLOY[@]:0:$DEPLOYED_COUNT}"; do
        echo "  - $contract: ${CONTRACT_IDS[$contract]}"
    done
    echo ""
    echo "State saved to: $CONTRACT_IDS_FILE"
    echo ""
    echo "To clean up, manually delete these contracts from the network:"
    echo "  for id in $(jq -r '.deployments | keys[]' \"$CONTRACT_IDS_FILE\"); do"
    echo "    soroban contract invoke --id \$id --source ${IDENTITY} --network ${NETWORK} -- version"
    echo "  done"
    echo ""
    exit $exit_code
}

# Deploy each contract
for contract in "${CONTRACTS_TO_DEPLOY[@]}"; do
    echo "Deploying ${contract} contract..."

    CONTRACT_ID=$(soroban contract deploy \
        --wasm target/wasm32-unknown-unknown/release/${contract}_contract.wasm \
        --source ${IDENTITY} \
        --network ${NETWORK})

    CONTRACT_IDS[$contract]=$CONTRACT_ID

    echo "  ✅ ${contract}: ${CONTRACT_ID}"

    # Save incrementally to file with contract ID and status
    jq --arg contract "$contract" --arg id "$CONTRACT_ID" \
        '.deployments[$contract] = $id' "${CONTRACT_IDS_FILE}" > "${CONTRACT_IDS_FILE}.tmp"
    mv "${CONTRACT_IDS_FILE}.tmp" "${CONTRACT_IDS_FILE}"

    ((DEPLOYED_COUNT++))
    echo ""
done

# Mark deployment as complete
jq '.status = "complete"' "${CONTRACT_IDS_FILE}" > "${CONTRACT_IDS_FILE}.tmp"
mv "${CONTRACT_IDS_FILE}.tmp" "${CONTRACT_IDS_FILE}"

# ── Update contracts.json ────────────────────────────────────────────────────────
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
echo "📝 Contract IDs saved to $CONTRACT_IDS_FILE and contracts.json"

# ── Regenerate TypeScript bindings (issue #846) ────────────────────────────────
echo ""
echo "🔗 Regenerating TypeScript client bindings..."

# Export contract IDs so generate-bindings.sh can pick them up
export SOROBAN_COORDINATOR_CONTRACT_ID="${CONTRACT_IDS[coordinator]:-}"
export SOROBAN_IDENTITY_CONTRACT_ID="${CONTRACT_IDS[identity]:-}"
export SOROBAN_INVENTORY_CONTRACT_ID="${CONTRACT_IDS[inventory]:-}"
export SOROBAN_PAYMENTS_CONTRACT_ID="${CONTRACT_IDS[payments]:-}"
export SOROBAN_REQUESTS_CONTRACT_ID="${CONTRACT_IDS[requests]:-}"
export SOROBAN_TEMPERATURE_CONTRACT_ID="${CONTRACT_IDS[temperature]:-}"
export SOROBAN_MATCHING_CONTRACT_ID="${CONTRACT_IDS[matching]:-}"
export SOROBAN_REPUTATION_CONTRACT_ID="${CONTRACT_IDS[reputation]:-}"
export SOROBAN_DELIVERY_CONTRACT_ID="${CONTRACT_IDS[delivery]:-}"
export SOROBAN_ANALYTICS_CONTRACT_ID="${CONTRACT_IDS[analytics]:-}"
export SOROBAN_NETWORK="${NETWORK}"

GENERATE_SCRIPT="$(cd "$(dirname "$0")/../.." && pwd)/scripts/generate-bindings.sh"

if [[ -f "${GENERATE_SCRIPT}" ]]; then
  bash "${GENERATE_SCRIPT}"
else
  echo "  ⚠️  generate-bindings.sh not found at ${GENERATE_SCRIPT} — skipping."
  echo "  Run scripts/generate-bindings.sh manually to regenerate TypeScript bindings."
fi
