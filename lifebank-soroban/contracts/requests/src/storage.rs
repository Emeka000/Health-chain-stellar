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
        bump_instance_ttl(env);
        Ok(())
    } else {
        Err(ContractError::NotInitialized)
    }
}

pub fn bump_instance_ttl(env: &Env) {
    env.storage()
        .instance()
        .extend_ttl(TTL_THRESHOLD, TTL_EXTEND_TO);
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

pub fn set_payments_contract(env: &Env, payments_contract: &Address) {
    env.storage()
        .instance()
        .set(&DataKey::PaymentsContract, payments_contract);
}

pub fn get_payments_contract(env: &Env) -> Option<Address> {
    env.storage().instance().get(&DataKey::PaymentsContract)
}

pub fn set_request_counter(env: &Env, value: u64) {
    env.storage()
        .instance()
        .set(&DataKey::RequestCounter, &value);
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
    env.storage()
        .persistent()
        .extend_ttl(&key, TTL_THRESHOLD, TTL_EXTEND_TO);
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
    let key = DataKey::AuthorizedBloodBank(blood_bank.clone());
    env.storage().persistent().set(&key, &true);
    env.storage()
        .persistent()
        .extend_ttl(&key, TTL_THRESHOLD, TTL_EXTEND_TO);
}

pub fn revoke_blood_bank(env: &Env, blood_bank: &Address) {
    env.storage()
        .persistent()
        .remove(&DataKey::AuthorizedBloodBank(blood_bank.clone()));
}

pub fn is_blood_bank_authorized(env: &Env, blood_bank: &Address) -> bool {
    env.storage()
        .persistent()
        .get::<DataKey, bool>(&DataKey::AuthorizedBloodBank(blood_bank.clone()))
        .unwrap_or(false)
}

pub fn authorize_rider(env: &Env, rider: &Address) {
    let key = DataKey::AuthorizedRider(rider.clone());
    env.storage().persistent().set(&key, &true);
    env.storage()
        .persistent()
        .extend_ttl(&key, TTL_THRESHOLD, TTL_EXTEND_TO);
}

pub fn revoke_rider(env: &Env, rider: &Address) {
    env.storage()
        .persistent()
        .remove(&DataKey::AuthorizedRider(rider.clone()));
}

pub fn is_rider_authorized(env: &Env, rider: &Address) -> bool {
    env.storage()
        .persistent()
        .get::<DataKey, bool>(&DataKey::AuthorizedRider(rider.clone()))
        .unwrap_or(false)
}

pub fn set_request_rider(env: &Env, request_id: u64, rider: &Address) {
    let key = DataKey::RequestRider(request_id);
    env.storage().persistent().set(&key, rider);
    env.storage()
        .persistent()
        .extend_ttl(&key, TTL_THRESHOLD, TTL_EXTEND_TO);
}

pub fn get_request_rider(env: &Env, request_id: u64) -> Option<Address> {
    env.storage()
        .persistent()
        .get(&DataKey::RequestRider(request_id))
}

pub fn set_request(env: &Env, request: &BloodRequest) {
    let key = DataKey::Request(request.id);
    env.storage().persistent().set(&key, request);
    env.storage()
        .persistent()
        .extend_ttl(&key, TTL_THRESHOLD, TTL_EXTEND_TO);
}

pub fn get_request(env: &Env, request_id: u64) -> Option<BloodRequest> {
    env.storage()
        .persistent()
        .get(&DataKey::Request(request_id))
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

/// Append a request ID to a hospital's request index.
pub fn append_to_hospital_requests(env: &Env, hospital: &Address, request_id: u64) {
    let key = DataKey::HospitalRequestIds(hospital.clone());
    let mut ids: soroban_sdk::Vec<u64> = env
        .storage()
        .persistent()
        .get(&key)
        .unwrap_or_else(|| soroban_sdk::Vec::new(env));
    ids.push_back(request_id);
    env.storage().persistent().set(&key, &ids);
    env.storage()
        .persistent()
        .extend_ttl(&key, TTL_THRESHOLD, TTL_EXTEND_TO);
}

/// Remove a terminal-state request ID from a hospital's index to prevent unbounded growth.
pub fn remove_from_hospital_requests(env: &Env, hospital: &Address, request_id: u64) {
    let key = DataKey::HospitalRequestIds(hospital.clone());
    let ids: soroban_sdk::Vec<u64> = env
        .storage()
        .persistent()
        .get(&key)
        .unwrap_or_else(|| soroban_sdk::Vec::new(env));
    let mut pruned: soroban_sdk::Vec<u64> = soroban_sdk::Vec::new(env);
    for i in 0..ids.len() {
        let id = ids.get(i).unwrap();
        if id != request_id {
            pruned.push_back(id);
        }
    }
    env.storage().persistent().set(&key, &pruned);
    env.storage()
        .persistent()
        .extend_ttl(&key, TTL_THRESHOLD, TTL_EXTEND_TO);
}

/// Retrieve all request IDs for a hospital.
pub fn get_hospital_request_ids(env: &Env, hospital: &Address) -> soroban_sdk::Vec<u64> {
    let key = DataKey::HospitalRequestIds(hospital.clone());
    env.storage()
        .persistent()
        .get(&key)
        .unwrap_or_else(|| soroban_sdk::Vec::new(env))
}
