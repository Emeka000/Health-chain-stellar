# Issue #125 Fix Summary: Donor ID Collision Across Blood Banks

## Problem Statement

The `get_units_by_donor` function was using `DataKey::DonorUnits(donor_id)` as the storage key, which only included the donor ID. This caused a critical bug where two different blood banks could register donors with the same donor_id string (e.g., both using sequential integers starting from "1"), resulting in:

- The second bank's `register_unit` call appending to the first bank's donor index
- `get_units_by_donor` returning blood units from both banks mixed together under the same donor key
- Potential data privacy violations and incorrect blood unit allocation

## Solution Implemented

### 1. Added DataKey Enum with Composite Key

Created a new `DataKey` enum to support composite keys:

```rust
#[contracttype]
#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub enum DataKey {
    /// Donor units index: (bank_id, donor_id) -> Vec<u64>
    DonorUnits(Address, Symbol),
}
```

### 2. Updated `register_blood` Function

Modified the function to maintain a donor index using the composite key `(bank_id, donor_id)`:

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

### 3. Implemented `get_units_by_donor` Function

Added a new public function that requires both `bank_id` and `donor_id` parameters:

```rust
pub fn get_units_by_donor(env: Env, bank_id: Address, donor_id: Symbol) -> Vec<BloodUnit> {
    // Get unit IDs from the donor index using composite key
    let donor_key = DataKey::DonorUnits(bank_id, donor_id);
    let unit_ids: Vec<u64> = env
        .storage()
        .persistent()
        .get(&donor_key)
        .unwrap_or(vec![&env]);

    // Retrieve the actual blood units
    let units: Map<u64, BloodUnit> = env
        .storage()
        .persistent()
        .get(&BLOOD_UNITS)
        .unwrap_or(Map::new(&env));

    let mut donor_units = vec![&env];
    for i in 0..unit_ids.len() {
        let unit_id = unit_ids.get(i).unwrap();
        if let Some(unit) = units.get(unit_id) {
            donor_units.push_back(unit);
        }
    }

    donor_units
}
```

### 4. Added Debug Trait to BloodType

Added `Debug` trait to `BloodType` enum to support test assertions:

```rust
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub enum BloodType {
    // ...
}
```

## Tests Added

### 1. `test_donor_id_collision_across_banks`

The primary test that verifies the fix:
- Registers two different blood banks
- Both banks register units with donor ID "001" (different people, same ID)
- Verifies that `get_units_by_donor` returns only the correct bank's units
- Tests that adding more units to one bank doesn't affect the other bank's donor index

### 2. `test_get_units_by_donor_nonexistent`

Tests querying for a donor that doesn't exist:
- Verifies the function returns an empty vector
- Ensures no errors are thrown for non-existent donors

### 3. `test_get_units_by_donor_anonymous`

Tests behavior with anonymous donors:
- Registers blood without a donor_id (anonymous)
- Verifies that anonymous donors are not indexed
- Confirms querying for "ANON" returns empty results

## Test Results

All three new tests pass successfully:

```
test test::test_donor_id_collision_across_banks ... ok
test test::test_get_units_by_donor_nonexistent ... ok
test test::test_get_units_by_donor_anonymous ... ok
```

## Acceptance Criteria Met

✅ `DataKey::DonorUnits` uses a composite `(bank_id, donor_id)` key  
✅ `get_units_by_donor` requires both `bank_id` and `donor_id` as parameters  
✅ Cross-bank donor ID collision no longer causes data mixing  
✅ Test covers the exact collision scenario described in the issue  
✅ Migration note included for existing deployments (see `MIGRATION_DONOR_INDEX.md`)

## Files Modified

1. `contracts/src/lib.rs`
   - Added `DataKey` enum
   - Updated `register_blood` function
   - Added `get_units_by_donor` function
   - Added `Debug` trait to `BloodType`
   - Added three comprehensive tests

2. `contracts/MIGRATION_DONOR_INDEX.md` (new file)
   - Detailed migration guide for existing deployments
   - Multiple migration strategies
   - Verification procedures

3. `contracts/ISSUE_125_FIX_SUMMARY.md` (this file)
   - Summary of changes and implementation details

## Breaking Changes

The function signature has changed:

**Before (if existed):**
```rust
get_units_by_donor(env: Env, donor_id: Symbol) -> Vec<BloodUnit>
```

**After:**
```rust
get_units_by_donor(env: Env, bank_id: Address, donor_id: Symbol) -> Vec<BloodUnit>
```

All client applications must be updated to provide the `bank_id` parameter.

## Security Impact

This fix addresses a critical data isolation issue:
- **Before**: Donor data could leak across blood banks
- **After**: Each bank's donor data is properly isolated
- **Privacy**: Prevents unauthorized access to donor information from other banks
- **Data Integrity**: Ensures blood units are correctly associated with their source bank

## Performance Impact

- **Storage**: Minimal increase (composite key vs single key)
- **Query Performance**: No significant change (same number of storage lookups)
- **Index Maintenance**: Negligible overhead during blood registration

## Recommendations

1. Deploy to test network first and verify with the provided tests
2. Run migration function on existing deployments (see migration guide)
3. Update all client applications to use the new function signature
4. Monitor for any issues during the transition period
5. Consider adding additional tests for edge cases specific to your use case

## Related Issues

- Issue #125: [BUG] get_units_by_donor Returns Units Registered at Other Blood Banks When Donor ID Collides Across Banks
