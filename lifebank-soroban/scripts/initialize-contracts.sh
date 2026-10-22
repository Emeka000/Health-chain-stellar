#!/bin/bash

set -e

# Configuration
NETWORK="${1:-testnet}"
IDENTITY="${2:-default}"
CONTRACT_IDS_FILE=".contract-ids.${NETWORK}.json"

if [ ! -f "$CONTRACT_IDS_FILE" ]; then
    echo "❌ Error: $CONTRACT_IDS_FILE not found."
    echo "Run deploy-${NETWORK}.sh first."
    exit 1
fi

echo "🔧 Initializing Lifebank contracts on ${NETWORK}..."
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

# Get admin address from current key
ADMIN=$(stellar keys show $IDENTITY --public-key)

echo "📋 Using admin: $ADMIN"
echo ""

# Extract all contract IDs
ANALYTICS=$(get_contract_id "analytics")
COORDINATOR=$(get_contract_id "coordinator")
DELIVERY=$(get_contract_id "delivery")
IDENTITY_CONTRACT=$(get_contract_id "identity")
INVENTORY=$(get_contract_id "inventory")
MATCHING=$(get_contract_id "matching")
PAYMENTS=$(get_contract_id "payments")
REPUTATION=$(get_contract_id "reputation")
REQUESTS=$(get_contract_id "requests")
TEMPERATURE=$(get_contract_id "temperature")

# 1. Initialize Analytics
echo "1️⃣  Initializing analytics..."
invoke_contract "analytics" "$ANALYTICS" \
    initialize \
    --admin "$ADMIN"
echo "  ✅ analytics initialized"
echo ""

# 2. Initialize Coordinator
echo "2️⃣  Initializing coordinator..."
invoke_contract "coordinator" "$COORDINATOR" \
    initialize \
    --admin "$ADMIN" \
    --analytics_contract "$ANALYTICS" \
    --inventory_contract "$INVENTORY" \
    --requests_contract "$REQUESTS" \
    --payments_contract "$PAYMENTS" \
    --delivery_contract "$DELIVERY" \
    --identity_contract "$IDENTITY_CONTRACT" \
    --temperature_contract "$TEMPERATURE" \
    --reputation_contract "$REPUTATION" \
    --matching_contract "$MATCHING"
echo "  ✅ coordinator initialized"
echo ""

# 3. Initialize Delivery (links to Identity & Temperature)
echo "3️⃣  Initializing delivery..."
invoke_contract "delivery" "$DELIVERY" \
    initialize \
    --admin "$ADMIN" \
    --identity_contract "$IDENTITY_CONTRACT" \
    --temperature_contract "$TEMPERATURE"
echo "  ✅ delivery initialized"
echo ""

# 4. Initialize Identity
echo "4️⃣  Initializing identity..."
invoke_contract "identity" "$IDENTITY_CONTRACT" \
    initialize \
    --admin "$ADMIN"
echo "  ✅ identity initialized"
echo ""

# 5. Initialize Inventory
echo "5️⃣  Initializing inventory..."
invoke_contract "inventory" "$INVENTORY" \
    initialize \
    --admin "$ADMIN"
echo "  ✅ inventory initialized"
echo ""

# 6. Initialize Matching (links to Requests & Inventory)
echo "6️⃣  Initializing matching..."
invoke_contract "matching" "$MATCHING" \
    initialize \
    --admin "$ADMIN" \
    --requests_contract "$REQUESTS" \
    --inventory_contract "$INVENTORY"
echo "  ✅ matching initialized"
echo ""

# 7. Initialize Payments
echo "7️⃣  Initializing payments..."
invoke_contract "payments" "$PAYMENTS" \
    initialize \
    --admin "$ADMIN"
echo "  ✅ payments initialized"
echo ""

# 8. Initialize Reputation
echo "8️⃣  Initializing reputation..."
invoke_contract "reputation" "$REPUTATION" \
    initialize \
    --admin "$ADMIN"
echo "  ✅ reputation initialized"
echo ""

# 9. Initialize Requests (links to Inventory, Matching, Payments)
echo "9️⃣  Initializing requests..."
invoke_contract "requests" "$REQUESTS" \
    initialize \
    --admin "$ADMIN" \
    --inventory_contract "$INVENTORY" \
    --matching_contract "$MATCHING" \
    --payments_contract "$PAYMENTS"
echo "  ✅ requests initialized"
echo ""

# 10. Initialize Temperature (links to Identity)
echo "🔟 Initializing temperature..."
invoke_contract "temperature" "$TEMPERATURE" \
    initialize \
    --admin "$ADMIN" \
    --identity_contract "$IDENTITY_CONTRACT"
echo "  ✅ temperature initialized"
echo ""

echo "✅ All contracts initialized!"
echo ""
echo "Next step: Wire contracts together"
echo "  ./scripts/wire-contracts.sh $NETWORK"
