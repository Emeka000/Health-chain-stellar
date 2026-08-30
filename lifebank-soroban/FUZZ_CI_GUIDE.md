# Fuzz Testing CI/CD Integration Guide

## Problem Context

The fuzz test architecture was previously blocked by a monolithic dependency structure. This guide documents the recommended CI/CD setup for the new independent test binary architecture.

## Current Architecture

- **Location**: `contracts/fuzz/Cargo.toml`
- **Test Files**: 
  - `contracts/fuzz/tests/fuzz_inventory.rs` (Issue #844, #845)
  - `contracts/fuzz/tests/fuzz_payments.rs` (Issue #844)
- **Dependency Isolation**: Each test binary only depends on its respective contract

## CI Workflow Examples

### GitHub Actions Workflow

**File: `.github/workflows/fuzz-tests.yml`**

```yaml
name: Fuzz Tests

on:
  push:
    branches: [main, develop]
    paths:
      - 'contracts/fuzz/**'
      - 'contracts/inventory/**'
      - 'contracts/payments/**'
      - '.github/workflows/fuzz-tests.yml'
  pull_request:
    branches: [main, develop]
    paths:
      - 'contracts/fuzz/**'
      - 'contracts/inventory/**'
      - 'contracts/payments/**'

jobs:
  fuzz-inventory:
    name: "Fuzz Tests - Inventory"
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      
      - name: Install Rust
        uses: dtolnay/rust-toolchain@stable
      
      - name: Cache cargo registry
        uses: actions/cache@v3
        with:
          path: ~/.cargo/registry
          key: ${{ runner.os }}-cargo-registry-${{ hashFiles('**/Cargo.lock') }}
      
      - name: Cache cargo index
        uses: actions/cache@v3
        with:
          path: ~/.cargo/git
          key: ${{ runner.os }}-cargo-git-${{ hashFiles('**/Cargo.lock') }}
      
      - name: Cache cargo build
        uses: actions/cache@v3
        with:
          path: lifebank-soroban/target
          key: ${{ runner.os }}-cargo-build-${{ hashFiles('**/Cargo.lock') }}
      
      - name: Run Inventory Fuzz Tests
        run: |
          cd lifebank-soroban
          cargo test --manifest-path contracts/fuzz/Cargo.toml --test fuzz_inventory \
            --release -- --nocapture
        env:
          RUST_BACKTRACE: 1

  fuzz-payments:
    name: "Fuzz Tests - Payments"
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      
      - name: Install Rust
        uses: dtolnay/rust-toolchain@stable
      
      - name: Cache cargo registry
        uses: actions/cache@v3
        with:
          path: ~/.cargo/registry
          key: ${{ runner.os }}-cargo-registry-${{ hashFiles('**/Cargo.lock') }}
      
      - name: Cache cargo index
        uses: actions/cache@v3
        with:
          path: ~/.cargo/git
          key: ${{ runner.os }}-cargo-git-${{ hashFiles('**/Cargo.lock') }}
      
      - name: Cache cargo build
        uses: actions/cache@v3
        with:
          path: lifebank-soroban/target
          key: ${{ runner.os }}-cargo-build-${{ hashFiles('**/Cargo.lock') }}
      
      - name: Run Payments Fuzz Tests
        run: |
          cd lifebank-soroban
          cargo test --manifest-path contracts/fuzz/Cargo.toml --test fuzz_payments \
            --release -- --nocapture
        env:
          RUST_BACKTRACE: 1

  # Optional: Ensure both suites can run together
  fuzz-all:
    name: "Fuzz Tests - Full Suite"
    runs-on: ubuntu-latest
    needs: [fuzz-inventory, fuzz-payments]
    if: always()
    steps:
      - uses: actions/checkout@v4
      
      - name: Install Rust
        uses: dtolnay/rust-toolchain@stable
      
      - name: Run All Fuzz Tests
        run: |
          cd lifebank-soroban
          cargo test --manifest-path contracts/fuzz/Cargo.toml --release -- --nocapture
```

## Local Testing Commands

### Run individual test suites locally

```bash
# Inventory fuzz tests only
cd lifebank-soroban
cargo test --manifest-path contracts/fuzz/Cargo.toml --test fuzz_inventory --release

# Payments fuzz tests only
cargo test --manifest-path contracts/fuzz/Cargo.toml --test fuzz_payments --release

# All fuzz tests together
cargo test --manifest-path contracts/fuzz/Cargo.toml --release
```

### Run with increased test verbosity

```bash
cargo test --manifest-path contracts/fuzz/Cargo.toml --test fuzz_inventory \
  --release -- --nocapture --test-threads=1
```

### Run with custom proptest iterations

```bash
PROPTEST_CASES=10000 cargo test --manifest-path contracts/fuzz/Cargo.toml \
  --test fuzz_inventory --release
```

## Failure Scenarios & Expected Behavior

### Scenario 1: Payment Contract Breaks

**Before Fix:**
- Both fuzz suites fail
- No inventory coverage data
- CI marked as completely failed

**After Fix:**
- ✅ Inventory fuzz tests run successfully
- ❌ Payments fuzz tests fail
- ✅ Partial CI success with clear failure isolation

### Scenario 2: Inventory Contract Breaks

**Before Fix:**
- Both fuzz suites fail
- No payments coverage data
- CI marked as completely failed

**After Fix:**
- ❌ Inventory fuzz tests fail
- ✅ Payments fuzz tests run successfully
- ✅ Partial CI success with clear failure isolation

### Scenario 3: Both Contracts Break

**Before & After:**
- Both fuzz suites fail as expected
- CI marked as failed
- But failure reason is now clear and traceable per contract

## Recommendations

### For Local Development
- Run only the affected test suite: `cargo test --test fuzz_inventory`
- Use `--release` for longer fuzz campaigns (10x faster)
- Set `PROPTEST_CASES=1000+` for more thorough testing

### For CI/CD
- Run both suites in parallel (separate jobs)
- Use `--release` to reduce execution time
- Consider different iteration counts per suite based on stability:
  - Inventory: 5000+ cases (more edge cases with expiry logic)
  - Payments: 2000+ cases (simpler state machine)

### For Post-Merge
- Schedule nightly runs with high case counts (50000+)
- Use separate nightly jobs for extended fuzz campaigns
- Archive fuzz seeds for regression testing

## Troubleshooting

### "Error: could not find `fuzz_inventory`"
This means the test binary name in `Cargo.toml` doesn't match the test file. Verify:
```toml
[[test]]
name = "fuzz_inventory"    # Must match the command name
path = "tests/fuzz_inventory.rs"  # Must exist
```

### Test Hangs During Execution
- Reduce `PROPTEST_CASES` (default: 256)
- Disable shrinking: `PROPTEST_MAX_SHRINK_ITERS=0`
- Run with `--test-threads=1` for debugging

### Out of Memory
- The Soroban test environment may accumulate state
- Consider reducing batch sizes in test strategies
- Run individual test functions separately

## References

- **Issue #844**: Property-based testing for contract edge cases
- **Issue #845**: Expired unit reservation prevention
- **Issue #848**: Two-party escrow confirmation process
- **Related Docs**: `FUZZ_TESTING_ARCHITECTURE.md` in this directory
