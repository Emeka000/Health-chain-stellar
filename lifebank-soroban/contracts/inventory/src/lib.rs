#![no_std]

mod error;
mod events;
mod storage;
mod types;
mod validation;

use crate::error::ContractError;
use crate::types::{BloodStatus, BloodType, BloodUnit, DataKey};

use soroban_sdk::{contract, contractimpl, Address, Env, Map, String, Vec};
#[contract]
pub struct InventoryContract;

#[contractimpl]
impl InventoryContract {
    /// Initialize the inventory contract
    ///
    /// # Arguments
    /// * `env` - Contract environment
    /// * `admin` - Admin address who can authorize blood banks
    ///
    /// # Errors
    /// - `AlreadyInitialized`: Contract has already been initialized
    pub fn initialize(env: Env, admin: Address) -> Result<(), ContractError> {
        admin.require_auth();

        // Check if already initialized
        if env.storage().instance().has(&DataKey::Admin) {
            return Err(ContractError::AlreadyInitialized);
        }

        // Set admin
        storage::set_admin(&env, &admin);

        Ok(())
    }

    /// Register a new blood donation into the inventory
    ///
    /// # Arguments
    /// * `env` - Contract environment
    /// * `bank_id` - Blood bank's address (must be authorized)
    /// * `blood_type` - Type of blood (A+, A-, B+, B-, AB+, AB-, O+, O-)
    /// * `quantity_ml` - Quantity in milliliters (100-600ml)
    /// * `expiration_timestamp` - Unix timestamp when blood expires
    /// * `donor_id` - Optional donor address (None for anonymous)
    ///
    /// # Returns
    /// Unique ID of the registered blood unit
    ///
    /// # Errors
    /// - `NotInitialized`: Contract not initialized
    /// - `NotAuthorizedBloodBank`: Bank is not authorized
    /// - `InvalidQuantity`: Quantity outside acceptable range
    /// - `InvalidExpiration`: Expiration date is invalid
    ///
    /// # Events
    /// Emits `BloodRegistered` event with all blood unit details
    pub fn register_blood(
        env: Env,
        bank_id: Address,
        blood_type: BloodType,
        quantity_ml: u32,
        expiration_timestamp: u64,
        donor_id: Option<Address>,
    ) -> Result<u64, ContractError> {
        // 1. Verify bank authentication
        bank_id.require_auth();

        // 2. Check contract is initialized
        if !env.storage().instance().has(&DataKey::Admin) {
            return Err(ContractError::NotInitialized);
        }

        // 3. Verify bank is authorized
        if !storage::is_authorized_bank(&env, &bank_id) {
            return Err(ContractError::NotAuthorizedBloodBank);
        }

        // 4. Validate input parameters
        validation::validate_blood_registration(&env, quantity_ml, expiration_timestamp)?;
        validation::validate_minimum_shelf_life(&env, expiration_timestamp)?;

        // 5. Generate unique blood unit ID using atomic counter increment.
        //
        // Soroban Transaction Ordering Model:
        // Within a single ledger close, transactions are ordered deterministically.
        // Each transaction sees the committed state of all preceding transactions
        // in that ledger. The counter read-increment-write below executes within
        // a single transaction's footprint, so two transactions calling
        // register_blood will always see sequential counter values — the second
        // transaction reads the counter AFTER the first transaction committed it.
        //
        // However, as a defense-in-depth measure against any future changes to
        // the execution model, we also verify that no blood unit with the
        // generated ID already exists in persistent storage before writing.
        // This turns the registration into an atomic compare-and-set: the write
        // only succeeds if the slot is empty, preventing any duplicate even if
        // two transactions somehow observed the same counter value.
        let blood_unit_id = storage::increment_blood_unit_id(&env);

        // Guard: reject if a blood unit with this ID already exists.
        // This makes duplicate registration impossible regardless of
        // transaction ordering within a ledger batch.
        if storage::blood_unit_exists(&env, blood_unit_id) {
            return Err(ContractError::DuplicateBloodUnit);
        }

        // 6. Create blood unit struct
        let current_time = env.ledger().timestamp();
        let blood_unit = BloodUnit {
            id: blood_unit_id,
            blood_type,
            quantity_ml,
            bank_id: bank_id.clone(),
            donor_id: donor_id.clone(),
            donation_timestamp: current_time,
            expiration_timestamp,
            status: BloodStatus::Available,
            metadata: Map::new(&env),
        };

        // 7. Validate the complete blood unit
        blood_unit.validate(current_time)?;

        // 8. Store blood unit — only reaches here if the ID slot was empty.
        storage::set_blood_unit(&env, &blood_unit);

        // 9. Update indexes for efficient querying
        storage::add_to_blood_type_index(&env, &blood_unit);
        storage::add_to_bank_index(&env, &blood_unit);
        storage::add_to_status_index(&env, &blood_unit);
        storage::add_to_donor_index(&env, &blood_unit);

        // 10. Emit event
        events::emit_blood_registered(
            &env,
            blood_unit_id,
            &bank_id,
            blood_type,
            quantity_ml,
            expiration_timestamp,
        );

        // 11. Return blood unit ID
        Ok(blood_unit_id)
    }

