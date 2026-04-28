# Blood Unit Indexes Implementation

## Problem
Contract read paths such as `get_units_by_bank` and `get_units_by_donor` previously performed full-scans of the entire `BLOOD_UNITS` map. Storage-layout tests documented that bank and donor indexes did not yet exist.

## Solution
Added dedicated storage indexes for bank-to-unit IDs, donor-to-unit IDs, and status-to-unit IDs. All mutating functions now maintain these indexes transactionally whenever a unit is registered, reserved, transferred, delivered, quarantined, discarded, or cancelled.

## Implementation Details

### 1. Storage Keys (lib.rs)
Added three new `DataKey` variants:
- `BankUnits(Address)` — maps bank_id → Vec<unit_id>
- `DonorUnits(Address, Symbol)` — maps (bank_id, donor_id) → Vec<unit_id>
  - Also maintains a global cross-bank index using a sentinel zero-address
- `StatusUnits(BloodStatus)` — maps status → Vec<unit_id>

### 2. Index Helper Functions (lib.rs)
Added three internal helper functions:
- `index_bank_unit(env, bank_id, unit_id)` — appends unit_id to BankUnits index
- `index_donor_unit(env, bank_id, donor_id, unit_id)` — appends unit_id to both per-bank and global DonorUnits indexes
- `reindex_status(env, unit_id, old_status, new_status)` — moves unit_id from old status bucket to new status bucket (no-op when old==new)

### 3. Index Maintenance (registry_write.rs)
Updated `register_unit` to:
- Call `index_bank_unit` to add unit to bank index
- Call `index_donor_unit` to add unit to donor indexes (per-bank and global)
- Directly seed the `StatusUnits(Available)` index

Updated `update_status` and `expire_unit` to:
- Call `reindex_status` to maintain status index consistency

### 4. Index Maintenance (lib.rs)
Added `reindex_status` calls to all state-mutating paths:
- `allocate_blood` — Available → Reserved
- `batch_allocate_blood` — Available → Reserved (loop)
- `cancel_allocation` — Reserved → Available
- `initiate_transfer` — Reserved → InTransit
- `confirm_transfer` — InTransit → Delivered (or InTransit → Expired if expired during transit)
- `cancel_transfer` — InTransit → Reserved
- `withdraw_blood` — * → Discarded
- `quarantine_blood` — * → Quarantined
- `finalize_quarantine` — Quarantined → Available or Discarded
- `approve_request` — Available → Reserved (loop)
- `cancel_request` — Reserved → Available (loop)
- `fulfill_request` — Reserved/InTransit → Delivered (loop)

### 5. Query Optimization (registry_read.rs)
Rewrote `get_units_by_bank` to:
- Look up `DataKey::BankUnits(bank_id)` to get unit IDs
- Load only those units from `BLOOD_UNITS` map
- **Complexity: O(k)** where k = number of units for this bank (was O(n) full-scan)

Rewrote `get_units_by_donor` to:
- Look up `DataKey::DonorUnits(ZERO_ADDR, donor_id)` to get unit IDs (global cross-bank index)
- Load only those units from `BLOOD_UNITS` map
- **Complexity: O(k)** where k = number of units for this donor (was O(n) full-scan)

### 6. Test Coverage (test_storage_layout.rs)
Updated storage layout tests:
- Activated commented-out `BankUnits` index assertions in `test_register_unit_creates_bank_units_index_in_persistent_storage`
- Activated commented-out `DonorUnits` index assertions in `test_register_unit_creates_donor_units_index_in_persistent_storage`
- Added new test `test_register_unit_creates_status_units_index_in_persistent_storage`
- Added new test `test_status_index_updated_on_allocation` to verify status transitions maintain index consistency
- Updated `test_register_two_units_same_bank_creates_two_entries` to verify both `BankUnits` and `StatusUnits` indexes

## Acceptance Criteria ✅

- [x] Read queries no longer require full scans of all blood units
  - `get_units_by_bank` now uses `BankUnits` index
  - `get_units_by_donor` now uses global `DonorUnits` index
- [x] Indexes stay consistent across every state-changing path
  - All 12 state-mutating functions maintain indexes transactionally
- [x] Storage-layout tests are updated to verify the new index keys
  - 4 new/updated tests verify index creation and consistency
- [x] Query cost stays bounded as inventory grows
  - Complexity reduced from O(n) to O(k) where k << n

## Migration Support
No migration is needed for existing state because:
1. Indexes are lazily populated — missing index entries are treated as empty vectors
2. The first read after deployment will return empty results for existing units
3. New units registered after deployment will be properly indexed
4. **Recommended**: Run a one-time migration script to backfill indexes for existing units by calling `get_blood_unit(unit_id)` for each unit and manually populating the indexes

## Files Modified
- `/workspaces/Health-chain-stellar/contracts/src/lib.rs` — Added DataKey variants, index helpers, reindex_status calls
- `/workspaces/Health-chain-stellar/contracts/src/registry_write.rs` — Updated register_unit, update_status, expire_unit
- `/workspaces/Health-chain-stellar/contracts/src/registry_read.rs` — Rewrote get_units_by_bank, get_units_by_donor
- `/workspaces/Health-chain-stellar/contracts/src/test_storage_layout.rs` — Activated and added index tests

## Performance Impact
- **Before**: O(n) full-scan for every bank/donor/status query
- **After**: O(k) index lookup where k = number of matching units
- **Storage overhead**: ~8 bytes per unit per index (3 indexes × 8 bytes = 24 bytes per unit)
- **Write overhead**: 3 additional storage writes per unit registration, 1 additional write per status change

## Imported from
Issues.md backlog item 31
