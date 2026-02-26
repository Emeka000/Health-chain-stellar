# Migration Guide: Donor Index Composite Key (Issue #125)

## Overview

This migration addresses a critical bug where `get_units_by_donor` could return blood units from different blood banks when donor IDs collided across banks. The fix introduces a composite key `(bank_id, donor_id)` for the donor index.

## Changes Made

### 1. DataKey Enum Addition
Added a new `DataKey` enum to support composite keys:
```rust
#[contracttype]
#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub enum DataKey {
    /// Donor units index: (bank_id, donor_id) -> Vec<u64>
    DonorUnits(Address, Symbol),
}
```

### 2. Updated `register_blood` Function
The function now maintains a donor index using the composite key:
```rust
// Update donor index with composite key (bank_id, donor_id)
if let Some(ref donor) = donor_id {
    let donor_key = DataKey::DonorUnits(bank_id.clone(), donor.clone());
    let mut donor_units: Vec<u64> = env
        .storage()
        .persistent()
        .get(&donor_key)
        .unwrap_or(vec![&env]);
    donor_units.push_back(unit_id);
    env.storage().persistent().set(&donor_key, &donor_units);
}
```

### 3. New `get_units_by_donor` Function
Added a new function that requires both `bank_id` and `donor_id`:
```rust
pub fn get_units_by_donor(env: Env, bank_id: Address, donor_id: Symbol) -> Vec<BloodUnit>
```

## Breaking Changes

### Function Signature Change
**Old (if existed in previous versions):**
```rust
get_units_by_donor(env: Env, donor_id: Symbol) -> Vec<BloodUnit>
```

**New:**
```rust
get_units_by_donor(env: Env, bank_id: Address, donor_id: Symbol) -> Vec<BloodUnit>
```

## Migration Path for Existing Deployments

### Option 1: Fresh Deployment (Recommended for Test Networks)
Deploy a new contract instance. This is the simplest approach for test networks or if you don't have critical data to preserve.

### Option 2: Manual Migration (For Production with Existing Data)

If you have an existing deployment with donor data, you'll need to create a migration function:

```rust
/// Admin-only function to migrate old donor index to new composite key format
/// This should be called once after contract upgrade
pub fn migrate_donor_index(env: Env) -> Result<u32, Error> {
    let admin: Address = env
        .storage()
        .instance()
        .get(&ADMIN)
        .ok_or(Error::Unauthorized)?;
    admin.require_auth();

    let units: Map<u64, BloodUnit> = env
        .storage()
        .persistent()
        .get(&BLOOD_UNITS)
        .unwrap_or(Map::new(&env));

    let mut migrated_count = 0u32;

    // Iterate through all blood units and rebuild donor index
    for (_, unit) in units.iter() {
        if unit.donor_id != symbol_short!("ANON") {
            let donor_key = DataKey::DonorUnits(unit.bank_id.clone(), unit.donor_id.clone());
            let mut donor_units: Vec<u64> = env
                .storage()
                .persistent()
                .get(&donor_key)
                .unwrap_or(vec![&env]);
            
            // Check if unit is already in the index
            let mut already_indexed = false;
            for i in 0..donor_units.len() {
                if donor_units.get(i).unwrap() == unit.id {
                    already_indexed = true;
                    break;
                }
            }
            
            if !already_indexed {
                donor_units.push_back(unit.id);
                env.storage().persistent().set(&donor_key, &donor_units);
                migrated_count += 1;
            }
        }
    }

    Ok(migrated_count)
}
```

**Migration Steps:**
1. Deploy the updated contract
2. Call `migrate_donor_index()` as admin
3. Verify the migration by testing `get_units_by_donor` with known donor IDs
4. Update all client applications to use the new function signature

### Option 3: Parallel Index (Zero-Downtime Migration)

For production systems requiring zero downtime:

1. Deploy the updated contract with both old and new index maintenance
2. Run a background migration to populate the new index
3. Switch client applications to use the new function
4. Remove old index maintenance code in a subsequent update

## Testing

Three new tests have been added to verify the fix:

1. `test_donor_id_collision_across_banks` - Verifies that donor ID collisions across banks are properly isolated
2. `test_get_units_by_donor_nonexistent` - Tests querying for non-existent donors
3. `test_get_units_by_donor_anonymous` - Tests behavior with anonymous donors

Run tests with:
```bash
cargo test test_donor_id_collision_across_banks
cargo test test_get_units_by_donor
```

## Client Application Updates

Update all calls to `get_units_by_donor`:

**Before:**
```rust
let units = client.get_units_by_donor(&donor_id);
```

**After:**
```rust
let units = client.get_units_by_donor(&bank_id, &donor_id);
```

## Verification

After migration, verify the fix by:

1. Registering units with the same donor ID at different banks
2. Querying each bank's donor units separately
3. Confirming that results are properly isolated by bank

Example verification:
```rust
// Bank A registers donor "001"
client.register_blood(&bank_a, &BloodType::OPositive, &450, &expiration, &Some(symbol_short!("001")));

// Bank B registers donor "001" (different person)
client.register_blood(&bank_b, &BloodType::APositive, &350, &expiration, &Some(symbol_short!("001")));

// Verify isolation
let bank_a_units = client.get_units_by_donor(&bank_a, &symbol_short!("001"));
let bank_b_units = client.get_units_by_donor(&bank_b, &symbol_short!("001"));

assert_eq!(bank_a_units.len(), 1);
assert_eq!(bank_b_units.len(), 1);
assert_ne!(bank_a_units.get(0).unwrap().id, bank_b_units.get(0).unwrap().id);
```

## Rollback Plan

If issues arise during migration:

1. Revert to the previous contract version
2. Old data will still be accessible (new index doesn't affect existing storage)
3. Investigate and fix issues before re-attempting migration

## Support

For questions or issues during migration, please refer to:
- Issue #125: https://github.com/Emeka000/Health-chain-stellar/issues/125
- Contract documentation in `contracts/README.md`
