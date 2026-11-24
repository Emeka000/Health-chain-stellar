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
        fn get_request(env: Env, request_id: u64) -> RequestStatus;
    }

    /// Mirror of the request contract's status enum, used to gate attestation.
    #[soroban_sdk::contracttype]
    #[derive(Clone, Debug, Eq, PartialEq)]
    pub enum RequestStatus {
        Pending,
        Approved,
        InProgress,
        Fulfilled,
        Cancelled,
        Rejected,
    }
}

use request_client::{RequestContractClient, RequestStatus};

#[contractevent(topics = ["delivery", "init"], data_format = "vec")]
pub struct DeliveryInitialized {
    pub admin: Address,
    pub request_contract: Address,
}

/// Emitted when the current admin proposes a new admin. The transfer only
/// completes once the proposed address calls `accept_admin`.
#[contractevent(topics = ["delivery", "admin_proposed"], data_format = "vec")]
pub struct AdminProposed {
    pub current_admin: Address,
    pub proposed_admin: Address,
}

/// Emitted when the proposed admin accepts and takes over the admin role.
#[contractevent(topics = ["delivery", "admin_transferred"], data_format = "vec")]
pub struct AdminTransferred {
    pub previous_admin: Address,
    pub new_admin: Address,
}

/// Emitted when the admin upgrades the contract's wasm code.
#[contractevent(topics = ["delivery", "upgraded"], data_format = "vec")]
pub struct ContractUpgraded {
    pub admin: Address,
    pub new_wasm_hash: Bytes,
}

#[contractevent(topics = ["comply"], data_format = "vec")]
pub struct ComplianceAttested {
    pub delivery_id: u64,
    pub compliance_hash: Bytes,
    pub is_compliant: bool,
}

/// Emitted when the admin amends an existing compliance attestation. Carries
/// the previous hash and compliance flag so the correction is auditable.
#[contractevent(topics = ["delivery", "comply_amended"], data_format = "vec")]
pub struct ComplianceAmended {
    pub admin: Address,
    pub delivery_id: u64,
    pub previous_compliance_hash: Bytes,
    pub previous_is_compliant: bool,
    pub compliance_hash: Bytes,
    pub is_compliant: bool,
}

/// Emitted when the admin redefines the temperature band a delivery must stay
/// within. `previous` is the band in effect before this call; without it an
/// indexer could not tell what the compliance bar moved from.
///
/// Thresholds are expressed in hundredths of a degree Celsius (`_x100`), the
/// same unit the temperature contract uses, so `200` means `2.00 °C`.
#[contractevent(topics = ["delivery", "thresholds"], data_format = "vec")]
pub struct TemperatureThresholdsUpdated {
    pub admin: Address,
    pub min_celsius_x100: i32,
    pub max_celsius_x100: i32,
    pub previous_min_celsius_x100: i32,
    pub previous_max_celsius_x100: i32,
}

/// Emitted when the admin changes which proofs a delivery must supply.
#[contractevent(topics = ["delivery", "proofs"], data_format = "vec")]
pub struct ProofRequirementsUpdated {
    pub admin: Address,
    pub requires_photo_proof: bool,
    pub requires_recipient_signature: bool,
    pub requires_temperature_log: bool,
    pub prev_requires_photo_proof: bool,
    pub prev_requires_recipient_sig: bool,
    pub prev_requires_temperature_log: bool,
}

/// Default cold-chain band: 2.00 °C to 6.00 °C, in hundredths of a degree.
const DEFAULT_MIN_TEMPERATURE_C_X100: i32 = 200;
const DEFAULT_MAX_TEMPERATURE_C_X100: i32 = 600;

/// Plausibility bounds for any configured band, in hundredths of a degree.
/// Anything outside this range is rejected as an invalid input.
const MIN_ALLOWED_TEMPERATURE_C_X100: i32 = -10_000; // -100.00 °C
const MAX_ALLOWED_TEMPERATURE_C_X100: i32 = 10_000; // 100.00 °C

/// Maximum accepted length of a compliance hash, in bytes.
const MAX_COMPLIANCE_HASH_LEN: u32 = 64;

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
    NotAttested = 706,
    InvalidStatus = 707,
}

