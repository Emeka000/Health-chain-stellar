#!/bin/bash

set -e

# Configuration
NETWORK="${1:-testnet}"
IDENTITY="${2:-default}"
CONTRACT_IDS_FILE=".contract-ids.${NETWORK}.json"

if [ ! -f "$CONTRACT_IDS_FILE" ]; then
    echo "❌ Error: $CONTRACT_IDS_FILE not found."
    exit 1
fi

echo "✔️  Verifying Lifebank deployment on ${NETWORK}..."
echo ""

# Helper function to extract contract ID
get_contract_id() {
    jq -r ".contracts.$1" "$CONTRACT_IDS_FILE"
}

# Helper function to check contract
check_contract() {
    local contract_name=$1
    local contract_id=$2
    
    if stellar contract info --contract-id "$contract_id" --network $NETWORK &> /dev/null; then
        echo "  ✅ $contract_name: $contract_id"
        return 0
    else
        echo "  ❌ $contract_name: $contract_id (not found)"
        return 1
    fi
}

FAILED=0

# Check all contracts
CONTRACTS=("analytics" "coordinator" "delivery" "identity" "inventory" "matching" "payments" "reputation" "requests" "temperature")

echo "📋 Checking all 10 contracts..."
for contract in "${CONTRACTS[@]}"; do
    CONTRACT_ID=$(get_contract_id "$contract")
    if ! check_contract "$contract" "$CONTRACT_ID"; then
        FAILED=$((FAILED + 1))
    fi
done

echo ""
if [ $FAILED -eq 0 ]; then
    echo "✅ All contracts deployed successfully!"
    echo ""
    echo "📝 Contract IDs:"
    jq '.contracts' "$CONTRACT_IDS_FILE"
else
    echo "❌ $FAILED contract(s) failed verification."
    exit 1
fi
