#!/bin/bash

set -e

source "$(dirname "$0")/wasm-artifacts.sh"

echo "🔨 Building all Lifebank contracts..."
echo ""

# Build in release mode for optimized WASM
cargo build --release --target wasm32-unknown-unknown \
    -p coordinator-contract \
    -p identity-contract \
    -p inventory-contract \
    -p payment-contract \
    -p request-contract \
    -p temperature-contract \
    -p matching-contract \
    -p reputation-contract \
    -p delivery-contract \
    -p analytics-contract

echo ""
echo "✅ Build complete!"
echo ""
echo "📦 Contract artifacts:"
for contract in coordinator identity inventory payments requests temperature matching reputation delivery analytics; do
    echo "  - ${contract}: ${WASM_DIR}/${WASM_ARTIFACTS[$contract]}.wasm"
done
echo ""

# Optional: Optimize WASM files
if command -v soroban &> /dev/null; then
    echo "🔧 Optimizing WASM files..."

    for contract in inventory requests payments identity; do
        soroban contract optimize \
            --wasm "${WASM_DIR}/${WASM_ARTIFACTS[$contract]}.wasm"
    done
    
    echo "✅ Optimization complete!"
fi
