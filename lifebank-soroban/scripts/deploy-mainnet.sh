#!/bin/bash

set -e

# Configuration
NETWORK="mainnet"
IDENTITY="${1:-default}"  # Stellar CLI identity; default to 'default'

echo "⚠️  MAINNET DEPLOYMENT - This will deploy to production!"
echo ""
read -p "Are you sure? Type 'yes' to continue: " confirm
if [ "$confirm" != "yes" ]; then
    echo "Deployment cancelled."
    exit 0
fi

echo ""
echo "🚀 Deploying Lifebank contracts to ${NETWORK}..."
echo ""

# Check if stellar CLI is installed
if ! command -v stellar &> /dev/null; then
    echo "❌ Error: stellar CLI not found. Please install it first."
    echo "   https://github.com/stellar/stellar-cli"
    exit 1
fi

# Build all contracts first
echo "📦 Building contracts..."
./scripts/build-all.sh

echo ""
echo "🌐 Deploying to ${NETWORK}..."
echo ""

# Deploy each contract
declare -A CONTRACT_IDS

CONTRACTS=("analytics" "coordinator" "delivery" "identity" "inventory" "matching" "payments" "reputation" "requests" "temperature")

for contract in "${CONTRACTS[@]}"; do
    echo "Deploying ${contract} contract..."
    
    CONTRACT_ID=$(stellar contract deploy \
        --wasm "target/wasm32-unknown-unknown/release/${contract}_contract.wasm" \
        --source-account ${IDENTITY} \
        --network ${NETWORK})
    
    CONTRACT_IDS[$contract]=$CONTRACT_ID
    
    echo "  ✅ ${contract}: ${CONTRACT_ID}"
    echo ""
done

# Save contract IDs to a file
echo "💾 Saving contract IDs to .contract-ids.${NETWORK}.json..."

cat > ".contract-ids.${NETWORK}.json" << EOF
{
  "network": "${NETWORK}",
  "deployed_at": "$(date -u +"%Y-%m-%dT%H:%M:%SZ")",
  "contracts": {
    "analytics": "${CONTRACT_IDS[analytics]}",
    "coordinator": "${CONTRACT_IDS[coordinator]}",
    "delivery": "${CONTRACT_IDS[delivery]}",
    "identity": "${CONTRACT_IDS[identity]}",
    "inventory": "${CONTRACT_IDS[inventory]}",
    "matching": "${CONTRACT_IDS[matching]}",
    "payments": "${CONTRACT_IDS[payments]}",
    "reputation": "${CONTRACT_IDS[reputation]}",
    "requests": "${CONTRACT_IDS[requests]}",
    "temperature": "${CONTRACT_IDS[temperature]}"
  }
}
EOF

echo ""
echo "✅ Deployment complete!"
echo ""
echo "📝 Contract IDs saved to .contract-ids.${NETWORK}.json"
echo ""
echo "Next steps:"
echo "  1. Backup .contract-ids.${NETWORK}.json"
echo "  2. Initialize contracts: ./scripts/initialize-contracts.sh ${NETWORK}"
echo "  3. Wire contracts: ./scripts/wire-contracts.sh ${NETWORK}"
echo "  4. Verify deployment: ./scripts/verify-deployment.sh ${NETWORK}"
