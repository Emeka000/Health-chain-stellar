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

use crate::{BloodStatus, BloodUnit, DataKey, Error, BLOOD_UNITS};

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
/// Uses the BankUnits index — O(k) where k is the number of units for this bank.
pub fn get_units_by_bank(env: &Env, bank_id: Address) -> Vec<BloodUnit> {
    let key = DataKey::BankUnits(bank_id);
    let ids: Vec<u64> = env
        .storage()
        .persistent()
        .get(&key)
        .unwrap_or(Vec::new(env));

    let units: Map<u64, BloodUnit> = env
        .storage()
        .persistent()
        .get(&BLOOD_UNITS)
        .unwrap_or(Map::new(env));

    let mut result = vec![env];
    for id in ids.iter() {
        if let Some(unit) = units.get(id) {
            result.push_back(unit);
        }
    }
    result
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
/// Uses the DonorUnits index with a sentinel zero-address for cross-bank queries.
/// Anonymous units (donor_id == "ANON") are excluded unless the caller explicitly
/// passes `symbol_short!("ANON")`.
pub fn get_units_by_donor(env: &Env, donor_id: Symbol) -> Vec<BloodUnit> {
    // Use a sentinel zero-address for global donor index
    let sentinel = soroban_sdk::Address::from_contract_id(
        env,
        &soroban_sdk::BytesN::from_array(env, &[0u8; 32]),
    );
    let key = DataKey::DonorUnits(sentinel, donor_id.clone());
    let ids: Vec<u64> = env
        .storage()
        .persistent()
        .get(&key)
        .unwrap_or(Vec::new(env));

    let units: Map<u64, BloodUnit> = env
        .storage()
        .persistent()
        .get(&BLOOD_UNITS)
        .unwrap_or(Map::new(env));

    let mut result = vec![env];
    for id in ids.iter() {
        if let Some(unit) = units.get(id) {
            if unit.donor_id == symbol_short!("ANON") && donor_id != symbol_short!("ANON") {
                continue;
            }
            result.push_back(unit);
        }
    }
    result
}
