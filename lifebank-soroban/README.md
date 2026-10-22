# Lifebank Soroban Contracts

On-chain smart contract layer for the HealthChain blood supply platform, built with [Soroban](https://soroban.stellar.org/) on Stellar.

## What's here

Ten contracts that together manage the full blood donation lifecycle — from registration through delivery and payment settlement:

| Contract | Purpose |
|---|---|
| **coordinator** | Orchestrates the three-step delivery workflow across inventory, payments, and requests |
| **inventory** | Registers blood units, tracks status transitions, manages reservations |
| **requests** | Hospital blood requests with approval workflow and history |
| **payments** | Escrow-backed payments, dispute handling, donation pledges |
| **temperature** | IoT cold-chain monitoring with automatic excursion escalation |
| **matching** | ABO/Rh compatibility matching with FIFO expiration-aware selection |
| **identity** | Organization registry, role-based access, badges, delivery verification |
| **reputation** | Weighted reputation scoring with decay, fraud penalties, and violation tracking |
| **analytics** | Periodic metrics snapshots and lifetime counters |
| **delivery** | Compliance attestation hashes for completed deliveries |

The coordinator is the integration point. It holds references to inventory, payments, and requests, and enforces the canonical three-step workflow: `allocate_units → confirm_delivery → settle_payment`.

## Prerequisites

- Rust toolchain with `wasm32-unknown-unknown` target
- Stellar CLI (`cargo install --locked stellar-cli`)
- A funded Stellar testnet account (use `stellar keys generate` or Stellar Laboratory)

```bash
# Add the WASM target if you haven't already
rustup target add wasm32-unknown-unknown
```

## Build

```bash
# From the lifebank-soroban directory
cargo build --release --target wasm32-unknown-unknown

# Or use the helper script
./scripts/build-all.sh
```

WASM artifacts land in `target/wasm32-unknown-unknown/release/`.

## Test

```bash
# Run all unit and integration tests
cargo test

# Run only the cross-contract integration tests
cargo test -p integration-tests

# Run tests for a single contract
cargo test --package inventory-contract
```

The integration tests in `tests/integration_test.rs` exercise the full coordinator workflow using lightweight mock contracts. See [ARCHITECTURE.md](ARCHITECTURE.md) for what each test covers.

## Deploy

See [docs/deployment.md](docs/deployment.md) for step-by-step testnet and mainnet deployment instructions.

A quick testnet deploy:

```bash
./scripts/deploy-testnet.sh
```

Contract addresses are written to `.contract-ids.json` after deployment.

## Documentation

- [ARCHITECTURE.md](ARCHITECTURE.md) — contract dependency graph and data flow
- [docs/deployment.md](docs/deployment.md) — deployment guide (build, deploy, initialize, upgrade)
- [docs/indexing.md](docs/indexing.md) — event schema for off-chain indexers

### Contract References

- [docs/contracts/coordinator.md](docs/contracts/coordinator.md) — workflow orchestration
- [docs/contracts/identity.md](docs/contracts/identity.md) — organization registry and delivery verification
- [docs/contracts/inventory.md](docs/contracts/inventory.md) — blood unit registration and tracking
- [docs/contracts/matching.md](docs/contracts/matching.md) — blood compatibility matching
- [docs/contracts/payments.md](docs/contracts/payments.md) — escrow and dispute handling
- [docs/contracts/reputation.md](docs/contracts/reputation.md) — reputation scoring and decay
- [docs/contracts/requests.md](docs/contracts/requests.md) — hospital blood requests
- [docs/contracts/delivery.md](docs/contracts/delivery.md) — delivery compliance attestation
- [docs/contracts/temperature.md](docs/contracts/temperature.md) — cold-chain monitoring
- [docs/contracts/analytics.md](docs/contracts/analytics.md) — periodic metrics and counters
