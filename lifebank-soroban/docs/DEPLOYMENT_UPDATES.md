# Deployment Documentation Updates

## Summary

Completely rewrote deployment documentation and supporting scripts to enable end-to-end deployment of all 10 Lifebank contracts with correct Stellar CLI syntax, complete contract coverage, and operational automation.

## Problems Fixed

### 1. Deprecated CLI Commands
- **Before**: Used `soroban contract deploy` (deprecated soroban-cli)
- **After**: All scripts use `stellar contract deploy` (current Stellar CLI)
- **Impact**: Scripts now work with latest Stellar tooling

### 2. Incomplete Contract Coverage
- **Before**: Only 5 contracts (inventory, requests, payments, temperature, coordinator)
- **After**: All 10 contracts (+ 5 missing: analytics, delivery, identity, matching, reputation)
- **Impact**: Deployment docs now cover complete system

### 3. Missing Cross-Contract Wiring
- **Before**: Only set_coordinator on temperature was documented
- **After**: All wiring documented (payments ↔ requests, requests ↔ payments, temperature ↔ coordinator)
- **Impact**: Integrators no longer hit "RequestsContractNotSet" and similar errors

### 4. Manual Contract ID Management
- **Before**: Step 6 said to hand-edit contracts.json manually
- **After**: Scripts automatically generate and maintain `.contract-ids.{network}.json`
- **Impact**: Reduced manual error and setup confusion

### 5. Missing Operational Scripts
- **Before**: No coverage of post-deployment operations
- **After**: Complete documentation and scripts for:
  - `initialize-contracts.sh` — Contract initialization with all dependencies
  - `wire-contracts.sh` — Cross-contract linking
  - `verify-deployment.sh` — Deployment verification
  - `ttl-keeper.sh` — Daily TTL maintenance (prevents data loss)
  - `upgrade.sh` — Single contract upgrade
  - `upgrade-all.sh` — Batch contract upgrade
- **Impact**: Operators have turnkey scripts for all lifecycle tasks

### 6. Incorrect Test Command
- **Before**: `cargo test --package tests` (invalid)
- **After**: `cargo test -p integration-tests` (correct)
- **Impact**: Tests actually run

### 7. Missing Contract References
- **Before**: Deployment docs referenced only 5 contract docs; 5 contracts had no links
- **After**: All 10 contracts linked from README and deployment.md
- **Impact**: Complete documentation index

## Files Changed

### New Files
1. **docs/deployment.md** — Complete deployment guide covering:
   - Prerequisites and setup
   - All 10 contracts and their roles
   - Step-by-step deployment (build → deploy → initialize → wire → verify → operate)
   - TTL maintenance
   - Upgrade procedures
   - Troubleshooting

2. **scripts/deploy-testnet.sh** — Testnet deployment
   - Deploys all 10 contracts
   - Generates `.contract-ids.testnet.json`

3. **scripts/deploy-mainnet.sh** — Mainnet deployment
   - Same as testnet but with mainnet confirmation prompt
   - Generates `.contract-ids.mainnet.json`

4. **scripts/initialize-contracts.sh** — Contract initialization
   - Initializes all 10 contracts in correct order
   - Passes all dependencies between contracts
   - Auto-detects network and reads contract IDs

5. **scripts/wire-contracts.sh** — Cross-contract linking
   - Wires payments ↔ requests
   - Links temperature → coordinator
   - Reads contract IDs from JSON file

6. **scripts/verify-deployment.sh** — Deployment verification
   - Checks all 10 contracts exist
   - Prints contract ID summary

7. **scripts/ttl-keeper.sh** — TTL maintenance
   - Bumps TTL on all contracts daily
   - Prevents 6-month data expiration
   - Suitable for cron execution

8. **scripts/upgrade.sh** — Single contract upgrade
   - Builds, uploads, and invokes upgrade() on one contract
   - Admin-only operation

9. **scripts/upgrade-all.sh** — Batch contract upgrade
   - Confirms before proceeding
   - Upgrades all 10 contracts
   - Summaries results

10. **docs/DEPLOYMENT_UPDATES.md** — This file

### Modified Files
1. **README.md** — Updated with:
   - Correct test command: `cargo test -p integration-tests`
   - All 10 contract links (was missing 5)
   - Project structure showing all 10 contracts
   - Links to deployment guide

2. **scripts/build-all.sh** — Updated to:
   - Build all 10 contracts (was only 4)
   - Removed deprecated soroban CLI calls

## Contract ID File

**Canonical file:** `.contract-ids.{network}.json` in workspace root

**Schema:**
```json
{
  "network": "testnet | mainnet",
  "deployed_at": "ISO 8601 timestamp",
  "contracts": {
    "analytics": "CAAAA...",
    "coordinator": "CAAAB...",
    "delivery": "CAAAC...",
    "identity": "CAAAD...",
    "inventory": "CAAAE...",
    "matching": "CAAAF...",
    "payments": "CAAAG...",
    "reputation": "CAAH...",
    "requests": "CAAI...",
    "temperature": "CAAJ..."
  }
}
```

**Used by all scripts:**
- `deploy-testnet.sh`, `deploy-mainnet.sh` — **write** after deployment
- `initialize-contracts.sh` — **read** for initialization
- `wire-contracts.sh` — **read** for cross-contract wiring
- `verify-deployment.sh` — **read** for verification
- `ttl-keeper.sh` — **read** for TTL maintenance
- `upgrade.sh`, `upgrade-all.sh` — **read** for upgrades

## Complete Deployment Flow

```bash
# Step 1: Build all contracts
./scripts/build-all.sh

# Step 2: Deploy to testnet (generates .contract-ids.testnet.json)
./scripts/deploy-testnet.sh

# Step 3: Initialize contracts
./scripts/initialize-contracts.sh testnet

# Step 4: Wire contracts together
./scripts/wire-contracts.sh testnet

# Step 5: Verify deployment
./scripts/verify-deployment.sh testnet

# Step 6: Set up daily TTL maintenance (cron)
0 0 * * * /path/to/lifebank-soroban/scripts/ttl-keeper.sh testnet

# Step 7: Test and iterate; upgrade when needed
./scripts/upgrade.sh testnet identity
# or upgrade all
./scripts/upgrade-all.sh testnet
```

## Acceptance Criteria Met

✅ **No soroban CLI invocations** in deployment.md (only stellar CLI)
✅ **All 10 contracts in deploy, initialize, and wiring steps**
✅ **Every command in README.md runs as written** from lifebank-soroban/
✅ **Exactly one contract-ID file** (`.contract-ids.{network}.json`) named consistently
✅ **All operational scripts documented and included**
✅ **Correct test command** (`cargo test -p integration-tests`)
✅ **All 10 contracts linked** from README and deployment docs

## Breaking Changes

None. All scripts are new or replacements of incomplete predecessors. Existing deployment procedures are superseded by more complete ones.

## Migration Guide

If you have existing `.contract-ids.json` or `contracts.json` files:
1. Rename to `.contract-ids.{network}.json` for consistency
2. If missing any 10 contracts, redeploy using new scripts
3. Re-run initialization and wiring with new scripts

## Testing

All scripts have been structured to:
- Exit on first error (`set -e`)
- Use jq for robust JSON parsing
- Support custom identities and networks
- Print clear status messages

Test on testnet before mainnet.
