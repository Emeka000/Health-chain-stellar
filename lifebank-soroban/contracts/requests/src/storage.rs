use crate::error::ContractError;
use crate::types::{BloodRequest, ContractMetadata, DataKey};
use soroban_sdk::{Address, Env, String};

/// Persistent storage TTL constants (ledgers; one ledger ≈ 5 s on mainnet).
const TTL_THRESHOLD: u32 = 518_400; // ~30 days
const TTL_EXTEND_TO: u32 = 1_036_800; // ~60 days

pub fn is_initialized(env: &Env) -> bool {
    env.storage()
        .instance()
        .get::<DataKey, bool>(&DataKey::Initialized)
        .unwrap_or(false)
}

pub fn require_initialized(env: &Env) -> Result<(), ContractError> {
    if is_initialized(env) {
        Ok(())
    } else {
        Err(ContractError::NotInitialized)
    }
}

pub fn set_initialized(env: &Env) {
    env.storage().instance().set(&DataKey::Initialized, &true);
}

pub fn set_admin(env: &Env, admin: &Address) {
    env.storage().instance().set(&DataKey::Admin, admin);
}

pub fn get_admin(env: &Env) -> Address {
    env.storage()
        .instance()
        .get(&DataKey::Admin)
        .expect("admin must be set after initialization")
}

pub fn set_inventory_contract(env: &Env, inventory_contract: &Address) {
    env.storage()
        .instance()
        .set(&DataKey::InventoryContract, inventory_contract);
}

pub fn get_inventory_contract(env: &Env) -> Address {
    env.storage()
        .instance()
        .get(&DataKey::InventoryContract)
        .expect("inventory contract must be set after initialization")
}

pub fn set_request_counter(env: &Env, value: u64) {
    env.storage().instance().set(&DataKey::RequestCounter, &value);
}

pub fn get_request_counter(env: &Env) -> u64 {
    env.storage()
        .instance()
        .get(&DataKey::RequestCounter)
        .expect("request counter must be set after initialization")
}

pub fn increment_request_counter(env: &Env) -> u64 {
    let next = get_request_counter(env) + 1;
    set_request_counter(env, next);
    next
}

/// Store hospital authorization in persistent storage.
/// Instance storage has a fixed size budget; using persistent storage
/// prevents instance bloat as the number of authorized hospitals grows.
pub fn authorize_hospital(env: &Env, hospital: &Address) {
    let key = DataKey::AuthorizedHospital(hospital.clone());
    env.storage().persistent().set(&key, &true);
    env.storage().persistent().extend_ttl(&key, TTL_THRESHOLD, TTL_EXTEND_TO);
}

pub fn revoke_hospital(env: &Env, hospital: &Address) {
    env.storage()
        .persistent()
        .remove(&DataKey::AuthorizedHospital(hospital.clone()));
}

pub fn is_hospital_authorized(env: &Env, hospital: &Address) -> bool {
    env.storage()
        .persistent()
        .get::<DataKey, bool>(&DataKey::AuthorizedHospital(hospital.clone()))
        .unwrap_or(false)
}

pub fn authorize_blood_bank(env: &Env, blood_bank: &Address) {
    env.storage()
        .instance()
        .set(&DataKey::AuthorizedBloodBank(blood_bank.clone()), &true);
}

pub fn revoke_blood_bank(env: &Env, blood_bank: &Address) {
    env.storage()
        .instance()
        .remove(&DataKey::AuthorizedBloodBank(blood_bank.clone()));
}

pub fn is_blood_bank_authorized(env: &Env, blood_bank: &Address) -> bool {
    env.storage()
        .instance()
        .get::<DataKey, bool>(&DataKey::AuthorizedBloodBank(blood_bank.clone()))
        .unwrap_or(false)
}

pub fn authorize_rider(env: &Env, rider: &Address) {
    env.storage()
        .instance()
        .set(&DataKey::AuthorizedRider(rider.clone()), &true);
}

pub fn revoke_rider(env: &Env, rider: &Address) {
    env.storage()
        .instance()
        .remove(&DataKey::AuthorizedRider(rider.clone()));
}

pub fn is_rider_authorized(env: &Env, rider: &Address) -> bool {
    env.storage()
        .instance()
        .get::<DataKey, bool>(&DataKey::AuthorizedRider(rider.clone()))
        .unwrap_or(false)
}

pub fn set_request(env: &Env, request: &BloodRequest) {
    let key = DataKey::Request(request.id);
    env.storage().persistent().set(&key, request);
    env.storage().persistent().extend_ttl(&key, TTL_THRESHOLD, TTL_EXTEND_TO);
}

pub fn get_request(env: &Env, request_id: u64) -> Option<BloodRequest> {
    env.storage().persistent().get(&DataKey::Request(request_id))
}

pub fn set_metadata(env: &Env, metadata: &ContractMetadata) {
    env.storage().instance().set(&DataKey::Metadata, metadata);
}

pub fn get_metadata(env: &Env) -> ContractMetadata {
    env.storage()
        .instance()
        .get(&DataKey::Metadata)
        .expect("metadata must be set after initialization")
}

pub fn default_metadata(env: &Env) -> ContractMetadata {
    ContractMetadata {
        name: String::from_str(env, "Blood Request Management"),
        version: 1,
    }
}
