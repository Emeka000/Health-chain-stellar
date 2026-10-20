#![no_std]

use soroban_sdk::{contract, contractimpl, contracttype, Address, Env, String, Vec};

/// ~30 days in ledgers (5s per ledger).
const INSTANCE_TTL_THRESHOLD: u32 = 30 * 24 * 60 * 12;
/// ~60 days in ledgers (5s per ledger).
const INSTANCE_TTL_EXTEND_TO: u32 = 60 * 24 * 60 * 12;

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum DataKey {
    Admin,
    PendingAdmin,
    OrgCounter,
    Paused,
    RequestsContract,
    Org(u64),
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Organization {
    pub id: u64,
    pub name: String,
    pub owner: Address,
    pub active: bool,
}

#[contract]
pub struct IdentityContract;

fn extend_instance_ttl(env: &Env) {
    env.storage()
        .instance()
        .extend_ttl(INSTANCE_TTL_THRESHOLD, INSTANCE_TTL_EXTEND_TO);
}

#[contractimpl]
impl IdentityContract {
    pub fn initialize(env: Env, admin: Address, requests_contract: Address) {
        if env.storage().instance().has(&DataKey::Admin) {
            panic!("already initialized");
        }
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage()
            .instance()
            .set(&DataKey::RequestsContract, &requests_contract);
        env.storage().instance().set(&DataKey::OrgCounter, &0u64);
        env.storage().instance().set(&DataKey::Paused, &false);
        extend_instance_ttl(&env);
    }

    pub fn transfer_admin(env: Env, new_admin: Address) {
        let admin: Address = env.storage().instance().get(&DataKey::Admin).unwrap();
        admin.require_auth();
        env.storage()
            .instance()
            .set(&DataKey::PendingAdmin, &new_admin);
        extend_instance_ttl(&env);
    }

    pub fn accept_admin(env: Env) {
        let pending: Address = env
            .storage()
            .instance()
            .get(&DataKey::PendingAdmin)
            .unwrap();
        pending.require_auth();
        env.storage().instance().set(&DataKey::Admin, &pending);
        env.storage().instance().remove(&DataKey::PendingAdmin);
        extend_instance_ttl(&env);
    }

    pub fn set_requests_contract(env: Env, requests_contract: Address) {
        let admin: Address = env.storage().instance().get(&DataKey::Admin).unwrap();
        admin.require_auth();
        env.storage()
            .instance()
            .set(&DataKey::RequestsContract, &requests_contract);
        extend_instance_ttl(&env);
    }

    pub fn pause(env: Env) {
        let admin: Address = env.storage().instance().get(&DataKey::Admin).unwrap();
        admin.require_auth();
        env.storage().instance().set(&DataKey::Paused, &true);
        extend_instance_ttl(&env);
    }

    pub fn unpause(env: Env) {
        let admin: Address = env.storage().instance().get(&DataKey::Admin).unwrap();
        admin.require_auth();
        env.storage().instance().set(&DataKey::Paused, &false);
        extend_instance_ttl(&env);
    }

    pub fn register_org(env: Env, owner: Address, name: String) -> u64 {
        owner.require_auth();
        let paused: bool = env.storage().instance().get(&DataKey::Paused).unwrap();
        if paused {
            panic!("paused");
        }
        let mut counter: u64 = env.storage().instance().get(&DataKey::OrgCounter).unwrap();
        counter += 1;
        let org = Organization {
            id: counter,
            name,
            owner,
            active: true,
        };
        env.storage().persistent().set(&DataKey::Org(counter), &org);
        env.storage().instance().set(&DataKey::OrgCounter, &counter);
        extend_instance_ttl(&env);
        counter
    }

    pub fn set_org_active(env: Env, org_id: u64, active: bool) {
        let admin: Address = env.storage().instance().get(&DataKey::Admin).unwrap();
        admin.require_auth();
        let mut org: Organization = env
            .storage()
            .persistent()
            .get(&DataKey::Org(org_id))
            .unwrap();
        org.active = active;
        env.storage().persistent().set(&DataKey::Org(org_id), &org);
        extend_instance_ttl(&env);
    }

    pub fn get_org(env: Env, org_id: u64) -> Organization {
        env.storage().persistent().get(&DataKey::Org(org_id)).unwrap()
    }

    pub fn get_admin(env: Env) -> Address {
        env.storage().instance().get(&DataKey::Admin).unwrap()
    }

    pub fn is_paused(env: Env) -> bool {
        env.storage().instance().get(&DataKey::Paused).unwrap()
    }

    pub fn list_orgs(env: Env) -> Vec<Organization> {
        let counter: u64 = env.storage().instance().get(&DataKey::OrgCounter).unwrap();
        let mut orgs = Vec::new(&env);
        let mut i: u64 = 1;
        while i <= counter {
            if let Some(org) = env.storage().persistent().get(&DataKey::Org(i)) {
                orgs.push_back(org);
            }
            i += 1;
        }
        orgs
    }
}

#[cfg(test)]
mod test {
    use super::*;
    use soroban_sdk::testutils::Address as _;

    #[test]
    fn initialize_extends_instance_ttl() {
        let env = Env::default();
        let contract_id = env.register_contract(None, IdentityContract);
        let client = IdentityContractClient::new(&env, &contract_id);
        let admin = Address::generate(&env);
        let requests = Address::generate(&env);
        client.initialize(&admin, &requests);
        let ttl = env.storage().instance().get_ttl();
        assert!(ttl >= INSTANCE_TTL_THRESHOLD);
    }

    #[test]
    fn mutating_call_extends_instance_ttl() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register_contract(None, IdentityContract);
        let client = IdentityContractClient::new(&env, &contract_id);
        let admin = Address::generate(&env);
        let requests = Address::generate(&env);
        client.initialize(&admin, &requests);
        client.pause();
        let ttl = env.storage().instance().get_ttl();
        assert!(ttl >= INSTANCE_TTL_THRESHOLD);
    }
}
