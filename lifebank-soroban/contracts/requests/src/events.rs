use crate::types::{BloodRequest, RequestCreatedEvent, RequestStatus};
use soroban_sdk::{symbol_short, Address, Env, Symbol};

pub fn emit_initialized(env: &Env, admin: &Address, inventory_contract: &Address) {
    env.events().publish(
        (Symbol::new(env, "initialized"), symbol_short!("v1")),
        (admin.clone(), inventory_contract.clone()),
    );
}

pub fn emit_request_created(env: &Env, request: &BloodRequest) {
    env.events().publish(
        (
            Symbol::new(env, "request_created"),
            request.blood_type,
            symbol_short!("v1"),
        ),
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

pub fn emit_request_cancelled(env: &Env, request_id: u64, actor: &Address, timestamp: u64) {
    env.events().publish(
        (Symbol::new(env, "request_cancelled"), symbol_short!("v1")),
        (request_id, actor.clone(), timestamp),
    );
}

pub fn emit_request_status_updated(
    env: &Env,
    request_id: u64,
    actor: &Address,
    old_status: RequestStatus,
    new_status: RequestStatus,
    timestamp: u64,
) {
    env.events().publish(
        (
            Symbol::new(env, "request_status_updated"),
            symbol_short!("v1"),
        ),
        (request_id, actor.clone(), old_status, new_status, timestamp),
    );
}
