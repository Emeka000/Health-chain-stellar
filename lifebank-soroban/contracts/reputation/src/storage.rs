use soroban_sdk::{contracttype, Address, Env, Vec};

use crate::types::{DataKey, EntityReputation, FraudFlag, ReputationError};

// ... existing storage helpers preserved below ...

/// Register (or update) the mapping between an opaque `entity_id` and the
/// on-chain `Address` that owns it. Admin-gated at the contract layer.
pub fn set_entity_address(env: &Env, entity_id: u64, address: &Address) {
    let key = DataKey::EntityAddress(entity_id);
    env.storage().persistent().set(&key, address);
}

/// Resolve the `Address` bound to an `entity_id`, if any.
pub fn get_entity_address(env: &Env, entity_id: u64) -> Option<Address> {
    let key = DataKey::EntityAddress(entity_id);
    env.storage().persistent().get(&key)
}

/// Reverse lookup: find the `entity_id` bound to an `Address`, if any.
pub fn get_entity_id_by_address(env: &Env, address: &Address) -> Option<u64> {
    let key = DataKey::AddressEntity(address.clone());
    env.storage().persistent().get(&key)
}

/// Bind an address to an entity id in both directions.
pub fn bind_entity_address(env: &Env, entity_id: u64, address: &Address) {
    set_entity_address(env, entity_id, address);
    let reverse = DataKey::AddressEntity(address.clone());
    env.storage().persistent().set(&reverse, &entity_id);
}

/// Look up an entity's reputation score by its `Address`.
pub fn get_reputation_by_address(env: &Env, address: &Address) -> Option<EntityReputation> {
    let entity_id = get_entity_id_by_address(env, address)?;
    get_reputation(env, entity_id)
}

/// Clear all fraud flags for an entity, returning the number removed.
pub fn clear_fraud_flags(env: &Env, entity_id: u64) -> u32 {
    let key = DataKey::FraudFlags(entity_id);
    let flags: Vec<FraudFlag> = env
        .storage()
        .persistent()
        .get(&key)
        .unwrap_or_else(|| Vec::new(env));
    let removed = flags.len();
    env.storage().persistent().remove(&key);
    removed
}
