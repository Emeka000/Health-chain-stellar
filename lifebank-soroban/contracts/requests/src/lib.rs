#![no_std]

mod error;
mod events;
mod storage;
mod types;

#[cfg(test)]
mod test;

pub use crate::error::ContractError;
pub use crate::types::{
    BloodComponent, BloodRequest, BloodType, ContractMetadata, DataKey, RequestCreatedEvent,
    RequestHistoryEntry, RequestStatus, Urgency,
};

mod validation;

use soroban_sdk::{contract, contractimpl, Address, Env, String};

mod inventory_client {
    use soroban_sdk::{contractclient, Env};

    #[contractclient(name = "InventoryContractClient")]
    pub trait InventoryContractInterface {
        fn release_reservation(env: Env, reservation_id: u64);
    }
}

use inventory_client::InventoryContractClient;

#[contract]
pub struct RequestContract;

#[contractimpl]
impl RequestContract {
    fn append_history(
        env: &Env,
        request: &mut BloodRequest,
        actor: &Address,
        previous_status: RequestStatus,
        is_initial_transition: bool,
        new_status: RequestStatus,
        reason: String,
        fulfilled_delta_ml: u32,
        released_reservation: bool,
    ) {
        request.history.push_back(RequestHistoryEntry {
            previous_status,
            is_initial_transition,
            new_status,
            actor: actor.clone(),
            reason,
            fulfilled_delta_ml,
            released_reservation,
            timestamp: env.ledger().timestamp(),
        });
    }

    fn ensure_non_empty_reason(reason: &String) -> Result<(), ContractError> {
        if reason.len() == 0 {
            Err(ContractError::InvalidReason)
        } else {
            Ok(())
        }
    }

    fn release_reservation_if_present(env: &Env, request: &mut BloodRequest) -> bool {
        if let Some(res_id) = request.reservation_id {
            let inventory_addr = storage::get_inventory_contract(env);
            let inv_client = InventoryContractClient::new(env, &inventory_addr);
            inv_client.release_reservation(&res_id);
            request.reservation_id = None;
            true
        } else {
            false
        }
    }

    pub fn initialize(
        env: Env,
        admin: Address,
        inventory_contract: Address,
    ) -> Result<(), ContractError> {
        admin.require_auth();

        if storage::is_initialized(&env) {
            return Err(ContractError::AlreadyInitialized);
        }

        storage::set_admin(&env, &admin);
        storage::set_inventory_contract(&env, &inventory_contract);
        storage::set_request_counter(&env, 0);
        storage::set_metadata(&env, &storage::default_metadata(&env));
        storage::authorize_hospital(&env, &admin);
        storage::set_initialized(&env);

        events::emit_initialized(&env, &admin, &inventory_contract);

        Ok(())
    }

    pub fn authorize_hospital(env: Env, hospital: Address) -> Result<(), ContractError> {
        storage::require_initialized(&env)?;
        storage::get_admin(&env).require_auth();
        storage::authorize_hospital(&env, &hospital);
        Ok(())
    }

    pub fn revoke_hospital(env: Env, hospital: Address) -> Result<(), ContractError> {
        storage::require_initialized(&env)?;
        storage::get_admin(&env).require_auth();
        storage::revoke_hospital(&env, &hospital);
        Ok(())
    }

    pub fn create_request(
        env: Env,
        hospital: Address,
        blood_type: BloodType,
        component: BloodComponent,
        quantity_ml: u32,
        urgency: Urgency,
        required_by_timestamp: u64,
    ) -> Result<u64, ContractError> {
        hospital.require_auth();
        storage::require_initialized(&env)?;

        if !storage::is_hospital_authorized(&env, &hospital) {
            return Err(ContractError::NotAuthorizedHospital);
        }

        validation::validate_timestamp(&env, required_by_timestamp)?;
        validation::validate_quantity(quantity_ml)?;

        let request_id = storage::increment_request_counter(&env);
        let request = BloodRequest {
            id: request_id,
            hospital_id: hospital.clone(),
            blood_type,
            component,
            quantity_ml,
            urgency,
            created_timestamp: env.ledger().timestamp(),
            required_by_timestamp,
            status: RequestStatus::Pending,
            assigned_units: soroban_sdk::Vec::new(&env),
            fulfilled_quantity_ml: 0,
            reservation_id: None,
            history: soroban_sdk::Vec::new(&env),
        };
        let mut request = request;
        Self::append_history(
            &env,
            &mut request,
            &hospital,
            RequestStatus::Pending,
            true,
            RequestStatus::Pending,
            String::from_str(&env, "Request created"),
            0,
            false,
        );

        storage::set_request(&env, &request);
        events::emit_request_created(&env, &request);

        Ok(request_id)
    }

