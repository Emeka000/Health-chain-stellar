# Deployment Guide

This guide covers deploying all 10 Soroban contracts (coordinator, identity, inventory, matching, payments, reputation, requests, delivery, temperature, analytics) to Stellar testnet and mainnet, initializing them, and wiring their cross-contract references.

## Prerequisites

```bash
# Install Rust and the WASM target
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
rustup target add wasm32-unknown-unknown

# Install Stellar CLI
cargo install --locked stellar-cli

# Verify installation
stellar --version
```

## Quick Start

For testnet, the fastest path is:

```bash
./scripts/deploy-testnet.sh     # Deploy all 10 contracts
./scripts/initialize-contracts.sh # Initialize & wire all contracts
```

For mainnet, see [Mainnet Deployment](#mainnet-deployment) below.

---

## Detailed Workflow

### 1. Build

Compile all contracts to WASM:

```bash
# From the lifebank-soroban directory
cargo build --release --target wasm32-unknown-unknown

# Or use the helper script
./scripts/build-all.sh
```

WASM artifacts land in `target/wasm32-unknown-unknown/release/`. All 10 contracts will be built:
- `coordinator_contract.wasm`
- `identity_contract.wasm`
- `inventory_contract.wasm`
- `matching_contract.wasm`
- `payments_contract.wasm`
- `reputation_contract.wasm`
- `requests_contract.wasm`
- `delivery_contract.wasm`
- `temperature_contract.wasm`
- `analytics_contract.wasm`

### 2. Set up a Stellar identity

Create or import a Stellar keypair to use as the deployer and admin:

```bash
# Generate a new keypair for testnet only
stellar keys generate deployer --network testnet

# Fund the testnet account via Friendbot
stellar keys fund deployer --network testnet

# Verify the balance
stellar keys show deployer
```

For mainnet:
- Use a hardware wallet or a securely managed keypair.
- Never store mainnet private keys in plaintext.
- Fund the account with real XLM before deploying.

Set the identity for all subsequent commands:

```bash
export STELLAR_IDENTITY=deployer
export STELLAR_NETWORK=testnet
```

For mainnet, also set:

```bash
export STELLAR_NETWORK=mainnet
export STELLAR_RPC_URL=https://mainnet.sorobanrpc.com
export STELLAR_NETWORK_PASSPHRASE="Public Global Stellar Network ; September 2015"
```

### 3. Deploy contracts to the network

Use the deployment script to deploy all 10 contracts in a single invocation:

#### Testnet

```bash
./scripts/deploy-testnet.sh
```

The script will:
- Build all contracts if needed
- Validate all WASM binaries exist
- Deploy each contract to testnet
- Save contract IDs to `.contract-ids.testnet.json`
- (Optional) Regenerate TypeScript bindings if `scripts/generate-bindings.sh` exists

For a dry-run (validation only, no deployment):

```bash
./scripts/deploy-testnet.sh --dry-run
```

#### Mainnet

```bash
./scripts/deploy-mainnet.sh
```

The script requires three environment variables:
- `STELLAR_IDENTITY` — your mainnet identity
- `STELLAR_RPC_URL` — RPC endpoint (e.g., `https://mainnet.sorobanrpc.com`)
- `STELLAR_NETWORK_PASSPHRASE` — `"Public Global Stellar Network ; September 2015"`

The script will prompt for explicit confirmation before deploying. Contract IDs are saved to `.contract-ids.mainnet.json`.

### 4. Initialize contracts

After deployment, each contract must be initialized with an admin address and dependency references. Use the initialization script:

```bash
./scripts/initialize-contracts.sh
```

The script:
- Reads contract IDs from `.contract-ids.{testnet,mainnet}.json` (determined by `$STELLAR_NETWORK`)
- Derives the admin address from the current identity
- Initializes all 10 contracts in dependency order:
  - **Phase 1** (no dependencies): `identity`, `reputation`, `temperature`, `inventory`
  - **Phase 2** (single dependency): `requests` (→ inventory), `payments` (→ requests), `delivery` (→ requests)
  - **Phase 3** (multiple dependencies): `matching` (→ inventory, requests), `analytics` (→ inventory, requests, payments)
  - **Phase 4** (all domain contracts): `coordinator` (→ requests, inventory, payments)

Each contract's `initialize` entrypoint is called with:
- `admin` — the deployer's address
- `*_contract` parameters — contract IDs for dependencies (passed as needed)

Example initialization invocations (performed automatically by the script):

```bash
# Phase 1: Independent contracts
stellar contract invoke --id $IDENTITY_ID --source $IDENTITY --network $NETWORK \
    -- initialize --admin $ADMIN_ADDRESS

stellar contract invoke --id $REPUTATION_ID --source $IDENTITY --network $NETWORK \
    -- initialize --admin $ADMIN_ADDRESS

stellar contract invoke --id $TEMPERATURE_ID --source $IDENTITY --network $NETWORK \
    -- initialize --admin $ADMIN_ADDRESS

stellar contract invoke --id $INVENTORY_ID --source $IDENTITY --network $NETWORK \
    -- initialize --admin $ADMIN_ADDRESS

# Phase 2: Contracts with single dependencies
stellar contract invoke --id $REQUESTS_ID --source $IDENTITY --network $NETWORK \
    -- initialize --admin $ADMIN_ADDRESS --inventory_contract $INVENTORY_ID

stellar contract invoke --id $PAYMENTS_ID --source $IDENTITY --network $NETWORK \
    -- initialize --admin $ADMIN_ADDRESS --requests_contract $REQUESTS_ID

stellar contract invoke --id $DELIVERY_ID --source $IDENTITY --network $NETWORK \
    -- initialize --admin $ADMIN_ADDRESS --request_contract $REQUESTS_ID

# Phase 3: Contracts with multiple dependencies
stellar contract invoke --id $MATCHING_ID --source $IDENTITY --network $NETWORK \
    -- initialize --admin $ADMIN_ADDRESS \
    --inventory_contract $INVENTORY_ID \
    --requests_contract $REQUESTS_ID

stellar contract invoke --id $ANALYTICS_ID --source $IDENTITY --network $NETWORK \
    -- initialize --admin $ADMIN_ADDRESS \
    --inventory_contract $INVENTORY_ID \
    --requests_contract $REQUESTS_ID \
    --payments_contract $PAYMENTS_ID

# Phase 4: Coordinator (depends on all domain contracts)
stellar contract invoke --id $COORDINATOR_ID --source $IDENTITY --network $NETWORK \
    -- initialize --admin $ADMIN_ADDRESS \
    --request_contract $REQUESTS_ID \
    --inventory_contract $INVENTORY_ID \
    --payment_contract $PAYMENTS_ID
```

### 5. Post-initialization wiring

After initialization, wire cross-contract references that were not set during `initialize`:

```bash
# Wire temperature → coordinator for excursion escalation
stellar contract invoke --id $TEMPERATURE_ID --source $IDENTITY --network $NETWORK \
    -- set_coordinator --admin $ADMIN_ADDRESS --coordinator $COORDINATOR_ID

# Wire payments → requests for request validation
stellar contract invoke --id $PAYMENTS_ID --source $IDENTITY --network $NETWORK \
    -- set_requests_contract --admin $ADMIN_ADDRESS --requests_contract $REQUESTS_ID

# Wire requests → payments for payment status queries
stellar contract invoke --id $REQUESTS_ID --source $IDENTITY --network $NETWORK \
    -- set_payments_contract --admin $ADMIN_ADDRESS --payments_contract $PAYMENTS_ID

# Wire identity contract references (if identity-aware contracts need it)
stellar contract invoke --id $IDENTITY_ID --source $IDENTITY --network $NETWORK \
    -- set_requests_contract --admin $ADMIN_ADDRESS --requests_contract $REQUESTS_ID
```

### 6. Verify deployment

Query each contract to verify initialization succeeded:

```bash
# Check initialization status
stellar contract invoke --id $COORDINATOR_ID --source $IDENTITY --network $NETWORK \
    -- is_initialized

# Check admin address
stellar contract invoke --id $COORDINATOR_ID --source $IDENTITY --network $NETWORK \
    -- get_admin

# Check contract version
stellar contract invoke --id $COORDINATOR_ID --source $IDENTITY --network $NETWORK \
    -- version
```

---

## Contract ID File

Deployed contract IDs are stored in a JSON file determined by the network:

- **Testnet**: `.contract-ids.testnet.json`
- **Mainnet**: `.contract-ids.mainnet.json`

Schema (all 10 contracts):

```json
{
  "coordinator": "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4",
  "identity": "CBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB5",
  "inventory": "CCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC",
  "matching": "CDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDD",
  "payments": "CEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEE",
  "reputation": "CFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF",
  "requests": "CGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGG",
  "delivery": "CHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHHH",
  "temperature": "CIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIIII",
  "analytics": "CJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJJ"
}
```

Scripts that read and write this file:
- **deploy-testnet.sh**: writes `.contract-ids.testnet.json`
- **deploy-mainnet.sh**: writes `.contract-ids.mainnet.json`
- **initialize-contracts.sh**: reads `.contract-ids.{testnet,mainnet}.json` (selected by `$STELLAR_NETWORK`)
- **ttl-keeper.sh**: reads `contracts.json` (keyed by network, see [TTL Maintenance](#ttl-maintenance))
- **upgrade.sh**: reads `contracts.json` (keyed by network, see [Upgrading](#upgrading))

---

## TTL Maintenance

Soroban persistent storage entries expire after their TTL elapses. Contracts extend TTL on every write, but entries that are rarely written (e.g., blood units in `Available` status for weeks) can approach expiry. The TTL keeper bot proactively bumps TTLs before they drop below the threshold.

Schedule it as a daily cron job:

```bash
# Run daily at midnight UTC
0 0 * * * cd /path/to/lifebank-soroban && ./scripts/ttl-keeper.sh >> /var/log/ttl-keeper.log 2>&1
```

The script:
- Reads contract IDs from `contracts.json` (keyed by network, selected by `$STELLAR_NETWORK`)
- Scans all persistent entries in inventory, requests, and identity contracts
- Extends their TTL via the contract's `extend_ttl` entrypoint (or relies on write-path bumps)

Environment variables:
- `STELLAR_IDENTITY` — Stellar CLI identity to use (default: `"default"`)
- `STELLAR_NETWORK` — target network (default: `"testnet"`)
- `CONTRACTS_JSON` — path to contracts.json (default: auto-detected)

---

## Upgrading Contracts

Soroban contracts can be upgraded by deploying a new WASM and calling the on-chain `upgrade` function. The admin address controls upgrades.

**Contracts with `upgrade` entrypoint:**
- coordinator
- identity
- inventory
- matching
- payments
- reputation
- requests
- delivery
- temperature
- analytics

All 10 contracts support upgrades.

### Upgrade a single contract

```bash
CONTRACT=inventory \
NEW_WASM=target/wasm32-unknown-unknown/release/inventory_contract.wasm \
STELLAR_IDENTITY=deployer \
STELLAR_NETWORK=testnet \
./scripts/upgrade.sh
```

The script:
1. Installs the new WASM onto the ledger (generates a new WASM hash)
2. Calls the on-chain `upgrade` function with the new WASM hash
3. Preserves the contract's address and all persistent storage

Environment variables:
- `CONTRACT` — contract name (required)
- `NEW_WASM` — path to newly compiled .wasm file (required)
- `STELLAR_IDENTITY` — Stellar CLI identity (default: `"default"`)
- `STELLAR_NETWORK` — network (default: `"testnet"`)
- `STELLAR_RPC_URL` — RPC URL for mainnet (optional; required for mainnet)
- `CONTRACT_ID` — override contract ID from contracts.json (optional)

### Coordinate upgrades

When upgrading the backend:
1. Stop all writes to the contract
2. Upgrade the WASM using `upgrade.sh`
3. Resume operations

For the coordinator, this means halting the workflow via `emergency_halt()`:

```bash
stellar contract invoke --id $COORDINATOR_ID --source $IDENTITY --network $NETWORK \
    -- emergency_halt --admin $ADMIN_ADDRESS
```

After the upgrade, call `clear_emergency_halt()`:

```bash
stellar contract invoke --id $COORDINATOR_ID --source $IDENTITY --network $NETWORK \
    -- clear_emergency_halt --admin $ADMIN_ADDRESS
```

---

## Contract Dependencies

Understanding the dependency graph helps plan deployments and upgrades:

```
  coordinator
      ├── requests
      ├── inventory
      └── payments
            └── requests

  payments
      └── requests

  requests
      └── inventory

  delivery
      └── requests

  matching
      ├── inventory
      └── requests

  analytics
      ├── inventory
      ├── requests
      └── payments

  temperature
      └── (optional: coordinator for excursion escalation)

  identity
      └── (optional: requests for delivery verification)

  reputation
      └── (no dependencies)
```

**Deployment order** (must respect dependencies):
1. `inventory` (no deps)
2. `requests` (→ inventory)
3. `payments` (→ requests)
4. `coordinator` (→ requests, inventory, payments)
5. Others can follow in any order

**Initialization order** (must respect dependencies):
- Phase 1: `identity`, `reputation`, `temperature`, `inventory`
- Phase 2: `requests`, `payments`, `delivery`
- Phase 3: `matching`, `analytics`
- Phase 4: `coordinator`

---

## Mainnet Deployment

Before deploying to mainnet:

- [ ] Audit all contract code (especially coordinator, payments, identity)
- [ ] Use a hardware wallet or multi-sig for the admin keypair
- [ ] Test the full workflow end-to-end on testnet first
- [ ] Verify WASM hashes match the audited build
- [ ] Fund the deployer account with real XLM (~10 XLM)
- [ ] Store contract addresses and admin keypair in a secure secrets manager
- [ ] Set up monitoring for events listed in [indexing.md](indexing.md)
- [ ] Set up cron job for [TTL maintenance](#ttl-maintenance)

Deploy to mainnet:

```bash
export STELLAR_IDENTITY=<mainnet-key>
export STELLAR_NETWORK=mainnet
export STELLAR_RPC_URL=https://mainnet.sorobanrpc.com
export STELLAR_NETWORK_PASSPHRASE="Public Global Stellar Network ; September 2015"

./scripts/deploy-mainnet.sh
./scripts/initialize-contracts.sh
```

---

## Troubleshooting

**`Error: account not found`**

The deployer account is not funded or does not exist on the network. For testnet, run:

```bash
stellar keys fund deployer --network testnet
```

For mainnet, fund the account via an exchange or ATM, then verify:

```bash
stellar account get $(stellar keys address deployer)
```

**`Error: AlreadyInitialized`**

The contract was already initialized. This is expected if re-running the init step. Skip the contract or clear the contract from the ledger (if testing) by deploying a new instance.

**`Error: Unauthorized`**

The `--source` identity does not match the admin address stored in the contract. Use the same identity that initialized the contract.

**`Error: contract not found`**

The contract ID is wrong, or the contract was deployed to a different network. Double-check:
- The contract ID in the `.contract-ids.{testnet,mainnet}.json` file
- The `$STELLAR_NETWORK` environment variable
- The network passed to the stellar CLI command

**Deployment hung or timed out**

The RPC endpoint may be slow or unresponsive. Check:

```bash
curl -s https://mainnet.sorobanrpc.com/soroban/rpc/getNetwork | jq .
```

If the RPC is down, retry after a few minutes or use a different RPC URL.

---

## Documentation References

For function signatures and entry points, see:
- [docs/contracts/coordinator.md](coordinator.md)
- [docs/contracts/identity.md](identity.md)
- [docs/contracts/inventory.md](inventory.md)
- [docs/contracts/matching.md](matching.md)
- [docs/contracts/payments.md](payments.md)
- [docs/contracts/reputation.md](reputation.md)
- [docs/contracts/requests.md](requests.md)
- [docs/contracts/delivery.md](delivery.md)
- [docs/contracts/temperature.md](temperature.md)
- [docs/contracts/analytics.md](analytics.md)
- [docs/indexing.md](indexing.md) — event schema for off-chain indexers