/// Temperature band a delivery must stay within, in hundredths of a degree
/// Celsius (`_x100`). This matches the unit used by the temperature contract's
/// `min_celsius_x100`/`max_celsius_x100` thresholds so the two can be compared
/// directly. The temperature contract remains the authoritative source for
/// per-unit thresholds; this band is the delivery-level compliance bar.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct TemperatureThresholds {
    pub min_celsius_x100: i32,
    pub max_celsius_x100: i32,
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
pub struct ComplianceAttestation {
    pub compliance_hash: Bytes,
    pub is_compliant: bool,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum DataKey {
    Admin,
    PendingAdmin,
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
            min_celsius_x100: DEFAULT_MIN_TEMPERATURE_C_X100,
            max_celsius_x100: DEFAULT_MAX_TEMPERATURE_C_X100,
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

    /// Returns the address that has been proposed as the next admin, if any.
    pub fn get_pending_admin(env: Env) -> Option<Address> {
        env.storage().instance().get(&DataKey::PendingAdmin)
    }

    /// Begin a two-step admin transfer. The current admin nominates
    /// `new_admin`, who must then call `accept_admin` to complete the transfer.
    pub fn propose_admin(env: Env, admin: Address, new_admin: Address) -> Result<(), Error> {
        admin.require_auth();
        let stored: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(Error::NotInitialized)?;
        if admin != stored {
            return Err(Error::Unauthorized);
        }
        if new_admin == stored {
            return Err(Error::InvalidInput);
        }

        env.storage()
            .instance()
            .set(&DataKey::PendingAdmin, &new_admin);
        env.storage()
            .instance()
            .extend_ttl(TTL_THRESHOLD, TTL_EXTEND_TO);

        AdminProposed {
            current_admin: admin,
            proposed_admin: new_admin,
        }
        .publish(&env);

        Ok(())
    }

    /// Complete a pending admin transfer. Must be called by the proposed admin.
    pub fn accept_admin(env: Env, new_admin: Address) -> Result<(), Error> {
        new_admin.require_auth();
        let pending: Address = env
            .storage()
            .instance()
            .get(&DataKey::PendingAdmin)
            .ok_or(Error::Unauthorized)?;
        if new_admin != pending {
            return Err(Error::Unauthorized);
        }

        let previous: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(Error::NotInitialized)?;

        env.storage().instance().set(&DataKey::Admin, &new_admin);
        env.storage().instance().remove(&DataKey::PendingAdmin);
        env.storage()
            .instance()
            .extend_ttl(TTL_THRESHOLD, TTL_EXTEND_TO);

        AdminTransferred {
            previous_admin: previous,
            new_admin,
        }
        .publish(&env);

        Ok(())
    }

    /// Record a compliance attestation for a delivery. The request must exist
    /// and be `InProgress` or `Fulfilled`; cancelled, rejected, pending and
    /// approved requests cannot be attested. The hash is capped at
    /// `MAX_COMPLIANCE_HASH_LEN` bytes and the first attestation is permanent
    /// (use `amend_compliance_attestation` to correct it).
    pub fn record_compliance_attestation(
        env: Env,
        delivery_id: u64,
        compliance_hash: Bytes,
        is_compliant: bool,
    ) -> Result<(), Error> {
        if !Self::is_initialized(env.clone()) {
            return Err(Error::NotInitialized);
        }
        if compliance_hash.len() > MAX_COMPLIANCE_HASH_LEN {
            return Err(Error::InvalidInput);
        }

        let counter: u64 = env
            .storage()
            .instance()
            .get(&DataKey::DeliveryCounter)
            .unwrap_or(0);
        if delivery_id == 0 || delivery_id > counter {
            return Err(Error::DeliveryNotFound);
        }

        let request_contract: Address = env
            .storage()
            .instance()
            .get(&DataKey::RequestContract)
            .ok_or(Error::NotInitialized)?;
        let status = RequestContractClient::new(&env, &request_contract)
            .get_request(&delivery_id);
        match status {
            RequestStatus::InProgress | RequestStatus::Fulfilled => {}
            _ => return Err(Error::InvalidStatus),
        }

        let key = DataKey::ComplianceAttestation(delivery_id);
        if env.storage().persistent().has(&key) {
            return Err(Error::AlreadyAttested);
        }

        let attestation = ComplianceAttestation {
            compliance_hash: compliance_hash.clone(),
            is_compliant,
        };
        env.storage().persistent().set(&key, &attestation);
        env.storage()
            .persistent()
            .extend_ttl(&key, TTL_THRESHOLD, TTL_EXTEND_TO);

        ComplianceAttested {
            delivery_id,
            compliance_hash,
            is_compliant,
        }
        .publish(&env);

        Ok(())
    }

    /// Admin-only correction of an existing compliance attestation. Emits the
    /// previous hash and flag so the amendment is auditable.
    pub fn amend_compliance_attestation(
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
        if compliance_hash.len() > MAX_COMPLIANCE_HASH_LEN {
            return Err(Error::InvalidInput);
        }

        let key = DataKey::ComplianceAttestation(delivery_id);
        let previous: ComplianceAttestation = env
            .storage()
            .persistent()
            .get(&key)
            .ok_or(Error::NotAttested)?;

        let attestation = ComplianceAttestation {
            compliance_hash: compliance_hash.clone(),
            is_compliant,
        };
        env.storage().persistent().set(&key, &attestation);
        env.storage()
            .persistent()
            .extend_ttl(&key, TTL_THRESHOLD, TTL_EXTEND_TO);

        ComplianceAmended {
            admin,
            delivery_id,
            previous_compliance_hash: previous.compliance_hash,
            previous_is_compliant: previous.is_compliant,
            compliance_hash,
            is_compliant,
        }
        .publish(&env);

        Ok(())
    }
}
