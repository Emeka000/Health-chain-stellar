//! # registry_read
//!
//! All **read-only** BloodUnitRegistry helpers live here.
//!
//! ## Storage Write Audit
//! ✅  ZERO `env.storage().*.set()` calls in this module — verified manually.
//!
//! Every function performs **only** storage reads (`get`) and pure computation.
//! The public contract entry-points in `lib.rs` delegate to these free functions.

use soroban_sdk::{symbol_short, vec, Address, Env, Map, Symbol, Vec};

use crate::{BloodStatus, BloodUnit, Error, BLOOD_UNITS};

// ── READ ──────────────────────────────────────────────────────────────────────

/// Retrieve a single [`BloodUnit`] by its ID.
///
/// Returns `Err(Error::UnitNotFound)` when the ID does not exist in storage.
pub fn get_unit(env: &Env, unit_id: u64) -> Result<BloodUnit, Error> {
    let units: Map<u64, BloodUnit> = env
        .storage()
        .persistent()
        .get(&BLOOD_UNITS)
        .unwrap_or(Map::new(env));

    units.get(unit_id).ok_or(Error::UnitNotFound)
}

/// Return all blood units registered by a specific blood bank.
///
/// Performs a full-scan of the units map and filters by `bank_id`.
pub fn get_units_by_bank(env: &Env, bank_id: Address) -> Vec<BloodUnit> {
    let units: Map<u64, BloodUnit> = env
        .storage()
        .persistent()
        .get(&BLOOD_UNITS)
        .unwrap_or(Map::new(env));

    let mut bank_units = vec![env];

    for (_, unit) in units.iter() {
        if unit.bank_id == bank_id {
            bank_units.push_back(unit);
        }
    }

    bank_units
}

/// Return `true` when the blood unit's expiration date is in the past.
///
/// Returns `Err(Error::UnitNotFound)` when the unit does not exist.
pub fn is_expired(env: &Env, unit_id: u64) -> Result<bool, Error> {
    let unit = get_unit(env, unit_id)?;
    let current_time = env.ledger().timestamp();
    Ok(unit.expiration_date <= current_time || unit.status == BloodStatus::Expired)
}

/// Return all blood units donated by the given `donor_id` symbol.
///
/// Performs a full-scan of the units map and filters by `donor_id` field.
pub fn get_units_by_donor(env: &Env, donor_id: Symbol) -> Vec<BloodUnit> {
    let units: Map<u64, BloodUnit> = env
        .storage()
        .persistent()
        .get(&BLOOD_UNITS)
        .unwrap_or(Map::new(env));

    let mut donor_units = vec![env];

    for (_, unit) in units.iter() {
        if unit.donor_id == donor_id {
            // Exclude a generic "ANON" donor from per-donor queries unless
            // the caller explicitly asks for it (i.e. passes symbol_short!("ANON")).
            if unit.donor_id == symbol_short!("ANON") && donor_id != symbol_short!("ANON") {
                continue;
            }
            donor_units.push_back(unit);
        }
    }

    donor_units
}
