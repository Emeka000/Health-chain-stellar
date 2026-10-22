#!/bin/bash

# Upgrade a single contract to a new WASM version
# Usage: ./scripts/upgrade.sh testnet identity
#
# This script:
# 1. Builds the specified contract
# 2. Uploads new WASM
# 3. Invokes upgrade() entrypoint with new WASM hash

set -e

NETWORK="${1:-testnet}"
CONTRACT_NAME="${2}"
IDENTITY="${3:-default}"
CONTRACT_IDS_FILE=".contract-ids.${NETWORK}.json"

if [ -z "$CONTRACT_NAME" ]; then
    echo "Usage: $0 <network> <contract_name> [identity]"
    echo "Example: $0 testnet identity default"
    echo ""
    echo "Valid contract names:"
    echo "  analytics, coordinator, delivery, identity, inventory,"
    echo "  matching, payments, reputation, requests, temperature"
    exit 1
fi

if [ ! -f "$CONTRACT_IDS_FILE" ]; then
    echo "❌ Error: $CONTRACT_IDS_FILE not found."
    exit 1
fi

echo "🔄 Upgrading $CONTRACT_NAME on ${NETWORK}..."
echo ""

# Helper function to extract contract ID
get_contract_id() {
    jq -r ".contracts.$1" "$CONTRACT_IDS_FILE"
}

# Build the contract
echo "📦 Building ${CONTRACT_NAME}..."
cargo build --release --target wasm32-unknown-unknown -p "${CONTRACT_NAME}_contract"

WASM_FILE="target/wasm32-unknown-unknown/release/${CONTRACT_NAME}_contract.wasm"

if [ ! -f "$WASM_FILE" ]; then
    echo "❌ Error: Built WASM not found at $WASM_FILE"
    exit 1
fi

echo "  ✅ Build complete: $WASM_FILE"
echo ""

# Get contract ID
CONTRACT_ID=$(get_contract_id "$CONTRACT_NAME")
ADMIN=$(stellar keys show $IDENTITY --public-key)

echo "📤 Uploading WASM..."
WASM_HASH=$(stellar contract deploy \
    --wasm "$WASM_FILE" \
    --source-account $IDENTITY \
    --network $NETWORK)

echo "  ✅ WASM uploaded: $WASM_HASH"
echo ""

# Invoke upgrade entrypoint
echo "🔧 Invoking upgrade() on $CONTRACT_NAME..."
stellar contract invoke \
    --contract-id "$CONTRACT_ID" \
    --source-account $IDENTITY \
    --network $NETWORK \
    -- upgrade \
    --admin "$ADMIN" \
    --new_wasm_hash "$WASM_HASH"

echo ""
echo "✅ Upgrade complete!"
echo ""
echo "Contract: $CONTRACT_NAME"
echo "Network:  $NETWORK"
echo "New WASM: $WASM_HASH"
