#!/bin/bash
# Single source of truth: logical contract name -> WASM file stem cargo emits.
# Cargo writes <crate name with '-' replaced by '_'>.wasm, and the payments and
# requests crates are named payment-contract / request-contract (not *s-contract).
# Source this file; do not execute it.

WASM_DIR="target/wasm32-unknown-unknown/release"

declare -A WASM_ARTIFACTS=(
    [coordinator]=coordinator_contract
    [identity]=identity_contract
    [inventory]=inventory_contract
    [payments]=payment_contract
    [requests]=request_contract
    [temperature]=temperature_contract
    [matching]=matching_contract
    [reputation]=reputation_contract
    [delivery]=delivery_contract
    [analytics]=analytics_contract
)
