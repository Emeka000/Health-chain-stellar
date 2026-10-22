#!/bin/bash

set -e

echo "🔨 Building all Lifebank contracts..."
echo ""

# Build in release mode for optimized WASM
cargo build --release --target wasm32-unknown-unknown \
    -p inventory-contract \
    -p request-contract \
    -p payment-contract \
    -p temperature-contract \
    -p delivery-contract \
    -p reputation-contract \
    -p identity-contract

echo ""
echo "✅ Build complete!"
echo ""
echo "📦 Contract artifacts:"
echo "  - Inventory: target/wasm32-unknown-unknown/release/inventory_contract.wasm"
echo "  - Requests:  target/wasm32-unknown-unknown/release/requests_contract.wasm"
echo "  - Payments:  target/wasm32-unknown-unknown/release/payments_contract.wasm"
echo "  - Identity:  target/wasm32-unknown-unknown/release/identity_contract.wasm"
echo ""

# Optional: Optimize WASM files
if command -v soroban &> /dev/null; then
    echo "🔧 Optimizing WASM files..."
    
    for contract in inventory requests payments identity; do
        soroban contract optimize \
            --wasm target/wasm32-unknown-unknown/release/${contract}_contract.wasm
    done
    
    echo "✅ Optimization complete!"
fi
