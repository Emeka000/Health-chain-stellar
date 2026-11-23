#![no_std]
#![deny(deprecated)]

/// Cross-contract coordinator for the HealthDonor workflow.
///
/// Canonical workflow sequence enforced here:
///   1. allocate_units  – Request must be Pending; reserves inventory units
///                        through `inventory.reserve_blood`, approves the request,
///                        records the reservation ID on it and binds the payment
///                        to the workflow
///   2. confirm_delivery – Workflow must be Allocated and no unit compromised;
///                        marks units Delivered
///   3. settle_payment   – Workflow must be Delivered; releases escrowed payment.
///                        If the hospital has not yet confirmed receipt the
///                        workflow moves to AwaitingReceipt, and
///                        `finalize_settlement` marks it Settled once the
///                        payment is Released.
///
/// Any step that finds the prerequisite state missing returns an error and makes
/// no state changes, providing safe rollback semantics within a single transaction.
///
/// Two independent circuit breakers guard the workflow:
///   * `pause()` – blocks every state-mutating entry point.
///   * `emergency_halt()` – sets a separate flag that blocks the workflow
///     entry points until `clear_emergency_halt()` is called. `unpause()` never
///     clears the halt flag and `clear_emergency_halt()` never clears the pause
///     flag, so an incident can only be acknowledged explicitly.
mod error;
mod types;

#[cfg(test)]
mod test;

pub use error::CoordinatorError;
pub use payment_client::DisputeReason;
pub use types::{DataKey, ExcursionSummary, WorkflowRecord, WorkflowStatus};

use soroban_sdk::{
    contract, contractevent, contractimpl, contracttype, Address, Env, Map, String, Symbol, Vec,
};

/// Default workflow expiry window: 6 hours expressed in seconds.
/// After `allocate_units` is called, if `confirm_delivery` is never invoked
/// within this window, anyone may call `expire_workflow` to roll back the
/// allocation and free the reserved units and escrowed payment.
const WORKFLOW_TIMEOUT_SECS: u64 = 6 * 60 * 60;

/// Window the hospital has to call `confirm_receipt` after `settle_payment`
/// recorded the coordinator's half of an escrow release (48 hours). Once it
/// elapses, anyone may call `expire_workflow` to refund the still-Locked escrow.
const RECEIPT_TIMEOUT_SECS: u64 = 48 * 60 * 60;

/// Inventory's `ContractError::ReservationNotFound` discriminant.
const INVENTORY_RESERVATION_NOT_FOUND: u32 = 150;

const CONTRACT_VERSION: u32 = 1;

// ── Minimal interface types mirroring the domain contracts ────────────────────
// These allow the coordinator to inspect cross-contract return values without
// importing compiled WASMs. Soroban's generated decoder unpacks the returned
// `ScMap` with `map_unpack_to_linear_memory`, which requires the map to contain
// *exactly* the declared keys — so every field of the real structs must be
// mirrored here, in the same order. The domain contracts must keep these in sync.

#[contracttype]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum BloodType {
    APositive,
    ANegative,
    BPositive,
    BNegative,
    ABPositive,
    ABNegative,
    OPositive,
    ONegative,
}

impl BloodType {
    pub fn can_donate_to(&self, recipient: &BloodType) -> bool {
        use BloodType::*;
        matches!(
            (self, recipient),
            (ONegative, _)
                | (OPositive, APositive | BPositive | ABPositive | OPositive)
                | (ANegative, APositive | ANegative | ABPositive | ABNegative)
                | (APositive, APositive | ABPositive)
                | (BNegative, BPositive | BNegative | ABPositive | ABNegative)
                | (BPositive, BPositive | ABPositive)
                | (ABNegative, ABPositive | ABNegative)
                | (ABPositive, ABPositive)
        )
    }
}

#[contracttype]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum BloodComponent {
    WholeBlood,
    RedCells,
    Plasma,
    Platelets,
    Cryoprecipitate,
}

#[contracttype]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum Urgency {
    Critical,
    Urgent,
    Routine,
    Scheduled,
}

#[contracttype]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum RequestStatus {
    Pending,
    Approved,
    InProgress,
    Fulfilled,
    Cancelled,
    Rejected,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct RequestHistoryEntry {
    pub previous_status: RequestStatus,
    pub is_initial_transition: bool,
    pub new_status: RequestStatus,
    pub actor: Address,
    pub reason: String,
    pub fulfilled_delta_ml: u32,
    pub released_reservation: bool,
    pub timestamp: u64,
}