    /// Create multiple blood requests in a single transaction.
    /// Each tuple is `(blood_type, component, quantity_ml, urgency, required_by_timestamp)`.
    /// Returns the Vec of new request IDs in input order.
    pub fn batch_create_requests(
        env: Env,
        hospital: Address,
        entries: soroban_sdk::Vec<(BloodType, BloodComponent, u32, Urgency, u64)>,
    ) -> Result<soroban_sdk::Vec<u64>, ContractError> {
        hospital.require_auth();
        storage::require_initialized(&env)?;

        if !storage::is_hospital_authorized(&env, &hospital) {
            return Err(ContractError::NotAuthorizedHospital);
        }

        let mut ids: soroban_sdk::Vec<u64> = soroban_sdk::Vec::new(&env);
        for i in 0..entries.len() {
            let (blood_type, component, quantity_ml, urgency, required_by_timestamp) =
                entries.get(i).unwrap();
            validation::validate_timestamp(&env, required_by_timestamp)?;
            validation::validate_quantity(quantity_ml)?;

            let request_id = storage::increment_request_counter(&env);
            let request = BloodRequest {
                id: request_id,
                hospital_id: hospital.clone(),
                blood_type,
                component,
                quantity_ml,
                urgency,
                created_timestamp: env.ledger().timestamp(),
                required_by_timestamp,
                status: RequestStatus::Pending,
                assigned_units: soroban_sdk::Vec::new(&env),
                fulfilled_quantity_ml: 0,
                reservation_id: None,
                history: soroban_sdk::Vec::new(&env),
            };
            let mut request = request;
            Self::append_history(
                &env,
                &mut request,
                &hospital,
                RequestStatus::Pending,
                true,
                RequestStatus::Pending,
                String::from_str(&env, "Request created"),
                0,
                false,
            );
            storage::set_request(&env, &request);
            events::emit_request_created(&env, &request);
            ids.push_back(request_id);
        }
        Ok(ids)
    }

    /// Cancel a blood request. Only the owning hospital or the admin may cancel.
    /// The request must be in Pending or Approved status.
    pub fn cancel_request(
        env: Env,
        caller: Address,
        request_id: u64,
        reason: String,
    ) -> Result<(), ContractError> {
        caller.require_auth();
        storage::require_initialized(&env)?;
        Self::ensure_non_empty_reason(&reason)?;

        let mut request = storage::get_request(&env, request_id)
            .ok_or(ContractError::RequestNotFound)?;

        let admin = storage::get_admin(&env);
        if caller != request.hospital_id && caller != admin {
            return Err(ContractError::NotRequestOwner);
        }

        match request.status {
            RequestStatus::Pending | RequestStatus::Approved | RequestStatus::InProgress => {}
            _ => return Err(ContractError::InvalidRequestStatus),
        }

        let old_status = request.status;
        request.status = RequestStatus::Cancelled;
        let released_reservation = Self::release_reservation_if_present(&env, &mut request);
        Self::append_history(
            &env,
            &mut request,
            &caller,
            old_status,
            false,
            RequestStatus::Cancelled,
            reason,
            0,
            released_reservation,
        );
        storage::set_request(&env, &request);

        events::emit_request_cancelled(
            &env,
            request_id,
            &caller,
            env.ledger().timestamp(),
        );

        Ok(())
    }

