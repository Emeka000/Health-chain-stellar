#![cfg(test)]

//! Cross-contract integration tests for the coordinator workflow.
//!
//! Each test registers mock implementations of the four domain contracts
//! alongside the coordinator in a single Soroban test environment, then
//! drives the full request → allocation → delivery → settlement sequence.

use soroban_sdk::{
    contract, contractimpl, contracttype, testutils::Address as _, vec, Address, Env, String, Vec,
};

use super::{
    BloodRequest, BloodStatus, BloodUnit, CoordinatorContract, CoordinatorContractClient,
    CoordinatorError, Payment, PaymentStatus, RequestStatus, WorkflowStatus,
};

// ── Mock: Request contract ────────────────────────────────────────────────────

#[contracttype]
enum ReqKey {
    Request(u64),
    Counter,
}

#[contract]
struct MockRequestContract;

#[contractimpl]
impl MockRequestContract {
    pub fn seed_request(env: Env, id: u64, status: RequestStatus) {
        env.storage()
            .persistent()
            .set(&ReqKey::Request(id), &BloodRequest { id, status });
    }

    pub fn get_request(env: Env, request_id: u64) -> BloodRequest {
        env.storage()
            .persistent()
            .get(&ReqKey::Request(request_id))
            .unwrap()
    }
}

// ── Mock: Inventory contract ──────────────────────────────────────────────────

#[contracttype]
enum InvKey {
    Unit(u64),
    Admin,
    Counter,
}

#[contract]
struct MockInventoryContract;

#[contractimpl]
impl MockInventoryContract {
    pub fn initialize(env: Env, admin: Address) {
        env.storage().instance().set(&InvKey::Admin, &admin);
        env.storage().instance().set(&InvKey::Counter, &0u64);
    }

    pub fn get_admin(env: Env) -> Address {
        env.storage().instance().get(&InvKey::Admin).unwrap()
    }

    pub fn register_unit(env: Env) -> u64 {
        let id: u64 = env
            .storage()
            .instance()
            .get(&InvKey::Counter)
            .unwrap_or(0u64)
            + 1;
        env.storage().instance().set(&InvKey::Counter, &id);
        env.storage().persistent().set(
            &InvKey::Unit(id),
            &BloodUnit {
                id,
                status: BloodStatus::Available,
            },
        );
        id
    }

    pub fn get_blood_unit(env: Env, blood_unit_id: u64) -> BloodUnit {
        env.storage()
            .persistent()
            .get(&InvKey::Unit(blood_unit_id))
            .unwrap()
    }

    pub fn update_status(
        env: Env,
        unit_id: u64,
        new_status: BloodStatus,
        _authorized_by: Address,
        _reason: Option<String>,
    ) -> BloodUnit {
        let mut unit: BloodUnit = env
            .storage()
            .persistent()
            .get(&InvKey::Unit(unit_id))
            .unwrap();
        unit.status = new_status;
        env.storage().persistent().set(&InvKey::Unit(unit_id), &unit);
        unit
    }

    pub fn mark_delivered(
        env: Env,
        unit_id: u64,
        authorized_by: Address,
        delivery_location: String,
    ) -> BloodUnit {
        Self::update_status(env, unit_id, BloodStatus::Delivered, authorized_by, Some(delivery_location))
    }
}

// ── Mock: Payment contract ────────────────────────────────────────────────────

#[contracttype]
enum PayKey {
    Payment(u64),
    Counter,
}

#[contract]
struct MockPaymentContract;

#[contractimpl]
impl MockPaymentContract {
    pub fn create_payment(env: Env, request_id: u64, status: PaymentStatus) -> u64 {
        let id: u64 = env
            .storage()
            .instance()
            .get(&PayKey::Counter)
            .unwrap_or(0u64)
            + 1;
        env.storage().instance().set(&PayKey::Counter, &id);
        env.storage().persistent().set(
            &PayKey::Payment(id),
            &Payment { id, request_id, status },
        );
        id
    }

    pub fn get_payment(env: Env, payment_id: u64) -> Payment {
        env.storage()
            .persistent()
            .get(&PayKey::Payment(payment_id))
            .unwrap()
    }

    pub fn update_status(env: Env, payment_id: u64, status: PaymentStatus) {
        let mut p: Payment = env
            .storage()
            .persistent()
            .get(&PayKey::Payment(payment_id))
            .unwrap();
        p.status = status;
        env.storage()
            .persistent()
            .set(&PayKey::Payment(payment_id), &p);
    }

