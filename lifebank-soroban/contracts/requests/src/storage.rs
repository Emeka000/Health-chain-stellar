use crate::error::ContractError;
use crate::types::{BloodRequest, ContractMetadata, DataKey, RequestHistoryEntry};
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

pub fn set_coordinator_contract(env: &Env, coordinator_contract: &Address) {
    env.storage()
        .instance()
        .set(&DataKey::CoordinatorContract, coordinator_contract);
}

pub fn get_coordinator_contract(env: &Env) -> Option<Address> {
    env.storage().instance().get(&DataKey::CoordinatorContract)
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

/// Extend a persistent authorization entry when it exists. Checks run on every
/// request, so bumping here keeps active actors from archiving after ~60 days.
/// Skips missing keys because `extend_ttl` traps on an absent entry.
fn bump_authorization_ttl(env: &Env, key: &DataKey) {
    if env.storage().persistent().has(key) {
        env.storage()
            .persistent()
            .extend_ttl(key, TTL_THRESHOLD, TTL_EXTEND_TO);
    }
}

pub fn is_hospital_authorized(env: &Env, hospital: &Address) -> bool {
    let key = DataKey::AuthorizedHospital(hospital.clone());
    let authorized = env
        .storage()
        .persistent()
        .get::<DataKey, bool>(&key)
        .unwrap_or(false);
    if authorized {
        bump_authorization_ttl(env, &key);
    }
    authorized
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
    let key = DataKey::AuthorizedBloodBank(blood_bank.clone());
    let authorized = env
        .storage()
        .persistent()
        .get::<DataKey, bool>(&key)
        .unwrap_or(false);
    if authorized {
        bump_authorization_ttl(env, &key);
    }
    authorized
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
    let key = DataKey::AuthorizedRider(rider.clone());
    let authorized = env
        .storage()
        .persistent()
        .get::<DataKey, bool>(&key)
        .unwrap_or(false);
    if authorized {
        bump_authorization_ttl(env, &key);
    }
    authorized
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

/// Append a request ID to a hospital's open-request index.
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

/// Record a request in the hospital's append-only history index. Unlike the
/// open-request index, entries are never removed on terminal transitions.
pub fn append_to_hospital_history(env: &Env, hospital: &Address, request_id: u64) {
    let count = get_hospital_history_count(env, hospital);
    let entry_key = DataKey::HospitalRequestAt(hospital.clone(), count);
    env.storage().persistent().set(&entry_key, &request_id);
    env.storage()
        .persistent()
        .extend_ttl(&entry_key, TTL_THRESHOLD, TTL_EXTEND_TO);

    let count_key = DataKey::HospitalRequestCount(hospital.clone());
    env.storage().persistent().set(&count_key, &(count + 1));
    env.storage()
        .persistent()
        .extend_ttl(&count_key, TTL_THRESHOLD, TTL_EXTEND_TO);
}

/// Number of requests ever created by a hospital.
pub fn get_hospital_history_count(env: &Env, hospital: &Address) -> u32 {
    env.storage()
        .persistent()
        .get(&DataKey::HospitalRequestCount(hospital.clone()))
        .unwrap_or(0)
}

/// Request ID at `position` in a hospital's append-only history index.
pub fn get_hospital_history_entry(env: &Env, hospital: &Address, position: u32) -> Option<u64> {
    env.storage()
        .persistent()
        .get(&DataKey::HospitalRequestAt(hospital.clone(), position))
}

/// Retrieve the open (non-terminal) request IDs for a hospital.
pub fn get_hospital_request_ids(env: &Env, hospital: &Address) -> soroban_sdk::Vec<u64> {
    let key = DataKey::HospitalRequestIds(hospital.clone());
    env.storage()
        .persistent()
        .get(&key)
        .unwrap_or_else(|| soroban_sdk::Vec::new(env))
}

/// Maximum number of history entries stored per persistent page.
pub const HISTORY_PAGE_SIZE: u32 = 20;

pub fn is_paused(env: &Env) -> bool {
    env.storage()
        .instance()
        .get::<DataKey, bool>(&DataKey::Paused)
        .unwrap_or(false)
}

pub fn set_paused(env: &Env, paused: bool) {
    env.storage().instance().set(&DataKey::Paused, &paused);
}

pub fn require_not_paused(env: &Env) -> Result<(), ContractError> {
    if is_paused(env) {
        Err(ContractError::ContractPaused)
    } else {
        Ok(())
    }
}

pub fn get_history_page(
    env: &Env,
    request_id: u64,
    page: u32,
) -> soroban_sdk::Vec<RequestHistoryEntry> {
    env.storage()
        .persistent()
        .get(&DataKey::RequestHistoryPage(request_id, page))
        .unwrap_or_else(|| soroban_sdk::Vec::new(env))
}

/// Append `entry` to the page addressed by the request's current history
/// length and bump `history_len`. Only the last page is read and rewritten,
/// so the cost of an append is bounded by `HISTORY_PAGE_SIZE`.
pub fn append_history_entry(env: &Env, request: &mut BloodRequest, entry: RequestHistoryEntry) {
    let page = request.history_len / HISTORY_PAGE_SIZE;
    let key = DataKey::RequestHistoryPage(request.id, page);
    let mut entries = get_history_page(env, request.id, page);
    entries.push_back(entry);
    env.storage().persistent().set(&key, &entries);
    env.storage()
        .persistent()
        .extend_ttl(&key, TTL_THRESHOLD, TTL_EXTEND_TO);
    request.history_len += 1;
}
