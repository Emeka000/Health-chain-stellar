# Lifebank Soroban Contracts

A suite of 10 Stellar Soroban smart contracts enabling transparent health donations, secure fund escrow, and immutable healthcare supply chain tracking.

## Contracts

All contracts are located in `contracts/` and cover the complete healthcare donation workflow:

| Contract | Documentation | Purpose |
|----------|---|---------|
| **analytics** | [Analytics Docs](../docs/contracts/analytics.md) | Event aggregation and metrics tracking |
| **coordinator** | [Coordinator Docs](../docs/contracts/coordinator.md) | Cross-contract orchestration and event routing |
| **delivery** | [Delivery Docs](../docs/contracts/delivery.md) | Delivery tracking, verification, and proof of delivery |
| **identity** | [Identity Docs](../docs/contracts/identity.md) | Organization registry, roles, and permissions |
| **inventory** | [Inventory Docs](../docs/contracts/inventory.md) | Supply chain tracking and inventory management |
| **matching** | [Matching Docs](../docs/contracts/matching.md) | Request-to-supplier matching and assignment |
| **payments** | [Payments Docs](../docs/contracts/payments.md) | Fund escrow and settlement |
| **reputation** | [Reputation Docs](../docs/contracts/reputation.md) | Entity reputation scoring and feedback |
| **requests** | [Requests Docs](../docs/contracts/requests.md) | Service requests (blood, medical supplies, vaccines) |
| **temperature** | [Temperature Docs](../docs/contracts/temperature.md) | IoT sensor data and cold chain validation |

## Quick Start

### Build All Contracts

```bash
./scripts/build-all.sh
```

Builds all 10 contracts in release mode with WASM optimization. Output: `target/wasm32-unknown-unknown/release/{contract}_contract.wasm`

### Deploy to Testnet

```bash
./scripts/deploy-testnet.sh
```

Deploys all contracts and writes IDs to `.contract-ids.testnet.json`. See [Deployment Guide](docs/deployment.md) for full setup including initialization, wiring, and verification.

### Run Tests

**Integration tests:**
```bash
cargo test -p integration-tests
```

**Single contract tests:**
```bash
cargo test -p identity_contract
cargo test -p reputation_contract
# ... etc for each contract
```

**With output:**
```bash
cargo test -p integration-tests -- --nocapture
```

## Development

### Project Structure

```text
.
├── contracts/
│   ├── analytics/
│   ├── coordinator/
│   ├── delivery/
│   ├── identity/
│   ├── inventory/
│   ├── matching/
│   ├── payments/
│   ├── reputation/
│   ├── requests/
│   └── temperature/
├── docs/
│   ├── contracts/
│   │   ├── analytics.md
│   │   ├── coordinator.md
│   │   ├── delivery.md
│   │   ├── identity.md
│   │   ├── inventory.md
│   │   ├── matching.md
│   │   ├── payments.md
│   │   ├── reputation.md
│   │   ├── requests.md
│   │   └── temperature.md
│   └── deployment.md
├── scripts/
│   ├── build-all.sh
│   ├── deploy-testnet.sh
│   ├── deploy-mainnet.sh
│   ├── initialize-contracts.sh
│   ├── wire-contracts.sh
│   ├── verify-deployment.sh
│   ├── ttl-keeper.sh
│   ├── upgrade.sh
│   └── upgrade-all.sh
├── Cargo.toml
└── README.md
```

Each contract is a workspace member with its own `Cargo.toml` inheriting dependencies from the top-level workspace.

### Building a Contract

```bash
cargo build --release --target wasm32-unknown-unknown -p identity_contract
```

### Testing a Contract

```bash
cargo test -p identity_contract
```

## Deployment

See **[Deployment Guide](docs/deployment.md)** for:
- Prerequisites and setup
- Step-by-step deployment process
- Contract initialization and wiring
- Cross-contract integration
- TTL maintenance (daily cron)
- Upgrade procedures
- Troubleshooting

## Contract Architecture

### Initialization Flow
1. Deploy contracts → Get contract IDs
2. Initialize each contract with admin and dependencies
3. Wire contracts together (set cross-contract references)
4. Verify all wiring is correct

### Cross-Contract Calls
- **Payments** ↔ **Requests**: Escrow and settlement
- **Requests** ↔ **Matching**: Assignment and request lookup
- **Requests** ↔ **Inventory**: Supply tracking
- **Delivery** ↔ **Identity**: Org verification and rating
- **Identity** ↔ **Reputation**: Reputation tracking
- **Temperature** ↔ **Identity**: Cold chain verification
- **All** → **Analytics**: Event aggregation

### State Management
All persistent state automatically expires after 6 months of inactivity per Soroban's TTL model. Use `ttl-keeper.sh` cron job to prevent data loss.

## Optimization

See [GAS_OPTIMIZATION.md](GAS_OPTIMIZATION.md) for contract optimization strategies and benchmarks.

## License

MIT
