#!/bin/bash

# Upgrade all contracts to new WASM versions
# Usage: ./scripts/upgrade-all.sh testnet [identity]

set -e

NETWORK="${1:-testnet}"
IDENTITY="${2:-default}"

echo "⚠️  UPGRADING ALL CONTRACTS on ${NETWORK}"
echo ""
read -p "Are you sure? Type 'yes' to continue: " confirm
if [ "$confirm" != "yes" ]; then
    echo "Upgrade cancelled."
    exit 0
fi

echo ""
echo "🚀 Upgrading all 10 contracts..."
echo ""

CONTRACTS=("analytics" "coordinator" "delivery" "identity" "inventory" "matching" "payments" "reputation" "requests" "temperature")

FAILED=0
SUCCEEDED=0

for contract in "${CONTRACTS[@]}"; do
    echo "=========================================="
    echo "Upgrading: $contract"
    echo "=========================================="
    
    if ./scripts/upgrade.sh "$NETWORK" "$contract" "$IDENTITY"; then
        SUCCEEDED=$((SUCCEEDED + 1))
    else
        echo "❌ Failed to upgrade $contract"
        FAILED=$((FAILED + 1))
    fi
    
    echo ""
done

echo "=========================================="
echo "Upgrade Summary"
echo "=========================================="
echo "✅ Succeeded: $SUCCEEDED"
echo "❌ Failed: $FAILED"
echo ""

if [ $FAILED -eq 0 ]; then
    echo "✅ All contracts upgraded successfully!"
else
    echo "⚠️  Some contracts failed to upgrade."
    exit 1
fi
