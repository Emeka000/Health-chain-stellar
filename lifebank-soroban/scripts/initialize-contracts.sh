#!/bin/bash

set -e

# Contract initialization script for Lifebank Soroban contracts
# This script initializes deployed contracts with admin, token addresses, and dependencies
#
# Prerequisites:
#   - Contracts must be deployed first (deploy-testnet.sh or deploy-mainnet.sh)
#   - Contract IDs saved in .contract-ids.testnet.json or .contract-ids.mainnet.json
#   - STELLAR_IDENTITY set to the admin identity
#   - STELLAR_NETWORK set to testnet or mainnet
#   - STELLAR_RPC_URL set (for mainnet)

NETWORK=${STELLAR_NETWORK:-testnet}
IDENTITY=${STELLAR_IDENTITY:-default}

echo "🔧 Initializing Lifebank contracts on ${NETWORK}..."
echo ""

# Determine which contract ID file to use
if [[ "$NETWORK" == "mainnet" ]]; then
    CONTRACT_FILE=".contract-ids.mainnet.json"
    RPC_FLAG="--rpc-url=${STELLAR_RPC_URL}"
else
    CONTRACT_FILE=".contract-ids.testnet.json"
    RPC_FLAG=""
fi

if [[ ! -f "$CONTRACT_FILE" ]]; then
    echo "❌ Error: $CONTRACT_FILE not found."
    echo "   Run deploy-testnet.sh or deploy-mainnet.sh first."
    exit 1
fi

# Read contract IDs
COORDINATOR_ID=$(jq -r '.coordinator' "$CONTRACT_FILE")
IDENTITY_ID=$(jq -r '.identity' "$CONTRACT_FILE")
INVENTORY_ID=$(jq -r '.inventory' "$CONTRACT_FILE")
PAYMENTS_ID=$(jq -r '.payments' "$CONTRACT_FILE")
REQUESTS_ID=$(jq -r '.requests' "$CONTRACT_FILE")
TEMPERATURE_ID=$(jq -r '.temperature' "$CONTRACT_FILE")
MATCHING_ID=$(jq -r '.matching' "$CONTRACT_FILE")
REPUTATION_ID=$(jq -r '.reputation' "$CONTRACT_FILE")
DELIVERY_ID=$(jq -r '.delivery' "$CONTRACT_FILE")
ANALYTICS_ID=$(jq -r '.analytics' "$CONTRACT_FILE")

# Get the admin address (usually the source identity's public key)
ADMIN_ADDRESS=$(stellar keys address "$IDENTITY" 2>/dev/null || echo "")
if [[ -z "$ADMIN_ADDRESS" ]]; then
    echo "❌ Error: Could not determine admin address from identity '$IDENTITY'"
    echo "   Make sure STELLAR_IDENTITY is set correctly."
    exit 1
fi

echo "Admin: $ADMIN_ADDRESS"
echo "Network: $NETWORK"
echo ""

# Helper function to invoke contract initialization
init_contract() {
    local contract_name=$1
    local contract_id=$2
    shift 2
    local extra_args=("$@")

    echo "Initializing $contract_name..."
    stellar contract invoke \
        --id "$contract_id" \
        --source "$IDENTITY" \
        --network "$NETWORK" \
        $RPC_FLAG \
        -- initialize \
        --admin "$ADMIN_ADDRESS" \
        "${extra_args[@]}"
    echo "  ✅ $contract_name initialized"
    echo ""
}

# Initialize contracts in dependency order

echo "📦 Phase 1: Contracts with no dependencies..."
echo ""

# identity (only needs admin)
init_contract "identity" "$IDENTITY_ID"

# reputation (only needs admin)
init_contract "reputation" "$REPUTATION_ID"

# temperature (only needs admin)
init_contract "temperature" "$TEMPERATURE_ID"

# inventory (only needs admin)
init_contract "inventory" "$INVENTORY_ID"

echo "📦 Phase 2: Contracts with single dependencies..."
echo ""

# requests (needs inventory)
init_contract "requests" "$REQUESTS_ID" \
    --inventory-contract "$INVENTORY_ID"

# payments (requests is optional, we set it)
init_contract "payments" "$PAYMENTS_ID" \
    --requests-contract "$REQUESTS_ID"

# delivery (needs requests)
init_contract "delivery" "$DELIVERY_ID" \
    --request-contract "$REQUESTS_ID"

echo "📦 Phase 3: Contracts with multiple dependencies..."
echo ""

# matching (needs inventory, requests)
init_contract "matching" "$MATCHING_ID" \
    --inventory-contract "$INVENTORY_ID" \
    --requests-contract "$REQUESTS_ID"

# analytics (needs inventory, requests, payments)
init_contract "analytics" "$ANALYTICS_ID" \
    --inventory-contract "$INVENTORY_ID" \
    --requests-contract "$REQUESTS_ID" \
    --payments-contract "$PAYMENTS_ID"

echo "📦 Phase 4: Coordinator (depends on all domain contracts)..."
echo ""

# coordinator (needs requests, inventory, payments)
init_contract "coordinator" "$COORDINATOR_ID" \
    --request-contract "$REQUESTS_ID" \
    --inventory-contract "$INVENTORY_ID" \
    --payment-contract "$PAYMENTS_ID"

echo ""
echo "✅ Contract initialization complete!"
echo ""
echo "Initialized contracts:"
echo "  - identity: $IDENTITY_ID"
echo "  - reputation: $REPUTATION_ID"
echo "  - temperature: $TEMPERATURE_ID"
echo "  - inventory: $INVENTORY_ID"
echo "  - requests: $REQUESTS_ID"
echo "  - payments: $PAYMENTS_ID"
echo "  - delivery: $DELIVERY_ID"
echo "  - matching: $MATCHING_ID"
echo "  - analytics: $ANALYTICS_ID"
echo "  - coordinator: $COORDINATOR_ID"
