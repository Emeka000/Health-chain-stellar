#!/usr/bin/env bash
# generate-bindings.sh
#
# Regenerate TypeScript client bindings for all 5 HealthChain Soroban contracts
# using `stellar contract bindings typescript`.
#
# This script is run automatically as part of the deploy CI pipeline (issue #846)
# after contracts are deployed to testnet. It can also be run manually:
#
#   ./scripts/generate-bindings.sh
#
# Prerequisites:
#   - Stellar CLI installed: https://developers.stellar.org/docs/tools/developer-tools/cli/install-cli
#   - Contract IDs available in environment variables or .contract-ids.json
#   - SOROBAN_NETWORK set to "testnet" or "mainnet" (default: testnet)
#
# Environment variables (all optional — fall back to .contract-ids.json):
#   COORDINATOR_CONTRACT_ID
#   INVENTORY_CONTRACT_ID
#   PAYMENTS_CONTRACT_ID
#   REQUESTS_CONTRACT_ID
#   TEMPERATURE_CONTRACT_ID
#   SOROBAN_NETWORK

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
PACKAGES_DIR="${REPO_ROOT}/packages"
CONTRACTS_JSON="${REPO_ROOT}/lifebank-soroban/.contract-ids.json"
NETWORK="${SOROBAN_NETWORK:-testnet}"

# ── Helpers ────────────────────────────────────────────────────────────────────

log()  { echo "  ✅ $*"; }
warn() { echo "  ⚠️  $*"; }
fail() { echo "  ❌ $*" >&2; exit 1; }

# Resolve a contract ID: env var takes precedence over .contract-ids.json.
resolve_contract_id() {
  local env_var="$1"
  local json_key="$2"

  local from_env="${!env_var:-}"
  if [[ -n "${from_env}" && "${from_env}" != CAAAAAAA* ]]; then
    echo "${from_env}"
    return
  fi

  if [[ -f "${CONTRACTS_JSON}" ]]; then
    local from_json
    from_json=$(python3 -c "
import json, sys
data = json.load(open('${CONTRACTS_JSON}'))
print(data.get('contracts', {}).get('${json_key}', ''))
" 2>/dev/null || echo "")
    if [[ -n "${from_json}" && "${from_json}" != CAAAAAAA* ]]; then
      echo "${from_json}"
      return
    fi
  fi

  echo ""
}

# Generate bindings for a single contract.
generate_bindings() {
  local contract_name="$1"
  local contract_id="$2"
  local output_dir="${PACKAGES_DIR}/${contract_name}-sdk"

  if [[ -z "${contract_id}" ]]; then
    warn "No contract ID for '${contract_name}' — skipping binding generation."
    warn "Set ${contract_name^^}_CONTRACT_ID or deploy contracts first."
    return
  fi

  echo ""
  echo "📦 Generating bindings for ${contract_name} (${contract_id})..."

  stellar contract bindings typescript \
    --contract-id "${contract_id}" \
    --network "${NETWORK}" \
    --output-dir "${output_dir}"

  log "${contract_name}-sdk generated at ${output_dir}"
}

# ── Main ───────────────────────────────────────────────────────────────────────

echo ""
echo "🔗 HealthChain — Soroban TypeScript Binding Generator"
echo "   Network : ${NETWORK}"
echo "   Packages: ${PACKAGES_DIR}"
echo ""

# Check Stellar CLI is available
if ! command -v stellar &>/dev/null; then
  fail "Stellar CLI not found. Install it from https://developers.stellar.org/docs/tools/developer-tools/cli/install-cli"
fi

STELLAR_VERSION=$(stellar --version 2>&1 | head -1)
echo "   CLI     : ${STELLAR_VERSION}"
echo ""

# Resolve contract IDs
COORDINATOR_ID=$(resolve_contract_id "COORDINATOR_CONTRACT_ID" "coordinator")
INVENTORY_ID=$(resolve_contract_id "INVENTORY_CONTRACT_ID" "inventory")
PAYMENTS_ID=$(resolve_contract_id "PAYMENTS_CONTRACT_ID" "payments")
REQUESTS_ID=$(resolve_contract_id "REQUESTS_CONTRACT_ID" "requests")
TEMPERATURE_ID=$(resolve_contract_id "TEMPERATURE_CONTRACT_ID" "temperature")

# Generate bindings for each contract
generate_bindings "coordinator" "${COORDINATOR_ID}"
generate_bindings "inventory"   "${INVENTORY_ID}"
generate_bindings "payments"    "${PAYMENTS_ID}"
generate_bindings "requests"    "${REQUESTS_ID}"
generate_bindings "temperature" "${TEMPERATURE_ID}"

echo ""
echo "✅ Binding generation complete."
echo ""
echo "Next steps:"
echo "  1. Review generated files in packages/*-sdk/src/"
echo "  2. Run 'npm install' in the workspace root to link packages"
echo "  3. Run 'npm run build' in each package to compile TypeScript"
echo "  4. Restart the backend: npm run start:dev"
echo ""
