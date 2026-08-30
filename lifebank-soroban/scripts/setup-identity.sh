#!/bin/bash
# setup-identity.sh — create and fund a Stellar testnet identity before deploying.
#
# Usage:
#   ./scripts/setup-identity.sh              # uses STELLAR_IDENTITY or "default"
#   STELLAR_IDENTITY=alice ./scripts/setup-identity.sh
#
# In CI set STELLAR_IDENTITY as a GitHub Actions secret and the script picks it up
# automatically; no file editing required (see docs/contracts/deploy-setup.md).

set -euo pipefail

IDENTITY=${STELLAR_IDENTITY:-default}
NETWORK="testnet"

echo "Setting up Stellar identity '${IDENTITY}' on ${NETWORK}..."

# Generate the keypair if it does not already exist (--no-overwrite-existing
# is not a flag, so we use stderr redirect to suppress the "already exists" message).
stellar keys generate --network "${NETWORK}" "${IDENTITY}" 2>/dev/null || true

echo "  Keypair ready."

# Fund via Friendbot (idempotent — safe to call on an already-funded account).
echo "  Funding via Friendbot..."
stellar keys fund "${IDENTITY}" --network "${NETWORK}"

echo ""
echo "Identity '${IDENTITY}' is ready. Run ./scripts/deploy-testnet.sh to deploy."
