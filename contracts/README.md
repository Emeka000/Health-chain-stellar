# Health Chain Soroban Smart Contracts

Welcome! This is where we build the smart contracts for Health Chain on Stellar using Soroban.

## What is Health Chain?

Health Chain is a decentralized healthcare data management system. Our smart contracts handle:

- **Health Record Hashes** - Store and retrieve cryptographic health record hashes on-chain
- **Patient-Controlled Access** - Patients grant and revoke provider access to their records
- **Privacy-Preserving** - Only hashes/encrypted references are stored; raw data never touches the chain
- **Audit Events** - Every store, grant, and revoke operation emits an on-chain event

## Getting Started

### What You'll Need

- Rust (latest stable version)
- `wasm32-unknown-unknown` target for building to WebAssembly

### Quick Setup

If you haven't already, add the WASM target:
```bash
rustup target add wasm32-unknown-unknown
```

That's it! You're ready to build.

## Building the Contract

Build for local testing:
```bash
cargo build
```

Build optimized WASM for deployment:
```bash
cargo build --target wasm32-unknown-unknown --release
```

## Running Tests

We've included tests for all contract functions. Run them with:
```bash
cargo test
```

## Code Quality Tools

Before submitting your code, make sure it's clean:

**Format your code:**
```bash
cargo fmt
```

**Quick syntax check (faster than building):**
```bash
cargo check
```

**Catch common issues:**
```bash
cargo clippy
```

**Run everything at once:**
```bash
cargo fmt && cargo clippy && cargo test
```

## Project Structure

```
contracts/
├── src/
│   └── lib.rs          # Main contract code
├── Cargo.toml          # Dependencies and configuration
└── .gitignore          # Keeps build artifacts out of git
```

## Contributing

### Adding New Functions

1. **Write your function** in the `impl HealthChainContract` block:
   ```rust
   pub fn my_function(env: Env) -> u32 {
       42
   }
   ```

2. **Write a test** in the `mod test` block:
   ```rust
   #[test]
   fn test_my_function() {
       let env = Env::default();
       let contract_id = env.register_contract(None, HealthChainContract);
       let client = HealthChainContractClient::new(&env, &contract_id);
       assert_eq!(client.my_function(), 42);
   }
   ```

3. **Test it:**
   ```bash
   cargo test
   ```

### Best Practices

**General:**
- Keep `#![no_std]` at the top of lib.rs
- Run `cargo fmt` before committing
- Use `cargo clippy` to catch issues early
- Write tests for everything

**Soroban Specific:**
- Use `symbol_short!` for strings 9 characters or less
- Keep contracts small - WASM size matters
- Add doc comments to public functions
- Follow snake_case for function names

### Testing Tips

- Use `Env::default()` for test environments
- Register your contract with `env.register_contract(None, YourContract)`
- Test edge cases and error conditions
- Make sure tests are readable - they're documentation too!

### Pre-Commit Checklist

Before pushing your code:
- [ ] `cargo fmt` - Code is formatted
- [ ] `cargo clippy` - No warnings
- [ ] `cargo test` - All tests pass
- [ ] `cargo build --target wasm32-unknown-unknown --release` - WASM builds successfully
- [ ] Functions have doc comments
- [ ] Tests cover your changes

## Questions?

Check out the [Stellar Soroban docs](https://developers.stellar.org/docs/learn/smart-contract-internals/overview) or ask the team!
