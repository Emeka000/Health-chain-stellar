#!/bin/bash

set -e

echo "🔨 Building all 10 Lifebank contracts..."
echo ""

# Build in release mode for optimized WASM
cargo build --release --target wasm32-unknown-unknown

echo ""
echo "✅ Build complete!"
echo ""
echo "📦 Contract artifacts:"
echo "  - Analytics:    target/wasm32-unknown-unknown/release/analytics_contract.wasm"
echo "  - Coordinator:  target/wasm32-unknown-unknown/release/coordinator_contract.wasm"
echo "  - Delivery:     target/wasm32-unknown-unknown/release/delivery_contract.wasm"
echo "  - Identity:     target/wasm32-unknown-unknown/release/identity_contract.wasm"
echo "  - Inventory:    target/wasm32-unknown-unknown/release/inventory_contract.wasm"
echo "  - Matching:     target/wasm32-unknown-unknown/release/matching_contract.wasm"
echo "  - Payments:     target/wasm32-unknown-unknown/release/payments_contract.wasm"
echo "  - Reputation:   target/wasm32-unknown-unknown/release/reputation_contract.wasm"
echo "  - Requests:     target/wasm32-unknown-unknown/release/requests_contract.wasm"
echo "  - Temperature:  target/wasm32-unknown-unknown/release/temperature_contract.wasm"
echo ""

echo "✅ All contracts built successfully!"