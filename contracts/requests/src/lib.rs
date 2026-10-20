//! Requests contract for the LifeBank system.
//!
//! Manages blood requests, hospital/rider/blood bank authorization, and
//! request lifecycle. Admin configuration changes emit events so indexers
//! and auditors can observe authorization changes.

#![no_std]

use soroban_sdk::{contract, contractevent, contractimpl, contracttype, Address, Env, Vec};

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum Role {
    Hospital,
    BloodBank,
    Rider,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct AuthorizationChanged {
    #[topic]
    pub subject: Address,
    #[topic]
    pub role: Role,
    pub granted: bool,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Request {
    pub id: u64,
    pub hospital: Address,
    pub blood_type: u32,
    pub quantity: u32,
    pub fulfilled: bool,
}

#[contract]
pub struct RequestsContract;

#[contractimpl]
impl RequestsContract {
    pub fn authorize_hospital(env: Env, hospital: Address) {
        env.storage()
            .persistent()
            .set(&(Role::Hospital, hospital.clone()), &true);
        AuthorizationChanged {
            subject: hospital,
            role: Role::Hospital,
            granted: true,
        }
        .publish(&env);
    }

    pub fn revoke_hospital(env: Env, hospital: Address) {
        env.storage()
            .persistent()
            .set(&(Role::Hospital, hospital.clone()), &false);
        AuthorizationChanged {
            subject: hospital,
            role: Role::Hospital,
            granted: false,
        }
        .publish(&env);
    }

    pub fn authorize_blood_bank(env: Env, bank: Address) {
        env.storage()
            .persistent()
            .set(&(Role::BloodBank, bank.clone()), &true);
        AuthorizationChanged {
            subject: bank,
            role: Role::BloodBank,
            granted: true,
        }
        .publish(&env);
    }

    pub fn revoke_blood_bank(env: Env, bank: Address) {
        env.storage()
            .persistent()
            .set(&(Role::BloodBank, bank.clone()), &false);
        AuthorizationChanged {
            subject: bank,
            role: Role::BloodBank,
            granted: false,
        }
        .publish(&env);
    }

    pub fn authorize_rider(env: Env, rider: Address) {
        env.storage()
            .persistent()
            .set(&(Role::Rider, rider.clone()), &true);
        AuthorizationChanged {
            subject: rider,
            role: Role::Rider,
            granted: true,
        }
        .publish(&env);
    }

    pub fn revoke_rider(env: Env, rider: Address) {
        env.storage()
            .persistent()
            .set(&(Role::Rider, rider.clone()), &false);
        AuthorizationChanged {
            subject: rider,
            role: Role::Rider,
            granted: false,
        }
        .publish(&env);
    }

    pub fn is_authorized(env: Env, role: Role, subject: Address) -> bool {
        env.storage()
            .persistent()
            .get(&(role, subject))
            .unwrap_or(false)
    }

    pub fn create_request(
        env: Env,
        hospital: Address,
        blood_type: u32,
        quantity: u32,
    ) -> u64 {
        let mut requests: Vec<Request> = env
            .storage()
            .persistent()
            .get(&"requests")
            .unwrap_or(Vec::new(&env));
        let id = requests.len() as u64;
        requests.push_back(Request {
            id,
            hospital,
            blood_type,
            quantity,
            fulfilled: false,
        });
        env.storage().persistent().set(&"requests", &requests);
        id
    }
}