    /// Update the status of a blood request. Admin only.
    /// Records the caller as the actor in the emitted event.
    pub fn update_request_status(
        env: Env,
        caller: Address,
        request_id: u64,
        new_status: RequestStatus,
        reason: String,
    ) -> Result<(), ContractError> {
        caller.require_auth();
        storage::require_initialized(&env)?;

        let admin = storage::get_admin(&env);
        if caller != admin {
            return Err(ContractError::Unauthorized);
        }

        let mut request = storage::get_request(&env, request_id)
            .ok_or(ContractError::RequestNotFound)?;

        if request.status == new_status {
            return Err(ContractError::InvalidRequestStatus);
        }

        let old_status = request.status;
        let mut released_reservation = false;
        let mut fulfilled_delta_ml = 0;

        match new_status {
            RequestStatus::Approved => {
                if old_status != RequestStatus::Pending {
                    return Err(ContractError::InvalidRequestStatus);
                }
            }
            RequestStatus::Rejected => {
                if old_status != RequestStatus::Pending && old_status != RequestStatus::Approved {
                    return Err(ContractError::InvalidRequestStatus);
                }
                Self::ensure_non_empty_reason(&reason)?;
                released_reservation = Self::release_reservation_if_present(&env, &mut request);
            }
            RequestStatus::Fulfilled => {
                if old_status != RequestStatus::Approved && old_status != RequestStatus::InProgress {
                    return Err(ContractError::InvalidRequestStatus);
                }
                let remaining = request.quantity_ml.saturating_sub(request.fulfilled_quantity_ml);
                fulfilled_delta_ml = remaining;
                request.fulfilled_quantity_ml = request.quantity_ml;
            }
            RequestStatus::InProgress | RequestStatus::Pending | RequestStatus::Cancelled => {
                return Err(ContractError::InvalidRequestStatus);
            }
        }

        request.status = new_status;
        Self::append_history(
            &env,
            &mut request,
            &caller,
            old_status,
            false,
            new_status,
            reason.clone(),
            fulfilled_delta_ml,
            released_reservation,
        );
        storage::set_request(&env, &request);

        events::emit_request_status_updated(
            &env,
            request_id,
            &caller,
            old_status,
            new_status,
            env.ledger().timestamp(),
        );

        Ok(())
    }

    /// Register partial fulfillment. Admin only.
    /// Allows Approved/InProgress requests, transitions to InProgress or Fulfilled.
    pub fn partial_fulfill_request(
        env: Env,
        caller: Address,
        request_id: u64,
        fulfilled_delta_ml: u32,
        reason: String,
    ) -> Result<(), ContractError> {
        caller.require_auth();
        storage::require_initialized(&env)?;
        Self::ensure_non_empty_reason(&reason)?;
        validation::validate_quantity(fulfilled_delta_ml)?;

        let admin = storage::get_admin(&env);
        if caller != admin {
            return Err(ContractError::Unauthorized);
        }

        let mut request =
            storage::get_request(&env, request_id).ok_or(ContractError::RequestNotFound)?;
        if request.status != RequestStatus::Approved && request.status != RequestStatus::InProgress {
            return Err(ContractError::InvalidRequestStatus);
        }

        let remaining = request.quantity_ml.saturating_sub(request.fulfilled_quantity_ml);
        if fulfilled_delta_ml > remaining {
            return Err(ContractError::InvalidQuantity);
        }

        let old_status = request.status;
        request.fulfilled_quantity_ml += fulfilled_delta_ml;
        let new_status = if request.fulfilled_quantity_ml == request.quantity_ml {
            RequestStatus::Fulfilled
        } else {
            RequestStatus::InProgress
        };
        request.status = new_status;
        Self::append_history(
            &env,
            &mut request,
            &caller,
            old_status,
            false,
            new_status,
            reason,
            fulfilled_delta_ml,
            false,
        );
        storage::set_request(&env, &request);

        events::emit_request_status_updated(
            &env,
            request_id,
            &caller,
            old_status,
            new_status,
            env.ledger().timestamp(),
        );
        Ok(())
    }

    pub fn get_request_history(
        env: Env,
        request_id: u64,
    ) -> Result<soroban_sdk::Vec<RequestHistoryEntry>, ContractError> {
        storage::require_initialized(&env)?;
        let request = storage::get_request(&env, request_id).ok_or(ContractError::RequestNotFound)?;
        Ok(request.history)
    }

    pub fn get_request(env: Env, request_id: u64) -> Result<BloodRequest, ContractError> {
        storage::require_initialized(&env)?;
        storage::get_request(&env, request_id).ok_or(ContractError::RequestNotFound)
    }

    pub fn get_admin(env: Env) -> Result<Address, ContractError> {
        storage::require_initialized(&env)?;
        Ok(storage::get_admin(&env))
    }

    pub fn get_inventory_contract(env: Env) -> Result<Address, ContractError> {
        storage::require_initialized(&env)?;
        Ok(storage::get_inventory_contract(&env))
    }

    pub fn get_request_counter(env: Env) -> Result<u64, ContractError> {
        storage::require_initialized(&env)?;
        Ok(storage::get_request_counter(&env))
    }

    pub fn get_metadata(env: Env) -> Result<ContractMetadata, ContractError> {
        storage::require_initialized(&env)?;
        Ok(storage::get_metadata(&env))
    }

    pub fn is_hospital_authorized(env: Env, hospital: Address) -> bool {
        storage::is_hospital_authorized(&env, &hospital)
    }

    pub fn is_initialized(env: Env) -> bool {
        storage::is_initialized(&env)
    }
}