    /// Get blood unit details by ID
    ///
    /// # Arguments
    /// * `env` - Contract environment
    /// * `blood_unit_id` - ID of the blood unit to retrieve
    ///
    /// # Returns
    /// Blood unit details
    ///
    /// # Errors
    /// - `NotFound`: Blood unit with given ID doesn't exist
    pub fn get_blood_unit(env: Env, blood_unit_id: u64) -> Result<BloodUnit, ContractError> {
        storage::get_blood_unit(&env, blood_unit_id).ok_or(ContractError::NotFound)
    }

    pub fn update_status(
        env: Env,
        unit_id: u64,
        new_status: BloodStatus,
        authorized_by: Address,
        reason: Option<String>,
    ) -> Result<BloodUnit, ContractError> {
        authorized_by.require_auth();

        let admin = storage::get_admin(&env);
        if authorized_by != admin {
            return Err(ContractError::Unauthorized);
        }

        let mut blood_unit =
            storage::get_blood_unit(&env, unit_id).ok_or(ContractError::NotFound)?;

        let current_time = env.ledger().timestamp();

        if blood_unit.is_expired(current_time) {
            return Err(ContractError::BloodUnitExpired);
        }

        if blood_unit.status.is_terminal() {
            return Err(ContractError::InvalidStatusTransition);
        }

        validation::validate_status_transition(blood_unit.status, new_status)?;

        let old_status = blood_unit.status;
        blood_unit.status = new_status;
        storage::set_blood_unit(&env, &blood_unit);

        storage::record_status_change(
            &env,
            unit_id,
            old_status,
            new_status,
            &authorized_by,
            reason.clone(),
        );

        events::emit_status_change(
            &env,
            unit_id,
            old_status,
            new_status,
            &authorized_by,
            reason,
        );

        Ok(blood_unit)
    }

    pub fn mark_delivered(
        env: Env,
        unit_id: u64,
        authorized_by: Address,
        delivery_location: String,
    ) -> Result<BloodUnit, ContractError> {
        Self::update_status(
            env,
            unit_id,
            BloodStatus::Delivered,
            authorized_by,
            Some(delivery_location),
        )
    }

    pub fn mark_expired(
        env: Env,
        unit_id: u64,
        authorized_by: Address,
    ) -> Result<BloodUnit, ContractError> {
        let reason = String::from_str(&env, "Marked as expired");
        Self::update_status(
            env,
            unit_id,
            BloodStatus::Expired,
            authorized_by,
            Some(reason),
        )
    }

    pub fn batch_update_status(
        env: Env,
        unit_ids: Vec<u64>,
        new_status: BloodStatus,
        authorized_by: Address,
        reason: Option<String>,
    ) -> Result<u64, ContractError> {
        authorized_by.require_auth();

        let admin = storage::get_admin(&env);
        if authorized_by != admin {
            return Err(ContractError::Unauthorized);
        }

        let current_time = env.ledger().timestamp();
        let mut updated_count = 0u64;

        for i in 0..unit_ids.len() {
            let unit_id = unit_ids.get(i).ok_or(ContractError::NotFound)?;
            let mut blood_unit =
                storage::get_blood_unit(&env, unit_id).ok_or(ContractError::NotFound)?;

            if blood_unit.is_expired(current_time) {
                return Err(ContractError::BloodUnitExpired);
            }

            if blood_unit.status.is_terminal() {
                return Err(ContractError::InvalidStatusTransition);
            }

            validation::validate_status_transition(blood_unit.status, new_status)?;

            let old_status = blood_unit.status;
            blood_unit.status = new_status;
            storage::set_blood_unit(&env, &blood_unit);

            storage::record_status_change(
                &env,
                unit_id,
                old_status,
                new_status,
                &authorized_by,
                reason.clone(),
            );

            events::emit_status_change(
                &env,
                unit_id,
                old_status,
                new_status,
                &authorized_by,
                reason.clone(),
            );

            updated_count += 1;
        }

        Ok(updated_count)
    }

    pub fn get_status_history(env: Env, unit_id: u64) -> Vec<crate::types::StatusChangeHistory> {
        storage::get_status_history(&env, unit_id)
    }

    pub fn get_status_change_count(env: Env, unit_id: u64) -> u64 {
        storage::get_blood_unit_status_change_count(&env, unit_id)
    }
}

#[cfg(test)]
mod test;
