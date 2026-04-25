#![no_std]

use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, symbol_short, Address, Bytes, Env,
};

const DEFAULT_MIN_TEMPERATURE_C: i32 = 2;
const DEFAULT_MAX_TEMPERATURE_C: i32 = 6;

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Error {
    AlreadyInitialized = 700,
    NotInitialized = 701,
    DeliveryNotFound = 702,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct TemperatureThresholds {
    pub min_celsius: i32,
    pub max_celsius: i32,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ProofRequirements {
    pub requires_photo_proof: bool,
    pub requires_recipient_signature: bool,
    pub requires_temperature_log: bool,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum DataKey {
    Admin,
    RequestContract,
    DeliveryCounter,
    TemperatureThresholds,
    ProofRequirements,
    ComplianceAttestation(u64),
}

#[contract]
pub struct DeliveryContract;

#[contractimpl]
impl DeliveryContract {
    pub fn initialize(env: Env, admin: Address, request_contract: Address) -> Result<(), Error> {
        admin.require_auth();

        if Self::is_initialized(env.clone()) {
            return Err(Error::AlreadyInitialized);
        }

        let thresholds = TemperatureThresholds {
            min_celsius: DEFAULT_MIN_TEMPERATURE_C,
            max_celsius: DEFAULT_MAX_TEMPERATURE_C,
        };
        let proof_requirements = ProofRequirements {
            requires_photo_proof: true,
            requires_recipient_signature: true,
            requires_temperature_log: true,
        };

        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage()
            .instance()
            .set(&DataKey::RequestContract, &request_contract);
        env.storage()
            .instance()
            .set(&DataKey::DeliveryCounter, &0u64);
        env.storage()
            .instance()
            .set(&DataKey::TemperatureThresholds, &thresholds);
        env.storage()
            .instance()
            .set(&DataKey::ProofRequirements, &proof_requirements);

        env.events().publish(
            (symbol_short!("init"), symbol_short!("v1")),
            (admin, request_contract),
        );

        Ok(())
    }

    pub fn is_initialized(env: Env) -> bool {
        env.storage().instance().has(&DataKey::Admin)
    }

    pub fn get_admin(env: Env) -> Result<Address, Error> {
        env.storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(Error::NotInitialized)
    }

    pub fn get_request_contract(env: Env) -> Result<Address, Error> {
        env.storage()
            .instance()
            .get(&DataKey::RequestContract)
            .ok_or(Error::NotInitialized)
    }

    pub fn get_delivery_counter(env: Env) -> Result<u64, Error> {
        env.storage()
            .instance()
            .get(&DataKey::DeliveryCounter)
            .ok_or(Error::NotInitialized)
    }

    pub fn get_temperature_thresholds(env: Env) -> Result<TemperatureThresholds, Error> {
        env.storage()
            .instance()
            .get(&DataKey::TemperatureThresholds)
            .ok_or(Error::NotInitialized)
    }

    pub fn get_proof_requirements(env: Env) -> Result<ProofRequirements, Error> {
        env.storage()
            .instance()
            .get(&DataKey::ProofRequirements)
            .ok_or(Error::NotInitialized)
    }

    /// Record a compliance attestation hash for a completed delivery.
    /// The hash is produced off-chain by the backend after evaluating telemetry.
    pub fn record_compliance_attestation(
        env: Env,
        admin: Address,
        delivery_id: u64,
        compliance_hash: Bytes,
        is_compliant: bool,
    ) -> Result<(), Error> {
        admin.require_auth();
        if !Self::is_initialized(env.clone()) {
            return Err(Error::NotInitialized);
        }

        env.storage().persistent().set(
            &DataKey::ComplianceAttestation(delivery_id),
            &(compliance_hash.clone(), is_compliant),
        );

        env.events().publish(
            (symbol_short!("comply"), symbol_short!("v1")),
            (delivery_id, compliance_hash, is_compliant),
        );

        Ok(())
    }

    /// Retrieve the stored compliance attestation for a delivery.
    pub fn get_compliance_attestation(env: Env, delivery_id: u64) -> Result<(Bytes, bool), Error> {
        env.storage()
            .persistent()
            .get(&DataKey::ComplianceAttestation(delivery_id))
            .ok_or(Error::DeliveryNotFound)
    }
}

mod test;
