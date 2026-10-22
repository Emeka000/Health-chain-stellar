use crate::types::{DataKey, TemperatureReading, TemperatureThreshold};
use soroban_sdk::{Env, Vec};

pub fn get_admin(env: &Env) -> soroban_sdk::Address {
    env.storage().instance().get(&DataKey::Admin).unwrap()
}

pub fn set_admin(env: &Env, admin: &soroban_sdk::Address) {
    env.storage().instance().set(&DataKey::Admin, admin);
}

pub fn get_threshold(env: &Env, unit_id: u64) -> Option<TemperatureThreshold> {
    env.storage().persistent().get(&DataKey::Threshold(unit_id))
}

pub fn set_threshold(env: &Env, unit_id: u64, threshold: &TemperatureThreshold) {
    let key = DataKey::Threshold(unit_id);
    env.storage().persistent().set(&key, threshold);
    env.storage().persistent().extend_ttl(
        &key,
        crate::ORACLE_BUMP_THRESHOLD,
        crate::ORACLE_BUMP_TO,
    );
}

pub fn get_temp_page(env: &Env, unit_id: u64, page: u32) -> Vec<TemperatureReading> {
    env.storage()
        .persistent()
        .get(&DataKey::TempPage(unit_id, page))
        .unwrap_or_else(|| Vec::new(env))
}

pub fn set_temp_page(env: &Env, unit_id: u64, page: u32, readings: &Vec<TemperatureReading>) {
    let key = DataKey::TempPage(unit_id, page);
    env.storage().persistent().set(&key, readings);
    env.storage().persistent().extend_ttl(
        &key,
        crate::ORACLE_BUMP_THRESHOLD,
        crate::ORACLE_BUMP_TO,
    );
}

pub fn get_temp_page_len(env: &Env, unit_id: u64, page: u32) -> u32 {
    env.storage()
        .persistent()
        .get(&DataKey::TempPageLen(unit_id, page))
        .unwrap_or(0)
}

pub fn set_temp_page_len(env: &Env, unit_id: u64, page: u32, len: u32) {
    let key = DataKey::TempPageLen(unit_id, page);
    env.storage().persistent().set(&key, &len);
    env.storage().persistent().extend_ttl(
        &key,
        crate::ORACLE_BUMP_THRESHOLD,
        crate::ORACLE_BUMP_TO,
    );
}

/// Returns the last active (potentially non-full) page number for a unit,
/// or 0 if the unit has no readings yet.
pub fn get_current_page(env: &Env, unit_id: u64) -> u32 {
    env.storage()
        .persistent()
        .get(&DataKey::CurrentPage(unit_id))
        .unwrap_or(0)
}

pub fn set_current_page(env: &Env, unit_id: u64, page: u32) {
    let key = DataKey::CurrentPage(unit_id);
    env.storage().persistent().set(&key, &page);
    // The cursor must outlive the pages it points into; if it archives,
    // get_current_page falls back to 0 and new readings overwrite page 0.
    env.storage().persistent().extend_ttl(
        &key,
        crate::ORACLE_BUMP_THRESHOLD,
        crate::ORACLE_BUMP_TO,
    );
}

/// Number of most-recent pages scanned when deriving excursion data.
/// Bounds per-call work to O(1) in unit lifetime instead of O(total pages),
/// preventing instruction-limit failures for long-lived, heavily monitored units.
pub const EXCURSION_SCAN_PAGE_WINDOW: u32 = 8;

/// Returns the inclusive range of page numbers to scan when deriving
/// excursion data for a unit: the most recent `EXCURSION_SCAN_PAGE_WINDOW`
/// pages ending at the unit's current page. The scan is bounded regardless
/// of how many pages the unit has accumulated over its lifetime.
pub fn get_excursion_scan_range(env: &Env, unit_id: u64) -> (u32, u32) {
    let current = get_current_page(env, unit_id);
    let start = current.saturating_sub(EXCURSION_SCAN_PAGE_WINDOW.saturating_sub(1));
    (start, current)
}
