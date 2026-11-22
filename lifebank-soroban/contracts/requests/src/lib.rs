#![no_std]
#![deny(deprecated)]

mod error;
mod events;
mod storage;
mod types;

#[cfg(test)]
mod test;
#[cfg(test)]
mod test_utils;
#[cfg(test)]
mod test_issues_1807_1810;

pub use crate::error::ContractError;
pub use crate::types::{
    BloodComponent, BloodRequest, BloodType, ContractMetadata, DataKey, RequestCreatedEvent,
    RequestHistoryEntry, RequestStatus, Urgency,
};

mod validation;

use soroban_sdk::{contract, contractimpl, Address, Env, String};

mod inventory_client {
    use soroban_sdk::{contractclient, contracttype, Address, Env, Vec};

    /// Mirrors inventory's `Reservation` (decoded field-for-field by name).
    #[contracttype]
    #[derive(Clone, Debug, Eq, PartialEq)]
    pub struct InventoryReservation {
        pub unit_ids: Vec<u64>,
        pub requester: Address,
        pub reserved_by: Address,
        pub created_timestamp: u64,
        pub expiration_timestamp: u64,
        pub request_id: u64,
    }

    #[contractclient(name = "InventoryContractClient")]
    #[allow(dead_code)]
    pub trait InventoryContractInterface {
        fn get_reservation(env: Env, reservation_id: u64) -> InventoryReservation;
        fn release_reservation(env: Env, caller: Address, reservation_id: u64);
        fn release_reservation_by_contract(
            env: Env,
            authorized_contract: Address,
            reservation_id: u64,
        );
    }
}

use inventory_client::{InventoryContractClient, InventoryReservation};

const CONTRACT_VERSION: u32 = 1;

/// Inventory's `ContractError::ReservationNotFound` discriminant.
const INVENTORY_RESERVATION_NOT_FOUND: u32 = 150;

/// Maximum number of entries accepted by `batch_create_requests`.
/// Mirrors the sibling matching contract's `MAX_BATCH_SIZE` so callers hit a
/// dedicated error instead of the instruction or storage-write limit.
const MAX_BATCH_SIZE: u32 = 50;

#[contract]
pub struct RequestContract;

