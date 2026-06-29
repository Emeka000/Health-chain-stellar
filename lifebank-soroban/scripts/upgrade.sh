#!/bin/bash
# upgrade.sh — upgrade a deployed Lifebank Soroban contract in-place.
#
# Soroban supports replacing a contract's WASM while preserving its ledger
# address and all persistent storage.  This script:
#   1. Installs the new WASM onto the ledger (stellar contract install)
#   2. Calls the on-chain `upgrade` admin function with the new WASM hash
#
# Usage:
#   CONTRACT=inventory NEW_WASM=target/wasm32-unknown-unknown/release/inventory_contract.wasm \
#     ./scripts/upgrade.sh
#
# Required environment variables:
#   CONTRACT        contract name (coordinator | identity | inventory | payments |
#                   requests | temperature | matching | reputation | delivery | analytics)
#   NEW_WASM        path to the newly compiled .wasm file
#
# Optional environment variables:
#   STELLAR_IDENTITY   Stellar CLI identity to use (default: "default")
#   NETWORK            network to target (default: "testnet")
#   CONTRACT_ID        override the contract ID from contracts.json

set -euo pipefail

IDENTITY=${STELLAR_IDENTITY:-default}
NETWORK=${NETWORK:-testnet}
CONTRACT=${CONTRACT:?CONTRACT env var is required}
NEW_WASM=${NEW_WASM:?NEW_WASM env var is required}

if [[ ! -f "${NEW_WASM}" ]]; then
    echo "Error: WASM file not found: ${NEW_WASM}" >&2
    exit 1
fi

# Resolve the on-chain contract ID from contracts.json unless overridden.
if [[ -z "${CONTRACT_ID:-}" ]]; then
    CONTRACTS_JSON="$(cd "$(dirname "$0")/.." && pwd)/contracts.json"
    if [[ ! -f "${CONTRACTS_JSON}" ]]; then
        echo "Error: contracts.json not found at ${CONTRACTS_JSON}" >&2
        echo "       Set CONTRACT_ID env var to specify the contract address manually." >&2
        exit 1
    fi
    CONTRACT_ID=$(jq -r ".${NETWORK}.${CONTRACT} // empty" "${CONTRACTS_JSON}")
    if [[ -z "${CONTRACT_ID}" ]]; then
        echo "Error: no entry for '${NETWORK}.${CONTRACT}' in contracts.json" >&2
        exit 1
    fi
fi

echo "Upgrading '${CONTRACT}' on ${NETWORK}..."
echo "  Contract ID : ${CONTRACT_ID}"
echo "  New WASM    : ${NEW_WASM}"
echo "  Identity    : ${IDENTITY}"
echo ""

# Step 1: install the new WASM onto the ledger and capture its hash.
echo "Step 1/2: Installing new WASM..."
NEW_WASM_HASH=$(stellar contract install \
    --wasm "${NEW_WASM}" \
    --source "${IDENTITY}" \
    --network "${NETWORK}")

echo "  WASM hash: ${NEW_WASM_HASH}"
echo ""

# Step 2: invoke the on-chain upgrade function.
echo "Step 2/2: Invoking on-chain upgrade..."
stellar contract invoke \
    --id "${CONTRACT_ID}" \
    --source "${IDENTITY}" \
    --network "${NETWORK}" \
    -- upgrade \
    --admin "$(stellar keys address "${IDENTITY}")" \
    --new_wasm_hash "${NEW_WASM_HASH}"

echo ""
echo "Upgrade of '${CONTRACT}' complete."
echo "Contract address unchanged: ${CONTRACT_ID}"
