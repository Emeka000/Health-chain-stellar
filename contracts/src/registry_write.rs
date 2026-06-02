//! # registry_write
//!
//! All **state-mutating** BloodUnitRegistry helpers live here.
//! Every function in this module calls `env.storage().*.set()` to persist changes.
//!
//! The public contract entry-points in `lib.rs` delegate to these free functions.
//!
//! ## Storage Write Audit (PR checklist)
//! - [x] `register_unit`          — writes BLOOD_UNITS, NEXT_ID, BankUnits index, DonorUnits index, StatusUnits index
//! - [x] `update_status`          — writes BLOOD_UNITS, StatusUnits index
//! - [x] `expire_unit`            — 1 read + 1 write of BLOOD_UNITS, StatusUnits index
//! - [x] `expire_unit_in_map`     — pure in-memory mutation; no storage I/O (used by batch)
//! - [x] `check_and_expire_batch` — 1 read + N in-memory mutations + 1 write of BLOOD_UNITS
//! - [x] `allocate_blood` (lib.rs) — writes HospitalUnits index on allocation; deindex on cancel_allocation

use soroban_sdk::{symbol_short, Address, Env, Map, Symbol, Vec};

use crate::{
    constants::{
        MAX_BATCH_EXPIRY_SIZE, MAX_QUANTITY_ML, MAX_SHELF_LIFE_DAYS, MIN_QUANTITY_ML,
        MIN_SHELF_LIFE_DAYS, SECONDS_PER_DAY,
    },
    get_next_id, index_bank_unit, index_donor_unit, record_status_change, reindex_status,
    BloodComponent, BloodRegisteredEvent, BloodStatus, BloodType, BloodUnit, Error, BLOOD_UNITS,
};

// ── WRITE ─────────────────────────────────────────────────────────────────────

/// Register a new blood unit into the inventory.
///
/// Validates quantity and expiration window, then persists a fresh [`BloodUnit`]
/// with `status = Available`.  Emits a `blood/register` event and returns the
/// new unit ID.
pub fn register_unit(
    env: &Env,
    bank_id: Address,
    blood_type: BloodType,
    component: BloodComponent,
    quantity_ml: u32,
    expiration_timestamp: u64,
    donor_id: Option<Symbol>,
) -> Result<u64, Error> {
    // Validate quantity
    if !(MIN_QUANTITY_ML..=MAX_QUANTITY_ML).contains(&quantity_ml) {
        return Err(Error::InvalidQuantity);
    }

    // Validate expiration
    let current_time = env.ledger().timestamp();
    let min_expiration = current_time + (MIN_SHELF_LIFE_DAYS * SECONDS_PER_DAY);
    let max_expiration = current_time + (MAX_SHELF_LIFE_DAYS * SECONDS_PER_DAY);

    if expiration_timestamp <= current_time || expiration_timestamp < min_expiration {
        return Err(Error::InvalidExpiration);
    }
    if expiration_timestamp > max_expiration {
        return Err(Error::InvalidExpiration);
    }

    let unit_id = get_next_id(env);

    let blood_unit = BloodUnit {
        id: unit_id,
        blood_type,
        component,
        quantity: quantity_ml,
        expiration_date: expiration_timestamp,
        donor_id: donor_id.clone().unwrap_or(symbol_short!("ANON")),
        location: symbol_short!("BANK"),
        bank_id: bank_id.clone(),
        registration_timestamp: current_time,
        status: BloodStatus::Available,
        recipient_hospital: None,
        allocation_timestamp: None,
        transfer_timestamp: None,
        delivery_timestamp: None,
    };

    let mut units: Map<u64, BloodUnit> = env
        .storage()
        .persistent()
        .get(&BLOOD_UNITS)
        .unwrap_or(Map::new(env));

    units.set(unit_id, blood_unit);
    env.storage().persistent().set(&BLOOD_UNITS, &units);

    // Maintain bank and donor indexes
    index_bank_unit(env, &bank_id, unit_id);
    let resolved_donor = donor_id.clone().unwrap_or(symbol_short!("ANON"));
    index_donor_unit(env, &bank_id, &resolved_donor, unit_id);
    // New unit starts as Available — seed the status index directly
    let status_key = crate::DataKey::StatusUnits(BloodStatus::Available);
    let mut status_ids: soroban_sdk::Vec<u64> = env
        .storage()
        .persistent()
        .get(&status_key)
        .unwrap_or(soroban_sdk::Vec::new(env));
    status_ids.push_back(unit_id);
    env.storage().persistent().set(&status_key, &status_ids);

    // Record initial status
    record_status_change(
        env,
        unit_id,
        BloodStatus::Available, // "Old" status doesn't exist for new units, use current
        BloodStatus::Available,
        bank_id.clone(),
    );

    // Emit registration event
    let event = BloodRegisteredEvent {
        unit_id,
        blood_type,
        component,
        quantity_ml,
        bank_id,
        expiration_timestamp,
        registration_timestamp: current_time,
        donor_id,
    };

    env.events().publish(
        (
            symbol_short!("blood"),
            symbol_short!("register"),
            symbol_short!("v1"),
        ),
        event,
    );

    Ok(unit_id)
}

