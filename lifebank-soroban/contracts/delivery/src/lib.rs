#![no_std]

mod error;
mod storage;
mod types;

pub use error::ContractError;
pub use types::{DeliveryRecord, DeliveryStatus, ProofRequirements, TemperatureThresholds};

use soroban_sdk::{contract, contractimpl, Address, Env, String};

#[contract]
pub struct DeliveryContract;

#[contractimpl]
impl DeliveryContract {
    /// Initialize the delivery contract.
    ///
    /// # Arguments
    /// * `admin`            - Admin address with management privileges
    /// * `request_contract` - Address of the linked requests contract
    /// * `min_temp_x100`    - Minimum transport temperature (celsius * 100)
    /// * `max_temp_x100`    - Maximum transport temperature (celsius * 100)
    /// * `photo_required`   - Whether photo proof is required on delivery
    /// * `signature_required` - Whether recipient signature is required
    ///
    /// # Errors
    /// - `AlreadyInitialized`: Contract has already been initialized
    /// - `InvalidTemperatureThreshold`: min >= max
    pub fn initialize(
        env: Env,
        admin: Address,
        request_contract: Address,
        min_temp_x100: i32,
        max_temp_x100: i32,
        photo_required: bool,
        signature_required: bool,
    ) -> Result<(), ContractError> {
        admin.require_auth();

        if storage::is_initialized(&env) {
            return Err(ContractError::AlreadyInitialized);
        }

        if min_temp_x100 >= max_temp_x100 {
            return Err(ContractError::InvalidTemperatureThreshold);
        }

        storage::set_admin(&env, &admin);
        storage::set_request_contract(&env, &request_contract);
        storage::set_temp_thresholds(
            &env,
            &TemperatureThresholds { min_celsius_x100: min_temp_x100, max_celsius_x100: max_temp_x100 },
        );
        storage::set_proof_requirements(
            &env,
            &ProofRequirements { photo_required, signature_required },
        );

        Ok(())
    }

    /// Create a new delivery for a blood request.
    ///
    /// # Errors
    /// - `NotInitialized`: Contract not initialized
    /// - `Unauthorized`: Caller is not admin
    pub fn create_delivery(
        env: Env,
        request_id: u64,
        courier: Address,
        recipient: Address,
    ) -> Result<u64, ContractError> {
        if !storage::is_initialized(&env) {
            return Err(ContractError::NotInitialized);
        }

        let admin = storage::get_admin(&env);
        admin.require_auth();

        let id = storage::next_delivery_id(&env);
        let delivery = DeliveryRecord {
            id,
            request_id,
            courier,
            recipient,
            status: DeliveryStatus::Pending,
            created_at: env.ledger().timestamp(),
            delivered_at: None,
            photo_proof: None,
            signature_proof: None,
        };

        storage::set_delivery(&env, &delivery);
        Ok(id)
    }

    /// Mark a delivery as in-transit (called by courier).
    ///
    /// # Errors
    /// - `NotInitialized`: Contract not initialized
    /// - `DeliveryNotFound`: No delivery with given ID
    /// - `InvalidStatusTransition`: Delivery is not Pending
    pub fn mark_in_transit(env: Env, delivery_id: u64, courier: Address) -> Result<(), ContractError> {
        if !storage::is_initialized(&env) {
            return Err(ContractError::NotInitialized);
        }

        courier.require_auth();

        let mut delivery = storage::get_delivery(&env, delivery_id)
            .ok_or(ContractError::DeliveryNotFound)?;

        if delivery.status != DeliveryStatus::Pending || delivery.courier != courier {
            return Err(ContractError::InvalidStatusTransition);
        }

        delivery.status = DeliveryStatus::InTransit;
        storage::set_delivery(&env, &delivery);
        Ok(())
    }

    /// Confirm delivery with optional proof attachments.
    ///
    /// # Errors
    /// - `NotInitialized`: Contract not initialized
    /// - `DeliveryNotFound`: No delivery with given ID
    /// - `InvalidStatusTransition`: Delivery is not InTransit
    /// - `MissingProof`: Required proof not provided
    pub fn confirm_delivery(
        env: Env,
        delivery_id: u64,
        courier: Address,
        photo_proof: Option<String>,
        signature_proof: Option<String>,
    ) -> Result<(), ContractError> {
        if !storage::is_initialized(&env) {
            return Err(ContractError::NotInitialized);
        }

        courier.require_auth();

        let mut delivery = storage::get_delivery(&env, delivery_id)
            .ok_or(ContractError::DeliveryNotFound)?;

        if delivery.status != DeliveryStatus::InTransit || delivery.courier != courier {
            return Err(ContractError::InvalidStatusTransition);
        }

        let requirements = storage::get_proof_requirements(&env);

        if requirements.photo_required && photo_proof.is_none() {
            return Err(ContractError::MissingProof);
        }
        if requirements.signature_required && signature_proof.is_none() {
            return Err(ContractError::MissingProof);
        }

        delivery.status = DeliveryStatus::Delivered;
        delivery.delivered_at = Some(env.ledger().timestamp());
        delivery.photo_proof = photo_proof;
        delivery.signature_proof = signature_proof;

        storage::set_delivery(&env, &delivery);
        Ok(())
    }

    /// Get a delivery record by ID.
    pub fn get_delivery(env: Env, delivery_id: u64) -> Result<DeliveryRecord, ContractError> {
        storage::get_delivery(&env, delivery_id).ok_or(ContractError::DeliveryNotFound)
    }

    /// Get current temperature thresholds.
    pub fn get_temp_thresholds(env: Env) -> Result<TemperatureThresholds, ContractError> {
        if !storage::is_initialized(&env) {
            return Err(ContractError::NotInitialized);
        }
        Ok(storage::get_temp_thresholds(&env))
    }

    /// Get current proof requirements.
    pub fn get_proof_requirements(env: Env) -> Result<ProofRequirements, ContractError> {
        if !storage::is_initialized(&env) {
            return Err(ContractError::NotInitialized);
        }
        Ok(storage::get_proof_requirements(&env))
    }

    /// Get the linked request contract address.
    pub fn get_request_contract(env: Env) -> Result<Address, ContractError> {
        if !storage::is_initialized(&env) {
            return Err(ContractError::NotInitialized);
        }
        Ok(storage::get_request_contract(&env))
    }

    /// Update temperature thresholds (admin only).
    pub fn update_temp_thresholds(
        env: Env,
        min_temp_x100: i32,
        max_temp_x100: i32,
    ) -> Result<(), ContractError> {
        if !storage::is_initialized(&env) {
            return Err(ContractError::NotInitialized);
        }

        let admin = storage::get_admin(&env);
        admin.require_auth();

        if min_temp_x100 >= max_temp_x100 {
            return Err(ContractError::InvalidTemperatureThreshold);
        }

        storage::set_temp_thresholds(
            &env,
            &TemperatureThresholds { min_celsius_x100: min_temp_x100, max_celsius_x100: max_temp_x100 },
        );
        Ok(())
    }
}

#[cfg(test)]
mod test;
