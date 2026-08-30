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
    env.storage()
        .persistent()
        .extend_ttl(&key, crate::ORACLE_BUMP_THRESHOLD, crate::ORACLE_BUMP_TO);
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
    env.storage()
        .persistent()
        .extend_ttl(&key, crate::ORACLE_BUMP_THRESHOLD, crate::ORACLE_BUMP_TO);
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
    env.storage()
        .persistent()
        .extend_ttl(&key, crate::ORACLE_BUMP_THRESHOLD, crate::ORACLE_BUMP_TO);
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
    env.storage()
        .persistent()
        .set(&DataKey::CurrentPage(unit_id), &page);
}
