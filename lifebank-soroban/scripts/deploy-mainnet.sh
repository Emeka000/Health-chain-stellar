#!/bin/bash

set -e

# Configuration
NETWORK="mainnet"
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
  # Start with mainnet object
  jq --arg network "mainnet" '.mainnet = {}' contracts.json > contracts.json.tmp

  # Add each contract ID
  for contract in "${!CONTRACT_IDS[@]}"; do
    jq --arg contract "$contract" --arg id "${CONTRACT_IDS[$contract]}" \
      '.mainnet[$contract] = $id' contracts.json.tmp > contracts.json.tmp2
    mv contracts.json.tmp2 contracts.json.tmp
  done

  mv contracts.json.tmp contracts.json
}

echo ""
echo "✅ Deployment complete!"
echo ""
echo "📝 Contract IDs saved to contracts.json"
