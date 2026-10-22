# Deployment Guide

This guide covers deploying the five core contracts (coordinator, inventory, payments, requests, temperature) to Stellar testnet and mainnet. The remaining contracts (analytics, delivery, identity, matching, reputation) follow the same pattern.

## Prerequisites

```bash
# Install Rust and the WASM target
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
rustup target add wasm32-unknown-unknown

# Install Soroban CLI
cargo install --locked soroban-cli

# Verify
soroban --version
```

## 1. Build

```bash
# From the lifebank-soroban directory
cargo build --release --target wasm32-unknown-unknown

# Optimize WASM files (reduces size, recommended for mainnet)
for contract in coordinator inventory payments requests temperature; do
    soroban contract optimize \
        --wasm target/wasm32-unknown-unknown/release/${contract}_contract.wasm
done
```

Artifacts land in `target/wasm32-unknown-unknown/release/`.

## 2. Set up a Stellar identity

```bash
# Generate a new keypair (testnet only — never use this for mainnet)
soroban keys generate deployer --network testnet

# Fund the testnet account via Friendbot
soroban keys fund deployer --network testnet

# Verify the balance
soroban keys show deployer
```

For mainnet, use a hardware wallet or a securely managed keypair. Never store mainnet private keys in plaintext.

## 3. Deploy contracts

Deploy each contract and capture its address. The order matters: inventory and requests must be deployed before coordinator.

```bash
NETWORK=testnet
IDENTITY=deployer

# Deploy inventory
INVENTORY_ID=$(soroban contract deploy \
    --wasm target/wasm32-unknown-unknown/release/inventory_contract.wasm \
    --source $IDENTITY \
    --network $NETWORK)
echo "Inventory: $INVENTORY_ID"

# Deploy requests
REQUESTS_ID=$(soroban contract deploy \
    --wasm target/wasm32-unknown-unknown/release/requests_contract.wasm \
    --source $IDENTITY \
    --network $NETWORK)
echo "Requests: $REQUESTS_ID"

# Deploy payments
PAYMENTS_ID=$(soroban contract deploy \
    --wasm target/wasm32-unknown-unknown/release/payments_contract.wasm \
    --source $IDENTITY \
    --network $NETWORK)
echo "Payments: $PAYMENTS_ID"

# Deploy temperature
TEMPERATURE_ID=$(soroban contract deploy \
    --wasm target/wasm32-unknown-unknown/release/temperature_contract.wasm \
    --source $IDENTITY \
    --network $NETWORK)
echo "Temperature: $TEMPERATURE_ID"

# Deploy coordinator
COORDINATOR_ID=$(soroban contract deploy \
    --wasm target/wasm32-unknown-unknown/release/coordinator_contract.wasm \
    --source $IDENTITY \
    --network $NETWORK)
echo "Coordinator: $COORDINATOR_ID"
```

Or use the helper script which does all of the above:

```bash
./scripts/deploy-testnet.sh
```

## 4. Initialize contracts

Each contract must be initialized before use. The admin address is the deployer's public key.

```bash
ADMIN=$(soroban keys address $IDENTITY)

# Initialize inventory
soroban contract invoke \
    --id $INVENTORY_ID \
    --source $IDENTITY \
    --network $NETWORK \
    -- initialize \
    --admin $ADMIN

# Initialize requests (links to inventory)
soroban contract invoke \
    --id $REQUESTS_ID \
    --source $IDENTITY \
    --network $NETWORK \
    -- initialize \
    --admin $ADMIN \
    --inventory_contract $INVENTORY_ID

# Initialize payments (optionally links to requests for validation)
soroban contract invoke \
    --id $PAYMENTS_ID \
    --source $IDENTITY \
    --network $NETWORK \
    -- initialize \
    --admin $ADMIN \
    --requests_contract $REQUESTS_ID

# Initialize temperature
soroban contract invoke \
    --id $TEMPERATURE_ID \
    --source $IDENTITY \
    --network $NETWORK \
    -- initialize \
    --admin $ADMIN

# Initialize coordinator (links all three domain contracts)
soroban contract invoke \
    --id $COORDINATOR_ID \
    --source $IDENTITY \
    --network $NETWORK \
    -- initialize \
    --admin $ADMIN \
    --request_contract $REQUESTS_ID \
    --inventory_contract $INVENTORY_ID \
    --payment_contract $PAYMENTS_ID
```

## 5. Post-initialization wiring

```bash
# Wire temperature → coordinator for excursion escalation
soroban contract invoke \
    --id $TEMPERATURE_ID \
    --source $IDENTITY \
    --network $NETWORK \
    -- set_coordinator \
    --admin $ADMIN \
    --coordinator $COORDINATOR_ID

# Authorize a blood bank on the inventory contract
soroban contract invoke \
    --id $INVENTORY_ID \
    --source $IDENTITY \
    --network $NETWORK \
    -- authorize_bank \
    --admin $ADMIN \
    --bank <BLOOD_BANK_ADDRESS> \
    --authorized true

# Authorize a hospital on the requests contract
soroban contract invoke \
    --id $REQUESTS_ID \
    --source $IDENTITY \
    --network $NETWORK \
    -- authorize_hospital \
    --hospital <HOSPITAL_ADDRESS>
```

## 6. Update contracts.json

After deployment, update `contracts.json` with the deployed addresses so the backend can discover them:

```json
{
  "testnet": {
    "coordinator": "<COORDINATOR_ID>",
    "inventory":   "<INVENTORY_ID>",
    "payments":    "<PAYMENTS_ID>",
    "temperature": "<TEMPERATURE_ID>",
    "requests":    "<REQUESTS_ID>"
  }
}
```

The backend reads this file via `STELLAR_NETWORK` env var. Individual addresses can be overridden with env vars (`COORDINATOR_CONTRACT_ID`, etc.).

## 7. Verify deployment

```bash
# Check coordinator is initialized
soroban contract invoke \
    --id $COORDINATOR_ID \
    --source $IDENTITY \
    --network $NETWORK \
    -- is_initialized

# Check inventory admin
soroban contract invoke \
    --id $INVENTORY_ID \
    --source $IDENTITY \
    --network $NETWORK \
    -- get_admin
```

## Mainnet checklist

Before deploying to mainnet:

- [ ] Audit all contract code (especially coordinator, payments)
- [ ] Use a hardware wallet or multi-sig for the admin keypair
- [ ] Test the full workflow end-to-end on testnet first
- [ ] Set `NETWORK=mainnet` in all commands
- [ ] Fund the deployer account with real XLM
- [ ] Verify WASM hashes match the audited build
- [ ] Store contract addresses in a secure secrets manager
- [ ] Set up monitoring for the events listed in [indexing.md](indexing.md)

## Upgrading contracts

Soroban contracts can be upgraded by deploying a new WASM and calling `soroban contract install` + `soroban contract invoke ... upgrade`. The admin address controls upgrades. Coordinate upgrades with the backend team to avoid ABI mismatches.

## Troubleshooting

**`Error: account not found`** — The deployer account is not funded. Run `soroban keys fund deployer --network testnet`.

**`Error: AlreadyInitialized`** — The contract was already initialized. This is expected if re-running the init step. Skip it.

**`Error: contract not found`** — The contract ID is wrong or the contract was deployed to a different network. Double-check `$NETWORK` and the contract ID.

**`Error: Unauthorized`** — The `--source` identity does not match the admin address stored in the contract. Use the same identity that initialized the contract.
