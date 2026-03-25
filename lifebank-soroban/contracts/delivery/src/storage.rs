use soroban_sdk::{Address, Env};

use crate::types::{DataKey, DeliveryRecord, ProofRequirements, TemperatureThresholds};

pub fn is_initialized(env: &Env) -> bool {
    env.storage().instance().has(&DataKey::Admin)
}

pub fn set_admin(env: &Env, admin: &Address) {
    env.storage().instance().set(&DataKey::Admin, admin);
}

pub fn get_admin(env: &Env) -> Address {
    env.storage().instance().get(&DataKey::Admin).expect("Admin not set")
}

pub fn set_request_contract(env: &Env, contract: &Address) {
    env.storage().instance().set(&DataKey::RequestContract, contract);
}

pub fn get_request_contract(env: &Env) -> Address {
    env.storage().instance().get(&DataKey::RequestContract).expect("Request contract not set")
}

pub fn set_temp_thresholds(env: &Env, thresholds: &TemperatureThresholds) {
    env.storage().instance().set(&DataKey::TempThresholds, thresholds);
}

pub fn get_temp_thresholds(env: &Env) -> TemperatureThresholds {
    env.storage().instance().get(&DataKey::TempThresholds).expect("Thresholds not set")
}

pub fn set_proof_requirements(env: &Env, requirements: &ProofRequirements) {
    env.storage().instance().set(&DataKey::PhotoProofRequired, &requirements.photo_required);
    env.storage().instance().set(&DataKey::SignatureRequired, &requirements.signature_required);
}

pub fn get_proof_requirements(env: &Env) -> ProofRequirements {
    ProofRequirements {
        photo_required: env.storage().instance().get(&DataKey::PhotoProofRequired).unwrap_or(false),
        signature_required: env.storage().instance().get(&DataKey::SignatureRequired).unwrap_or(false),
    }
}

pub fn next_delivery_id(env: &Env) -> u64 {
    let id: u64 = env.storage().instance().get(&DataKey::DeliveryCounter).unwrap_or(0) + 1;
    env.storage().instance().set(&DataKey::DeliveryCounter, &id);
    id
}

pub fn set_delivery(env: &Env, delivery: &DeliveryRecord) {
    env.storage().persistent().set(&DataKey::Delivery(delivery.id), delivery);
}

pub fn get_delivery(env: &Env, id: u64) -> Option<DeliveryRecord> {
    env.storage().persistent().get(&DataKey::Delivery(id))
}
