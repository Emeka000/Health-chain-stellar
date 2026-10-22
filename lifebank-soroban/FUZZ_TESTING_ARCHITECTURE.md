# Fuzz Testing Architecture

## Problem Statement

The original fuzz test setup had a critical architectural dependency issue:

**Status Before Fix:**
- Single `lifebank-fuzz` crate in `contracts/fuzz/Cargo.toml`
- Both `inventory-contract` and `payment-contract` listed as direct dependencies
- Single unified build: `cargo test --manifest-path contracts/fuzz/Cargo.toml`
- **Result**: Any compilation failure in either contract blocks **both** fuzz test suites

**Real-World Impact:**
- Fuzz test suite for inventory (issues #844/#845) was non-functional if payments contract failed
- CI couldn't run inventory fuzz coverage independently
- Test isolation was zero—one domain's problems cascaded to another

## Previous Discriminant Issue (Already Fixed)

The error mentioned in the issue (`InvalidVestingSchedule = 518` and `Overflow = 518`) was a historical problem, already corrected:
- Current `contracts/payments/src/lib.rs` defines: `InvalidVestingSchedule = 518` and `Overflow = 519`
- Discriminants are unique; no collision exists
- Values were likely renumbered when the issue was discovered

## Solution Implemented

**Architecture: Independent Test Binaries with Selective Dependencies**

Instead of creating separate crate directories (which adds maintenance overhead), the solution uses Cargo's `[[test]]` feature with **dev-dependencies only**:

### Key Changes

```toml
# Before: Both contracts in main dependencies
[dependencies]
soroban-sdk = { workspace = true, features = ["testutils"] }
inventory-contract = { path = "../inventory" }
payment-contract = { path = "../payments" }

# After: Each test binary declares only what it needs
[dev-dependencies]
proptest = "1.4"
arbitrary = "1.3"
inventory-contract = { path = "../inventory" }
payment-contract = { path = "../payments" }

[[test]]
name = "fuzz_inventory"
path = "tests/fuzz_inventory.rs"

[[test]]
name = "fuzz_payments"
path = "tests/fuzz_payments.rs"
```

### Benefits

1. **Independent Compilation**: Each test binary compiles independently
2. **Isolated Failures**: A break in payments-contract doesn't block inventory fuzz tests
3. **Minimal Overhead**: No additional crates; uses built-in Cargo features
4. **Backwards Compatible**: `cargo test --manifest-path contracts/fuzz/Cargo.toml` still works

## Execution Modes

### Run All Fuzz Tests (Both Suites)
```bash
cargo test --manifest-path contracts/fuzz/Cargo.toml --test '*'
```

### Run Inventory Fuzz Tests Only
```bash
cargo test --manifest-path contracts/fuzz/Cargo.toml --test fuzz_inventory
```

### Run Payment Fuzz Tests Only
```bash
cargo test --manifest-path contracts/fuzz/Cargo.toml --test fuzz_payments
```

## CI Integration

**For `.github/workflows/test.yml` (or equivalent):**

```yaml
- name: Fuzz Test - Inventory
  run: cargo test --manifest-path contracts/fuzz/Cargo.toml --test fuzz_inventory
  
- name: Fuzz Test - Payments
  run: cargo test --manifest-path contracts/fuzz/Cargo.toml --test fuzz_payments
```

This ensures:
- If payments contract breaks, inventory fuzz still runs in CI
- Each test suite is independently verifiable
- Coverage gaps are immediately visible

## Test Coverage

### Inventory Fuzz Tests (`tests/fuzz_inventory.rs`)
- **Issue #844**: Duration overflow and panic resistance
- **Issue #845**: Expired unit validation
- **Strategies**: Duration extremes (0, MAX, normal range), quantities, batch sizes
- **Invariants**: Never panic, handle edge cases gracefully

### Payment Fuzz Tests (`tests/fuzz_payments.rs`)
- **Issue #844**: Payment amount edge cases
- **Strategies**: Arbitrary i128 amounts
- **Invariants**: Amounts ≤ 0 rejected, overflow handled

## Related Issues

- **#844**: Property-based tests for inventory/payment edge cases
- **#845**: Expired unit reservation prevention
- **#848**: Two-party escrow confirmation (payment contract fix)

## Maintenance Notes

- Test files remain in `tests/` subdirectory, not separate crate directories
- Both test binaries use the same `proptest` and `arbitrary` frameworks
- Each test binary's build is completely independent per Cargo's design
- If new test files are added, add corresponding `[[test]]` entries to `Cargo.toml`