/// Update the status of a blood unit in storage.
///
/// Persists the new status and appends a [`crate::StatusChangeEvent`] to the
/// unit's history.  Does **not** validate business-level transitions — callers
/// are responsible for guards.
pub fn update_status(
    env: &Env,
    unit_id: u64,
    new_status: BloodStatus,
    actor: Address,
) -> Result<(), Error> {
    let mut units: Map<u64, BloodUnit> = env
        .storage()
        .persistent()
        .get(&BLOOD_UNITS)
        .unwrap_or(Map::new(env));

    let mut unit = units.get(unit_id).ok_or(Error::UnitNotFound)?;
    let old_status = unit.status;

    unit.status = new_status;
    units.set(unit_id, unit);
    env.storage().persistent().set(&BLOOD_UNITS, &units);

    // Maintain status index
    reindex_status(env, unit_id, old_status, new_status);

    record_status_change(env, unit_id, old_status, new_status, actor);

    Ok(())
}

/// Force mark a blood unit as expired.
///
/// Loads the full `BLOOD_UNITS` map, delegates the mutation to
/// [`expire_unit_in_map`], then writes the map back.  Use this for
/// single-unit expiry; for bulk expiry prefer [`check_and_expire_batch`]
/// which amortises the storage round-trip across all units.
pub fn expire_unit(env: &Env, unit_id: u64) -> Result<(), Error> {
    let mut units: Map<u64, BloodUnit> = env
        .storage()
        .persistent()
        .get(&BLOOD_UNITS)
        .unwrap_or(Map::new(env));

    let expired = expire_unit_in_map(env, unit_id, &mut units)?;

    // Only persist if something actually changed.
    if expired {
        env.storage().persistent().set(&BLOOD_UNITS, &units);
    }

    Ok(())
}

/// Mutate a single entry inside an already-loaded `units` map.
///
/// Returns `Ok(true)` when the unit was transitioned to `Expired`,
/// `Ok(false)` when it was already `Expired` (no-op), and
/// `Err` when the unit does not exist or has not yet passed its expiry date.
///
/// This function performs **no storage I/O** — the caller is responsible for
/// loading the map beforehand and persisting it afterwards.  Keeping I/O out
/// of the hot loop in [`check_and_expire_batch`] reduces the per-batch cost
/// from O(n) reads/writes to a single read + single write.
fn expire_unit_in_map(
    env: &Env,
    unit_id: u64,
    units: &mut Map<u64, BloodUnit>,
) -> Result<bool, Error> {
    let mut unit = units.get(unit_id).ok_or(Error::UnitNotFound)?;

    let current_time = env.ledger().timestamp();
    if current_time < unit.expiration_date {
        return Err(Error::InvalidExpiration);
    }

    if unit.status == BloodStatus::Expired {
        // Already expired — nothing to do, not an error.
        return Ok(false);
    }

    let old_status = unit.status;
    unit.status = BloodStatus::Expired;
    units.set(unit_id, unit);

    // Keep the status index and history in sync.
    reindex_status(env, unit_id, old_status, BloodStatus::Expired);
    record_status_change(
        env,
        unit_id,
        old_status,
        BloodStatus::Expired,
        env.current_contract_address(),
    );

    Ok(true)
}

/// Batch check and expire units.
///
/// Loads `BLOOD_UNITS` **once**, mutates each requested unit in-memory via
/// [`expire_unit_in_map`], then writes the map back **once**.  This reduces
/// the storage cost from O(n) reads + O(n) writes (the old per-unit loop) to
/// a single read + single write regardless of batch size.
pub fn check_and_expire_batch(env: &Env, unit_ids: Vec<u64>) -> Result<Vec<u64>, Error> {
    if unit_ids.len() > MAX_BATCH_EXPIRY_SIZE {
        return Err(Error::BatchSizeExceeded);
    }

    // Single read for the entire batch.
    let mut units: Map<u64, BloodUnit> = env
        .storage()
        .persistent()
        .get(&BLOOD_UNITS)
        .unwrap_or(Map::new(env));

    let mut expired_ids = Vec::new(env);
    let mut any_changed = false;

    for i in 0..unit_ids.len() {
        let unit_id = unit_ids.get(i).unwrap();
        match expire_unit_in_map(env, unit_id, &mut units) {
            Ok(true) => {
                expired_ids.push_back(unit_id);
                any_changed = true;
            }
            // Ok(false) = already expired, skip silently.
            // Err(_)    = not yet expired or not found, skip silently.
            _ => {}
        }
    }

    // Single write — only when at least one unit changed.
    if any_changed {
        env.storage().persistent().set(&BLOOD_UNITS, &units);
    }

    Ok(expired_ids)
}
