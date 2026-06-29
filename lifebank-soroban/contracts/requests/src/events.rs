use crate::types::{BloodRequest, RequestCreatedEvent, RequestStatus};
use soroban_sdk::{contractevent, Address, Env};

#[contractevent(topics = ["initialized"], data_format = "vec")]
pub struct RequestsInitialized {
    pub admin: Address,
    pub inventory_contract: Address,
}

#[contractevent(topics = ["request_cancelled"], data_format = "vec")]
pub struct RequestCancelled {
    pub request_id: u64,
    pub actor: Address,
    pub timestamp: u64,
}

#[contractevent(topics = ["request_status_updated"], data_format = "vec")]
pub struct RequestStatusUpdated {
    pub request_id: u64,
    pub actor: Address,
    pub old_status: RequestStatus,
    pub new_status: RequestStatus,
    pub timestamp: u64,
}

pub fn emit_initialized(env: &Env, admin: &Address, inventory_contract: &Address) {
    RequestsInitialized {
        admin: admin.clone(),
        inventory_contract: inventory_contract.clone(),
    }
    .publish(env);
}

pub fn emit_request_created(env: &Env, request: &BloodRequest) {
    RequestCreatedEvent {
        blood_type: request.blood_type,
        request_id: request.id,
        hospital: request.hospital_id.clone(),
        quantity_ml: request.quantity_ml,
        urgency: request.urgency.priority(),
        timestamp: request.created_timestamp,
    }
    .publish(env);
}


pub fn emit_request_cancelled(env: &Env, request_id: u64, actor: &Address, timestamp: u64) {
    RequestCancelled {
        request_id,
        actor: actor.clone(),
        timestamp,
    }
    .publish(env);
}

pub fn emit_request_status_updated(
    env: &Env,
    request_id: u64,
    actor: &Address,
    old_status: RequestStatus,
    new_status: RequestStatus,
    timestamp: u64,
) {
    RequestStatusUpdated {
        request_id,
        actor: actor.clone(),
        old_status,
        new_status,
        timestamp,
    }
    .publish(env);
}
