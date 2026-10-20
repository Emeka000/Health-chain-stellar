#![no_std]

use soroban_sdk::{contract, contractimpl, contracttype, Address, Env};

/// Ledger threshold (in ledgers) below which the instance TTL is bumped.
/// ~30 days at 5s per ledger.
const INSTANCE_TTL_THRESHOLD: u32 = 30 * 24 * 60 * 12;
/// Ledger count to extend the instance TTL to. ~60 days at 5s per ledger.
const INSTANCE_TTL_EXTEND_TO: u32 = 60 * 24 * 60 * 12;

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum DataKey {
    Admin,
    Paused,
    CoordinatorContract,
}

#[contract]
pub struct TemperatureContract;

#[contractimpl]
impl TemperatureContract {
    pub fn initialize(env: Env, admin: Address, coordinator: Address) {
        if env.storage().instance().has(&DataKey::Admin) {
            panic!("already initialized");
        }
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage()
            .instance()
            .set(&DataKey::CoordinatorContract, &coordinator);
        env.storage().instance().set(&DataKey::Paused, &false);
        Self::extend_instance_ttl(&env);
    }

    pub fn set_coordinator(env: Env, coordinator: Address) {
        Self::require_admin(&env);
        env.storage()
            .instance()
            .set(&DataKey::CoordinatorContract, &coordinator);
        Self::extend_instance_ttl(&env);
    }

    pub fn pause(env: Env) {
        Self::require_admin(&env);
        env.storage().instance().set(&DataKey::Paused, &true);
        Self::extend_instance_ttl(&env);
    }

    pub fn unpause(env: Env) {
        Self::require_admin(&env);
        env.storage().instance().set(&DataKey::Paused, &false);
        Self::extend_instance_ttl(&env);
    }

    pub fn transfer_admin(env: Env, new_admin: Address) {
        Self::require_admin(&env);
        env.storage().instance().set(&DataKey::Admin, &new_admin);
        Self::extend_instance_ttl(&env);
    }

    pub fn get_admin(env: Env) -> Address {
        env.storage().instance().get(&DataKey::Admin).unwrap()
    }

    pub fn get_coordinator(env: Env) -> Address {
        env.storage()
            .instance()
            .get(&DataKey::CoordinatorContract)
            .unwrap()
    }

    pub fn is_paused(env: Env) -> bool {
        env.storage()
            .instance()
            .get(&DataKey::Paused)
            .unwrap_or(false)
    }

    fn require_admin(env: &Env) {
        let admin: Address = env.storage().instance().get(&DataKey::Admin).unwrap();
        admin.require_auth();
    }

    fn extend_instance_ttl(env: &Env) {
        env.storage()
            .instance()
            .extend_ttl(INSTANCE_TTL_THRESHOLD, INSTANCE_TTL_EXTEND_TO);
    }
}

#[cfg(test)]
mod test {
    use super::*;
    use soroban_sdk::testutils::Address as _;

    #[test]
    fn extends_instance_ttl_on_initialize_and_mutations() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register_contract(None, TemperatureContract);
        let client = TemperatureContractClient::new(&env, &contract_id);

        let admin = Address::generate(&env);
        let coordinator = Address::generate(&env);
        client.initialize(&admin, &coordinator);

        env.as_contract(&contract_id, || {
            let ttl = env.storage().instance().get_ttl();
            assert!(ttl >= INSTANCE_TTL_THRESHOLD);
        });

        client.pause();
        env.as_contract(&contract_id, || {
            let ttl = env.storage().instance().get_ttl();
            assert!(ttl >= INSTANCE_TTL_THRESHOLD);
        });
    }
}
