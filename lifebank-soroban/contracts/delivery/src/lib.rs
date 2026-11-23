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

    /// Replace the contract's wasm code. Admin only.
    pub fn upgrade(env: Env, admin: Address, new_wasm_hash: Bytes) -> Result<(), Error> {
        admin.require_auth();
        let stored: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(Error::NotInitialized)?;
        if admin != stored {
            return Err(Error::Unauthorized);
        }

        env.deployer().update_current_contract_wasm(new_wasm_hash.clone());

        ContractUpgraded {
            admin,
            new_wasm_hash,
        }
        .publish(&env);

        Ok(())
    }

    /// Update the temperature band a delivery must stay within. Admin only.
    ///
    /// Values are in hundredths of a degree Celsius (`_x100`), matching the
    /// temperature contract. The range must be strictly increasing
    /// (`min < max`) and both bounds must fall within the plausibility window
    /// `[-100.00 °C, 100.00 °C]`; otherwise `InvalidInput` is returned.
    pub fn set_temperature_thresholds(
        env: Env,
        admin: Address,
        min_celsius_x100: i32,
        max_celsius_x100: i32,
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

        if min_celsius_x100 >= max_celsius_x100
            || min_celsius_x100 < MIN_ALLOWED_TEMPERATURE_C_X100
            || max_celsius_x100 > MAX_ALLOWED_TEMPERATURE_C_X100
        {
            return Err(Error::InvalidInput);
        }

        let previous: TemperatureThresholds = env
            .storage()
            .instance()
            .get(&DataKey::TemperatureThresholds)
            .unwrap_or(TemperatureThresholds {
                min_celsius_x100: DEFAULT_MIN_TEMPERATURE_C_X100,
                max_celsius_x100: DEFAULT_MAX_TEMPERATURE_C_X100,
            });

        let thresholds = TemperatureThresholds {
            min_celsius_x100,
            max_celsius_x100,
        };
        env.storage()
            .instance()
            .set(&DataKey::TemperatureThresholds, &thresholds);
        env.storage()
            .instance()
            .extend_ttl(TTL_THRESHOLD, TTL_EXTEND_TO);

        TemperatureThresholdsUpdated {
            admin,
            min_celsius_x100,
            max_celsius_x100,
            previous_min_celsius_x100: previous.min_celsius_x100,
            previous_max_celsius_x100: previous.max_celsius_x100,
        }
        .publish(&env);

        Ok(())
    }

    /// Returns the current delivery-level temperature band, in hundredths of a
    /// degree Celsius (`_x100`).
    pub fn get_temperature_thresholds(env: Env) -> Result<TemperatureThresholds, Error> {
        env.storage()
            .instance()
            .get(&DataKey::TemperatureThresholds)
            .ok_or(Error::NotInitialized)
    }
}
