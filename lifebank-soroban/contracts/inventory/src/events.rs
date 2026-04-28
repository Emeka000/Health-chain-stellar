use crate::types::{AuditEvent, BloodRegisteredEvent, BloodStatus, BloodType, StatusChangeEvent};
use soroban_sdk::{symbol_short, Address, Env, String, Symbol};

/// Emit a BloodRegistered event
///
/// # Arguments
/// * `env` - Contract environment
/// * `blood_unit_id` - Unique ID of the registered blood unit
/// * `bank_id` - Blood bank that registered the unit
/// * `blood_type` - Type of blood
/// * `quantity_ml` - Quantity in milliliters
/// * `expiration_timestamp` - When the unit expires
pub fn emit_blood_registered(
    env: &Env,
    blood_unit_id: u64,
    bank_id: &Address,
    blood_type: BloodType,
    quantity_ml: u32,
    expiration_timestamp: u64,
) {
    let registered_at = env.ledger().timestamp();

    let event = BloodRegisteredEvent {
        blood_unit_id,
        bank_id: bank_id.clone(),
        blood_type,
        quantity_ml,
        expiration_timestamp,
        registered_at,
    };

    env.events().publish(
        (Symbol::new(env, "blood_registered"), symbol_short!("v1")),
        event,
    );
}

pub fn emit_status_change(
    env: &Env,
    blood_unit_id: u64,
    from_status: crate::types::BloodStatus,
    to_status: crate::types::BloodStatus,
    authorized_by: &Address,
    reason: Option<String>,
) {
    let changed_at = env.ledger().timestamp();

    // Legacy event kept for backwards compatibility
    let event = StatusChangeEvent {
        blood_unit_id,
        from_status,
        to_status,
        authorized_by: authorized_by.clone(),
        changed_at,
        reason,
    };

    env.events().publish(
        (Symbol::new(env, "status_changed"), symbol_short!("v1")),
        event,
    );

    // Canonical audit event: immutable on-chain audit trail.
    let audit = AuditEvent {
        unit_id: blood_unit_id,
        previous_status: from_status,
        new_status: to_status,
        actor: authorized_by.clone(),
        timestamp: changed_at,
    };

    env.events().publish(
        (Symbol::new(env, "bld_unit_chg"), symbol_short!("v1")),
        audit,
    );
}

/// Emit an event when an invalid status transition is attempted.
/// Includes both the `from` and `to` statuses for debuggability.
pub fn emit_invalid_transition(
    env: &Env,
    blood_unit_id: u64,
    from_status: BloodStatus,
    to_status: BloodStatus,
) {
    env.events().publish(
        (Symbol::new(env, "invalid_transition"), symbol_short!("v1")),
        (blood_unit_id, from_status as u32, to_status as u32),
    );
}

pub fn emit_blood_reserved(env: &Env, reservation_id: u64, requester: &Address, unit_count: u32) {
    env.events().publish(
        (Symbol::new(env, "blood_reserved"), symbol_short!("v1")),
        (reservation_id, requester.clone(), unit_count),
    );
}

pub fn emit_reservation_released(env: &Env, reservation_id: u64) {
    env.events().publish(
        (
            Symbol::new(env, "reservation_released"),
            symbol_short!("v1"),
        ),
        reservation_id,
    );
}
