#![no_std]

/// Cross-contract coordinator for the HealthDonor workflow.
///
/// Canonical workflow sequence enforced here:
///   1. allocate_units  – Request must be Pending; reserves inventory units
///   2. confirm_delivery – Workflow must be Allocated; marks units Delivered
///   3. settle_payment   – Workflow must be Delivered; releases escrowed payment
///
/// Any step that finds the prerequisite state missing returns an error and makes
/// no state changes, providing safe rollback semantics within a single transaction.
mod error;
mod types;

#[cfg(test)]
mod test;

pub use error::CoordinatorError;
pub use types::{DataKey, ExcursionSummary, WorkflowRecord, WorkflowStatus};

use soroban_sdk::{contract, contractimpl, contracttype, symbol_short, Address, Env, String, Vec};

// ── Minimal interface types mirroring the domain contracts ────────────────────
// These allow the coordinator to inspect cross-contract return values without
// importing compiled WASMs. The domain contracts must keep these in sync.

#[contracttype]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum RequestStatus {
    Pending,
    Approved,
    Fulfilled,
    Cancelled,
}

#[contracttype]
#[derive(Clone, Debug)]
pub struct BloodRequest {
    pub id: u64,
    pub status: RequestStatus,
}

#[contracttype]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum BloodStatus {
    Available,
    Reserved,
    InTransit,
    Delivered,
    Expired,
    Compromised,
    Disposed,
}

#[contracttype]
#[derive(Clone, Debug)]
pub struct BloodUnit {
    pub id: u64,
    pub status: BloodStatus,
}

#[contracttype]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum PaymentStatus {
    Pending,
    Locked,
    Released,
    Refunded,
    Disputed,
    Cancelled,
}

#[contracttype]
#[derive(Clone, Debug)]
pub struct Payment {
    pub id: u64,
    pub request_id: u64,
    pub status: PaymentStatus,
}

// ── Cross-contract client traits ──────────────────────────────────────────────

mod request_client {
    use super::BloodRequest;
    use soroban_sdk::{contractclient, Address, Env};

    #[contractclient(name = "RequestContractClient")]
    pub trait RequestContractInterface {
        fn get_request(env: Env, request_id: u64) -> BloodRequest;
    }
}

mod inventory_client {
    use super::{BloodStatus, BloodUnit};
    use soroban_sdk::{contractclient, Address, Env, String};

    #[contractclient(name = "InventoryContractClient")]
    pub trait InventoryContractInterface {
        fn get_blood_unit(env: Env, blood_unit_id: u64) -> BloodUnit;
        fn update_status(
            env: Env,
            unit_id: u64,
            new_status: BloodStatus,
            authorized_by: Address,
            reason: Option<String>,
        ) -> BloodUnit;
        fn mark_delivered(
            env: Env,
            unit_id: u64,
            authorized_by: Address,
            delivery_location: String,
        ) -> BloodUnit;
        fn get_admin(env: Env) -> Address;
    }
}

mod payment_client {
    use super::{Payment, PaymentStatus};
    use soroban_sdk::{contractclient, contracttype, Env, String};

    #[contracttype]
    #[derive(Clone, Copy, Debug, Eq, PartialEq)]
    pub enum DisputeReason {
        FailedDelivery,
        TemperatureExcursion,
        PaymentContested,
        WrongItem,
        DamagedGoods,
        LateDelivery,
        Other,
    }

    #[contractclient(name = "PaymentContractClient")]
    pub trait PaymentContractInterface {
        fn get_payment(env: Env, payment_id: u64) -> Payment;
        fn update_status(env: Env, payment_id: u64, status: PaymentStatus);
        fn record_dispute(env: Env, payment_id: u64, reason: DisputeReason, case_id: String);
    }
}

use inventory_client::InventoryContractClient;
use payment_client::PaymentContractClient;
use request_client::RequestContractClient;

// ── Storage helpers ────────────────────────────────────────────────────────────

fn get_admin(env: &Env) -> Address {
    env.storage().instance().get(&DataKey::Admin).unwrap()
}

fn load_workflow(env: &Env, request_id: u64) -> Option<WorkflowRecord> {
    env.storage()
        .persistent()
        .get(&DataKey::Workflow(request_id))
}

