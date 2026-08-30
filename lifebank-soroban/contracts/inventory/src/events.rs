use crate::types::{AuditEvent, BloodRegisteredEvent, BloodStatus, BloodType, StatusChangeEvent};
use soroban_sdk::{contractevent, Address, Env, String};

#[contractevent(topics = ["invalid_transition"], data_format = "vec")]
pub struct InvalidTransition {
    pub blood_unit_id: u64,
    pub from_status: u32,
    pub to_status: u32,
}

#[contractevent(topics = ["blood_reserved"], data_format = "vec")]
pub struct BloodReserved {
    pub reservation_id: u64,
    pub requester: Address,
    pub unit_count: u32,
}

#[contractevent(topics = ["reservation_released"], data_format = "single-value")]
pub struct ReservationReleased {
    pub reservation_id: u64,
}

pub fn emit_blood_registered(
    env: &Env,
    blood_unit_id: u64,
    bank_id: &Address,
    blood_type: BloodType,
    quantity_ml: u32,
    expiration_timestamp: u64,
) {
    let registered_at = env.ledger().timestamp();
    BloodRegisteredEvent {
        blood_unit_id,
        bank_id: bank_id.clone(),
        blood_type,
        quantity_ml,
        expiration_timestamp,
        registered_at,
    }
    .publish(env);
}

pub fn emit_status_change(
    env: &Env,
    blood_unit_id: u64,
    from_status: BloodStatus,
    to_status: BloodStatus,
    authorized_by: &Address,
    reason: Option<String>,
) {
    let changed_at = env.ledger().timestamp();

    StatusChangeEvent {
        blood_unit_id,
        from_status,
        to_status,
        authorized_by: authorized_by.clone(),
        changed_at,
        reason,
    }
    .publish(env);

    AuditEvent {
        unit_id: blood_unit_id,
        previous_status: from_status,
        new_status: to_status,
        actor: authorized_by.clone(),
        timestamp: changed_at,
    }
    .publish(env);
}

pub fn emit_invalid_transition(
    env: &Env,
    blood_unit_id: u64,
    from_status: BloodStatus,
    to_status: BloodStatus,
) {
    InvalidTransition {
        blood_unit_id,
        from_status: from_status as u32,
        to_status: to_status as u32,
    }
    .publish(env);
}

pub fn emit_blood_reserved(env: &Env, reservation_id: u64, requester: &Address, unit_count: u32) {
    BloodReserved {
        reservation_id,
        requester: requester.clone(),
        unit_count,
    }
    .publish(env);
}

pub fn emit_reservation_released(env: &Env, reservation_id: u64) {
    ReservationReleased { reservation_id }.publish(env);
}
