#![no_std]

mod error;
mod events;
mod storage;
mod types;
mod validation;

use crate::error::ContractError;
use crate::types::{is_valid_transition, BloodStatus, BloodType, BloodUnit, DataKey, Reservation};

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

        // Authorize admin as the first blood bank
        storage::set_authorized_bank(&env, &admin, true);

        Ok(())
    }

    /// Pause the contract. Only the admin can call this.
    /// All state-mutating functions will return `ContractPaused` while paused.
    pub fn pause(env: Env, admin: Address) -> Result<(), ContractError> {
        admin.require_auth();
        let stored_admin = storage::get_admin(&env);
        if admin != stored_admin {
            return Err(ContractError::Unauthorized);
        }
        env.storage().instance().set(&DataKey::Paused, &true);
        Ok(())
    }

    /// Unpause the contract. Only the admin can call this.
    pub fn unpause(env: Env, admin: Address) -> Result<(), ContractError> {
        admin.require_auth();
        let stored_admin = storage::get_admin(&env);
        if admin != stored_admin {
            return Err(ContractError::Unauthorized);
        }
        env.storage().instance().set(&DataKey::Paused, &false);
        Ok(())
    }

    /// Returns whether the contract is currently paused.
    pub fn is_paused(env: Env) -> bool {
        env.storage()
            .instance()
            .get(&DataKey::Paused)
            .unwrap_or(false)
    }

    /// Authorize or revoke a blood bank. Only admin can call this.
    pub fn authorize_bank(env: Env, admin: Address, bank: Address, authorized: bool) -> Result<(), ContractError> {
        admin.require_auth();
        let stored_admin = storage::get_admin(&env);
        if admin != stored_admin {
            return Err(ContractError::Unauthorized);
        }
        storage::set_authorized_bank(&env, &bank, authorized);
        Ok(())
    }

    /// Check if a bank is authorized
    pub fn is_authorized_bank(env: Env, bank: Address) -> bool {
        storage::is_authorized_bank(&env, &bank)
    }

    fn require_not_paused(env: &Env) -> Result<(), ContractError> {
        if env
            .storage()
            .instance()
            .get(&DataKey::Paused)
            .unwrap_or(false)
        {
            return Err(ContractError::ContractPaused);
        }
        Ok(())
    }

    /// Register a new blood donation into the inventory
    ///
    /// Both `donation_timestamp` (collected_at) and `expiration_timestamp` (expiry_at)
    /// are derived exclusively from the ledger close time (`env.ledger().timestamp()`).
    /// This ensures that expiration checks — which also use ledger time — are always
    /// consistent with the stored timestamps. Caller-supplied timestamps were removed
    /// to eliminate the mismatch described in issue #98.
    ///
    /// # Arguments
    /// * `env` - Contract environment
    /// * `bank_id` - Blood bank's address (must be authorized)
    /// * `blood_type` - Type of blood (A+, A-, B+, B-, AB+, AB-, O+, O-)
    /// * `quantity_ml` - Quantity in milliliters (100-600ml)
    /// * `donor_id` - Optional donor address (None for anonymous)
    ///
    /// # Returns
    /// Unique ID of the registered blood unit
    ///
    /// # Errors
    /// - `NotInitialized`: Contract not initialized
    /// - `NotAuthorizedBloodBank`: Bank is not authorized
    /// - `InvalidQuantity`: Quantity outside acceptable range
    ///
    /// # Events
    /// Emits `BloodRegistered` event with all blood unit details
    pub fn register_blood(
        env: Env,
        bank_id: Address,
        blood_type: BloodType,
        quantity_ml: u32,
        donor_id: Option<Address>,
    ) -> Result<u64, ContractError> {
        // 1. Verify bank authentication
        bank_id.require_auth();

        Self::register_blood_after_auth(env, bank_id, blood_type, quantity_ml, donor_id)
    }

    fn register_blood_after_auth(
        env: Env,
        bank_id: Address,
        blood_type: BloodType,
        quantity_ml: u32,
        donor_id: Option<Address>,
    ) -> Result<u64, ContractError> {
        Self::require_not_paused(&env)?;

        // Check contract is initialized
        if !env.storage().instance().has(&DataKey::Admin) {
            return Err(ContractError::NotInitialized);
        }

        // Verify bank is authorized
        if !storage::is_authorized_bank(&env, &bank_id) {
            return Err(ContractError::NotAuthorizedBloodBank);
        }

        // Validate quantity
        validation::validate_quantity(quantity_ml)?;

        // Generate unique blood unit ID using atomic counter increment.
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

        // Compute timestamps from ledger time.
        // Using ledger time for both donation and expiration guarantees that
        // expiration checks (which compare against env.ledger().timestamp())
        // are always consistent with the stored values.
        let current_time = env.ledger().timestamp();
        let expiration_timestamp =
            current_time + (storage::BLOOD_SHELF_LIFE_DAYS * storage::SECONDS_PER_DAY);

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

        // Validate the complete blood unit
        blood_unit.validate(current_time)?;

        // Store blood unit — only reaches here if the ID slot was empty.
        storage::set_blood_unit(&env, &blood_unit);

        // Update indexes for efficient querying
        storage::add_to_blood_type_index(&env, &blood_unit);
        storage::add_to_bank_index(&env, &blood_unit);
        storage::add_to_status_index(&env, &blood_unit);
        storage::add_to_donor_index(&env, &blood_unit);

        // Emit event
        events::emit_blood_registered(
            &env,
            blood_unit_id,
            &bank_id,
            blood_type,
            quantity_ml,
            expiration_timestamp,
        );

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

        Self::require_not_paused(&env)?;

        let blood_unit =
            storage::get_blood_unit(&env, unit_id).ok_or(ContractError::NotFound)?;

        let admin = storage::get_admin(&env);
        if authorized_by != admin && authorized_by != blood_unit.bank_id {
            return Err(ContractError::Unauthorized);
        }

        let mut blood_unit = blood_unit;

        let current_time = env.ledger().timestamp();
        let old_status = blood_unit.status;

        // Block supply-chain use of calendar-expired units except for explicit
        // expiry/disposal transitions that the state machine already allows.
        if blood_unit.is_expired(current_time) {
            let allowed_past_shelf = matches!(
                (old_status, new_status),
                (BloodStatus::Available, BloodStatus::Expired)
                    | (BloodStatus::Reserved, BloodStatus::Expired)
                    | (BloodStatus::InTransit, BloodStatus::Expired)
                    | (BloodStatus::Expired, BloodStatus::Disposed)
                    | (BloodStatus::Compromised, BloodStatus::Disposed)
            );
            if !allowed_past_shelf {
                return Err(ContractError::BloodUnitExpired);
            }
        }

        // Validate the transition using the pure is_valid_transition function.
        // This covers terminal state checks (Delivered/Disposed cannot transition)
        // as well as all illegal backwards transitions.
        if !is_valid_transition(&old_status, &new_status) {
            // Emit an event with both statuses for debuggability before returning error
            events::emit_invalid_transition(&env, unit_id, old_status, new_status);
            return Err(ContractError::InvalidStatusTransition);
        }

        blood_unit.status = new_status;
        storage::set_blood_unit(&env, &blood_unit);

        // Keep status index consistent: remove from old bucket, add to new bucket.
        storage::remove_from_status_index(&env, unit_id, old_status);
        storage::add_to_status_index(&env, &blood_unit);

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

    /// Formally dispose of a blood unit.
    ///
    /// Only units in `Expired` or `Compromised` state may be disposed.
    /// This permanently ends the lifecycle — `Disposed` is a terminal state.
    ///
    /// # Arguments
    /// * `env`           - Contract environment
    /// * `unit_id`       - ID of the blood unit to dispose
    /// * `authorized_by` - Address performing the disposal (must be admin)
    /// * `reason`        - Optional reason / disposal notes
    ///
    /// # Errors
    /// - `NotFound`                - Blood unit with given ID doesn't exist
    /// - `Unauthorized`            - Caller is not the admin
    /// - `InvalidStatusTransition` - Unit is not in Expired or Compromised state
    pub fn dispose(
        env: Env,
        unit_id: u64,
        authorized_by: Address,
        reason: Option<String>,
    ) -> Result<BloodUnit, ContractError> {
        Self::update_status(env, unit_id, BloodStatus::Disposed, authorized_by, reason)
    }

    pub fn batch_update_status(
        env: Env,
        unit_ids: Vec<u64>,
        new_status: BloodStatus,
        authorized_by: Address,
        reason: Option<String>,
    ) -> Result<u64, ContractError> {
        authorized_by.require_auth();

        Self::require_not_paused(&env)?;

        let admin = storage::get_admin(&env);
        let current_time = env.ledger().timestamp();

        // 1. Validate all units first (atomicity)
        for i in 0..unit_ids.len() {
            let unit_id = unit_ids.get(i).ok_or(ContractError::NotFound)?;
            let blood_unit = storage::get_blood_unit(&env, unit_id).ok_or(ContractError::NotFound)?;

            if authorized_by != admin && authorized_by != blood_unit.bank_id {
                return Err(ContractError::Unauthorized);
            }

            if blood_unit.is_expired(current_time) {
                let allowed_past_shelf = matches!(
                    (blood_unit.status, new_status),
                    (BloodStatus::Available, BloodStatus::Expired)
                        | (BloodStatus::Reserved, BloodStatus::Expired)
                        | (BloodStatus::InTransit, BloodStatus::Expired)
                        | (BloodStatus::Expired, BloodStatus::Disposed)
                        | (BloodStatus::Compromised, BloodStatus::Disposed)
                );
                if !allowed_past_shelf {
                    return Err(ContractError::BloodUnitExpired);
                }
            }

            if !is_valid_transition(&blood_unit.status, &new_status) {
                return Err(ContractError::InvalidStatusTransition);
            }
        }

        // 2. All units valid, perform updates
        let mut updated_count = 0u64;
        for i in 0..unit_ids.len() {
            let unit_id = unit_ids.get(i).ok_or(ContractError::NotFound)?;
            let mut blood_unit = storage::get_blood_unit(&env, unit_id).unwrap();

            let old_status = blood_unit.status;
            blood_unit.status = new_status;
            storage::set_blood_unit(&env, &blood_unit);

            storage::remove_from_status_index(&env, unit_id, old_status);
            storage::add_to_status_index(&env, &blood_unit);

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

    /// Return a single page of status history. O(1) storage reads.
    pub fn get_status_history_page(
        env: Env,
        unit_id: u64,
        page: u32,
    ) -> Vec<crate::types::StatusChangeHistory> {
        storage::get_status_history_page(&env, unit_id, page)
    }

    /// Return the last page number for a unit's history (0-based).
    pub fn get_history_page_count(env: Env, unit_id: u64) -> u32 {
        storage::get_history_page_count(&env, unit_id)
    }

    pub fn get_status_change_count(env: Env, unit_id: u64) -> u64 {
        storage::get_blood_unit_status_change_count(&env, unit_id)
    }

    /// Register multiple blood units in a single transaction.
    /// Returns a Vec of the new blood unit IDs in input order.
    pub fn batch_register_blood(
        env: Env,
        bank_id: Address,
        entries: Vec<(BloodType, u32, Option<Address>)>,
    ) -> Result<Vec<u64>, ContractError> {
        bank_id.require_auth();
        Self::require_not_paused(&env)?;

        if !env.storage().instance().has(&DataKey::Admin) {
            return Err(ContractError::NotInitialized);
        }
        if !storage::is_authorized_bank(&env, &bank_id) {
            return Err(ContractError::NotAuthorizedBloodBank);
        }

        for i in 0..entries.len() {
            let (_, quantity_ml, _) = entries.get(i).unwrap();
            validation::validate_quantity(quantity_ml)?;
        }

        let mut ids: Vec<u64> = Vec::new(&env);
        for i in 0..entries.len() {
            let (blood_type, quantity_ml, donor_id) = entries.get(i).unwrap();
            let id = Self::register_blood_after_auth(
                env.clone(),
                bank_id.clone(),
                blood_type,
                quantity_ml,
                donor_id,
            )?;
            ids.push_back(id);
        }
        Ok(ids)
    }

    /// Reserve one or more blood units for a hospital requester.
    ///
    /// All units must be `Available` and not expired. On success every unit is
    /// moved to `Reserved` and a time-bounded `Reservation` record is stored in
    /// temporary storage (auto-purged by the ledger after `duration_seconds`).
    ///
    /// # Arguments
    /// * `requester`        - Hospital address (must be authorized blood bank)
    /// * `unit_ids`         - IDs of blood units to reserve
    /// * `request_id`       - Caller-supplied correlation ID
    /// * `duration_seconds` - How long the reservation is valid
    ///
    /// # Returns
    /// Unique reservation ID
    pub fn reserve_blood(
        env: Env,
        requester: Address,
        unit_ids: Vec<u64>,
        request_id: u64,
        duration_seconds: u64,
    ) -> Result<u64, ContractError> {
        requester.require_auth();

        Self::require_not_paused(&env)?;

        if !storage::is_authorized_bank(&env, &requester) {
            return Err(ContractError::NotAuthorizedBloodBank);
        }

        let current_time = env.ledger().timestamp();

        // Validate all units before making any changes (all-or-nothing)
        for i in 0..unit_ids.len() {
            let unit_id = unit_ids.get(i).ok_or(ContractError::NotFound)?;
            let unit = storage::get_blood_unit(&env, unit_id).ok_or(ContractError::NotFound)?;
            
            // Explicit ownership check: prove that every selected unit belongs to the blood bank performing the action.
            if unit.bank_id != requester {
                return Err(ContractError::NotUnitOwner);
            }

            if unit.status != BloodStatus::Available {
                return Err(ContractError::BloodUnitNotAvailable);
            }
            if unit.is_expired(current_time) {
                return Err(ContractError::BloodUnitExpired);
            }
        }

        let reservation_id = storage::increment_reservation_id(&env);
        let expiration = current_time + duration_seconds;

        let reservation = Reservation {
            unit_ids: unit_ids.clone(),
            requester: requester.clone(),
            created_timestamp: current_time,
            expiration_timestamp: expiration,
            request_id,
        };

        storage::set_reservation(&env, reservation_id, &reservation);

        // Update all unit statuses to Reserved
        for i in 0..unit_ids.len() {
            let unit_id = unit_ids.get(i).ok_or(ContractError::NotFound)?;
            let mut unit = storage::get_blood_unit(&env, unit_id).ok_or(ContractError::NotFound)?;
            let old_status = unit.status;
            unit.status = BloodStatus::Reserved;
            storage::set_blood_unit(&env, &unit);
            storage::remove_from_status_index(&env, unit_id, old_status);
            storage::add_to_status_index(&env, &unit);
        }

        events::emit_blood_reserved(&env, reservation_id, &requester, unit_ids.len());

        Ok(reservation_id)
    }

    /// Release a reservation, returning all units to `Available`.
    ///
    /// Can be called by anyone — the reservation record is the authority.
    /// If the reservation has already expired (ledger time > expiration_timestamp)
    /// the call still succeeds so callers can clean up stale reservations.
    ///
    /// Records a status history entry and emits a status-change event for every
    /// unit that transitions Reserved → Available, preserving the full audit trail.
    pub fn release_reservation(env: Env, reservation_id: u64) -> Result<(), ContractError> {
        Self::require_not_paused(&env)?;
        let reservation = storage::get_reservation(&env, reservation_id)
            .ok_or(ContractError::ReservationNotFound)?;

        for i in 0..reservation.unit_ids.len() {
            let unit_id = reservation.unit_ids.get(i).ok_or(ContractError::NotFound)?;
            if let Some(mut unit) = storage::get_blood_unit(&env, unit_id) {
                if unit.status == BloodStatus::Reserved {
                    unit.status = BloodStatus::Available;
                    storage::set_blood_unit(&env, &unit);
                    storage::remove_from_status_index(&env, unit_id, BloodStatus::Reserved);
                    storage::add_to_status_index(&env, &unit);
                    storage::record_status_change(
                        &env,
                        unit_id,
                        BloodStatus::Reserved,
                        BloodStatus::Available,
                        &reservation.requester,
                        None,
                    );
                    events::emit_status_change(
                        &env,
                        unit_id,
                        BloodStatus::Reserved,
                        BloodStatus::Available,
                        &reservation.requester,
                        None,
                    );
                }
            }
        }

        storage::remove_reservation(&env, reservation_id);
        events::emit_reservation_released(&env, reservation_id);

        Ok(())
    }

    /// Get a reservation by ID.
    pub fn get_reservation(env: Env, reservation_id: u64) -> Result<Reservation, ContractError> {
        storage::get_reservation(&env, reservation_id).ok_or(ContractError::ReservationNotFound)
    }

    /// Reserve multiple batches of blood units in a single transaction.
    ///
    /// Each element of `batch` is a `(unit_ids, request_id, duration_seconds)` tuple.
    /// Returns a `Vec<u64>` of reservation IDs in the same order as the input.
    pub fn batch_reserve_blood(
        env: Env,
        requester: Address,
        batch: Vec<(Vec<u64>, u64, u64)>,
    ) -> Result<Vec<u64>, ContractError> {
        requester.require_auth();

        Self::require_not_paused(&env)?;

        if !storage::is_authorized_bank(&env, &requester) {
            return Err(ContractError::NotAuthorizedBloodBank);
        }

        let mut reservation_ids: Vec<u64> = Vec::new(&env);

        for i in 0..batch.len() {
            let (unit_ids, request_id, duration_seconds) =
                batch.get(i).ok_or(ContractError::InvalidInput)?;

            let res_id = Self::reserve_blood(
                env.clone(),
                requester.clone(),
                unit_ids,
                request_id,
                duration_seconds,
            )?;
            reservation_ids.push_back(res_id);
        }

        Ok(reservation_ids)
    }
}

#[cfg(test)]
mod test;
