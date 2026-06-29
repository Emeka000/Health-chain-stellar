# Contract Initialization Guide

After deploying Lifebank contracts, each contract must be initialized with an admin address and any required dependency references before it can accept transactions.

## Quick Start

After running `deploy-testnet.sh` or `deploy-mainnet.sh`:

```bash
# For testnet
STELLAR_IDENTITY=default STELLAR_NETWORK=testnet ./scripts/initialize-contracts.sh

# For mainnet
STELLAR_IDENTITY=<your-mainnet-identity> \
  STELLAR_NETWORK=mainnet \
  STELLAR_RPC_URL=https://mainnet.sorobanrpc.com \
  ./scripts/initialize-contracts.sh
```

The initialization script will:
1. Load contract IDs from `.contract-ids.testnet.json` or `.contract-ids.mainnet.json`
2. Derive the admin address from `STELLAR_IDENTITY`
3. Initialize all 10 contracts in dependency order
4. Report success or failure for each contract

## Initialization Order and Dependencies

Contracts are initialized in four phases to respect dependencies:

### Phase 1: No dependencies
- **identity** - Organization registry and role-based access control
- **reputation** - Reputation scoring and fraud tracking
- **temperature** - Cold-chain monitoring
- **inventory** - Blood unit registry (no init dependencies, but required by others)

### Phase 2: Single dependency
- **requests** - Depends on `inventory`
- **payments** - Depends on `requests` (optional, but recommended)
- **delivery** - Depends on `requests`

### Phase 3: Multiple dependencies
- **matching** - Depends on `inventory`, `requests`
- **analytics** - Depends on `inventory`, `requests`, `payments`

### Phase 4: Integration hub
- **coordinator** - Depends on `requests`, `inventory`, `payments`

## Manual Initialization

If you prefer to initialize contracts manually, use `stellar contract invoke`:

```bash
stellar contract invoke \
  --id <CONTRACT_ID> \
  --source <IDENTITY> \
  --network <NETWORK> \
  -- initialize <ARGUMENTS>
```

### Per-Contract Initialization

#### identity
```bash
stellar contract invoke \
  --id <IDENTITY_CONTRACT_ID> \
  --source <IDENTITY> \
  --network testnet \
  -- initialize --admin <ADMIN_ADDRESS>
```

#### reputation
```bash
stellar contract invoke \
  --id <REPUTATION_CONTRACT_ID> \
  --source <IDENTITY> \
  --network testnet \
  -- initialize --admin <ADMIN_ADDRESS>
```

#### temperature
```bash
stellar contract invoke \
  --id <TEMPERATURE_CONTRACT_ID> \
  --source <IDENTITY> \
  --network testnet \
  -- initialize --admin <ADMIN_ADDRESS>
```

#### inventory
```bash
stellar contract invoke \
  --id <INVENTORY_CONTRACT_ID> \
  --source <IDENTITY> \
  --network testnet \
  -- initialize --admin <ADMIN_ADDRESS>
```

#### requests
```bash
stellar contract invoke \
  --id <REQUESTS_CONTRACT_ID> \
  --source <IDENTITY> \
  --network testnet \
  -- initialize \
    --admin <ADMIN_ADDRESS> \
    --inventory-contract <INVENTORY_CONTRACT_ID>
```

#### payments
```bash
stellar contract invoke \
  --id <PAYMENTS_CONTRACT_ID> \
  --source <IDENTITY> \
  --network testnet \
  -- initialize \
    --admin <ADMIN_ADDRESS> \
    --requests-contract <REQUESTS_CONTRACT_ID>
```

#### delivery
```bash
stellar contract invoke \
  --id <DELIVERY_CONTRACT_ID> \
  --source <IDENTITY> \
  --network testnet \
  -- initialize \
    --admin <ADMIN_ADDRESS> \
    --request-contract <REQUESTS_CONTRACT_ID>
```

#### matching
```bash
stellar contract invoke \
  --id <MATCHING_CONTRACT_ID> \
  --source <IDENTITY> \
  --network testnet \
  -- initialize \
    --admin <ADMIN_ADDRESS> \
    --inventory-contract <INVENTORY_CONTRACT_ID> \
    --requests-contract <REQUESTS_CONTRACT_ID>
```

#### analytics
```bash
stellar contract invoke \
  --id <ANALYTICS_CONTRACT_ID> \
  --source <IDENTITY> \
  --network testnet \
  -- initialize \
    --admin <ADMIN_ADDRESS> \
    --inventory-contract <INVENTORY_CONTRACT_ID> \
    --requests-contract <REQUESTS_CONTRACT_ID> \
    --payments-contract <PAYMENTS_CONTRACT_ID>
```

#### coordinator
```bash
stellar contract invoke \
  --id <COORDINATOR_CONTRACT_ID> \
  --source <IDENTITY> \
  --network testnet \
  -- initialize \
    --admin <ADMIN_ADDRESS> \
    --request-contract <REQUESTS_CONTRACT_ID> \
    --inventory-contract <INVENTORY_CONTRACT_ID> \
    --payment-contract <PAYMENTS_CONTRACT_ID>
```

## Verification

After initialization, verify that contracts are initialized:

```bash
# Check if a contract is initialized
stellar contract invoke \
  --id <CONTRACT_ID> \
  --source <IDENTITY> \
  --network testnet \
  -- is-initialized
```

Should return `true` if the contract was successfully initialized.

## Troubleshooting

### "AlreadyInitialized" error
The contract has already been initialized. Each contract can only be initialized once.

### "Unauthorized" error
The signing identity doesn't have permission to initialize. Make sure you're using the correct identity that was passed as `--admin` during initialization.

### "ContractNotFound" error
The contract address is incorrect. Verify the contract ID in your `.contract-ids.testnet.json` or `.contract-ids.mainnet.json` file.

### Mainnet: "RPC connection failed"
Set `STELLAR_RPC_URL` to a valid Soroban RPC endpoint:
- Mainnet: `https://mainnet.sorobanrpc.com`
- Testnet: `https://soroban-testnet.stellar.org` (if using explicit URL instead of `--network testnet`)