fn save_workflow(env: &Env, wf: &WorkflowRecord) {
    env.storage()
        .persistent()
        .set(&DataKey::Workflow(wf.request_id), wf);
}

// ── Contract ───────────────────────────────────────────────────────────────────

#[contract]
pub struct CoordinatorContract;

#[contractimpl]
impl CoordinatorContract {
    pub fn initialize(
        env: Env,
        admin: Address,
        request_contract: Address,
        inventory_contract: Address,
        payment_contract: Address,
    ) -> Result<(), CoordinatorError> {
        admin.require_auth();
        if env.storage().instance().has(&DataKey::Admin) {
            return Err(CoordinatorError::AlreadyInitialized);
        }
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage()
            .instance()
            .set(&DataKey::RequestContract, &request_contract);
        env.storage()
            .instance()
            .set(&DataKey::InventoryContract, &inventory_contract);
        env.storage()
            .instance()
            .set(&DataKey::PaymentContract, &payment_contract);
        env.events().publish(
            (
                symbol_short!("coord"),
                symbol_short!("init"),
                symbol_short!("v1"),
            ),
            admin,
        );
        Ok(())
    }

    /// Pause all state-mutating functions. Admin only.
    pub fn pause(env: Env, admin: Address) -> Result<(), CoordinatorError> {
        admin.require_auth();
        let stored: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(CoordinatorError::Unauthorized)?;
        if admin != stored {
            return Err(CoordinatorError::Unauthorized);
        }
        env.storage().instance().set(&DataKey::Paused, &true);
        Ok(())
    }

