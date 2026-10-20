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
    InventoryContract,
    RequestsContract,
    Initialized,
    Paused,
}

#[contract]
pub struct MatchingContract;

#[contractimpl]
impl MatchingContract {
    /// Bump the instance storage TTL so the contract (and its admin) never
    /// reaches archival during periods without write traffic.
    fn extend_instance_ttl(env: &Env) {
        env.storage()
            .instance()
            .extend_ttl(INSTANCE_TTL_THRESHOLD, INSTANCE_TTL_EXTEND_TO);
    }

    pub fn initialize(
        env: Env,
        admin: Address,
        inventory_contract: Address,
        requests_contract: Address,
    ) {
        if env.storage().instance().has(&DataKey::Initialized) {
            panic!("already initialized");
        }
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage()
            .instance()
            .set(&DataKey::InventoryContract, &inventory_contract);
        env.storage()
            .instance()
            .set(&DataKey::RequestsContract, &requests_contract);
        env.storage().instance().set(&DataKey::Initialized, &true);
        env.storage().instance().set(&DataKey::Paused, &false);
        Self::extend_instance_ttl(&env);
    }

    pub fn set_inventory_contract(env: Env, inventory_contract: Address) {
        Self::require_admin(&env);
        env.storage()
            .instance()
            .set(&DataKey::InventoryContract, &inventory_contract);
        Self::extend_instance_ttl(&env);
    }

    pub fn set_requests_contract(env: Env, requests_contract: Address) {
        Self::require_admin(&env);
        env.storage()
            .instance()
            .set(&DataKey::RequestsContract, &requests_contract);
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

    pub fn accept_admin(env: Env) {
        let pending: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .expect("admin not set");
        pending.require_auth();
        Self::extend_instance_ttl(&env);
    }

    fn require_admin(env: &Env) {
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .expect("admin not set");
        admin.require_auth();
    }
}

#[cfg(test)]
mod test {
    use super::*;
    use soroban_sdk::testutils::Address as _;

    #[test]
    fn initialize_extends_instance_ttl() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register_contract(None, MatchingContract);
        let client = MatchingContractClient::new(&env, &contract_id);

        let admin = Address::generate(&env);
        let inventory = Address::generate(&env);
        let requests = Address::generate(&env);
        client.initialize(&admin, &inventory, &requests);

        let ttl = env.storage().instance().get_ttl();
        assert!(ttl >= INSTANCE_TTL_THRESHOLD);
    }

    #[test]
    fn mutating_call_extends_instance_ttl() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register_contract(None, MatchingContract);
        let client = MatchingContractClient::new(&env, &contract_id);

        let admin = Address::generate(&env);
        let inventory = Address::generate(&env);
        let requests = Address::generate(&env);
        client.initialize(&admin, &inventory, &requests);

        client.pause();

        let ttl = env.storage().instance().get_ttl();
        assert!(ttl >= INSTANCE_TTL_THRESHOLD);
    }
}
