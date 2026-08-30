#![no_std]
#![deny(deprecated)]

use soroban_sdk::{
    contract, contracterror, contractevent, contractimpl, contracttype, Address, Bytes, Env,
};

mod request_client {
    use soroban_sdk::{contractclient, Env};

    #[contractclient(name = "RequestContractClient")]
    #[allow(dead_code)]
    pub trait RequestContractInterface {
        fn get_request_counter(env: Env) -> u64;
    }
}

use request_client::RequestContractClient;

#[contractevent(topics = ["delivery", "init"], data_format = "vec")]
pub struct DeliveryInitialized {
    pub admin: Address,
    pub request_contract: Address,
}

#[contractevent(topics = ["comply"], data_format = "vec")]
pub struct ComplianceAttested {
    pub delivery_id: u64,
    pub compliance_hash: Bytes,
    pub is_compliant: bool,
}

const DEFAULT_MIN_TEMPERATURE_C: i32 = 2;
const DEFAULT_MAX_TEMPERATURE_C: i32 = 6;
const CONTRACT_VERSION: u32 = 1;

/// Persistent storage TTL constants (ledgers; one ledger ≈ 5 s on mainnet).
const TTL_THRESHOLD: u32 = 518_400; // ~30 days
const TTL_EXTEND_TO: u32 = 1_036_800; // ~60 days

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Error {
    AlreadyInitialized = 700,
    NotInitialized = 701,
    DeliveryNotFound = 702,
    Unauthorized = 703,
    InvalidInput = 704,
    AlreadyAttested = 705,
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
        env.storage()
            .instance()
            .extend_ttl(TTL_THRESHOLD, TTL_EXTEND_TO);

        DeliveryInitialized {
            admin,
            request_contract,
        }
        .publish(&env);

        Ok(())
    }

    pub fn version(_env: Env) -> u32 {
        CONTRACT_VERSION
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

    /// Update the cold-chain temperature thresholds. Admin only.
    pub fn set_temperature_thresholds(
        env: Env,
        admin: Address,
        thresholds: TemperatureThresholds,
    ) -> Result<(), Error> {
        admin.require_auth();
        let stored: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(Error::NotInitialized)?;
        if admin != stored {
            return Err(Error::Unauthorized);
        }
        if thresholds.min_celsius > thresholds.max_celsius {
            return Err(Error::InvalidInput);
        }
        env.storage()
            .instance()
            .set(&DataKey::TemperatureThresholds, &thresholds);
        env.storage()
            .instance()
            .extend_ttl(TTL_THRESHOLD, TTL_EXTEND_TO);
        Ok(())
    }

    /// Update the proof requirements. Admin only.
    pub fn set_proof_requirements(
        env: Env,
        admin: Address,
        requirements: ProofRequirements,
    ) -> Result<(), Error> {
        admin.require_auth();
        let stored: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(Error::NotInitialized)?;
        if admin != stored {
            return Err(Error::Unauthorized);
        }
        env.storage()
            .instance()
            .set(&DataKey::ProofRequirements, &requirements);
        env.storage()
            .instance()
            .extend_ttl(TTL_THRESHOLD, TTL_EXTEND_TO);
        Ok(())
    }

    /// Record a compliance attestation for a completed delivery.
    ///
    /// This function implements an **oracle attestation pattern**: the backend
    /// evaluates the delivery's telemetry (temperature readings, photo proof,
    /// recipient signature, temperature log) against the configured
    /// `TemperatureThresholds` and `ProofRequirements` off-chain, produces a
    /// `compliance_hash` committing to that evaluation, and then calls this
    /// function to record the result on-chain. Only the stored admin may attest.
    pub fn record_compliance_attestation(
        env: Env,
        admin: Address,
        delivery_id: u64,
        compliance_hash: Bytes,
        is_compliant: bool,
    ) -> Result<(), Error> {
        admin.require_auth();
        let stored: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(Error::NotInitialized)?;
        if admin != stored {
            return Err(Error::Unauthorized);
        }
        if !Self::is_initialized(env.clone()) {
            return Err(Error::NotInitialized);
        }

        let attestation_key = DataKey::ComplianceAttestation(delivery_id);
        if env.storage().persistent().has(&attestation_key) {
            return Err(Error::AlreadyAttested);
        }

        env.storage()
            .persistent()
            .set(&attestation_key, &(compliance_hash.clone(), is_compliant));
        env.storage()
            .persistent()
            .extend_ttl(&attestation_key, TTL_THRESHOLD, TTL_EXTEND_TO);
        env.storage()
            .instance()
            .extend_ttl(TTL_THRESHOLD, TTL_EXTEND_TO);

        ComplianceAttested {
            delivery_id,
            compliance_hash,
            is_compliant,
        }
        .publish(&env);

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
