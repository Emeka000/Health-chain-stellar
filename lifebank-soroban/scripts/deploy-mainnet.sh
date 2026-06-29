#!/bin/bash

set -e

# Configuration
NETWORK="mainnet"

echo "🚀 Deploying Lifebank contracts to ${NETWORK}..."
echo ""

# Require mainnet environment configuration
if [[ -z "${STELLAR_IDENTITY}" ]]; then
    echo "❌ Error: STELLAR_IDENTITY environment variable is required."
    echo "   Set it to your mainnet Stellar CLI identity."
    exit 1
fi

if [[ -z "${STELLAR_RPC_URL}" ]]; then
    echo "❌ Error: STELLAR_RPC_URL environment variable is required."
    echo "   Example: https://mainnet.sorobanrpc.com"
    exit 1
fi

if [[ -z "${STELLAR_NETWORK_PASSPHRASE}" ]]; then
    echo "❌ Error: STELLAR_NETWORK_PASSPHRASE environment variable is required."
    echo "   For Stellar Mainnet: 'Public Global Stellar Network ; September 2015'"
    exit 1
fi

# Check if stellar CLI is installed
if ! command -v stellar &> /dev/null; then
    echo "❌ Error: stellar CLI not found. Please install it first."
    echo "   cargo install --locked stellar-cli"
    exit 1
fi

# Confirmation prompt
echo "⚠️  WARNING: You are about to deploy contracts to Stellar MAINNET"
echo ""
echo "Configuration:"
echo "  Identity: ${STELLAR_IDENTITY}"
echo "  RPC URL: ${STELLAR_RPC_URL}"
echo "  Network Passphrase: ${STELLAR_NETWORK_PASSPHRASE}"
echo ""
read -p "Type 'DEPLOY_TO_MAINNET' to proceed, or press Ctrl+C to cancel: " -r confirmation

if [[ "${confirmation}" != "DEPLOY_TO_MAINNET" ]]; then
    echo "❌ Deployment cancelled."
    exit 1
fi

echo ""

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
        --source ${STELLAR_IDENTITY} \
        --network ${NETWORK} \
        --rpc-url ${STELLAR_RPC_URL} \
        --network-passphrase "${STELLAR_NETWORK_PASSPHRASE}")

    CONTRACT_IDS[$contract]=$CONTRACT_ID

    echo "  ✅ ${contract}: ${CONTRACT_ID}"
    echo ""
done

# Save contract IDs to mainnet-specific file
echo "💾 Saving contract IDs to .contract-ids.mainnet.json..."

OUTPUT_FILE=".contract-ids.mainnet.json"

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