/// Mirrors `requests::types::BloodRequest` (14 fields).
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct BloodRequest {
    pub id: u64,
    pub hospital_id: Address,
    /// Recipient blood type; every allocated unit must be able to donate to it.
    pub blood_type: BloodType,
    /// Requested component. Inventory units do not record a component, so it
    /// cannot be matched on-chain yet; it is mirrored to keep decoding exact.
    pub component: BloodComponent,
    /// Requested volume; allocated units must cover what is still outstanding.
    pub quantity_ml: u32,
    pub urgency: Urgency,
    pub created_timestamp: u64,
    pub required_by_timestamp: u64,
    pub status: RequestStatus,
    pub assigned_units: Vec<u64>,
    pub fulfilled_quantity_ml: u32,
    pub reservation_id: Option<u64>,
    pub fulfilled_by: Option<Address>,
    pub history_len: u32,
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

/// Mirrors `inventory::types::BloodUnit` (9 fields).
#[contracttype]
#[derive(Clone, Debug)]
pub struct BloodUnit {
    pub id: u64,
    pub blood_type: BloodType,
    pub quantity_ml: u32,
    pub bank_id: Address,
    pub donor_id: Option<Address>,
    pub donation_timestamp: u64,
    pub expiration_timestamp: u64,
    pub status: BloodStatus,
    pub metadata: Map<Symbol, String>,
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

/// Mirrors `payments::Payment` (12 fields).
#[contracttype]
#[derive(Clone, Debug)]
pub struct Payment {
    pub id: u64,
    pub request_id: u64,
    pub payer: Address,
    pub payee: Address,
    pub amount: i128,
    pub status: PaymentStatus,
    pub created_at: u64,
    pub updated_at: u64,
    pub dispute_reason_code: Option<u32>,
    pub dispute_case_id: Option<String>,
    pub dispute_resolved: bool,
    /// Token contract address — set only for escrow-backed payments, which
    /// must be settled through release_escrow / refund_escrow.
    pub token: Option<Address>,
}

// ── Cross-contract client traits ──────────────────────────────────────────────

mod request_client {
    use super::{BloodRequest, RequestStatus};
    use soroban_sdk::{contractclient, Address, Env, String};

    #[contractclient(name = "RequestContractClient")]
    #[allow(dead_code)]
    pub trait RequestContractInterface {
        fn get_request(env: Env, request_id: u64) -> BloodRequest;
        fn get_admin(env: Env) -> Address;
        fn update_request_status(
            env: Env,
            caller: Address,
            request_id: u64,
            new_status: RequestStatus,
            reason: String,
        );
        fn set_reservation_id(env: Env, caller: Address, request_id: u64, reservation_id: u64);
    }
}

mod inventory_client {
    use super::{BloodStatus, BloodUnit};
    use soroban_sdk::{contractclient, Address, Env, String, Vec};

    #[contractclient(name = "InventoryContractClient")]
    #[allow(dead_code)]
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
        fn reserve_blood(
            env: Env,
            requester: Address,
            hospital_id: Address,
            unit_ids: Vec<u64>,
            request_id: u64,
            duration_seconds: u64,
        ) -> u64;
        fn release_reservation(env: Env, caller: Address, reservation_id: u64);
        fn expire_reservation(env: Env, reservation_id: u64);
    }
}

mod temperature_client {
    use soroban_sdk::{contractclient, Env};

    #[contractclient(name = "TemperatureContractClient")]
    #[allow(dead_code)]
    pub trait TemperatureContractInterface {
        fn is_compromised(env: Env, unit_id: u64) -> bool;
    }
}

mod payment_client {
    use super::{Payment, PaymentStatus};
    use soroban_sdk::{contractclient, contracttype, Address, Env, String};

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
    #[allow(dead_code)]
    pub trait PaymentContractInterface {
        fn get_payment(env: Env, payment_id: u64) -> Payment;
        fn update_status(env: Env, payment_id: u64, status: PaymentStatus, caller: Address);
        fn release_escrow(env: Env, caller: Address, payment_id: u64);
        fn refund_escrow(env: Env, caller: Address, payment_id: u64);
        fn record_dispute(
            env: Env,
            payment_id: u64,
            reason: DisputeReason,
            case_id: String,
            caller: Address,
        );
    }
}

use inventory_client::InventoryContractClient;
use payment_client::PaymentContractClient;
use request_client::RequestContractClient;
use temperature_client::TemperatureContractClient;

// ── Contract events ───────────────────────────────────────────────────────────

#[contractevent(topics = ["coord", "init"], data_format = "single-value")]
pub struct CoordInitialized {
    pub admin: Address,
}

#[contractevent(topics = ["coord", "emrghlt"], data_format = "single-value")]
pub struct CoordEmergencyHalt {
    pub admin: Address,
}

#[contractevent(topics = ["coord", "alloc"], data_format = "vec")]
pub struct CoordAllocated {
    pub request_id: u64,
    pub unit_ids: Vec<u64>,
    pub unit_count: u32,
}

#[contractevent(topics = ["coord", "dlvrd"], data_format = "vec")]
pub struct CoordDelivered {
    pub request_id: u64,
    pub location: String,
}

#[contractevent(topics = ["coord", "settld"], data_format = "vec")]
pub struct CoordSettled {
    pub request_id: u64,
    pub payment_id: u64,
}

/// settle_payment recorded the coordinator's half of a two-party escrow
/// release; the funds stay Locked until the hospital calls `confirm_receipt`.
/// Distinct from `coord/settld`, which is only emitted once the payment is
/// actually Released.
#[contractevent(topics = ["coord", "awt_rcpt"], data_format = "vec")]
pub struct CoordAwaitingReceipt {
    pub request_id: u64,
    pub payment_id: u64,
}

#[contractevent(topics = ["coord", "rollbk"], data_format = "single-value")]
pub struct CoordRolledBack {
    pub request_id: u64,
}

#[contractevent(topics = ["coord", "expired"], data_format = "single-value")]
pub struct CoordExpired {
    pub request_id: u64,
}

#[contractevent(topics = ["coord", "tmp_brch"], data_format = "vec")]
pub struct CoordTemperatureBreach {
    pub payment_id: u64,
    pub unit_id: u64,
    pub timestamp: u64,
}

// ── Storage helpers ────────────────────────────────────────────────────────────

fn get_admin(env: &Env) -> Result<Address, CoordinatorError> {
    env.storage()
        .instance()
        .get(&DataKey::Admin)
        .ok_or(CoordinatorError::NotInitialized)
}

fn require_admin(env: &Env, caller: &Address) -> Result<(), CoordinatorError> {
    if *caller != get_admin(env)? {
        return Err(CoordinatorError::Unauthorized);
    }
    Ok(())
}

fn get_contract_address(env: &Env, key: &DataKey) -> Result<Address, CoordinatorError> {
    env.storage()
        .instance()
        .get(key)
        .ok_or(CoordinatorError::NotInitialized)
}

fn is_terminal(status: WorkflowStatus) -> bool {
    matches!(status, WorkflowStatus::Settled | WorkflowStatus::RolledBack)
}

fn is_paused(env: &Env) -> bool {
    env.storage()
        .instance()
        .get(&DataKey::Paused)
        .unwrap_or(false)
}

fn is_emergency_halted(env: &Env) -> bool {
    env.storage()
        .instance()
        .get(&DataKey::EmergencyHalt)
        .unwrap_or(false)
}

fn require_not_paused(env: &Env) -> Result<(), CoordinatorError> {
    if is_paused(env) {
        return Err(CoordinatorError::ContractPaused);
    }
    Ok(())
}

/// Emergency halt is tracked independently from `Paused`: `unpause()` must never
/// silently lift a halt, and clearing a halt must never silently unpause.
fn require_not_emergency_halted(env: &Env) -> Result<(), CoordinatorError> {
    if is_emergency_halted(env) {
        return Err(CoordinatorError::EmergencyHalted);
    }
    Ok(())
}

fn load_workflow(env: &Env, request_id: u64) -> Option<WorkflowRecord> {
    const WORKFLOW_TTL_LEDGERS: u32 = 535_680; // ~30 days at 5s/ledger
    let key = DataKey::Workflow(request_id);

    let workflow: Option<WorkflowRecord> = env.storage().persistent().get(&key);
    if let Some(wf) = &workflow {
        // Terminal workflows are archived with a fixed short TTL at write time
        // (see save_workflow) and must be allowed to lapse naturally — do not
        // keep extending TTL on every read or storage grows unbounded forever.
        if !is_terminal(wf.status) {
            env.storage()
                .persistent()
                .extend_ttl(&key, WORKFLOW_TTL_LEDGERS, WORKFLOW_TTL_LEDGERS);
        }
    }

    workflow
}

fn save_workflow(env: &Env, wf: &WorkflowRecord) {
    const WORKFLOW_TTL_LEDGERS: u32 = 535_680; // ~30 days at 5s/ledger
    // Terminal records get a short archival TTL instead of the long
    // auto-renewing one, so they lapse on their own instead of accumulating
    // as permanent persistent-storage entries.
    const TERMINAL_TTL_LEDGERS: u32 = 17_280; // ~1 day at 5s/ledger

    let key = DataKey::Workflow(wf.request_id);

    env.storage().persistent().set(&key, wf);

    let ttl = if is_terminal(wf.status) {
        TERMINAL_TTL_LEDGERS
    } else {
        WORKFLOW_TTL_LEDGERS
    };
    env.storage().persistent().extend_ttl(&key, ttl, ttl);
}

/// Release a payment to the payee on the coordinator's behalf.
///
/// The coordinator contract must be registered as the payments contract's
/// settlement coordinator (`payments.set_coordinator`). It must *not* be the
/// payments admin: the admin stays a human or governance key that keeps dispute
/// resolution, the token allowlist, timeouts and upgrades, while the
/// coordinator role is limited to settlement (`release_escrow`,
/// `refund_escrow`, `record_dispute`, and Locked → Released/Refunded for
/// bookkeeping payments). Escrow-backed payments cannot be released through
/// `update_status` (the payments contract returns `EscrowSettlementRequired`),
/// so they go through `release_escrow`, which records the coordinator's
/// confirmation and moves the tokens once the hospital has also called
/// `confirm_receipt`. Bookkeeping-only payments are marked Released directly.
fn release_payment(
    env: &Env,
    pay_client: &PaymentContractClient,
    payment: &Payment,
) -> Result<(), CoordinatorError> {
    let coordinator = env.current_contract_address();
    if payment.token.is_some() {
        pay_client
            .try_release_escrow(&coordinator, &payment.id)
            .map_err(|_| CoordinatorError::PaymentUpdateFailed)?
            .map_err(|_| CoordinatorError::PaymentUpdateFailed)?;
    } else {
        pay_client
            .try_update_status(&payment.id, &PaymentStatus::Released, &coordinator)
            .map_err(|_| CoordinatorError::PaymentUpdateFailed)?
            .map_err(|_| CoordinatorError::PaymentUpdateFailed)?;
    }
    Ok(())
}

/// Refund a payment to the payer on the coordinator's behalf. Escrow-backed
/// payments go through `refund_escrow` so the locked tokens are returned.
fn refund_payment(
    env: &Env,
    pay_client: &PaymentContractClient,
    payment: &Payment,
) -> Result<(), CoordinatorError> {
    let coordinator = env.current_contract_address();
    if payment.token.is_some() {
        pay_client
            .try_refund_escrow(&coordinator, &payment.id)
            .map_err(|_| CoordinatorError::PaymentUpdateFailed)?
            .map_err(|_| CoordinatorError::PaymentUpdateFailed)?;
    } else {
        pay_client
            .try_update_status(&payment.id, &PaymentStatus::Refunded, &coordinator)
            .map_err(|_| CoordinatorError::PaymentUpdateFailed)?
            .map_err(|_| CoordinatorError::PaymentUpdateFailed)?;
    }
    Ok(())
}

/// Refuse to proceed if the configured temperature contract reports any unit
/// as compromised. Skipped only while no temperature contract is configured
/// (see `set_temperature_contract`).
fn require_units_not_compromised(env: &Env, unit_ids: &Vec<u64>) -> Result<(), CoordinatorError> {
    let temp_addr: Option<Address> = env.storage().instance().get(&DataKey::TemperatureContract);
    if let Some(addr) = temp_addr {
        let temp_client = TemperatureContractClient::new(env, &addr);
        for i in 0..unit_ids.len() {
            let uid = unit_ids.get(i).unwrap();
            let compromised = temp_client
                .try_is_compromised(&uid)
                .map_err(|_| CoordinatorError::TemperatureCheckFailed)?
                .map_err(|_| CoordinatorError::TemperatureCheckFailed)?;
            if compromised {
                return Err(CoordinatorError::UnitCompromised);
            }
        }
    }
    Ok(())
}

/// Return an Allocated workflow's units to `Available`.
///
/// Workflows allocated through `inventory.reserve_blood` hold an inventory
/// reservation recorded on the request; releasing it frees every unit and
/// removes the reservation record. When `expiring` is set and the reservation
/// has reached its own expiry, the permissionless `expire_reservation` is used
/// instead. A reservation that is already gone has nothing left to release.
/// Workflows without a recorded reservation (allocated before reservations
/// were used, or whose request was cancelled and its reservation released)
/// fall back to per-unit status updates for units still Reserved.
fn release_allocated_units(
    env: &Env,
    wf: &WorkflowRecord,
    expiring: bool,
) -> Result<(), CoordinatorError> {
    let inv_addr: Address = get_contract_address(env, &DataKey::InventoryContract)?;
    let inv_client = InventoryContractClient::new(env, &inv_addr);

    let req_addr: Address = get_contract_address(env, &DataKey::RequestContract)?;
    let req_client = RequestContractClient::new(env, &req_addr);
    let reservation_id = req_client
        .try_get_request(&wf.request_id)
        .map_err(|_| CoordinatorError::RequestNotFound)?
        .map_err(|_| CoordinatorError::RequestNotFound)?
        .reservation_id;

    if let Some(res_id) = reservation_id {
        let result = if expiring {
            inv_client.try_expire_reservation(&res_id)
        } else {
            let inv_admin = inv_client.get_admin();
            inv_client.try_release_reservation(&inv_admin, &res_id)
        };
        let not_found = soroban_sdk::Error::from_contract_error(INVENTORY_RESERVATION_NOT_FOUND);
        match result {
            Ok(Ok(())) => {}
            Err(Ok(err)) if err == not_found => {}
            _ => return Err(CoordinatorError::InventoryUpdateFailed),
        }
        return Ok(());
    }

    let inv_admin = inv_client.get_admin();
    for i in 0..wf.unit_ids.len() {
        let uid = wf.unit_ids.get(i).unwrap();
        // Units already released elsewhere (e.g. the request was cancelled,
        // releasing its reservation) have nothing left to undo.
        let unit = inv_client
            .try_get_blood_unit(&uid)
            .map_err(|_| CoordinatorError::UnitNotFound)?
            .map_err(|_| CoordinatorError::UnitNotFound)?;
        if unit.status != BloodStatus::Reserved {
            continue;
        }
        inv_client
            .try_update_status(&uid, &BloodStatus::Available, &inv_admin, &None)
            .map_err(|_| CoordinatorError::InventoryUpdateFailed)?
            .map_err(|_| CoordinatorError::InventoryUpdateFailed)?;
    }
    Ok(())
}

/// Load the workflow's bound payment, checking it still belongs to the request.
fn load_bound_payment(
    pay_client: &PaymentContractClient,
    wf: &WorkflowRecord,
) -> Result<Payment, CoordinatorError> {
    let payment = pay_client
        .try_get_payment(&wf.payment_id)
        .map_err(|_| CoordinatorError::PaymentNotFound)?
        .map_err(|_| CoordinatorError::PaymentNotFound)?;
    if payment.request_id != wf.request_id {
        return Err(CoordinatorError::PaymentRequestMismatch);
    }
    Ok(payment)
}

/// Unwind an Allocated or AwaitingReceipt workflow: release the reserved units
/// (Allocated only — once delivered they are physically at the hospital) and
/// refund the payment if it is still Locked. An AwaitingReceipt workflow whose
/// payment has already been Released is settled, not unwound.
fn unwind_workflow(
    env: &Env,
    wf: &mut WorkflowRecord,
    expiring: bool,
) -> Result<(), CoordinatorError> {
    let pay_addr: Address = get_contract_address(env, &DataKey::PaymentContract)?;
    let pay_client = PaymentContractClient::new(env, &pay_addr);
    let payment = load_bound_payment(&pay_client, wf)?;

    match wf.status {
        WorkflowStatus::Allocated => release_allocated_units(env, wf, expiring)?,
        WorkflowStatus::AwaitingReceipt => {
            if payment.status == PaymentStatus::Released {
                return Err(CoordinatorError::CannotRollbackSettled);
            }
        }
        _ => return Err(CoordinatorError::InvalidWorkflowState),
    }

    if payment.status == PaymentStatus::Locked {
        refund_payment(env, &pay_client, &payment)?;
    }

    wf.status = WorkflowStatus::RolledBack;
    save_workflow(env, wf);
    Ok(())
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
        CoordInitialized { admin }.publish(&env);
        Ok(())
    }

    /// Get contract version
    pub fn version(_env: Env) -> u32 {
        CONTRACT_VERSION
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
        is_paused(&env)
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

    fn require_not_emergency_halted(env: &Env) -> Result<(), CoordinatorError> {
        if env
            .storage()
            .instance()
            .get(&DataKey::EmergencyHalt)
            .unwrap_or(false)
        {
            return Err(CoordinatorError::EmergencyHalted);
        }
        Ok(())
    }

    /// Emergency halt — immediately blocks all in-flight workflow steps
    /// (confirm_delivery and settle_payment). Admin only.
    ///
    /// Unlike pause(), which prevents new allocations, emergency_halt() is
    /// designed to contain active incidents (e.g. compromised oracle, critical
    /// bug) by stopping every in-progress workflow from advancing.
    /// Call unpause() or a dedicated resume function to restore normal operation.
    pub fn emergency_halt(env: Env, admin: Address) -> Result<(), CoordinatorError> {
        admin.require_auth();
        let stored: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(CoordinatorError::Unauthorized)?;
        if admin != stored {
            return Err(CoordinatorError::Unauthorized);
        }
        env.storage().instance().set(&DataKey::EmergencyHalt, &true);
        CoordEmergencyHalt { admin }.publish(&env);
        Ok(())
    }

    /// Clear the emergency halt flag. Admin only.
    pub fn clear_emergency_halt(env: Env, admin: Address) -> Result<(), CoordinatorError> {
        admin.require_auth();
        let stored: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(CoordinatorError::Unauthorized)?;
        if admin != stored {
            return Err(CoordinatorError::Unauthorized);
        }
        env.storage()
            .instance()
            .set(&DataKey::EmergencyHalt, &false);
        Ok(())
    }

    /// Returns whether the emergency halt is active.
    pub fn is_emergency_halted(env: Env) -> bool {
        env.storage()
            .instance()
            .get(&DataKey::EmergencyHalt)
            .unwrap_or(false)
    }

    /// Configure the address authorized to call flag_temperature_breach
    /// (typically the temperature-oracle contract). Admin only.
    pub fn set_temperature_oracle(
        env: Env,
        admin: Address,
        oracle: Address,
    ) -> Result<(), CoordinatorError> {
        admin.require_auth();
        let stored = get_admin(&env)?;
        if admin != stored {
            return Err(CoordinatorError::Unauthorized);
        }
        env.storage().instance().set(&DataKey::TemperatureOracle, &oracle);
        Ok(())
    }

    /// Configure the temperature contract consulted (via `is_compromised`) by
    /// `confirm_delivery` and `settle_payment`. Admin only.
    ///
    /// Once set, a workflow with any compromised unit can neither be delivered
    /// nor settled: an Allocated workflow can then be rolled back (refunding the
    /// payment), and a Delivered one disputed and resolved on the payments
    /// contract.
    pub fn set_temperature_contract(
        env: Env,
        admin: Address,
        temperature_contract: Address,
    ) -> Result<(), CoordinatorError> {
        admin.require_auth();
        let stored = get_admin(&env)?;
        if admin != stored {
            return Err(CoordinatorError::Unauthorized);
        }
        env.storage()
            .instance()
            .set(&DataKey::TemperatureContract, &temperature_contract);
        Ok(())
    }

    /// Returns the configured temperature contract, if any.
    pub fn get_temperature_contract(env: Env) -> Option<Address> {
        env.storage().instance().get(&DataKey::TemperatureContract)
    }

    fn require_admin(env: &Env, caller: &Address) -> Result<(), CoordinatorError> {
        let stored = get_admin(env)?;
        if *caller != stored {
            return Err(CoordinatorError::Unauthorized);
        }
        Ok(())
    }

    /// Restricts flag_temperature_breach to the admin or the configured
    /// temperature-oracle address, mirroring the admin check used by rollback.
    fn require_oracle(env: &Env, caller: &Address) -> Result<(), CoordinatorError> {
        let admin = get_admin(env)?;
        if *caller == admin {
            return Ok(());
        }
        let oracle: Address = env
            .storage()
            .instance()
            .get(&DataKey::TemperatureOracle)
            .ok_or(CoordinatorError::Unauthorized)?;
        if *caller != oracle {
            return Err(CoordinatorError::Unauthorized);
        }
        Ok(())
    }

    /// Step 1 – Allocate inventory units to a pending request.
    ///
    /// `payment_id` is bound to the workflow here (it must belong to
    /// `request_id`) and is the only payment `settle_payment` will release.
    /// Every unit must be Available, ABO/Rh-compatible with the request's
    /// blood type and owned by the same blood bank, and together the units
    /// must cover the request's outstanding `quantity_ml` (partial allocations
    /// are rejected).
    ///
    /// The units are reserved through `inventory.reserve_blood`, so a
    /// `Reservation` record with an expiry is created (and the registry synced
    /// when configured); the owning blood bank must authorize the call. The
    /// request is then approved and the reservation ID recorded on it via
    /// `requests.set_reservation_id`, so cancelling the request releases the
    /// units. Any failure aborts the whole allocation.
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
        Self::require_admin(&env, &caller)?;

        if let Some(wf) = load_workflow(&env, request_id) {
            if !is_terminal(wf.status) {
                return Err(CoordinatorError::WorkflowAlreadyStarted);
            }
        }

        // Verify request is Pending
        let req_addr: Address = get_contract_address(&env, &DataKey::RequestContract)?;
        let req_client = RequestContractClient::new(&env, &req_addr);
        let request = req_client
            .try_get_request(&request_id)
            .map_err(|_| CoordinatorError::RequestNotFound)?
            .map_err(|_| CoordinatorError::RequestNotFound)?;

        if request.status != RequestStatus::Pending {
            return Err(CoordinatorError::InvalidRequestState);
        }

        // Reject empty unit allocations — no units means no delivery guarantee
        if unit_ids.len() == 0 {
            return Err(CoordinatorError::NoUnitsSpecified);
        }

        // Verify payment is actually escrowed for this request
        let pay_addr: Address = get_contract_address(&env, &DataKey::PaymentContract)?;
        let pay_client = PaymentContractClient::new(&env, &pay_addr);
        let payment = pay_client
            .try_get_payment(&payment_id)
            .map_err(|_| CoordinatorError::PaymentNotFound)?
            .map_err(|_| CoordinatorError::PaymentNotFound)?;
        if payment.request_id != request_id {
            return Err(CoordinatorError::PaymentRequestMismatch);
        }

        // Validate every unit before reserving anything.
        let inv_addr: Address = get_contract_address(&env, &DataKey::InventoryContract)?;
        let inv_client = InventoryContractClient::new(&env, &inv_addr);

        let mut bank: Option<Address> = None;
        let mut total_ml: u32 = 0;
        for i in 0..unit_ids.len() {
            let uid = unit_ids.get(i).unwrap();
            // A unit listed twice would be counted twice toward the volume.
            for j in 0..i {
                if unit_ids.get(j).unwrap() == uid {
                    return Err(CoordinatorError::UnitNotAvailable);
                }
            }

            let unit = inv_client
                .try_get_blood_unit(&uid)
                .map_err(|_| CoordinatorError::UnitNotFound)?
                .map_err(|_| CoordinatorError::UnitNotFound)?;

            if unit.status != BloodStatus::Available {
                return Err(CoordinatorError::UnitNotAvailable);
            }

            if !unit.blood_type.can_donate_to(&request.blood_type) {
                return Err(CoordinatorError::IncompatibleBloodType);
            }

            match bank.clone() {
                None => bank = Some(unit.bank_id.clone()),
                Some(b) if b != unit.bank_id => {
                    return Err(CoordinatorError::MixedBloodBanks);
                }
                Some(_) => {}
            }

            total_ml = total_ml.saturating_add(unit.quantity_ml);
        }

        let outstanding_ml = request
            .quantity_ml
            .saturating_sub(request.fulfilled_quantity_ml);
        if total_ml < outstanding_ml {
            return Err(CoordinatorError::InsufficientQuantity);
        }

        // Reserve through inventory's reservation system (expiry, registry
        // sync, ownership and duplicate checks). The reservation lasts as long
        // as the workflow's own expiry window.
        let bank = bank.ok_or(CoordinatorError::NoUnitsSpecified)?;
        let reservation_id = inv_client
            .try_reserve_blood(
                &bank,
                &request.hospital_id,
                &unit_ids,
                &request_id,
                &WORKFLOW_TIMEOUT_SECS,
            )
            .map_err(|_| CoordinatorError::InventoryUpdateFailed)?
            .map_err(|_| CoordinatorError::InventoryUpdateFailed)?;

        // Approve the request and record the reservation on it, so that
        // cancelling or rejecting the request releases the reserved units.
        let req_admin = req_client.get_admin();
        req_client
            .try_update_request_status(
                &req_admin,
                &request_id,
                &RequestStatus::Approved,
                &String::from_str(&env, "Units allocated by coordinator"),
            )
            .map_err(|_| CoordinatorError::RequestUpdateFailed)?
            .map_err(|_| CoordinatorError::RequestUpdateFailed)?;
        req_client
            .try_set_reservation_id(&req_admin, &request_id, &reservation_id)
            .map_err(|_| CoordinatorError::RequestUpdateFailed)?
            .map_err(|_| CoordinatorError::RequestUpdateFailed)?;

        CoordAllocated {
            request_id,
            unit_ids: unit_ids.clone(),
            unit_count: unit_ids.len(),
        }
        .publish(&env);

        save_workflow(
            &env,
            &WorkflowRecord {
                request_id,
                payment_id,
                unit_ids,
                status: WorkflowStatus::Allocated,
                delivery_confirmed: false,
                delivery_location: None,
                expires_at: env.ledger().timestamp() + WORKFLOW_TIMEOUT_SECS,
            },
        );

        Ok(())
    }

    /// Step 2 – Confirm delivery: mark all reserved units as Delivered.
    ///
    /// `location` must be a GPS coordinate or facility identifier supplied by
    /// the confirmer.  It is stored in the workflow record and emitted in the
    /// event so off-chain auditors and cold-chain compliance tooling can verify
    /// where delivery occurred.
    ///
    /// Fails with `UnitCompromised` if the configured temperature contract
    /// reports any unit as compromised; the workflow stays Allocated and can be
    /// rolled back, refunding the payment.
    pub fn confirm_delivery(
        env: Env,
        request_id: u64,
        caller: Address,
        location: String,
    ) -> Result<(), CoordinatorError> {
        caller.require_auth();
        Self::require_initialized(&env)?;
        Self::require_not_paused(&env)?;
        Self::require_not_emergency_halted(&env)?;
        Self::require_admin(&env, &caller)?;

        let mut wf = load_workflow(&env, request_id).ok_or(CoordinatorError::WorkflowNotFound)?;

        if wf.status != WorkflowStatus::Allocated {
            return Err(CoordinatorError::InvalidWorkflowState);
        }

        require_units_not_compromised(&env, &wf.unit_ids)?;

        let inv_addr: Address = get_contract_address(&env, &DataKey::InventoryContract)?;
        let inv_client = InventoryContractClient::new(&env, &inv_addr);
        let inv_admin = inv_client.get_admin();

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
        wf.delivery_location = Some(location.clone());
        save_workflow(&env, &wf);

        CoordDelivered {
            request_id,
            location,
        }
        .publish(&env);

        Ok(())
    }

    /// Step 3 – Settle payment. Blocked if delivery not confirmed.
    ///
    /// Only the payment bound at allocation is released, after re-checking that
    /// it still belongs to this request and is Locked, and that no unit has
    /// since been reported compromised. For an escrow-backed payment this
    /// records the coordinator's half of the two-party release: the tokens
    /// reach the payee once the hospital calls `confirm_receipt` on the
    /// payments contract (immediately, if it already has).
    ///
    /// The payment is re-read afterwards. The workflow becomes Settled (and
    /// `coord/settld` is emitted) only if it is Released; otherwise it moves to
    /// AwaitingReceipt (emitting `coord/awt_rcpt`) with a fresh
    /// `RECEIPT_TIMEOUT_SECS` deadline, and `finalize_settlement` completes it
    /// once the hospital confirms. An AwaitingReceipt workflow can still be
    /// rolled back or expired.
    pub fn settle_payment(
        env: Env,
        request_id: u64,
        caller: Address,
    ) -> Result<(), CoordinatorError> {
        caller.require_auth();
        Self::require_initialized(&env)?;
        Self::require_not_paused(&env)?;
        Self::require_not_emergency_halted(&env)?;
        Self::require_admin(&env, &caller)?;

        let mut wf = load_workflow(&env, request_id).ok_or(CoordinatorError::WorkflowNotFound)?;

        if !wf.delivery_confirmed || wf.status != WorkflowStatus::Delivered {
            return Err(CoordinatorError::DeliveryNotConfirmed);
        }

        let pay_addr: Address = get_contract_address(&env, &DataKey::PaymentContract)?;
        let pay_client = PaymentContractClient::new(&env, &pay_addr);

        let payment = pay_client
            .try_get_payment(&wf.payment_id)
            .map_err(|_| CoordinatorError::PaymentNotFound)?
            .map_err(|_| CoordinatorError::PaymentNotFound)?;

        if payment.request_id != request_id {
            return Err(CoordinatorError::PaymentRequestMismatch);
        }

        if payment.status != PaymentStatus::Locked {
            return Err(CoordinatorError::InvalidPaymentState);
        }

        require_units_not_compromised(&env, &wf.unit_ids)?;

        release_payment(&env, &pay_client, &payment)?;

        // release_escrow only records the coordinator's confirmation until the
        // hospital has called confirm_receipt, so check what actually happened.
        let payment = load_bound_payment(&pay_client, &wf)?;
        if payment.status == PaymentStatus::Released {
            wf.status = WorkflowStatus::Settled;
            save_workflow(&env, &wf);

            CoordSettled {
                request_id,
                payment_id: wf.payment_id,
            }
            .publish(&env);
        } else {
            wf.status = WorkflowStatus::AwaitingReceipt;
            wf.expires_at = env.ledger().timestamp() + RECEIPT_TIMEOUT_SECS;
            save_workflow(&env, &wf);

            CoordAwaitingReceipt {
                request_id,
                payment_id: wf.payment_id,
            }
            .publish(&env);
        }

        Ok(())
    }

    /// Finalize an AwaitingReceipt workflow once the payments contract has
    /// settled the escrow. Permissionless: it only mirrors the payment's state.
    ///
    /// * Payment Released (the hospital confirmed receipt) → workflow Settled,
    ///   `coord/settld` emitted.
    /// * Payment Refunded or Cancelled (e.g. a dispute was resolved in the
    ///   payer's favour) → workflow RolledBack, `coord/rollbk` emitted.
    ///
    /// # Errors
    /// - `WorkflowNotFound`     — no workflow exists for `request_id`
    /// - `InvalidWorkflowState` — workflow is not AwaitingReceipt
    /// - `ReceiptNotConfirmed`  — the payment is not yet settled
    pub fn finalize_settlement(env: Env, request_id: u64) -> Result<(), CoordinatorError> {
        Self::require_initialized(&env)?;
        Self::require_not_paused(&env)?;
        Self::require_not_emergency_halted(&env)?;

        let mut wf = load_workflow(&env, request_id).ok_or(CoordinatorError::WorkflowNotFound)?;
        if wf.status != WorkflowStatus::AwaitingReceipt {
            return Err(CoordinatorError::InvalidWorkflowState);
        }

        let pay_addr: Address = get_contract_address(&env, &DataKey::PaymentContract)?;
        let pay_client = PaymentContractClient::new(&env, &pay_addr);
        let payment = load_bound_payment(&pay_client, &wf)?;

        match payment.status {
            PaymentStatus::Released => {
                wf.status = WorkflowStatus::Settled;
                save_workflow(&env, &wf);
                CoordSettled {
                    request_id,
                    payment_id: wf.payment_id,
                }
                .publish(&env);
            }
            PaymentStatus::Refunded | PaymentStatus::Cancelled => {
                wf.status = WorkflowStatus::RolledBack;
                save_workflow(&env, &wf);
                CoordRolledBack { request_id }.publish(&env);
            }
            _ => return Err(CoordinatorError::ReceiptNotConfirmed),
        }

        Ok(())
    }

    /// Rollback – admin only. Releases units and refunds payment.
    ///
    /// Allowed for an Allocated workflow (the inventory reservation is
    /// released and a Locked payment refunded) and for an AwaitingReceipt one
    /// (the delivered units stay where they are; a still-Locked escrow is
    /// refunded). An AwaitingReceipt workflow whose payment was already
    /// Released must be finalized instead.
    pub fn rollback(env: Env, request_id: u64) -> Result<(), CoordinatorError> {
        let admin = get_admin(&env)?;
        admin.require_auth();
        Self::require_initialized(&env)?;
        Self::require_not_paused(&env)?;

        let mut wf = load_workflow(&env, request_id).ok_or(CoordinatorError::WorkflowNotFound)?;

        if wf.status == WorkflowStatus::Settled {
            return Err(CoordinatorError::CannotRollbackSettled);
        }

        // Only Allocated and AwaitingReceipt workflows can be rolled back. A
        // Delivered workflow's units are physically at the hospital with no
        // settlement started, and a workflow that is already RolledBack must not
        // release its units or refund twice.
        if !matches!(
            wf.status,
            WorkflowStatus::Allocated | WorkflowStatus::AwaitingReceipt
        ) {
            return Err(CoordinatorError::InvalidWorkflowState);
        }

        unwind_workflow(&env, &mut wf, false)?;

        CoordRolledBack { request_id }.publish(&env);

        Ok(())
    }

    /// Expire a stale workflow once its deadline has elapsed.
    ///
    /// Any caller may invoke this once `ledger.timestamp() >= record.expires_at`.
    /// The workflow must be `Allocated` (i.e. `confirm_delivery` was never
    /// called) or `AwaitingReceipt` (the hospital never confirmed receipt
    /// within `RECEIPT_TIMEOUT_SECS`). On success the workflow is rolled back:
    /// an Allocated workflow's inventory reservation is expired, returning the
    /// units to `Available`, and a still-Locked payment is refunded to the payer.
    ///
    /// # Errors
    /// - `WorkflowNotFound`    — no workflow exists for `request_id`
    /// - `WorkflowNotExpired`  — the expiry deadline has not yet passed
    /// - `InvalidWorkflowState`— workflow is neither Allocated nor
    ///   AwaitingReceipt (delivered without settlement, settled, or rolled back)
    /// - `CannotRollbackSettled` — the escrow was already Released; call
    ///   `finalize_settlement` instead
    pub fn expire_workflow(env: Env, request_id: u64) -> Result<(), CoordinatorError> {
        Self::require_initialized(&env)?;
        Self::require_not_paused(&env)?;

        let mut wf = load_workflow(&env, request_id).ok_or(CoordinatorError::WorkflowNotFound)?;

        if env.ledger().timestamp() < wf.expires_at {
            return Err(CoordinatorError::WorkflowNotExpired);
        }

        if !matches!(
            wf.status,
            WorkflowStatus::Allocated | WorkflowStatus::AwaitingReceipt
        ) {
            return Err(CoordinatorError::InvalidWorkflowState);
        }

        unwind_workflow(&env, &mut wf, true)?;

        CoordExpired { request_id }.publish(&env);

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
        let caller = env.current_contract_address();
        caller.require_auth();

        let pay_addr: Address = get_contract_address(&env, &DataKey::PaymentContract)?;
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
                &caller,
            )
            .map_err(|_| CoordinatorError::PaymentUpdateFailed)?
            .map_err(|_| CoordinatorError::PaymentUpdateFailed)?;

        let now = env.ledger().timestamp();
        CoordTemperatureBreach {
            payment_id,
            unit_id: excursion_summary.unit_id,
            timestamp: now,
        }
        .publish(&env);

        Ok(())
    }

    /// Step 1 of two-step admin transfer: propose a new admin.
    /// The current admin must authorize. The new admin is stored as PendingAdmin
    /// until they call accept_admin().
    pub fn propose_admin(
        env: Env,
        current_admin: Address,
        new_admin: Address,
    ) -> Result<(), CoordinatorError> {
        current_admin.require_auth();
        let stored: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(CoordinatorError::Unauthorized)?;
        if current_admin != stored {
            return Err(CoordinatorError::Unauthorized);
        }
        env.storage()
            .instance()
            .set(&DataKey::PendingAdmin, &new_admin);
        Ok(())
    }

    /// Step 2 of two-step admin transfer: the pending admin accepts ownership.
    /// Clears PendingAdmin and promotes new_admin to Admin.
    pub fn accept_admin(env: Env, new_admin: Address) -> Result<(), CoordinatorError> {
        new_admin.require_auth();
        let pending: Address = env
            .storage()
            .instance()
            .get(&DataKey::PendingAdmin)
            .ok_or(CoordinatorError::Unauthorized)?;
        if new_admin != pending {
            return Err(CoordinatorError::Unauthorized);
        }
        env.storage().instance().set(&DataKey::Admin, &new_admin);
        env.storage().instance().remove(&DataKey::PendingAdmin);
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
    ) -> Result<(), CoordinatorError> {
        admin.require_auth();
        let stored: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(CoordinatorError::Unauthorized)?;
        if admin != stored {
            return Err(CoordinatorError::Unauthorized);
        }
        env.deployer().update_current_contract_wasm(new_wasm_hash);
        Ok(())
    }
}