    pub fn record_dispute(env: Env, payment_id: u64, _reason: super::payment_client::DisputeReason, _case_id: String) {
        let mut p: Payment = env
            .storage()
            .persistent()
            .get(&PayKey::Payment(payment_id))
            .unwrap();
        p.status = PaymentStatus::Disputed;
        env.storage()
            .persistent()
            .set(&PayKey::Payment(payment_id), &p);
    }
}

// ── Harness ───────────────────────────────────────────────────────────────────

struct Harness<'a> {
    env: Env,
    admin: Address,
    coord: CoordinatorContractClient<'a>,
    req_id: Address,
    inv_id: Address,
    pay_id: Address,
}

fn setup<'a>() -> Harness<'a> {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);

    let req_id = env.register(MockRequestContract, ());
    let inv_id = env.register(MockInventoryContract, ());
    let pay_id = env.register(MockPaymentContract, ());
    let coord_id = env.register(CoordinatorContract, ());

    // Initialize inventory mock with admin
    let inv = MockInventoryContractClient::new(&env, &inv_id);
    inv.initialize(&admin);

    let coord = CoordinatorContractClient::new(&env, &coord_id);
    coord.initialize(&admin, &req_id, &inv_id, &pay_id);

    Harness { env, admin, coord, req_id, inv_id, pay_id }
}

fn seed_pending_request(h: &Harness, id: u64) {
    MockRequestContractClient::new(&h.env, &h.req_id)
        .seed_request(&id, &RequestStatus::Pending);
}

fn register_unit(h: &Harness) -> u64 {
    MockInventoryContractClient::new(&h.env, &h.inv_id).register_unit()
}

fn create_locked_payment(h: &Harness, request_id: u64) -> u64 {
    MockPaymentContractClient::new(&h.env, &h.pay_id)
        .create_payment(&request_id, &PaymentStatus::Locked)
}

// ── Happy path ────────────────────────────────────────────────────────────────

#[test]
fn test_full_happy_path() {
    let h = setup();
    seed_pending_request(&h, 1);
    let unit_id = register_unit(&h);
    let payment_id = create_locked_payment(&h, 1);

    h.coord.allocate_units(&1u64, &vec![&h.env, unit_id], &payment_id, &h.admin);

    let wf = h.coord.get_workflow(&1u64);
    assert_eq!(wf.status, WorkflowStatus::Allocated);
    assert!(!wf.delivery_confirmed);

    let unit = MockInventoryContractClient::new(&h.env, &h.inv_id).get_blood_unit(&unit_id);
    assert_eq!(unit.status, BloodStatus::Reserved);

    h.coord.confirm_delivery(&1u64, &h.admin);

    let wf = h.coord.get_workflow(&1u64);
    assert_eq!(wf.status, WorkflowStatus::Delivered);
    assert!(wf.delivery_confirmed);

    let unit = MockInventoryContractClient::new(&h.env, &h.inv_id).get_blood_unit(&unit_id);
    assert_eq!(unit.status, BloodStatus::Delivered);

    h.coord.settle_payment(&1u64, &h.admin);

    let wf = h.coord.get_workflow(&1u64);
    assert_eq!(wf.status, WorkflowStatus::Settled);

    let payment = MockPaymentContractClient::new(&h.env, &h.pay_id).get_payment(&payment_id);
    assert_eq!(payment.status, PaymentStatus::Released);
}

// ── Sequence enforcement ──────────────────────────────────────────────────────

#[test]
fn test_settle_blocked_without_delivery() {
    let h = setup();
    seed_pending_request(&h, 1);
    let unit_id = register_unit(&h);
    let payment_id = create_locked_payment(&h, 1);

    h.coord.allocate_units(&1u64, &vec![&h.env, unit_id], &payment_id, &h.admin);

    let result = h.coord.try_settle_payment(&1u64, &h.admin);
    assert_eq!(result, Err(Ok(CoordinatorError::DeliveryNotConfirmed)));

    let payment = MockPaymentContractClient::new(&h.env, &h.pay_id).get_payment(&payment_id);
    assert_eq!(payment.status, PaymentStatus::Locked);
}

