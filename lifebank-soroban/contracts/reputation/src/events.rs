use soroban_sdk::{contracttype, symbol_short, Address, Env, Symbol};

use crate::types::{EntityType, ReputationEvent};

// Event names
const EVENT_INIT: Symbol = symbol_short!("init");
const EVENT_SCORE_UPDATED: Symbol = symbol_short!("score_upd");
const EVENT_FRAUD_FLAGGED: Symbol = symbol_short!("fraud_flg");
const EVENT_FRAUD_CLEARED: Symbol = symbol_short!("fraud_clr");
const EVENT_ENTITY_REGISTERED: Symbol = symbol_short!("ent_reg");
const EVENT_ENTITY_UPDATED: Symbol = symbol_short!("ent_upd");

/// Emitted when the contract is initialized.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct InitEvent {
    pub admin: Address,
}

/// Emitted when an entity's score is updated.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ScoreUpdatedEvent {
    pub entity_id: u64,
    pub old_score: u32,
    pub new_score: u32,
    pub event: ReputationEvent,
}

/// Emitted when an entity is flagged for fraud.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct FraudFlaggedEvent {
    pub entity_id: u64,
    pub reason: Symbol,
    pub flag_count: u32,
}

/// Emitted when an entity's fraud flags are cleared (audit trail).
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct FraudClearedEvent {
    pub entity_id: u64,
    pub admin: Address,
    pub reason: Symbol,
    pub cleared_count: u32,
}

/// Emitted when an entity_id is linked to an Address in the registry.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct EntityRegisteredEvent {
    pub entity_id: u64,
    pub address: Address,
    pub entity_type: EntityType,
}

/// Emitted when an entity_id's registry entry is updated.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct EntityUpdatedEvent {
    pub entity_id: u64,
    pub old_address: Address,
    pub new_address: Address,
    pub entity_type: EntityType,
}

pub fn emit_init(env: &Env, admin: &Address) {
    env.events()
        .publish((EVENT_INIT,), InitEvent { admin: admin.clone() });
}

pub fn emit_score_updated(
    env: &Env,
    entity_id: u64,
    old_score: u32,
    new_score: u32,
    event: &ReputationEvent,
) {
    env.events().publish(
        (EVENT_SCORE_UPDATED, entity_id),
        ScoreUpdatedEvent {
            entity_id,
            old_score,
            new_score,
            event: event.clone(),
        },
    );
}

pub fn emit_fraud_flagged(env: &Env, entity_id: u64, reason: &Symbol, flag_count: u32) {
    env.events().publish(
        (EVENT_FRAUD_FLAGGED, entity_id),
        FraudFlaggedEvent {
            entity_id,
            reason: reason.clone(),
            flag_count,
        },
    );
}

pub fn emit_fraud_cleared(
    env: &Env,
    entity_id: u64,
    admin: &Address,
    reason: &Symbol,
    cleared_count: u32,
) {
    env.events().publish(
        (EVENT_FRAUD_CLEARED, entity_id),
        FraudClearedEvent {
            entity_id,
            admin: admin.clone(),
            reason: reason.clone(),
            cleared_count,
        },
    );
}

pub fn emit_entity_registered(
    env: &Env,
    entity_id: u64,
    address: &Address,
    entity_type: &EntityType,
) {
    env.events().publish(
        (EVENT_ENTITY_REGISTERED, entity_id),
        EntityRegisteredEvent {
            entity_id,
            address: address.clone(),
            entity_type: entity_type.clone(),
        },
    );
}

pub fn emit_entity_updated(
    env: &Env,
    entity_id: u64,
    old_address: &Address,
    new_address: &Address,
    entity_type: &EntityType,
) {
    env.events().publish(
        (EVENT_ENTITY_UPDATED, entity_id),
        EntityUpdatedEvent {
            entity_id,
            old_address: old_address.clone(),
            new_address: new_address.clone(),
            entity_type: entity_type.clone(),
        },
    );
}
