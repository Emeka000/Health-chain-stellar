//! # registry_write
//!
//! All **state-mutating** BloodUnitRegistry helpers live here.
//! Every function in this module calls `env.storage().*.set()` to persist changes.
//!
//! The public contract entry-points in `lib.rs` delegate to these free functions.
//!
//! ## Storage Write Audit (PR checklist)
//! - [x] `register_unit`  — writes BLOOD_UNITS, NEXT_ID
//! - [x] `update_status`  — writes BLOOD_UNITS
//! - [x] `expire_unit`    — writes BLOOD_UNITS
//! - [x] `check_and_expire_batch` — delegates to `expire_unit`

use soroban_sdk::{symbol_short, Address, Env, Map, Symbol, Vec};

use crate::{
    get_next_id, record_status_change,
    BloodRegisteredEvent, BloodStatus, BloodType, BloodUnit, Error, BLOOD_UNITS,
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
    quantity_ml: u32,
    expiration_timestamp: u64,
    donor_id: Option<Symbol>,
) -> Result<u64, Error> {
    use crate::{MAX_QUANTITY_ML, MAX_SHELF_LIFE_DAYS, MIN_QUANTITY_ML, MIN_SHELF_LIFE_DAYS};

    // Validate quantity
    if !(MIN_QUANTITY_ML..=MAX_QUANTITY_ML).contains(&quantity_ml) {
        return Err(Error::InvalidQuantity);
    }

    // Validate expiration
    let current_time = env.ledger().timestamp();
    let min_expiration = current_time + (MIN_SHELF_LIFE_DAYS * 86400);
    let max_expiration = current_time + (MAX_SHELF_LIFE_DAYS * 86400);

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
        quantity_ml,
        bank_id,
        expiration_timestamp,
        registration_timestamp: current_time,
        donor_id,
    };

    env.events()
        .publish((symbol_short!("blood"), symbol_short!("register")), event);

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

    record_status_change(env, unit_id, old_status, new_status, actor);

    Ok(())
}

/// Force mark a blood unit as expired.
pub fn expire_unit(env: &Env, unit_id: u64) -> Result<(), Error> {
    let mut units: Map<u64, BloodUnit> = env
        .storage()
        .persistent()
        .get(&BLOOD_UNITS)
        .unwrap_or(Map::new(env));

    let mut unit = units.get(unit_id).ok_or(Error::UnitNotFound)?;

    let current_time = env.ledger().timestamp();
    if current_time < unit.expiration_date {
        return Err(Error::InvalidExpiration);
    }

    if unit.status == BloodStatus::Expired {
        return Ok(());
    }

    let old_status = unit.status;
    unit.status = BloodStatus::Expired;

    units.set(unit_id, unit);
    env.storage().persistent().set(&BLOOD_UNITS, &units);

    // Record in history
    record_status_change(
        env,
        unit_id,
        old_status,
        BloodStatus::Expired,
        env.current_contract_address(),
    );

    Ok(())
}

/// Batch check and expire units.
pub fn check_and_expire_batch(env: &Env, unit_ids: Vec<u64>) -> Result<Vec<u64>, Error> {
    if unit_ids.len() > 50 {
        return Err(Error::BatchSizeExceeded);
    }

    let mut expired_ids = Vec::new(env);
    for i in 0..unit_ids.len() {
        let unit_id = unit_ids.get(i).unwrap();
        if expire_unit(env, unit_id).is_ok() {
            expired_ids.push_back(unit_id);
        }
    }

    Ok(expired_ids)
}
