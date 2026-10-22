use crate::types::{BloodRequest, RequestCreatedEvent, RequestStatus};
use soroban_sdk::{contractevent, Address, Env, Symbol};

#[contractevent(topics = ["fulfilling_org_set"], data_format = "vec")]
pub struct FulfillingOrgSet {
    pub request_id: u64,
    pub actor: Address,
    pub org_id: Address,
    pub timestamp: u64,
}

#[contractevent(topics = ["initialized"], data_format = "vec")]
pub struct RequestsInitialized {
    pub admin: Address,
    pub inventory_contract: Address,
}

#[contractevent(topics = ["payments_contract_set"], data_format = "single-value")]
pub struct PaymentsContractSet {
    pub payments_contract: Address,
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

#[contractevent(topics = ["reservation_id_set"], data_format = "vec")]
pub struct ReservationIdSet {
    pub request_id: u64,
    pub actor: Address,
    pub reservation_id: u64,
    pub timestamp: u64,
}

#[contractevent(topics = ["hospital_authorized"], data_format = "vec")]
pub struct HospitalAuthorized {
    pub hospital: Address,
    pub actor: Address,
    pub timestamp: u64,
}

#[contractevent(topics = ["hospital_revoked"], data_format = "vec")]
pub struct HospitalRevoked {
    pub hospital: Address,
    pub actor: Address,
    pub timestamp: u64,
}

#[contractevent(topics = ["blood_bank_authorized"], data_format = "vec")]
pub struct BloodBankAuthorized {
    pub blood_bank: Address,
    pub actor: Address,
    pub timestamp: u64,
}

#[contractevent(topics = ["blood_bank_revoked"], data_format = "vec")]
pub struct BloodBankRevoked {
    pub blood_bank: Address,
    pub actor: Address,
    pub timestamp: u64,
}

#[contractevent(topics = ["rider_authorized"], data_format = "vec")]
pub struct RiderAuthorized {
    pub rider: Address,
    pub actor: Address,
    pub timestamp: u64,
}

#[contractevent(topics = ["rider_revoked"], data_format = "vec")]
pub struct RiderRevoked {
    pub rider: Address,
    pub actor: Address,
    pub timestamp: u64,
}

#[contractevent(topics = ["rider_assigned"], data_format = "vec")]
pub struct RiderAssigned {
    pub request_id: u64,
    pub rider: Address,
    pub actor: Address,
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

pub fn emit_payments_contract_set(env: &Env, payments_contract: &Address) {
    PaymentsContractSet {
        payments_contract: payments_contract.clone(),
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

pub fn emit_reservation_id_set(
    env: &Env,
    request_id: u64,
    actor: &Address,
    reservation_id: u64,
    timestamp: u64,
) {
    ReservationIdSet {
        request_id,
        actor: actor.clone(),
        reservation_id,
        timestamp,
    }
    .publish(env);
}

pub fn emit_fulfilling_org_set(
    env: &Env,
    request_id: u64,
    actor: &Address,
    org_id: &Address,
    timestamp: u64,
) {
    FulfillingOrgSet {
        request_id,
        actor: actor.clone(),
        org_id: org_id.clone(),
        timestamp,
    }
    .publish(env);
}

pub fn emit_hospital_authorized(env: &Env, hospital: &Address, actor: &Address, timestamp: u64) {
    HospitalAuthorized {
        hospital: hospital.clone(),
        actor: actor.clone(),
        timestamp,
    }
    .publish(env);
}

pub fn emit_hospital_revoked(env: &Env, hospital: &Address, actor: &Address, timestamp: u64) {
    HospitalRevoked {
        hospital: hospital.clone(),
        actor: actor.clone(),
        timestamp,
    }
    .publish(env);
}

pub fn emit_blood_bank_authorized(
    env: &Env,
    blood_bank: &Address,
    actor: &Address,
    timestamp: u64,
) {
    BloodBankAuthorized {
        blood_bank: blood_bank.clone(),
        actor: actor.clone(),
        timestamp,
    }
    .publish(env);
}

pub fn emit_blood_bank_revoked(env: &Env, blood_bank: &Address, actor: &Address, timestamp: u64) {
    BloodBankRevoked {
        blood_bank: blood_bank.clone(),
        actor: actor.clone(),
        timestamp,
    }
    .publish(env);
}

pub fn emit_rider_authorized(env: &Env, rider: &Address, actor: &Address, timestamp: u64) {
    RiderAuthorized {
        rider: rider.clone(),
        actor: actor.clone(),
        timestamp,
    }
    .publish(env);
}

pub fn emit_rider_revoked(env: &Env, rider: &Address, actor: &Address, timestamp: u64) {
    RiderRevoked {
        rider: rider.clone(),
        actor: actor.clone(),
        timestamp,
    }
    .publish(env);
}

pub fn emit_rider_assigned(
    env: &Env,
    request_id: u64,
    rider: &Address,
    actor: &Address,
    timestamp: u64,
) {
    RiderAssigned {
        request_id,
        rider: rider.clone(),
        actor: actor.clone(),
        timestamp,
    }
    .publish(env);
}

/// Returns the topic symbols emitted by the role-change and rider-assignment
/// events, so callers and tests can reference them without duplicating
/// string literals.
pub fn role_event_topics(env: &Env) -> [Symbol; 7] {
    [
        Symbol::new(env, "hospital_authorized"),
        Symbol::new(env, "hospital_revoked"),
        Symbol::new(env, "blood_bank_authorized"),
        Symbol::new(env, "blood_bank_revoked"),
        Symbol::new(env, "rider_authorized"),
        Symbol::new(env, "rider_revoked"),
        Symbol::new(env, "rider_assigned"),
    ]
}
