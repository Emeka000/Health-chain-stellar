use crate::types::{BloodRequest, RequestCreatedEvent};
use soroban_sdk::{Address, Env, Symbol};

pub fn emit_initialized(env: &Env, admin: &Address, inventory_contract: &Address) {
    env.events().publish(
        (Symbol::new(env, "initialized"),),
        (admin.clone(), inventory_contract.clone()),
    );
}

pub fn emit_request_created(env: &Env, request: &BloodRequest) {
    env.events().publish(
        (Symbol::new(env, "request_created"), request.blood_type),
        RequestCreatedEvent {
            request_id: request.id,
            hospital: request.hospital_id.clone(),
            blood_type: request.blood_type,
            quantity_ml: request.quantity_ml,
            urgency: request.urgency.priority(),
            timestamp: request.created_timestamp,
        },
    );
}
