//! Payments contract for the LifeBank ecosystem.
//!
//! Handles escrow, pledges, and dispute resolution between hospitals and blood banks.

#![no_std]

use soroban_sdk::{contract, contractevent, contractimpl, contracttype, Address, Env, Vec};

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Pledge {
    pub hospital: Address,
    pub amount: i128,
    pub active: bool,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Config {
    pub admin: Address,
    pub dispute_timeout: u64,
    pub pledge_active: bool,
    pub paused: bool,
}

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
    pub key: soroban_sdk::Symbol,
    pub old: i128,
    pub new: i128,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct AuthorizationChanged {
    #[topic]
    pub subject: Address,
    #[topic]
    pub role: soroban_sdk::Symbol,
    pub granted: bool,
}

#[contract]
pub struct PaymentsContract;

#[contractimpl]
impl PaymentsContract {
    pub fn initialize(env: Env, admin: Address, dispute_timeout: u64) {
        admin.require_auth();
        let config = Config {
            admin,
            dispute_timeout,
            pledge_active: true,
            paused: false,
        };
        env.storage().instance().set(&"config", &config);
    }

    fn load_config(env: &Env) -> Config {
        env.storage().instance().get(&"config").unwrap()
    }

    fn save_config(env: &Env, config: &Config) {
        env.storage().instance().set(&"config", config);
    }

    pub fn pause(env: Env) {
        let mut config = Self::load_config(&env);
        config.admin.require_auth();
        config.paused = true;
        Self::save_config(&env, &config);
        Paused {
            admin: config.admin.clone(),
        }
        .publish(&env);
    }

    pub fn unpause(env: Env) {
        let mut config = Self::load_config(&env);
        config.admin.require_auth();
        config.paused = false;
        Self::save_config(&env, &config);
        Unpaused {
            admin: config.admin.clone(),
        }
        .publish(&env);
    }

    pub fn set_dispute_timeout(env: Env, timeout: u64) {
        let mut config = Self::load_config(&env);
        config.admin.require_auth();
        let old = config.dispute_timeout;
        config.dispute_timeout = timeout;
        Self::save_config(&env, &config);
        ConfigUpdated {
            key: soroban_sdk::Symbol::new(&env, "dispute_timeout"),
            old: old as i128,
            new: timeout as i128,
        }
        .publish(&env);
    }

    pub fn add_allowed_token(env: Env, token: Address) {
        let config = Self::load_config(&env);
        config.admin.require_auth();
        let mut tokens: Vec<Address> = env
            .storage()
            .instance()
            .get(&"allowed_tokens")
            .unwrap_or(Vec::new(&env));
        tokens.push_back(token.clone());
        env.storage().instance().set(&"allowed_tokens", &tokens);
        AuthorizationChanged {
            subject: token,
            role: soroban_sdk::Symbol::new(&env, "token"),
            granted: true,
        }
        .publish(&env);
    }

    pub fn remove_allowed_token(env: Env, token: Address) {
        let config = Self::load_config(&env);
        config.admin.require_auth();
        let tokens: Vec<Address> = env
            .storage()
            .instance()
            .get(&"allowed_tokens")
            .unwrap_or(Vec::new(&env));
        let mut updated = Vec::new(&env);
        for t in tokens.iter() {
            if t != token {
                updated.push_back(t);
            }
        }
        env.storage().instance().set(&"allowed_tokens", &updated);
        AuthorizationChanged {
            subject: token,
            role: soroban_sdk::Symbol::new(&env, "token"),
            granted: false,
        }
        .publish(&env);
    }

    pub fn set_pledge_active(env: Env, active: bool) {
        let mut config = Self::load_config(&env);
        config.admin.require_auth();
        let old = config.pledge_active;
        config.pledge_active = active;
        Self::save_config(&env, &config);
        ConfigUpdated {
            key: soroban_sdk::Symbol::new(&env, "pledge_active"),
            old: if old { 1 } else { 0 },
            new: if active { 1 } else { 0 },
        }
        .publish(&env);
    }
}