#[test]
fn test_double_allocation_blocked() {
    let h = setup();
    seed_pending_request(&h, 1);
    let unit_id = register_unit(&h);
    let payment_id = create_locked_payment(&h, 1);

    h.coord.allocate_units(&1u64, &vec![&h.env, unit_id], &payment_id, &h.admin);

    let unit_id2 = register_unit(&h);
    let result = h.coord.try_allocate_units(
        &1u64,
        &vec![&h.env, unit_id2],
        &payment_id,
        &h.admin,
    );
    assert_eq!(result, Err(Ok(CoordinatorError::WorkflowAlreadyStarted)));
}

#[test]
fn test_allocate_blocked_for_unavailable_unit() {
    let h = setup();
    seed_pending_request(&h, 1);
    let unit_id = register_unit(&h);
    let payment_id = create_locked_payment(&h, 1);

    // Pre-reserve the unit
    MockInventoryContractClient::new(&h.env, &h.inv_id)
        .update_status(&unit_id, &BloodStatus::Reserved, &h.admin, &None);

    let result = h.coord.try_allocate_units(
        &1u64,
        &vec![&h.env, unit_id],
        &payment_id,
        &h.admin,
    );
    assert_eq!(result, Err(Ok(CoordinatorError::UnitNotAvailable)));
}

#[test]
fn test_settle_blocked_for_pending_payment() {
    let h = setup();
    seed_pending_request(&h, 1);
    let unit_id = register_unit(&h);
    // Payment left Pending (not Locked)
    let payment_id = MockPaymentContractClient::new(&h.env, &h.pay_id)
        .create_payment(&1u64, &PaymentStatus::Pending);

    h.coord.allocate_units(&1u64, &vec![&h.env, unit_id], &payment_id, &h.admin);
    h.coord.confirm_delivery(&1u64, &h.admin);

    let result = h.coord.try_settle_payment(&1u64, &h.admin);
    assert_eq!(result, Err(Ok(CoordinatorError::InvalidPaymentState)));
}

#[test]
fn test_confirm_delivery_blocked_before_allocation() {
    let h = setup();
    let result = h.coord.try_confirm_delivery(&99u64, &h.admin);
    assert_eq!(result, Err(Ok(CoordinatorError::WorkflowNotFound)));
}

#[test]
fn test_allocate_blocked_for_non_pending_request() {
    let h = setup();
    // Seed request with Approved status (not Pending)
    MockRequestContractClient::new(&h.env, &h.req_id)
        .seed_request(&1u64, &RequestStatus::Approved);
    let unit_id = register_unit(&h);
    let payment_id = create_locked_payment(&h, 1);

    let result = h.coord.try_allocate_units(
        &1u64,
        &vec![&h.env, unit_id],
        &payment_id,
        &h.admin,
    );
    assert_eq!(result, Err(Ok(CoordinatorError::InvalidRequestState)));
}

// ── Rollback ──────────────────────────────────────────────────────────────────

#[test]
fn test_rollback_releases_units_and_refunds_payment() {
    let h = setup();
    seed_pending_request(&h, 1);
    let unit_id = register_unit(&h);
    let payment_id = create_locked_payment(&h, 1);

    h.coord.allocate_units(&1u64, &vec![&h.env, unit_id], &payment_id, &h.admin);
    h.coord.rollback(&1u64);

    let wf = h.coord.get_workflow(&1u64);
    assert_eq!(wf.status, WorkflowStatus::RolledBack);

    let unit = MockInventoryContractClient::new(&h.env, &h.inv_id).get_blood_unit(&unit_id);
    assert_eq!(unit.status, BloodStatus::Available);

    let payment = MockPaymentContractClient::new(&h.env, &h.pay_id).get_payment(&payment_id);
    assert_eq!(payment.status, PaymentStatus::Refunded);
}

#[test]
fn test_rollback_blocked_after_settlement() {
    let h = setup();
    seed_pending_request(&h, 1);
    let unit_id = register_unit(&h);
    let payment_id = create_locked_payment(&h, 1);

    h.coord.allocate_units(&1u64, &vec![&h.env, unit_id], &payment_id, &h.admin);
    h.coord.confirm_delivery(&1u64, &h.admin);
    h.coord.settle_payment(&1u64, &h.admin);

    let result = h.coord.try_rollback(&1u64);
    assert_eq!(result, Err(Ok(CoordinatorError::CannotRollbackSettled)));
}

// ── Circuit breaker tests ─────────────────────────────────────────────────────

