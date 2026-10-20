//! Inventory contract for the LifeBank system.
//!
//! Manages blood units, their lifecycle, and the banks that hold them.

#![no_std]

use soroban_sdk::{contract, contractevent, contractimpl, contracttype, Address, Env, String, Vec};

// ---------------------------------------------------------------------------
// Storage keys
// ---------------------------------------------------------------------------

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum DataKey {
    Admin,
    Paused,
    RegistryContract,
    RequestsContract,
    BankAuthorized(Address),
    Role(Address, String),
    BloodUnit(u64),
    BloodUnitCount,
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum BloodStatus {
    Available,
    Reserved,
    Delivered,
    Expired,
    Disposed,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct BloodUnit {
    pub id: u64,
    pub blood_type: String,
    pub bank: Address,
    pub status: BloodStatus,
    pub created_at: u64,
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Paused {
    #[topic]
    pub admin: Address,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Unpaused {
    #[topic]
    pub admin: Address,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ConfigUpdated {
    #[topic]
    pub key: String,
    pub old: Address,
    pub new: Address,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct AuthorizationChanged {
    #[topic]
    pub subject: Address,
    #[topic]
    pub role: String,
    pub granted: bool,
}

// ---------------------------------------------------------------------------
// Contract
// ---------------------------------------------------------------------------

#[contract]
pub struct InventoryContract;

#[contractimpl]
impl InventoryContract {
    pub fn initialize(env: Env, admin: Address) {
        admin.require_auth();
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().set(&DataKey::Paused, &false);
        env.storage().instance().set(&DataKey::BloodUnitCount, &0u64);
    }

    pub fn pause(env: Env) {
        let admin = Self::admin(&env);
        admin.require_auth();
        env.storage().instance().set(&DataKey::Paused, &true);
        Paused { admin }.publish(&env);
    }

    pub fn unpause(env: Env) {
        let admin = Self::admin(&env);
        admin.require_auth();
        env.storage().instance().set(&DataKey::Paused, &false);
        Unpaused { admin }.publish(&env);
    }

    pub fn authorize_bank(env: Env, bank: Address) {
        let admin = Self::admin(&env);
        admin.require_auth();
        env.storage()
            .persistent()
            .set(&DataKey::BankAuthorized(bank.clone()), &true);
        AuthorizationChanged {
            subject: bank,
            role: String::from_str(&env, "bank"),
            granted: true,
        }
        .publish(&env);
    }

    pub fn grant_role(env: Env, account: Address, role: String) {
        let admin = Self::admin(&env);
        admin.require_auth();
        env.storage()
            .persistent()
            .set(&DataKey::Role(account.clone(), role.clone()), &true);
        AuthorizationChanged {
            subject: account,
            role,
            granted: true,
        }
        .publish(&env);
    }

    pub fn set_registry_contract(env: Env, registry: Address) {
        let admin = Self::admin(&env);
        admin.require_auth();
        let old = env
            .storage()
            .instance()
            .get(&DataKey::RegistryContract)
            .unwrap_or_else(|| admin.clone());
        env.storage()
            .instance()
            .set(&DataKey::RegistryContract, &registry);
        ConfigUpdated {
            key: String::from_str(&env, "registry_contract"),
            old,
            new: registry,
        }
        .publish(&env);
    }

    pub fn set_requests_contract(env: Env, requests: Address) {
        let admin = Self::admin(&env);
        admin.require_auth();
        let old = env
            .storage()
            .instance()
            .get(&DataKey::RequestsContract)
            .unwrap_or_else(|| admin.clone());
        env.storage()
            .instance()
            .set(&DataKey::RequestsContract, &requests);
        ConfigUpdated {
            key: String::from_str(&env, "requests_contract"),
            old,
            new: requests,
        }
        .publish(&env);
    }

    pub fn register_blood_unit(env: Env, bank: Address, blood_type: String) -> u64 {
        bank.require_auth();
        Self::require_not_paused(&env);
        let mut count: u64 = env
            .storage()
            .instance()
            .get(&DataKey::BloodUnitCount)
            .unwrap_or(0);
        count += 1;
        let unit = BloodUnit {
            id: count,
            blood_type,
            bank,
            status: BloodStatus::Available,
            created_at: env.ledger().timestamp(),
        };
        env.storage()
            .persistent()
            .set(&DataKey::BloodUnit(count), &unit);
        env.storage().instance().set(&DataKey::BloodUnitCount, &count);
        count
    }

    pub fn get_blood_unit(env: Env, id: u64) -> Option<BloodUnit> {
        env.storage().persistent().get(&DataKey::BloodUnit(id))
    }

    pub fn is_paused(env: Env) -> bool {
        env.storage()
            .instance()
            .get(&DataKey::Paused)
            .unwrap_or(false)
    }

    // -----------------------------------------------------------------------
    // Internal helpers
    // -----------------------------------------------------------------------

    fn admin(env: &Env) -> Address {
        env.storage()
            .instance()
            .get(&DataKey::Admin)
            .expect("admin not set")
    }

    fn require_not_paused(env: &Env) {
        let paused: bool = env
            .storage()
            .instance()
            .get(&DataKey::Paused)
            .unwrap_or(false);
        if paused {
            panic!("contract is paused");
        }
    }
}

#[cfg(test)]
mod test;
