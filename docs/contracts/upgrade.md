# Contract Upgrade Guide

Soroban lets you replace a contract's WASM code in-place via
`env.deployer().update_current_contract_wasm(new_hash)`, keeping the contract
address and all persistent ledger storage intact.  Every Lifebank contract
exposes an admin-only `upgrade` entrypoint that calls this primitive.

## Prerequisites

- Stellar CLI (`stellar`) installed and on `$PATH`
- A funded identity on the target network (`setup-identity.sh` for testnet)
- The new WASM built locally (`./scripts/build-all.sh` or `cargo build --release`)

## Quick-Start

```bash
# 1. Build the changed contract
cd lifebank-soroban
cargo build --target wasm32-unknown-unknown --release -p inventory-contract

# 2. Run the upgrade script
CONTRACT=inventory \
  NEW_WASM=target/wasm32-unknown-unknown/release/inventory_contract.wasm \
  STELLAR_IDENTITY=my-admin-key \
  ./scripts/upgrade.sh
```

The script prints the new WASM hash and confirms the on-chain call.  The
contract address in `contracts.json` **does not change**.

## How It Works

`upgrade.sh` executes two steps:

| Step | Command | What it does |
|------|---------|--------------|
| 1 | `stellar contract install --wasm <file>` | Uploads the WASM to the ledger and returns its 32-byte hash |
| 2 | `stellar contract invoke … -- upgrade --admin <addr> --new_wasm_hash <hash>` | Calls the on-chain `upgrade` function which atomically swaps the executing WASM |

Because storage keys and the contract address are tied to the **contract
instance**, not the WASM, all existing data survives the swap.

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `CONTRACT` | *(required)* | Contract name as it appears in `contracts.json` |
| `NEW_WASM` | *(required)* | Path to the compiled `.wasm` file |
| `STELLAR_IDENTITY` | `default` | Stellar CLI identity name of the upgrade admin |
| `NETWORK` | `testnet` | `testnet` or `mainnet` |
| `CONTRACT_ID` | read from `contracts.json` | Override the on-chain contract address |

## On-Chain `upgrade` Function

Each contract has the following entrypoint (admin-only):

```rust
pub fn upgrade(
    env: Env,
    admin: Address,
    new_wasm_hash: BytesN<32>,
) -> Result<(), Error>
```

Only the stored admin address may call this.  Attempting an upgrade from any
other key returns `Error::Unauthorized` and aborts the transaction.

## Storage Migration

Soroban's in-place upgrade **does not run any migration code** automatically.
If the new WASM changes the layout of a stored `#[contracttype]` struct you
must handle backward compatibility explicitly:

1. Keep the old struct variant in the new WASM (e.g. `OrganizationV1`) and
   introduce a new variant (`OrganizationV2`).
2. Add a one-time `migrate` admin function that reads all `V1` entries,
   converts them to `V2`, and writes them back.
3. Call `migrate` once immediately after `upgrade` completes.
4. Remove the migration code in a subsequent upgrade once all entries are `V2`.

## Rollback

To revert an upgrade, run `upgrade.sh` again pointing at the **previous** WASM
binary (keep old binaries in `releases/` or in CI artefacts).

## CI / CD

Add a deployment job that:

1. Builds the WASM from the PR branch.
2. Runs `upgrade.sh` against testnet using `STELLAR_IDENTITY` from GitHub
   Secrets.
3. Runs smoke tests against the existing contract address.

Never automate mainnet upgrades — always require a manual admin sign-off.
