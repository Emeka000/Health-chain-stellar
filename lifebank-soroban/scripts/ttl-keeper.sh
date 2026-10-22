#!/bin/bash

# TTL maintenance script - extends persistent entry lifetimes to prevent data loss
# Soroban data expires after ~6 months of inactivity; this resets that timer
#
# Run daily via cron:
#   0 0 * * * /path/to/lifebank-soroban/scripts/ttl-keeper.sh testnet >> /var/log/lifebank-ttl.log 2>&1

set -e

NETWORK="${1:-testnet}"
IDENTITY="${2:-default}"
CONTRACT_IDS_FILE=".contract-ids.${NETWORK}.json"

if [ ! -f "$CONTRACT_IDS_FILE" ]; then
    echo "❌ Error: $CONTRACT_IDS_FILE not found."
    exit 1
fi

# Get the timestamp for logging
TIMESTAMP=$(date '+%Y-%m-%d %H:%M:%S')

echo "[$TIMESTAMP] 🔄 Bumping TTLs on ${NETWORK}..."

# Helper function to extract contract ID
get_contract_id() {
    jq -r ".contracts.$1" "$CONTRACT_IDS_FILE"
}

# Helper function to bump TTL on a contract
bump_ttl() {
    local contract_name=$1
    local contract_id=$2
    
    # Try to invoke a benign read-only function to bump the TTL
    # Different contracts may have different read functions, using a generic approach
    if stellar contract invoke \
        --contract-id "$contract_id" \
        --source-account $IDENTITY \
        --network $NETWORK \
        -- get_admin 2>/dev/null; then
        echo "[$TIMESTAMP]   ✅ $contract_name TTL bumped"
        return 0
    else
        echo "[$TIMESTAMP]   ⚠️  $contract_name TTL bump failed (may need manual intervention)"
        return 1
    fi
}

# Bump TTL for all contracts
CONTRACTS=("analytics" "coordinator" "delivery" "identity" "inventory" "matching" "payments" "reputation" "requests" "temperature")

for contract in "${CONTRACTS[@]}"; do
    CONTRACT_ID=$(get_contract_id "$contract")
    bump_ttl "$contract" "$CONTRACT_ID"
done

echo "[$TIMESTAMP] ✅ TTL maintenance complete"
