#!/bin/bash
# ttl-keeper.sh — periodically extend TTL for all active persistent storage entries.
#
# Soroban persistent entries expire after their TTL elapses.  The contracts call
# extend_ttl on every write, but entries that are rarely written (e.g. blood units
# that sit in Available status for months) can still approach expiry.  This keeper
# bot proactively bumps TTLs before they drop below the threshold by calling the
# permissionless `extend_ttl` entrypoint each contract exposes.
#
# Run this on a cron schedule — daily is sufficient for the 30-day threshold:
#   0 0 * * * /path/to/ttl-keeper.sh >> /var/log/ttl-keeper.log 2>&1
#
# Environment variables:
#   STELLAR_IDENTITY   Stellar CLI identity to use (default: "default")
#   NETWORK            target network (default: "testnet")
#   CONTRACTS_JSON     path to the deploy output file (default: auto-detected)
#   MAX_UNIT_ID        highest blood-unit ID to scan (default: read from contract)
#   MAX_REQUEST_ID     highest request ID to scan (default: read from contract)

set -euo pipefail

IDENTITY=${STELLAR_IDENTITY:-default}
NETWORK=${NETWORK:-testnet}
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

# The deploy scripts write .contract-ids.<network>.json; fall back to contracts.json
# only if that file is absent.
DEFAULT_IDS_JSON="${SCRIPT_DIR}/../.contract-ids.${NETWORK}.json"
if [[ -z "${CONTRACTS_JSON:-}" ]]; then
    if [[ -f "${DEFAULT_IDS_JSON}" ]]; then
        CONTRACTS_JSON="${DEFAULT_IDS_JSON}"
    else
        CONTRACTS_JSON="${SCRIPT_DIR}/../contracts.json"
    fi
fi

if [[ ! -f "${CONTRACTS_JSON}" ]]; then
    echo "Error: contract IDs file not found at ${CONTRACTS_JSON}" >&2
    exit 1
fi

# Deploy output is flat ({inventory: C...}); contracts.json is nested ({testnet: {inventory: C...}}).
read_id() {
    local key="$1"
    local flat nested
    flat=$(jq -r --arg k "${key}" '.[$k] // empty' "${CONTRACTS_JSON}" 2>/dev/null || true)
    nested=$(jq -r --arg n "${NETWORK}" --arg k "${key}" '.[$n][$k] // empty' "${CONTRACTS_JSON}" 2>/dev/null || true)
    if [[ -n "${flat}" ]]; then echo "${flat}"; else echo "${nested}"; fi
}

INVENTORY_ID=$(read_id inventory)
REQUESTS_ID=$(read_id requests)
IDENTITY_ID=$(read_id identity)
PAYMENTS_ID=$(read_id payments)

invoke() {
    local contract_id="$1"; shift
    stellar contract invoke \
        --id "${contract_id}" \
        --source "${IDENTITY}" \
        --network "${NETWORK}" \
        -- "$@"
}

# Call extend_ttl for a single entity; fail loudly on error.
extend_one() {
    local contract_id="$1" entity="$2" id="$3"
    if ! invoke "${contract_id}" extend_ttl --entity "${entity}" --id "${id}" >/dev/null; then
        echo "Error: extend_ttl failed for ${entity} ${id} on ${contract_id}" >&2
        exit 1
    fi
}

echo "[$(date -u +%FT%TZ)] TTL keeper starting on ${NETWORK} (ids: ${CONTRACTS_JSON})..."

# ── Inventory: extend TTL for every blood unit ───────────────────────────────
if [[ -n "${INVENTORY_ID}" ]]; then
    echo "Scanning inventory contract ${INVENTORY_ID}..."
    MAX_ID=${MAX_UNIT_ID:-$(invoke "${INVENTORY_ID}" get_blood_unit_counter)}
    echo "  Blood unit counter: ${MAX_ID}"
    for ((i=1; i<=MAX_ID; i++)); do
        extend_one "${INVENTORY_ID}" unit "$i"
    done
    echo "  Inventory scan done (${MAX_ID} units)."
fi

# ── Requests: extend TTL for every request ───────────────────────────────────
if [[ -n "${REQUESTS_ID}" ]]; then
    echo "Scanning requests contract ${REQUESTS_ID}..."
    MAX_REQ=${MAX_REQUEST_ID:-$(invoke "${REQUESTS_ID}" get_request_counter)}
    echo "  Request counter: ${MAX_REQ}"
    for ((i=1; i<=MAX_REQ; i++)); do
        extend_one "${REQUESTS_ID}" request "$i"
    done
    echo "  Requests scan done (${MAX_REQ} requests)."
fi

# ── Identity: extend TTL for every organization ──────────────────────────────
if [[ -n "${IDENTITY_ID}" ]]; then
    echo "Scanning identity contract ${IDENTITY_ID}..."
    MAX_ORG=$(invoke "${IDENTITY_ID}" get_organization_counter)
    echo "  Organization counter: ${MAX_ORG}"
    for ((i=1; i<=MAX_ORG; i++)); do
        extend_one "${IDENTITY_ID}" organization "$i"
    done
    echo "  Identity scan done (${MAX_ORG} organizations)."
fi

# ── Payments: extend TTL for every escrow record ─────────────────────────────
if [[ -n "${PAYMENTS_ID}" ]]; then
    echo "Scanning payments contract ${PAYMENTS_ID}..."
    MAX_ESCROW=$(invoke "${PAYMENTS_ID}" get_escrow_counter)
    echo "  Escrow counter: ${MAX_ESCROW}"
    for ((i=1; i<=MAX_ESCROW; i++)); do
        extend_one "${PAYMENTS_ID}" escrow "$i"
    done
    echo "  Payments scan done (${MAX_ESCROW} escrows)."
fi

echo "[$(date -u +%FT%TZ)] TTL keeper finished."
