# Deployment Guide

This guide covers deploying, initializing, and maintaining all 10 Lifebank smart contracts on Stellar testnet and mainnet.

## Prerequisites

- **Stellar CLI**: `brew install stellar-cli` (or see https://github.com/stellar/stellar-cli)
- **Rust & Wasm target**: `rustup target add wasm32-unknown-unknown`
- **Stellar account**: With testnet or mainnet XLM for transaction fees
- **Network setup**: Configured in `~/.config/stellar/networks.toml` or via `stellar keys add`

## Contract Overview

All 10 contracts are located in `contracts/`:

| Contract | Purpose |
|----------|---------|
| **analytics** | Event aggregation and metrics |
| **coordinator** | Cross-contract orchestration |
| **delivery** | Delivery tracking and verification |
| **identity** | Organization registry and roles |
| **inventory** | Supply chain tracking |
| **matching** | Request matching and assignment |
| **payments** | Fund escrow and settlement |
| **reputation** | Entity reputation scoring |
| **requests** | Service requests (blood, supplies, etc.) |
| **temperature** | IoT sensor data and cold chain validation |

## Deployment Steps

### Step 1: Build All Contracts

```bash
cd lifebank-soroban
./scripts/build-all.sh
```

This builds all 10 contracts in release mode with WASM optimization. Artifacts are in `target/wasm32-unknown-unknown/release/`.

**Contract WASM file names:** `{contract_name}_contract.wasm`

### Step 2: Deploy to Testnet

```bash
./scripts/deploy-testnet.sh
```

This script:
1. Deploys all 10 contracts to testnet
2. Writes contract IDs to `.contract-ids.testnet.json`

**Output:** Contract ID mapping file at `.contract-ids.testnet.json`

```json
{
  "network": "testnet",
  "deployed_at": "2025-02-18T14:30:00Z",
  "contracts": {
    "analytics": "CAAAA...",
    "coordinator": "CAAAB...",
    "delivery": "CAAAC...",
    "identity": "CAAAD...",
    "inventory": "CAAAE...",
    "matching": "CAAAF...",
    "payments": "CAAAG...",
    "reputation": "CAAAH...",
    "requests": "CAAAI...",
    "temperature": "CAAAJ..."
  }
}
```

**For mainnet:**
```bash
./scripts/deploy-mainnet.sh
```
Writes to `.contract-ids.mainnet.json`

### Step 3: Initialize Contracts

```bash
./scripts/initialize-contracts.sh testnet
```

This initializes each contract with required config (admin, initial state, etc.):

**Analytics:**
- `initialize(admin)`

**Coordinator:**
- `initialize(admin, contracts: {all contract IDs})`

**Delivery:**
- `initialize(admin, identity_contract, temperature_contract)`
- Wiring: Links to identity and temperature

**Identity:**
- `initialize(admin)`
- `AccessControlContract::initialize(admin)`

**Inventory:**
- `initialize(admin)`

**Matching:**
- `initialize(admin, requests_contract, inventory_contract)`
- Wiring: Links to requests and inventory

**Payments:**
- `initialize(admin)`
- Requires wiring: `set_requests_contract(admin, requests_id)` (Step 4)

**Reputation:**
- `initialize(admin)`

**Requests:**
- `initialize(admin, inventory_contract, matching_contract, payments_contract)`
- Wiring: Links to inventory, matching, payments
- Requires wiring: `set_payments_contract(admin, payments_id)` (Step 4)

**Temperature:**
- `initialize(admin, identity_contract)`
- Wiring: Links to identity

### Step 4: Wire Contracts (Cross-Contract Linking)

After initialization, set up contract references that contracts call each other through.

```bash
./scripts/wire-contracts.sh testnet
```

**Wiring steps:**

1. **Payments → Requests**
   ```bash
   stellar contract invoke \
     --contract-id $(jq -r .contracts.payments .contract-ids.testnet.json) \
     --network testnet \
     --id my-account \
     -- set_requests_contract \
     --admin $(stellar keys show my-account --public-key) \
     --requests_contract $(jq -r .contracts.requests .contract-ids.testnet.json)
   ```

2. **Requests → Payments**
   ```bash
   stellar contract invoke \
     --contract-id $(jq -r .contracts.requests .contract-ids.testnet.json) \
     --network testnet \
     --id my-account \
     -- set_payments_contract \
     --admin $(stellar keys show my-account --public-key) \
     --payments_contract $(jq -r .contracts.payments .contract-ids.testnet.json)
   ```

3. **Temperature → Coordinator** (optional)
   ```bash
   stellar contract invoke \
     --contract-id $(jq -r .contracts.temperature .contract-ids.testnet.json) \
     --network testnet \
     --id my-account \
     -- set_coordinator \
     --admin $(stellar keys show my-account --public-key) \
     --coordinator $(jq -r .contracts.coordinator .contract-ids.testnet.json)
   ```

### Step 5: Verify Deployment

```bash
./scripts/verify-deployment.sh testnet
```

Checks:
- All contract IDs exist
- All contracts initialized (no errors on get_admin)
- All cross-contract wiring in place

### Step 6: Set Up TTL Maintenance

Soroban persistent state entries expire after 6 months of inactivity. To keep entries alive, bump TTLs regularly:

```bash
# Add to crontab for daily execution
0 0 * * * /path/to/lifebank-soroban/scripts/ttl-keeper.sh testnet >> /var/log/lifebank-ttl.log 2>&1
```

Manual run:
```bash
./scripts/ttl-keeper.sh testnet
```

This extends TTL on all persistent entries to the maximum (roughly 6 months ahead).

---

## Upgrade Process

### Before Upgrade

1. Pause contracts (if supported) to prevent state mutations
2. Test WASM on testnet first
3. Notify operators

### Upgrade a Single Contract

```bash
./scripts/upgrade.sh testnet identity
```

This:
1. Builds the contract
2. Uploads new WASM
3. Invokes `upgrade(env, new_wasm_hash)` on the contract

Only contracts with an `upgrade()` entrypoint support in-place upgrades:
- **Supported:** analytics, coordinator, delivery, identity, inventory, matching, payments, reputation, requests, temperature (all have upgrade capability)
- **Not supported:** None (all 10 contracts support upgrades)

### Upgrade All Contracts

```bash
./scripts/upgrade-all.sh testnet
```

Or mainnet:
```bash
./scripts/upgrade-all.sh mainnet
```

---

## Contract ID File

**Canonical file:** `.contract-ids.{network}.json`

Location: `lifebank-soroban/.contract-ids.{network}.json`

Used by:
- `deploy-testnet.sh` / `deploy-mainnet.sh` — **writes** contract IDs after deploy
- `initialize-contracts.sh` — **reads** to get contract IDs for initialization
- `wire-contracts.sh` — **reads** to wire contract references
- `verify-deployment.sh` — **reads** to verify all contracts
- `ttl-keeper.sh` — **reads** to find contracts for TTL bumping
- `upgrade.sh` / `upgrade-all.sh` — **reads** to upgrade contracts

**Schema:**
```json
{
  "network": "testnet | mainnet",
  "deployed_at": "ISO 8601 timestamp",
  "contracts": {
    "analytics": "CAAA...",
    "coordinator": "CAAB...",
    "delivery": "CAAC...",
    "identity": "CAAD...",
    "inventory": "CAAE...",
    "matching": "CAAF...",
    "payments": "CAAG...",
    "reputation": "CAAH...",
    "requests": "CAAI...",
    "temperature": "CAAJ..."
  }
}
```

---

## Troubleshooting

### Contract Deploy Fails

- Verify Stellar CLI is installed: `stellar --version`
- Check network is accessible: `stellar network list`
- Ensure account has testnet XLM: Use Friendbot or faucet
- Check WASM was built: `ls target/wasm32-unknown-unknown/release/*_contract.wasm`

### Initialization Fails

- Verify contract IDs in `.contract-ids.{network}.json`
- Ensure account is funded and has signing key
- Check contract was deployed (not just built)
- Try `stellar contract info --contract-id {ID} --network {network}`

### TTL Bumping Fails

- TTL entries may be archived if TTL not bumped for 6 months
- Re-initialize the contract to restore entries
- Run `ttl-keeper.sh` more frequently (weekly vs daily) if resources limited

### Upgrade Fails

- Some older WASM may be incompatible with new code (Soroban SDK changes)
- Test on testnet before mainnet
- If upgrade fails, redeploy contract from scratch

---

## Manual Testing

### Invoke a Contract Function

```bash
stellar contract invoke \
  --contract-id $(jq -r .contracts.identity .contract-ids.testnet.json) \
  --network testnet \
  --id my-account \
  -- get_admin
```

### Read Contract Info

```bash
stellar contract info \
  --contract-id $(jq -r .contracts.identity .contract-ids.testnet.json) \
  --network testnet
```

### Check Contract Code

```bash
stellar contract code-id \
  --contract-id $(jq -r .contracts.identity .contract-ids.testnet.json) \
  --network testnet
```

---

## Production Checklist

- [ ] All 10 contracts deployed
- [ ] All contracts initialized with correct admin
- [ ] All cross-contract wiring verified
- [ ] TTL keeper cron job active
- [ ] Backup of `.contract-ids.mainnet.json`
- [ ] Operator runbooks for common issues
- [ ] Monitoring alerts for TTL expiry
- [ ] Test rollback procedure for upgrades