#[test]
fn test_coordinator_pause_blocks_allocate_units() {
    let h = setup();
    h.coord.pause(&h.admin);
    assert!(h.coord.is_paused());

    seed_pending_request(&h, 1);
    let unit_id = register_unit(&h);
    let pay_id = create_locked_payment(&h, 1);

    let result = h.coord.try_allocate_units(&1u64, &vec![&h.env, unit_id], &pay_id, &h.admin);
    assert!(result.is_err());
}

#[test]
fn test_coordinator_pause_allows_get_workflow() {
    let h = setup();

    // Create a workflow first
    seed_pending_request(&h, 10);
    let unit_id = register_unit(&h);
    let pay_id = create_locked_payment(&h, 10);
    h.coord.allocate_units(&10u64, &vec![&h.env, unit_id], &pay_id, &h.admin);

    h.coord.pause(&h.admin);

    // Read still works
    let wf = h.coord.get_workflow(&10u64);
    assert_eq!(wf.request_id, 10);
}

#[test]
fn test_coordinator_unpause_restores_writes() {
    let h = setup();
    h.coord.pause(&h.admin);
    h.coord.unpause(&h.admin);
    assert!(!h.coord.is_paused());

    seed_pending_request(&h, 20);
    let unit_id = register_unit(&h);
    let pay_id = create_locked_payment(&h, 20);
    h.coord.allocate_units(&20u64, &vec![&h.env, unit_id], &pay_id, &h.admin);
    assert_eq!(h.coord.get_workflow(&20u64).status, WorkflowStatus::Allocated);
}

#[test]
#[should_panic]
fn test_coordinator_non_admin_cannot_pause() {
    let h = setup();
    let attacker = Address::generate(&h.env);
    h.coord.pause(&attacker);
}

// ── Temperature excursion → dispute integration tests (issue #477) ────────────

use super::ExcursionSummary;

fn make_excursion(unit_id: u64) -> ExcursionSummary {
    ExcursionSummary {
        unit_id,
        violation_count: 3,
        peak_celsius_x100: 1200, // 12.00°C — above threshold
        detected_at: 1000,
    }
}

/// Full chain: flag_temperature_breach transitions Locked → Disputed.
#[test]
fn test_flag_temperature_breach_transitions_locked_to_disputed() {
    let h = setup();
    let payment_id = create_locked_payment(&h, 99);

    let excursion = make_excursion(42);
    h.coord
        .flag_temperature_breach(&h.admin, &payment_id, &excursion);

    let payment = MockPaymentContractClient::new(&h.env, &h.pay_id).get_payment(&payment_id);
    assert_eq!(
        payment.status,
        PaymentStatus::Disputed,
        "Payment must be Disputed after temperature breach"
    );
}

/// flag_temperature_breach on a non-Locked payment returns InvalidPaymentState.
#[test]
fn test_flag_temperature_breach_non_locked_payment_fails() {
    let h = setup();
    // Create a Released payment
    let payment_id = MockPaymentContractClient::new(&h.env, &h.pay_id)
        .create_payment(&1u64, &PaymentStatus::Released);

    let excursion = make_excursion(1);
    let result = h
        .coord
        .try_flag_temperature_breach(&h.admin, &payment_id, &excursion);
    assert_eq!(
        result,
        Err(Ok(CoordinatorError::InvalidPaymentState)),
        "Non-Locked payment must return InvalidPaymentState"
    );
}

/// flag_temperature_breach on a missing payment returns PaymentNotFound.
#[test]
fn test_flag_temperature_breach_missing_payment_fails() {
    let h = setup();
    let excursion = make_excursion(1);
    let result = h
        .coord
        .try_flag_temperature_breach(&h.admin, &9999u64, &excursion);
    assert_eq!(
        result,
        Err(Ok(CoordinatorError::PaymentNotFound)),
        "Missing payment must return PaymentNotFound"
    );
}

/// Paused coordinator rejects flag_temperature_breach.
#[test]
fn test_flag_temperature_breach_blocked_when_paused() {
    let h = setup();
    let payment_id = create_locked_payment(&h, 1);
    h.coord.pause(&h.admin);

    let excursion = make_excursion(1);
    let result = h
        .coord
        .try_flag_temperature_breach(&h.admin, &payment_id, &excursion);
    assert_eq!(result, Err(Ok(CoordinatorError::ContractPaused)));

    // Payment must remain Locked
    let payment = MockPaymentContractClient::new(&h.env, &h.pay_id).get_payment(&payment_id);
    assert_eq!(payment.status, PaymentStatus::Locked);
}