    /// Unpause the contract. Admin only.
    pub fn unpause(env: Env, admin: Address) -> Result<(), CoordinatorError> {
        admin.require_auth();
        let stored: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(CoordinatorError::Unauthorized)?;
        if admin != stored {
            return Err(CoordinatorError::Unauthorized);
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

    fn require_not_paused(env: &Env) -> Result<(), CoordinatorError> {
        if env
            .storage()
            .instance()
            .get(&DataKey::Paused)
            .unwrap_or(false)
        {
            return Err(CoordinatorError::ContractPaused);
        }
        Ok(())
    }

    /// Step 1 – Allocate inventory units to a pending request.
    pub fn allocate_units(
        env: Env,
        request_id: u64,
        unit_ids: Vec<u64>,
        payment_id: u64,
        caller: Address,
    ) -> Result<(), CoordinatorError> {
        caller.require_auth();
        Self::require_initialized(&env)?;
        Self::require_not_paused(&env)?;

        if let Some(wf) = load_workflow(&env, request_id) {
            if wf.status != WorkflowStatus::Pending {
                return Err(CoordinatorError::WorkflowAlreadyStarted);
            }
        }

        // Verify request is Pending
        let req_addr: Address = env
            .storage()
            .instance()
            .get(&DataKey::RequestContract)
            .unwrap();
        let req_client = RequestContractClient::new(&env, &req_addr);
        let request = req_client
            .try_get_request(&request_id)
            .map_err(|_| CoordinatorError::RequestNotFound)?
            .map_err(|_| CoordinatorError::RequestNotFound)?;

        if request.status != RequestStatus::Pending {
            return Err(CoordinatorError::InvalidRequestState);
        }

        // Reserve each inventory unit
        let inv_addr: Address = env
            .storage()
            .instance()
            .get(&DataKey::InventoryContract)
            .unwrap();
        let inv_client = InventoryContractClient::new(&env, &inv_addr);
        let inv_admin = inv_client.get_admin();

        for i in 0..unit_ids.len() {
            let uid = unit_ids.get(i).unwrap();
            let unit = inv_client
                .try_get_blood_unit(&uid)
                .map_err(|_| CoordinatorError::UnitNotFound)?
                .map_err(|_| CoordinatorError::UnitNotFound)?;

            if unit.status != BloodStatus::Available {
                return Err(CoordinatorError::UnitNotAvailable);
            }

            inv_client
                .try_update_status(&uid, &BloodStatus::Reserved, &inv_admin, &None)
                .map_err(|_| CoordinatorError::InventoryUpdateFailed)?
                .map_err(|_| CoordinatorError::InventoryUpdateFailed)?;
        }

        env.events().publish(
            (
                symbol_short!("coord"),
                symbol_short!("alloc"),
                symbol_short!("v1"),
            ),
            (request_id, unit_ids.len()),
        );

        save_workflow(
            &env,
            &WorkflowRecord {
                request_id,
                payment_id,
                unit_ids,
                status: WorkflowStatus::Allocated,
                delivery_confirmed: false,
            },
        );

        Ok(())
    }

    /// Step 2 – Confirm delivery: mark all reserved units as Delivered.
    pub fn confirm_delivery(
        env: Env,
        request_id: u64,
        caller: Address,
    ) -> Result<(), CoordinatorError> {
        caller.require_auth();
        Self::require_initialized(&env)?;
        Self::require_not_paused(&env)?;

        let mut wf = load_workflow(&env, request_id).ok_or(CoordinatorError::WorkflowNotFound)?;

        if wf.status != WorkflowStatus::Allocated {
            return Err(CoordinatorError::InvalidWorkflowState);
        }

        let inv_addr: Address = env
            .storage()
            .instance()
            .get(&DataKey::InventoryContract)
            .unwrap();
        let inv_client = InventoryContractClient::new(&env, &inv_addr);
        let inv_admin = inv_client.get_admin();
        let location = soroban_sdk::String::from_str(&env, "delivered");

        for i in 0..wf.unit_ids.len() {
            let uid = wf.unit_ids.get(i).unwrap();
            // Inventory enforces Reserved → InTransit → Delivered; coordinator must not skip InTransit.
            inv_client
                .try_update_status(&uid, &BloodStatus::InTransit, &inv_admin, &None)
                .map_err(|_| CoordinatorError::InventoryUpdateFailed)?
                .map_err(|_| CoordinatorError::InventoryUpdateFailed)?;
            inv_client
                .try_mark_delivered(&uid, &inv_admin, &location)
                .map_err(|_| CoordinatorError::InventoryUpdateFailed)?
                .map_err(|_| CoordinatorError::InventoryUpdateFailed)?;
        }

        wf.status = WorkflowStatus::Delivered;
        wf.delivery_confirmed = true;
        save_workflow(&env, &wf);

        env.events().publish(
            (
                symbol_short!("coord"),
                symbol_short!("dlvrd"),
                symbol_short!("v1"),
            ),
            request_id,
        );

        Ok(())
    }

    /// Step 3 – Settle payment. Blocked if delivery not confirmed.
    pub fn settle_payment(
        env: Env,
        request_id: u64,
        caller: Address,
    ) -> Result<(), CoordinatorError> {
        caller.require_auth();
        Self::require_initialized(&env)?;
        Self::require_not_paused(&env)?;

        let mut wf = load_workflow(&env, request_id).ok_or(CoordinatorError::WorkflowNotFound)?;

        if !wf.delivery_confirmed || wf.status != WorkflowStatus::Delivered {
            return Err(CoordinatorError::DeliveryNotConfirmed);
        }

        let pay_addr: Address = env
            .storage()
            .instance()
            .get(&DataKey::PaymentContract)
            .unwrap();
        let pay_client = PaymentContractClient::new(&env, &pay_addr);

        let payment = pay_client
            .try_get_payment(&wf.payment_id)
            .map_err(|_| CoordinatorError::PaymentNotFound)?
            .map_err(|_| CoordinatorError::PaymentNotFound)?;

        if payment.status != PaymentStatus::Locked {
            return Err(CoordinatorError::InvalidPaymentState);
        }

        pay_client
            .try_update_status(&wf.payment_id, &PaymentStatus::Released)
            .map_err(|_| CoordinatorError::PaymentUpdateFailed)?
            .map_err(|_| CoordinatorError::PaymentUpdateFailed)?;

        wf.status = WorkflowStatus::Settled;
        save_workflow(&env, &wf);

        env.events().publish(
            (
                symbol_short!("coord"),
                symbol_short!("settld"),
                symbol_short!("v1"),
            ),
            (request_id, wf.payment_id),
        );

        Ok(())
    }

    /// Rollback – admin only. Releases units and refunds payment.
    pub fn rollback(env: Env, request_id: u64) -> Result<(), CoordinatorError> {
        get_admin(&env).require_auth();
        Self::require_initialized(&env)?;
        Self::require_not_paused(&env)?;

        let mut wf = load_workflow(&env, request_id).ok_or(CoordinatorError::WorkflowNotFound)?;

        if wf.status == WorkflowStatus::Settled {
            return Err(CoordinatorError::CannotRollbackSettled);
        }

        let inv_addr: Address = env
            .storage()
            .instance()
            .get(&DataKey::InventoryContract)
            .unwrap();
        let inv_client = InventoryContractClient::new(&env, &inv_addr);
        let inv_admin = inv_client.get_admin();

        for i in 0..wf.unit_ids.len() {
            let uid = wf.unit_ids.get(i).unwrap();
            let _ = inv_client.try_update_status(&uid, &BloodStatus::Available, &inv_admin, &None);
        }

        let pay_addr: Address = env
            .storage()
            .instance()
            .get(&DataKey::PaymentContract)
            .unwrap();
        let pay_client = PaymentContractClient::new(&env, &pay_addr);
        if let Ok(Ok(payment)) = pay_client.try_get_payment(&wf.payment_id) {
            if payment.status == PaymentStatus::Locked {
                let _ = pay_client.try_update_status(&wf.payment_id, &PaymentStatus::Refunded);
            }
        }

        wf.status = WorkflowStatus::RolledBack;
        save_workflow(&env, &wf);

        env.events().publish(
            (
                symbol_short!("coord"),
                symbol_short!("rollbk"),
                symbol_short!("v1"),
            ),
            request_id,
        );

        Ok(())
    }

    pub fn get_workflow(env: Env, request_id: u64) -> Result<WorkflowRecord, CoordinatorError> {
        load_workflow(&env, request_id).ok_or(CoordinatorError::WorkflowNotFound)
    }

    /// Flag a temperature breach: transitions the linked payment from Locked → Disputed.
    ///
    /// Called by the temperature contract when a sustained excursion is detected.
    ///
    /// # Errors
    /// - `PaymentNotFound`     - No payment with this ID
    /// - `InvalidPaymentState` - Payment is not in Locked status
    /// - `PaymentFlagFailed`   - Cross-contract call to payments failed
    pub fn flag_temperature_breach(
        env: Env,
        caller: Address,
        payment_id: u64,
        excursion_summary: ExcursionSummary,
    ) -> Result<(), CoordinatorError> {
        caller.require_auth();
        Self::require_initialized(&env)?;
        Self::require_not_paused(&env)?;

        let pay_addr: Address = env
            .storage()
            .instance()
            .get(&DataKey::PaymentContract)
            .unwrap();
        let pay_client = PaymentContractClient::new(&env, &pay_addr);

        let payment = pay_client
            .try_get_payment(&payment_id)
            .map_err(|_| CoordinatorError::PaymentNotFound)?
            .map_err(|_| CoordinatorError::PaymentNotFound)?;

        if payment.status != PaymentStatus::Locked {
            return Err(CoordinatorError::InvalidPaymentState);
        }

        let case_id = String::from_str(&env, "TEMP-EXCURSION");

        pay_client
            .try_record_dispute(
                &payment_id,
                &payment_client::DisputeReason::TemperatureExcursion,
                &case_id,
            )
            .map_err(|_| CoordinatorError::PaymentFlagFailed)?
            .map_err(|_| CoordinatorError::PaymentFlagFailed)?;

        let now = env.ledger().timestamp();
        env.events().publish(
            (symbol_short!("coord"), symbol_short!("tmp_brch")),
            (payment_id, excursion_summary.unit_id, now),
        );

        Ok(())
    }

    pub fn is_initialized(env: Env) -> bool {
        env.storage().instance().has(&DataKey::Admin)
    }

    fn require_initialized(env: &Env) -> Result<(), CoordinatorError> {
        if !env.storage().instance().has(&DataKey::Admin) {
            return Err(CoordinatorError::NotInitialized);
        }
        Ok(())
    }
}
