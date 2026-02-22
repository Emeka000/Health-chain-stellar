use crate::types::{DataKey, BloodUnit};
use soroban_sdk::{Address, Env, Vec};

// --- INSTANCE STORAGE (Admin & Authorization) ---
// Used for high-frequency access and auth checks

pub fn set_admin(env: Env, admin: Address) {
    env.storage().instance().set(&DataKey::Admin, &admin);
}

pub fn get_admin(env: Env) -> Address {
    env.storage().instance().get(&DataKey::Admin).expect("Admin not set")
}

pub fn is_authorized_bank(env: Env, bank: &Address) -> bool {
    // If the Registrar key exists, the bank is authorized
    env.storage().instance().has(&DataKey::Registrar(bank.clone()))
}

pub fn set_authorized_bank(env: Env, bank: &Address, authorized: bool) {
    let key = DataKey::Registrar(bank.clone());
    if authorized {
        env.storage().instance().set(&key, &true);
    } else {
        env.storage().instance().remove(&key);
    }
}

pub fn increment_blood_unit_id(env: Env) -> u64 {
    let key = DataKey::UnitIdCounter;
    let mut id: u64 = env.storage().instance().get(&key).unwrap_or(0);
    id += 1;
    env.storage().instance().set(&key, &id);
    id
}

// --- PERSISTENT STORAGE (Unit Data & Large Indexes) ---
// Used for data that grows over time

pub fn set_blood_unit(env: Env, unit: &BloodUnit) {
    // Standardize all blood unit data to Persistent storage
    env.storage().persistent().set(&DataKey::BloodUnit(unit.id), unit);
}

pub fn get_blood_unit(env: Env, id: u64) -> Option<BloodUnit> {
    env.storage().persistent().get(&DataKey::BloodUnit(id))
}

pub fn add_to_bank_index(env: Env, unit: &BloodUnit) {
    let key = DataKey::BankUnits(unit.bank_id.clone());
    let mut units: Vec<u64> = env.storage().persistent().get(&key).unwrap_or(Vec::new(&env));
    units.push_back(unit.id);
    env.storage().persistent().set(&key, &units);
}

pub fn add_to_donor_index(env: Env, unit: &BloodUnit) {
    if let Some(donor_id) = &unit.donor_id {
        let key = DataKey::DonorUnits(donor_id.clone());
        let mut units: Vec<u64> = env.storage().persistent().get(&key).unwrap_or(Vec::new(&env));
        units.push_back(unit.id);
        env.storage().persistent().set(&key, &units);
    }
}