#[contractimpl]
impl RequestContract {
    #[allow(clippy::too_many_arguments)]
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
        storage::append_history_entry(
            env,
            request,
            RequestHistoryEntry {
                previous_status,
                is_initial_transition,
                new_status,
                actor: actor.clone(),
                reason,
                fulfilled_delta_ml,
                released_reservation,
                timestamp: env.ledger().timestamp(),
            },
        );
    }

    /// Fetch a reservation from inventory, mapping any failure to
    /// `ReservationNotFound`.
    fn fetch_reservation(
        env: &Env,
        reservation_id: u64,
    ) -> Result<InventoryReservation, ContractError> {
        let inventory_addr = storage::get_inventory_contract(env);
        let inv_client = InventoryContractClient::new(env, &inventory_addr);
        match inv_client.try_get_reservation(&reservation_id) {
            Ok(Ok(reservation)) => Ok(reservation),
            _ => Err(ContractError::ReservationNotFound),
        }
    }

    fn require_admin(env: &Env, admin: &Address) -> Result<(), ContractError> {
        admin.require_auth();
        if *admin != storage::get_admin(env) {
            return Err(ContractError::Unauthorized);
        }
        Ok(())
    }

    fn ensure_non_empty_reason(reason: &String) -> Result<(), ContractError> {
        if reason.is_empty() {
            Err(ContractError::InvalidReason)
        } else {
            Ok(())
        }
    }

    fn is_valid_transition(from: &RequestStatus, to: &RequestStatus) -> bool {
        matches!(
            (from, to),
            (RequestStatus::Pending, RequestStatus::Approved)
                | (RequestStatus::Pending, RequestStatus::Rejected)
                | (RequestStatus::Approved, RequestStatus::Rejected)
                | (RequestStatus::Approved, RequestStatus::InProgress)
                | (RequestStatus::Approved, RequestStatus::Fulfilled)
                | (RequestStatus::InProgress, RequestStatus::Fulfilled)
        )
    }

    /// Releases the request's inventory reservation, if it has one.
    ///
    /// Returns `Ok(true)` when a reservation was released (or was already gone),
    /// `Ok(false)` when there was none, and `Err(InventoryReleaseFailed)` when
    /// inventory refused the release (for example because it is paused). The
    /// caller propagates the error so the transition is rolled back instead of
    /// trapping with an opaque host panic or orphaning the reserved units.
    fn release_reservation_if_present(
        env: &Env,
        request: &mut BloodRequest,
    ) -> Result<bool, ContractError> {
        if let Some(res_id) = request.reservation_id {
            let inventory_addr = storage::get_inventory_contract(env);
            let inv_client = InventoryContractClient::new(env, &inventory_addr);
            let requests_contract = env.current_contract_address();
            // Use cross-contract authorization: the requests contract itself is
            // the authorized intermediary. The inventory contract verifies that
            // this function is called FROM the requests contract address.
            // A reservation that was already expired via `expire_reservation` has
            // nothing left to release, so `ReservationNotFound` counts as released
            // and the cancellation/rejection still goes through.
            let not_found =
                soroban_sdk::Error::from_contract_error(INVENTORY_RESERVATION_NOT_FOUND);
            match inv_client.try_release_reservation_by_contract(&requests_contract, &res_id) {
                Ok(Ok(())) => {}
                Err(Ok(err)) if err == not_found => {}
                _ => return Err(ContractError::InventoryReleaseFailed),
            }
            request.reservation_id = None;
            Ok(true)
        } else {
            Ok(false)
        }
    }

    /// Initialize the contract with its admin and inventory contract.
    ///
    /// The admin is not granted any tenant role (hospital, blood bank or
    /// rider); call `authorize_hospital` etc. explicitly.
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
        // The admin is deliberately NOT authorized as a hospital: the operator
        // role must not double as a tenant that can create, fund and settle
        // its own requests. Hospitals are granted explicitly via
        // `authorize_hospital`, which emits `hospital_authorized`.
        storage::set_initialized(&env);
        storage::bump_instance_ttl(&env);

        events::emit_initialized(&env, &admin, &inventory_contract);

        Ok(())
    }

    pub fn version(_env: Env) -> u32 {
        CONTRACT_VERSION
    }

    /// Pause the contract (admin only). Every request-state-mutating
    /// entrypoint returns `ContractPaused` while paused, including
    /// `cancel_request` / `cancel_request_by_contract`: cancelling releases
    /// inventory reservations, which is exactly the kind of cross-contract
    /// side effect an incident freeze must stop. Admin configuration
    /// (authorizations, payments contract, upgrade) stays available so the
    /// incident can be remediated.
    pub fn pause(env: Env, admin: Address) -> Result<(), ContractError> {
        storage::require_initialized(&env)?;
        Self::require_admin(&env, &admin)?;
        storage::set_paused(&env, true);
        Ok(())
    }

    /// Unpause the contract (admin only).
    pub fn unpause(env: Env, admin: Address) -> Result<(), ContractError> {
        storage::require_initialized(&env)?;
        Self::require_admin(&env, &admin)?;
        storage::set_paused(&env, false);
        Ok(())
    }

    pub fn is_paused(env: Env) -> bool {
        storage::is_paused(&env)
    }

    pub fn authorize_hospital(env: Env, hospital: Address) -> Result<(), ContractError> {
        storage::require_initialized(&env)?;
        let admin = storage::get_admin(&env);
        admin.require_auth();
        storage::authorize_hospital(&env, &hospital);
        events::emit_hospital_authorized(&env, &hospital, &admin, env.ledger().timestamp());
        Ok(())
    }

    pub fn revoke_hospital(env: Env, hospital: Address) -> Result<(), ContractError> {
        storage::require_initialized(&env)?;
        let admin = storage::get_admin(&env);
        admin.require_auth();
        storage::revoke_hospital(&env, &hospital);
        events::emit_hospital_revoked(&env, &hospital, &admin, env.ledger().timestamp());
        Ok(())
    }

    pub fn authorize_blood_bank(env: Env, blood_bank: Address) -> Result<(), ContractError> {
        storage::require_initialized(&env)?;
        let admin = storage::get_admin(&env);
        admin.require_auth();
        storage::authorize_blood_bank(&env, &blood_bank);
        events::emit_blood_bank_authorized(&env, &blood_bank, &admin, env.ledger().timestamp());
        Ok(())
    }

    pub fn revoke_blood_bank(env: Env, blood_bank: Address) -> Result<(), ContractError> {
        storage::require_initialized(&env)?;
        let admin = storage::get_admin(&env);
        admin.require_auth();
        storage::revoke_blood_bank(&env, &blood_bank);
        events::emit_blood_bank_revoked(&env, &blood_bank, &admin, env.ledger().timestamp());
        Ok(())
    }

    pub fn authorize_rider(env: Env, rider: Address) -> Result<(), ContractError> {
        storage::require_initialized(&env)?;
        let admin = storage::get_admin(&env);
        admin.require_auth();
        storage::authorize_rider(&env, &rider);
        events::emit_rider_authorized(&env, &rider, &admin, env.ledger().timestamp());
        Ok(())
    }

    pub fn revoke_rider(env: Env, rider: Address) -> Result<(), ContractError> {
        storage::require_initialized(&env)?;
        let admin = storage::get_admin(&env);
        admin.require_auth();
        storage::revoke_rider(&env, &rider);
        events::emit_rider_revoked(&env, &rider, &admin, env.ledger().timestamp());
        Ok(())
    }

    /// Assign the authorized rider that is allowed to pick up an Approved request.
    /// Admin only. May be called again to reassign before pickup.
    pub fn assign_rider(
        env: Env,
        caller: Address,
        request_id: u64,
        rider: Address,
    ) -> Result<(), ContractError> {
        caller.require_auth();
        storage::require_initialized(&env)?;
        storage::require_not_paused(&env)?;
        let admin = storage::get_admin(&env);
        if caller != admin {
            return Err(ContractError::Unauthorized);
        }

        if !storage::is_rider_authorized(&env, &rider) {
            return Err(ContractError::NotAuthorizedRider);
        }

        let request =
            storage::get_request(&env, request_id).ok_or(ContractError::RequestNotFound)?;
        if request.status != RequestStatus::Approved {
            return Err(ContractError::InvalidRequestStatus);
        }

        storage::set_request_rider(&env, request_id, &rider);
        events::emit_rider_assigned(&env, request_id, &rider, &admin, env.ledger().timestamp());
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
        storage::require_not_paused(&env)?;

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
            fulfilled_by: None,
            history_len: 0,
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
        storage::append_to_hospital_requests(&env, &hospital, request_id);
        storage::append_to_hospital_history(&env, &hospital, request_id);
        events::emit_request_created(&env, &request);

        Ok(request_id)
    }

    /// Create multiple blood requests in a single transaction.
    /// Each tuple is `(blood_type, component, quantity_ml, urgency, required_by_timestamp)`.
    /// Returns the Vec of new request IDs in input order.
    /// Validates all items first, then writes all atomically.
    /// Rejects batches larger than `MAX_BATCH_SIZE` before either pass begins.
    pub fn batch_create_requests(
        env: Env,
        hospital: Address,
        entries: soroban_sdk::Vec<(BloodType, BloodComponent, u32, Urgency, u64)>,
    ) -> Result<soroban_sdk::Vec<u64>, ContractError> {
        hospital.require_auth();
        storage::require_initialized(&env)?;
        storage::require_not_paused(&env)?;

        if entries.len() > MAX_BATCH_SIZE {
            return Err(ContractError::BatchTooLarge);
        }

        if !storage::is_hospital_authorized(&env, &hospital) {
            return Err(ContractError::NotAuthorizedHospital);
        }

        for i in 0..entries.len() {
            let (_, _, quantity_ml, _, required_by_timestamp) = entries.get(i).unwrap();
            validation::validate_timestamp(&env, required_by_timestamp)?;
            validation::validate_quantity(quantity_ml)?;
        }

        let mut ids: soroban_sdk::Vec<u64> = soroban_sdk::Vec::new(&env);
        for i in 0..entries.len() {
            let (blood_type, component, quantity_ml, urgency, required_by_timestamp) =
                entries.get(i).unwrap();

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
                fulfilled_by: None,
                history_len: 0,
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
            storage::append_to_hospital_requests(&env, &hospital, request_id);
            storage::append_to_hospital_history(&env, &hospital, request_id);
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
        storage::require_not_paused(&env)?;
        Self::ensure_non_empty_reason(&reason)?;

        let mut request =
            storage::get_request(&env, request_id).ok_or(ContractError::RequestNotFound)?;

        let admin = storage::get_admin(&env);
        if caller != request.hospital_id && caller != admin {
            return Err(ContractError::NotRequestOwner);
        }

        Self::cancel_internal(&env, &mut request, &caller, reason)
    }

    /// Configure the payments contract trusted to cancel requests via
    /// `cancel_request_by_contract`. Admin only; may be called again to rotate.
    pub fn set_payments_contract(
        env: Env,
        payments_contract: Address,
    ) -> Result<(), ContractError> {
        storage::require_initialized(&env)?;
        storage::get_admin(&env).require_auth();
        storage::set_payments_contract(&env, &payments_contract);
        events::emit_payments_contract_set(&env, &payments_contract);
        Ok(())
    }

    pub fn get_payments_contract(env: Env) -> Result<Option<Address>, ContractError> {
        storage::require_initialized(&env)?;
        Ok(storage::get_payments_contract(&env))
    }

    /// Cancel a blood request on behalf of the trusted payments contract
    /// (e.g. after an expired dispute is auto-refunded).
    ///
    /// Mirrors inventory's `release_reservation_by_contract`: `caller_contract`
    /// must authorize the call (automatic for the direct invoking contract) and
    /// must equal the payments contract configured via `set_payments_contract`.
    pub fn cancel_request_by_contract(
        env: Env,
        caller_contract: Address,
        request_id: u64,
        reason: String,
    ) -> Result<(), ContractError> {
        storage::require_initialized(&env)?;
        storage::require_not_paused(&env)?;
        caller_contract.require_auth();

        match storage::get_payments_contract(&env) {
            Some(ref trusted) if *trusted == caller_contract => {}
            Some(_) => return Err(ContractError::Unauthorized),
            None => return Err(ContractError::PaymentsContractNotSet),
        }

        Self::ensure_non_empty_reason(&reason)?;

        let mut request =
            storage::get_request(&env, request_id).ok_or(ContractError::RequestNotFound)?;

        Self::cancel_internal(&env, &mut request, &caller_contract, reason)
    }

    fn cancel_internal(
        env: &Env,
        request: &mut BloodRequest,
        actor: &Address,
        reason: String,
    ) -> Result<(), ContractError> {
        // Units in an InProgress request are already on a rider's vehicle;
        // cancelling would release their reservation while they are in transit.
        // This guard lives here (not only in `cancel_request`) so that every
        // cancellation path, including `cancel_request_by_contract`, enforces it.
        match request.status {
            RequestStatus::Pending | RequestStatus::Approved => {}
            _ => return Err(ContractError::InvalidRequestStatus),
        }

        let old_status = request.status;
        request.status = RequestStatus::Cancelled;
        let released_reservation = Self::release_reservation_if_present(env, request)?;
        Self::append_history(
            env,
            request,
            actor,
            old_status,
            false,
            RequestStatus::Cancelled,
            reason,
            0,
            released_reservation,
        );
        storage::set_request(env, request);
        storage::remove_from_hospital_requests(env, &request.hospital_id, request.id);

        events::emit_request_cancelled(env, request.id, actor, env.ledger().timestamp());

        Ok(())
    }

    /// Expire an overdue request. Permissionless: anyone may call it once the
    /// ledger time is past the request's `required_by_timestamp`.
    ///
    /// Only Pending or Approved requests expire. InProgress requests are left
    /// alone because their units are already in transit. The request moves to
    /// the terminal `Cancelled` status with the history reason
    /// `"Request expired"`, any inventory reservation is released, and a
    /// `request_expired` event is emitted.
    ///
    /// # Errors
    /// * `RequestNotFound` - unknown `request_id`
    /// * `InvalidRequestStatus` - request is not Pending or Approved
    /// * `RequestNotExpired` - `required_by_timestamp` has not passed yet
    /// * `InventoryReleaseFailed` - inventory refused to release the reservation
    pub fn expire_request(env: Env, request_id: u64) -> Result<(), ContractError> {
        storage::require_initialized(&env)?;

        let mut request =
            storage::get_request(&env, request_id).ok_or(ContractError::RequestNotFound)?;

        match request.status {
            RequestStatus::Pending | RequestStatus::Approved => {}
            _ => return Err(ContractError::InvalidRequestStatus),
        }

        let now = env.ledger().timestamp();
        if now <= request.required_by_timestamp {
            return Err(ContractError::RequestNotExpired);
        }

        let old_status = request.status;
        let released_reservation = Self::release_reservation_if_present(&env, &mut request)?;
        request.status = RequestStatus::Cancelled;
        let actor = env.current_contract_address();
        Self::append_history(
            &env,
            &mut request,
            &actor,
            old_status,
            false,
            RequestStatus::Cancelled,
            String::from_str(&env, "Request expired"),
            0,
            released_reservation,
        );
        storage::set_request(&env, &request);
        storage::remove_from_hospital_requests(&env, &request.hospital_id, request_id);

        events::emit_request_expired(
            &env,
            request_id,
            request.required_by_timestamp,
            released_reservation,
            now,
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
        storage::require_not_paused(&env)?;

        let admin = storage::get_admin(&env);
        let is_admin = caller == admin;
        let is_authorized_rider = storage::is_rider_authorized(&env, &caller);

        // Authorized riders may only drive the Approved → InProgress transition (pickup);
        // all other transitions remain admin-only.
        if !(is_admin || (new_status == RequestStatus::InProgress && is_authorized_rider)) {
            return Err(ContractError::Unauthorized);
        }

        let mut request =
            storage::get_request(&env, request_id).ok_or(ContractError::RequestNotFound)?;

        // A rider may only pick up a request the admin assigned to it.
        if !is_admin && storage::get_request_rider(&env, request_id) != Some(caller.clone()) {
            return Err(ContractError::Unauthorized);
        }

        Self::apply_status_transition(&env, &mut request, &caller, new_status, reason)
    }

    /// Shared body of `update_request_status` and
    /// `update_status_by_contract`, run once the caller is authorized.
    fn apply_status_transition(
        env: &Env,
        request: &mut BloodRequest,
        caller: &Address,
        new_status: RequestStatus,
        reason: String,
    ) -> Result<(), ContractError> {
        let request_id = request.id;

        if request.status == new_status {
            return Err(ContractError::InvalidRequestStatus);
        }

        let old_status = request.status;

        if !Self::is_valid_transition(&old_status, &new_status) {
            return Err(ContractError::InvalidRequestStatus);
        }

        let mut released_reservation = false;
        let mut fulfilled_delta_ml = 0;

        match new_status {
            RequestStatus::Approved | RequestStatus::InProgress => {}
            RequestStatus::Rejected => {
                Self::ensure_non_empty_reason(&reason)?;
                released_reservation = Self::release_reservation_if_present(env, request)?;
            }
            RequestStatus::Fulfilled => {
                let remaining = request
                    .quantity_ml
                    .saturating_sub(request.fulfilled_quantity_ml);
                fulfilled_delta_ml = remaining;
                request.fulfilled_quantity_ml = request.quantity_ml;
            }
            RequestStatus::Pending | RequestStatus::Cancelled => {
                return Err(ContractError::InvalidRequestStatus);
            }
        }

        request.status = new_status;
        Self::append_history(
            env,
            request,
            caller,
            old_status,
            false,
            new_status,
            reason.clone(),
            fulfilled_delta_ml,
            released_reservation,
        );
        storage::set_request(env, request);
        if matches!(
            new_status,
            RequestStatus::Rejected | RequestStatus::Fulfilled
        ) {
            storage::remove_from_hospital_requests(env, &request.hospital_id, request_id);
        }

        events::emit_request_status_updated(
            env,
            request_id,
            caller,
            old_status,
            new_status,
            env.ledger().timestamp(),
        );

        Ok(())
    }

    /// Configure the coordinator contract trusted to drive the request
    /// lifecycle via `update_status_by_contract`. Admin only; may be
    /// called again to rotate.
    pub fn set_coordinator_contract(
        env: Env,
        coordinator_contract: Address,
    ) -> Result<(), ContractError> {
        storage::require_initialized(&env)?;
        storage::get_admin(&env).require_auth();
        storage::set_coordinator_contract(&env, &coordinator_contract);
        events::emit_coordinator_contract_set(&env, &coordinator_contract);
        Ok(())
    }

    pub fn get_coordinator_contract(env: Env) -> Result<Option<Address>, ContractError> {
        storage::require_initialized(&env)?;
        Ok(storage::get_coordinator_contract(&env))
    }

    /// Move a request through its lifecycle on behalf of the trusted
    /// coordinator contract, which drives the allocate → deliver → settle
    /// workflow:
    ///   * allocation:  `Pending → Approved`
    ///   * delivery:    `Approved → InProgress`
    ///   * settlement:  `Approved | InProgress → Fulfilled`
    ///   * rollback / expiry: `Pending | Approved → Cancelled`
    ///
    /// Mirrors `cancel_request_by_contract`: `caller_contract` must authorize
    /// the call (automatic for the direct invoking contract) and must equal
    /// the coordinator configured via `set_coordinator_contract`. Transitions
    /// follow the same state machine as `update_request_status`.
    pub fn update_status_by_contract(
        env: Env,
        caller_contract: Address,
        request_id: u64,
        new_status: RequestStatus,
        reason: String,
    ) -> Result<(), ContractError> {
        storage::require_initialized(&env)?;
        storage::require_not_paused(&env)?;
        caller_contract.require_auth();

        match storage::get_coordinator_contract(&env) {
            Some(ref trusted) if *trusted == caller_contract => {}
            Some(_) => return Err(ContractError::Unauthorized),
            None => return Err(ContractError::CoordinatorContractNotSet),
        }

        let mut request =
            storage::get_request(&env, request_id).ok_or(ContractError::RequestNotFound)?;

        match new_status {
            RequestStatus::Approved | RequestStatus::InProgress | RequestStatus::Fulfilled => {
                Self::apply_status_transition(
                    &env,
                    &mut request,
                    &caller_contract,
                    new_status,
                    reason,
                )
            }
            RequestStatus::Cancelled => {
                Self::ensure_non_empty_reason(&reason)?;
                Self::cancel_internal(&env, &mut request, &caller_contract, reason)
            }
            RequestStatus::Pending | RequestStatus::Rejected => {
                Err(ContractError::InvalidRequestStatus)
            }
        }
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
        storage::require_not_paused(&env)?;
        Self::ensure_non_empty_reason(&reason)?;
        validation::validate_quantity(fulfilled_delta_ml)?;

        let admin = storage::get_admin(&env);
        if caller != admin {
            return Err(ContractError::Unauthorized);
        }

        let mut request =
            storage::get_request(&env, request_id).ok_or(ContractError::RequestNotFound)?;
        if request.status != RequestStatus::Approved && request.status != RequestStatus::InProgress
        {
            return Err(ContractError::InvalidRequestStatus);
        }

        let remaining = request
            .quantity_ml
            .saturating_sub(request.fulfilled_quantity_ml);
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
        if new_status == RequestStatus::Fulfilled {
            storage::remove_from_hospital_requests(&env, &request.hospital_id, request_id);
        }

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

    /// Set the inventory reservation ID for a request. Admin only.
    /// Called when units are reserved against a request so cancellation can release them.
    /// Rejects overwrite of an existing reservation (which would orphan inventory units)
    /// and only accepts requests in Approved or InProgress status.
    pub fn set_reservation_id(
        env: Env,
        caller: Address,
        request_id: u64,
        reservation_id: u64,
    ) -> Result<(), ContractError> {
        caller.require_auth();
        storage::require_initialized(&env)?;
        storage::require_not_paused(&env)?;

        let admin = storage::get_admin(&env);
        if caller != admin {
            return Err(ContractError::Unauthorized);
        }

        let mut request =
            storage::get_request(&env, request_id).ok_or(ContractError::RequestNotFound)?;

        match request.status {
            RequestStatus::Approved | RequestStatus::InProgress => {}
            _ => return Err(ContractError::InvalidRequestStatus),
        }

        if request.reservation_id.is_some() {
            return Err(ContractError::ReservationAlreadySet);
        }

        // #1809: the reservation must exist, be for this request, and (once a
        // fulfilling org is recorded) belong to that org.
        let reservation = Self::fetch_reservation(&env, reservation_id)?;
        if reservation.request_id != request_id {
            return Err(ContractError::ReservationRequestMismatch);
        }
        if let Some(ref org) = request.fulfilled_by {
            if reservation.requester != *org {
                return Err(ContractError::ReservationOwnerMismatch);
            }
        }

        request.reservation_id = Some(reservation_id);
        let status = request.status;
        Self::append_history(
            &env,
            &mut request,
            &caller,
            status,
            false,
            status,
            String::from_str(&env, "Reservation ID set"),
            0,
            false,
        );
        storage::set_request(&env, &request);

        events::emit_reservation_id_set(
            &env,
            request_id,
            &caller,
            reservation_id,
            env.ledger().timestamp(),
        );

        Ok(())
    }

    /// Record which organization (blood bank) fulfilled a request.
    /// Authorized blood banks can set themselves as the fulfilling org; admin can set any org.
    pub fn set_fulfilling_org(
        env: Env,
        caller: Address,
        request_id: u64,
        org_id: Address,
    ) -> Result<(), ContractError> {
        caller.require_auth();
        storage::require_initialized(&env)?;
        storage::require_not_paused(&env)?;

        let admin = storage::get_admin(&env);
        let is_admin = caller == admin;
        let is_authorized_blood_bank = storage::is_blood_bank_authorized(&env, &caller);

        if !is_admin && !is_authorized_blood_bank {
            return Err(ContractError::NotAuthorizedBloodBank);
        }

        // Blood banks may only set themselves; admin can set any org
        if !is_admin && caller != org_id {
            return Err(ContractError::NotAuthorizedBloodBank);
        }

        let mut request =
            storage::get_request(&env, request_id).ok_or(ContractError::RequestNotFound)?;

        match request.status {
            RequestStatus::Approved | RequestStatus::InProgress => {}
            _ => return Err(ContractError::InvalidRequestStatus),
        }

        if request.fulfilled_by.is_some() {
            return Err(ContractError::FulfillingOrgAlreadySet);
        }

        // #1808: a blood bank may only claim a request whose inventory
        // reservation it owns, so a competing bank cannot front-run it.
        if !is_admin {
            let reservation_id = request
                .reservation_id
                .ok_or(ContractError::ReservationRequired)?;
            let reservation = Self::fetch_reservation(&env, reservation_id)?;
            if reservation.requester != org_id {
                return Err(ContractError::ReservationOwnerMismatch);
            }
        }

        request.fulfilled_by = Some(org_id.clone());
        let status = request.status;
        Self::append_history(
            &env,
            &mut request,
            &caller,
            status,
            false,
            status,
            String::from_str(&env, "Fulfilling org set"),
            0,
            false,
        );
        storage::set_request(&env, &request);

        events::emit_fulfilling_org_set(
            &env,
            request_id,
            &caller,
            &org_id,
            env.ledger().timestamp(),
        );

        Ok(())
    }

    /// Admin correction of `fulfilled_by` (#1808). Overwrites any existing
    /// value; the reason and the change are recorded in the request history.
    pub fn reassign_fulfilling_org(
        env: Env,
        request_id: u64,
        org_id: Address,
        reason: String,
    ) -> Result<(), ContractError> {
        storage::require_initialized(&env)?;
        storage::require_not_paused(&env)?;
        let admin = storage::get_admin(&env);
        admin.require_auth();
        Self::ensure_non_empty_reason(&reason)?;

        let mut request =
            storage::get_request(&env, request_id).ok_or(ContractError::RequestNotFound)?;

        match request.status {
            RequestStatus::Approved | RequestStatus::InProgress | RequestStatus::Fulfilled => {}
            _ => return Err(ContractError::InvalidRequestStatus),
        }

        request.fulfilled_by = Some(org_id.clone());
        let status = request.status;
        Self::append_history(
            &env, &mut request, &admin, status, false, status, reason, 0, false,
        );
        storage::set_request(&env, &request);

        events::emit_fulfilling_org_set(
            &env,
            request_id,
            &admin,
            &org_id,
            env.ledger().timestamp(),
        );
        Ok(())
    }

    /// Full history for a request, assembled from its persistent pages.
    /// Prefer `get_request_history_page` for long histories.
    pub fn get_request_history(
        env: Env,
        request_id: u64,
    ) -> Result<soroban_sdk::Vec<RequestHistoryEntry>, ContractError> {
        storage::require_initialized(&env)?;
        let request =
            storage::get_request(&env, request_id).ok_or(ContractError::RequestNotFound)?;
        let mut all = soroban_sdk::Vec::new(&env);
        let pages = request.history_len.div_ceil(storage::HISTORY_PAGE_SIZE);
        for page in 0..pages {
            all.append(&storage::get_history_page(&env, request_id, page));
        }
        Ok(all)
    }

    /// One page (zero-indexed, `HISTORY_PAGE_SIZE` entries) of a request's
    /// history. Returns an empty Vec past the last page.
    pub fn get_request_history_page(
        env: Env,
        request_id: u64,
        page: u32,
    ) -> Result<soroban_sdk::Vec<RequestHistoryEntry>, ContractError> {
        storage::require_initialized(&env)?;
        if storage::get_request(&env, request_id).is_none() {
            return Err(ContractError::RequestNotFound);
        }
        Ok(storage::get_history_page(&env, request_id, page))
    }

    pub fn get_request(env: Env, request_id: u64) -> Result<BloodRequest, ContractError> {
        storage::require_initialized(&env)?;
        storage::get_request(&env, request_id).ok_or(ContractError::RequestNotFound)
    }

    /// Returns the rider assigned to `request_id` via `assign_rider`, if any.
    /// Used by the identity contract to authorize delivery proofs.
    pub fn get_request_rider(env: Env, request_id: u64) -> Option<Address> {
        storage::get_request_rider(&env, request_id)
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

    /// Returns a paginated slice of a hospital's **open** blood requests
    /// (Pending, Approved or InProgress).
    ///
    /// Requests are removed from this index when they reach a terminal state
    /// (Fulfilled, Cancelled — including expiry — or Rejected). Use
    /// `get_hospital_request_history` to list every request a hospital has
    /// ever created.
    ///
    /// `page` is zero-indexed; `page_size` is capped at 50 to bound instruction usage.
    /// Uses a per-hospital index for O(hospital_open_request_count) complexity
    /// instead of O(system_counter).
    pub fn get_requests_by_hospital(
        env: Env,
        hospital_id: Address,
        page: u32,
        page_size: u32,
    ) -> Result<soroban_sdk::Vec<BloodRequest>, ContractError> {
        storage::require_initialized(&env)?;
        let page_size = page_size.min(50);
        let request_ids = storage::get_hospital_request_ids(&env, &hospital_id);
        let total = request_ids.len();
        let start = page.saturating_mul(page_size).min(total);
        let end = start.saturating_add(page_size).min(total);

        let mut results: soroban_sdk::Vec<BloodRequest> = soroban_sdk::Vec::new(&env);
        for i in start..end {
            let id = request_ids.get(i).unwrap();
            if let Some(req) = storage::get_request(&env, id) {
                results.push_back(req);
            }
        }
        Ok(results)
    }

    /// Returns a paginated slice of **every** request a hospital has created,
    /// in creation order, regardless of status (open, fulfilled, cancelled,
    /// expired or rejected).
    ///
    /// Backed by an append-only index stored one entry per request, so a page
    /// reads only `page_size` entries. `page` is zero-indexed; `page_size` is
    /// capped at 50. Requests created before this index existed are not
    /// included.
    pub fn get_hospital_request_history(
        env: Env,
        hospital_id: Address,
        page: u32,
        page_size: u32,
    ) -> Result<soroban_sdk::Vec<BloodRequest>, ContractError> {
        storage::require_initialized(&env)?;
        let page_size = page_size.min(50);
        let total = storage::get_hospital_history_count(&env, &hospital_id);
        let start = page.saturating_mul(page_size).min(total);
        let end = start.saturating_add(page_size).min(total);

        let mut results: soroban_sdk::Vec<BloodRequest> = soroban_sdk::Vec::new(&env);
        for i in start..end {
            if let Some(id) = storage::get_hospital_history_entry(&env, &hospital_id, i) {
                if let Some(req) = storage::get_request(&env, id) {
                    results.push_back(req);
                }
            }
        }
        Ok(results)
    }

    /// Total number of requests a hospital has created (size of the history
    /// index), for paginating `get_hospital_request_history`.
    pub fn get_hospital_request_count(
        env: Env,
        hospital_id: Address,
    ) -> Result<u32, ContractError> {
        storage::require_initialized(&env)?;
        Ok(storage::get_hospital_history_count(&env, &hospital_id))
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

    /// Upgrade the contract to a new WASM hash. Only admin can call this.
    ///
    /// # Arguments
    /// * `admin` - Admin address that must authorize the upgrade
    /// * `new_wasm_hash` - Hash of the new WASM code to upgrade to
    ///
    /// # Errors
    /// * `Unauthorized` - If caller is not the admin
    pub fn upgrade(
        env: Env,
        admin: Address,
        new_wasm_hash: soroban_sdk::BytesN<32>,
    ) -> Result<(), ContractError> {
        admin.require_auth();
        storage::require_initialized(&env)?;
        let stored_admin = storage::get_admin(&env);
        if admin != stored_admin {
            return Err(ContractError::Unauthorized);
        }
        env.deployer().update_current_contract_wasm(new_wasm_hash);
        Ok(())
    }
}

#[cfg(test)]
mod test_security_fixes;

#[cfg(test)]
mod test_lifecycle_fixes;
