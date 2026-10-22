#!/bin/bash

set -e

# Configuration
NETWORK="${1:-testnet}"
IDENTITY="${2:-default}"
CONTRACT_IDS_FILE=".contract-ids.${NETWORK}.json"

if [ ! -f "$CONTRACT_IDS_FILE" ]; then
    echo "❌ Error: $CONTRACT_IDS_FILE not found."
    echo "Run deploy-${NETWORK}.sh and initialize-contracts.sh first."
    exit 1
fi

echo "🔗 Wiring contracts on ${NETWORK}..."
echo ""

# Helper function to extract contract ID
get_contract_id() {
    jq -r ".contracts.$1" "$CONTRACT_IDS_FILE"
}

# Helper function to invoke contract
invoke_contract() {
    local contract_name=$1
    local contract_id=$2
    shift 2
    
    stellar contract invoke \
        --contract-id "$contract_id" \
        --source-account $IDENTITY \
        --network $NETWORK \
        -- "$@"
}

# Get admin address
ADMIN=$(stellar keys show $IDENTITY --public-key)

# Extract all contract IDs
PAYMENTS=$(get_contract_id "payments")
REQUESTS=$(get_contract_id "requests")
TEMPERATURE=$(get_contract_id "temperature")
COORDINATOR=$(get_contract_id "coordinator")

echo "📋 Using admin: $ADMIN"
echo ""

# 1. Wire Payments → Requests
echo "1️⃣  Wiring payments to requests..."
invoke_contract "payments" "$PAYMENTS" \
    set_requests_contract \
    --admin "$ADMIN" \
    --requests_contract "$REQUESTS"
echo "  ✅ payments linked to requests"
echo ""

# 2. Wire Requests → Payments
echo "2️⃣  Wiring requests to payments..."
invoke_contract "requests" "$REQUESTS" \
    set_payments_contract \
    --admin "$ADMIN" \
    --payments_contract "$PAYMENTS"
echo "  ✅ requests linked to payments"
echo ""

# 3. Wire Temperature → Coordinator (optional but recommended)
echo "3️⃣  Wiring temperature to coordinator..."
invoke_contract "temperature" "$TEMPERATURE" \
    set_coordinator \
    --admin "$ADMIN" \
    --coordinator "$COORDINATOR"
echo "  ✅ temperature linked to coordinator"
echo ""

echo "✅ Contract wiring complete!"
echo ""
echo "Next step: Verify deployment"
echo "  ./scripts/verify-deployment.sh $NETWORK"
