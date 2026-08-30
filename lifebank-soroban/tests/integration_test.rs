//! Integration tests for the cross-contract coordinator ↔ inventory ↔ payments workflow.
//!
//! Each test registers lightweight mock implementations of the three domain
//! contracts alongside the real `CoordinatorContract` inside a single Soroban
//! test environment, then drives the full request lifecycle:
//!
//!   allocate_units → confirm_delivery → settle_payment   (happy path)
//!   allocate_units → rollback                            (coordinator rollback)
//!   rollback with unlocked payment                       (idempotent refund guard)
//!
//! Why mocks instead of real contracts?
//! The coordinator defines minimal proxy types (`BloodRequest {id, status}`,
//! `BloodUnit {id, status}`, `Payment {id, request_id, status}`) that share only
//! the fields it cares about. The real domain contracts use richer structs whose
//! XDR encoding is incompatible with the coordinator's cross-contract client
//! expectations. Mocks mirror the coordinator's type definitions exactly, keeping
//! these tests focused on coordinator orchestration and cross-contract state.

use soroban_sdk::{
    contract, contractimpl, contracttype, testutils::Address as _, vec, Address, Env, String,
};

use coordinator_contract::{
    BloodRequest, BloodStatus, BloodType, BloodUnit, CoordinatorContract,
    CoordinatorContractClient, CoordinatorError, Payment, PaymentStatus, RequestStatus,
    WorkflowRecord, WorkflowStatus,
};

// ── Mock: Requests contract ───────────────────────────────────────────────────

#[contracttype]
enum ReqKey {
    Request(u64),
}

#[contract]
struct MockRequestContract;

#[contractimpl]
impl MockRequestContract {
    /// Seed a request directly (test helper — not part of the real interface).
    pub fn seed_request(env: Env, id: u64, status: RequestStatus) {
        env.storage()
            .persistent()
            .set(&ReqKey::Request(id), &BloodRequest { id, status });
    }

    /// Called by the coordinator to check request status before allocating.
    pub fn get_request(env: Env, request_id: u64) -> BloodRequest {
        env.storage()
            .persistent()
            .get(&ReqKey::Request(request_id))
            .expect("request not found")
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

    /// Called by the coordinator to retrieve the admin address used as
    /// `authorized_by` in subsequent `update_status` / `mark_delivered` calls.
    pub fn get_admin(env: Env) -> Address {
        env.storage().instance().get(&InvKey::Admin).unwrap()
    }

    /// Seed an Available blood unit (test helper).
    pub fn seed_unit(env: Env) -> u64 {
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
                blood_type: coordinator_contract::BloodType::OPositive,
            },
        );
        id
    }

    /// Read a unit (test helper).
    pub fn get_blood_unit(env: Env, blood_unit_id: u64) -> BloodUnit {
        env.storage()
            .persistent()
            .get(&InvKey::Unit(blood_unit_id))
            .expect("unit not found")
    }

    /// Called by the coordinator in allocate_units, confirm_delivery, and rollback.
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
            .expect("unit not found");
        unit.status = new_status;
        env.storage()
            .persistent()
            .set(&InvKey::Unit(unit_id), &unit);
        unit
    }

    /// Called by the coordinator in confirm_delivery (InTransit → Delivered).
    pub fn mark_delivered(
        env: Env,
        unit_id: u64,
        authorized_by: Address,
        delivery_location: String,
    ) -> BloodUnit {
        Self::update_status(
            env,
            unit_id,
            BloodStatus::Delivered,
            authorized_by,
            Some(delivery_location),
        )
    }
}

// ── Mock: Payments contract ───────────────────────────────────────────────────

#[contracttype]
enum PayKey {
    Payment(u64),
    Counter,
}

#[contract]
struct MockPaymentContract;

#[contractimpl]
impl MockPaymentContract {
    /// Seed a payment directly (test helper).
    pub fn seed_payment(env: Env, request_id: u64, status: PaymentStatus) -> u64 {
        let id: u64 = env
            .storage()
            .instance()
            .get(&PayKey::Counter)
            .unwrap_or(0u64)
            + 1;
        env.storage().instance().set(&PayKey::Counter, &id);
        env.storage().persistent().set(
            &PayKey::Payment(id),
            &Payment {
                id,
                request_id,
                status,
            },
        );
        id
    }

    /// Read a payment (test helper).
    pub fn get_payment(env: Env, payment_id: u64) -> Payment {
        env.storage()
            .persistent()
            .get(&PayKey::Payment(payment_id))
            .expect("payment not found")
    }

    /// Called by the coordinator in settle_payment (→ Released) and rollback (→ Refunded).
    pub fn update_status(env: Env, payment_id: u64, status: PaymentStatus) {
        let mut p: Payment = env
            .storage()
            .persistent()
            .get(&PayKey::Payment(payment_id))
            .expect("payment not found");
        p.status = status;
        env.storage()
            .persistent()
            .set(&PayKey::Payment(payment_id), &p);
    }
}

// ── Test harness ──────────────────────────────────────────────────────────────

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

    // Initialize inventory mock with a known admin.
    MockInventoryContractClient::new(&env, &inv_id).initialize(&admin);

    // Initialize coordinator with all contract addresses.
    CoordinatorContractClient::new(&env, &coord_id).initialize(&admin, &req_id, &inv_id, &pay_id);

    let coord = CoordinatorContractClient::new(&env, &coord_id);
    Harness {
        env,
        admin,
        coord,
        req_id,
        inv_id,
        pay_id,
    }
}

fn seed_pending_request(h: &Harness, id: u64) {
    MockRequestContractClient::new(&h.env, &h.req_id).seed_request(&id, &RequestStatus::Pending);
}

fn seed_available_unit(h: &Harness) -> u64 {
    MockInventoryContractClient::new(&h.env, &h.inv_id).seed_unit()
}

fn seed_locked_payment(h: &Harness, request_id: u64) -> u64 {
    MockPaymentContractClient::new(&h.env, &h.pay_id)
        .seed_payment(&request_id, &PaymentStatus::Locked)
}

fn get_unit(h: &Harness, unit_id: u64) -> BloodUnit {
    MockInventoryContractClient::new(&h.env, &h.inv_id).get_blood_unit(&unit_id)
}

fn get_payment(h: &Harness, payment_id: u64) -> Payment {
    MockPaymentContractClient::new(&h.env, &h.pay_id).get_payment(&payment_id)
}

// ── Integration test 1: full allocation → delivery → settlement workflow ──────

/// Tests the end-to-end happy path:
///   coordinator.allocate_units() → inventory units become Reserved
///   coordinator.confirm_delivery() → inventory units become Delivered
///   coordinator.settle_payment() → payment transitions Locked → Released
///
/// Verifies that cross-contract state is consistent at every step.
#[test]
fn test_full_allocation_to_delivery_workflow() {
    let h = setup();

    // ── Arrange ──────────────────────────────────────────────────────────────
    let request_id = 1u64;
    seed_pending_request(&h, request_id);

    // Allocate two blood units so we prove the coordinator loops correctly.
    let unit_a = seed_available_unit(&h);
    let unit_b = seed_available_unit(&h);
    let units = vec![&h.env, unit_a, unit_b];

    let payment_id = seed_locked_payment(&h, request_id);

    // ── Step 1: allocate_units ───────────────────────────────────────────────
    h.coord.allocate_units(
        &request_id,
        &units,
        &payment_id,
        &h.admin,
        &BloodType::OPositive,
    );

    // Workflow record should be Allocated.
    let wf: WorkflowRecord = h.coord.get_workflow(&request_id);
    assert_eq!(
        wf.status,
        WorkflowStatus::Allocated,
        "workflow must be Allocated after allocate_units"
    );
    assert!(!wf.delivery_confirmed, "delivery not yet confirmed");
    assert_eq!(wf.unit_ids.len(), 2);

    // Both inventory units must be Reserved.
    assert_eq!(
        get_unit(&h, unit_a).status,
        BloodStatus::Reserved,
        "unit_a must be Reserved after allocation"
    );
    assert_eq!(
        get_unit(&h, unit_b).status,
        BloodStatus::Reserved,
        "unit_b must be Reserved after allocation"
    );

    // Payment must still be Locked (not yet released).
    assert_eq!(
        get_payment(&h, payment_id).status,
        PaymentStatus::Locked,
        "payment must remain Locked until settlement"
    );

    // ── Step 2: confirm_delivery ─────────────────────────────────────────────
    h.coord.confirm_delivery(
        &request_id,
        &h.admin,
        &String::from_str(&h.env, "facility-a"),
    );

    let wf: WorkflowRecord = h.coord.get_workflow(&request_id);
    assert_eq!(
        wf.status,
        WorkflowStatus::Delivered,
        "workflow must be Delivered after confirm_delivery"
    );
    assert!(wf.delivery_confirmed, "delivery_confirmed must be true");

    // Both units must be Delivered (coordinator drives InTransit → Delivered).
    assert_eq!(
        get_unit(&h, unit_a).status,
        BloodStatus::Delivered,
        "unit_a must be Delivered"
    );
    assert_eq!(
        get_unit(&h, unit_b).status,
        BloodStatus::Delivered,
        "unit_b must be Delivered"
    );

    // Payment still Locked — not released until settle_payment.
    assert_eq!(
        get_payment(&h, payment_id).status,
        PaymentStatus::Locked,
        "payment must still be Locked before settle_payment"
    );

    // ── Step 3: settle_payment ───────────────────────────────────────────────
    h.coord.settle_payment(&request_id, &h.admin);

    let wf: WorkflowRecord = h.coord.get_workflow(&request_id);
    assert_eq!(
        wf.status,
        WorkflowStatus::Settled,
        "workflow must be Settled after settle_payment"
    );

    // Payment must now be Released.
    assert_eq!(
        get_payment(&h, payment_id).status,
        PaymentStatus::Released,
        "payment must be Released after settlement"
    );
}

// ── Integration test 2: coordinator.rollback() ────────────────────────────────

/// Tests the rollback path:
///   coordinator.allocate_units() → units Reserved, payment Locked
///   coordinator.rollback()       → units Available again, payment Refunded
///
/// Verifies that rollback restores inventory and refunds the payment atomically.
#[test]
fn test_rollback_releases_inventory_and_refunds_payment() {
    let h = setup();

    // ── Arrange ──────────────────────────────────────────────────────────────
    let request_id = 2u64;
    seed_pending_request(&h, request_id);

    let unit_a = seed_available_unit(&h);
    let unit_b = seed_available_unit(&h);
    let units = vec![&h.env, unit_a, unit_b];

    let payment_id = seed_locked_payment(&h, request_id);

    // Allocate first so there is a workflow record to roll back.
    h.coord.allocate_units(
        &request_id,
        &units,
        &payment_id,
        &h.admin,
        &BloodType::OPositive,
    );

    assert_eq!(get_unit(&h, unit_a).status, BloodStatus::Reserved);
    assert_eq!(get_unit(&h, unit_b).status, BloodStatus::Reserved);
    assert_eq!(get_payment(&h, payment_id).status, PaymentStatus::Locked);

    // ── Rollback ─────────────────────────────────────────────────────────────
    h.coord.rollback(&request_id);

    // Workflow record must be RolledBack.
    let wf: WorkflowRecord = h.coord.get_workflow(&request_id);
    assert_eq!(
        wf.status,
        WorkflowStatus::RolledBack,
        "workflow must be RolledBack after rollback"
    );

    // Inventory units must be returned to Available.
    assert_eq!(
        get_unit(&h, unit_a).status,
        BloodStatus::Available,
        "unit_a must be Available after rollback"
    );
    assert_eq!(
        get_unit(&h, unit_b).status,
        BloodStatus::Available,
        "unit_b must be Available after rollback"
    );

    // Payment must be Refunded.
    assert_eq!(
        get_payment(&h, payment_id).status,
        PaymentStatus::Refunded,
        "payment must be Refunded after rollback"
    );
}

// ── Integration test 3: rollback with a non-Locked payment ───────────────────

/// Tests that rollback is safe when the payment is already in a terminal state
/// (e.g., Pending instead of Locked). The coordinator's rollback only refunds
/// Locked payments; for any other status it is a no-op on the payment side.
///
/// This exercises the guard:
///   if payment.status == PaymentStatus::Locked { refund() }
#[test]
fn test_rollback_with_pending_payment_does_not_refund() {
    let h = setup();

    // ── Arrange ──────────────────────────────────────────────────────────────
    let request_id = 3u64;
    seed_pending_request(&h, request_id);

    let unit_id = seed_available_unit(&h);

    // Create a Pending (not Locked) payment — simulates a workflow where escrow
    // was never funded.
    let payment_id = MockPaymentContractClient::new(&h.env, &h.pay_id)
        .seed_payment(&request_id, &PaymentStatus::Pending);

    h.coord.allocate_units(
        &request_id,
        &vec![&h.env, unit_id],
        &payment_id,
        &h.admin,
        &BloodType::OPositive,
    );

    assert_eq!(get_unit(&h, unit_id).status, BloodStatus::Reserved);
    assert_eq!(
        get_payment(&h, payment_id).status,
        PaymentStatus::Pending,
        "payment should remain Pending before rollback"
    );

    // ── Rollback ─────────────────────────────────────────────────────────────
    h.coord.rollback(&request_id);

    // Inventory must be freed regardless of payment status.
    assert_eq!(
        get_unit(&h, unit_id).status,
        BloodStatus::Available,
        "unit must be Available after rollback even with non-Locked payment"
    );

    // Payment must remain Pending — coordinator only refunds Locked payments.
    assert_eq!(
        get_payment(&h, payment_id).status,
        PaymentStatus::Pending,
        "Pending payment must not be changed to Refunded by rollback"
    );

    let wf: WorkflowRecord = h.coord.get_workflow(&request_id);
    assert_eq!(wf.status, WorkflowStatus::RolledBack);
}

// ── Negative tests ────────────────────────────────────────────────────────────

/// settle_payment must be rejected when delivery has not been confirmed.
#[test]
fn test_settle_without_confirm_delivery_is_rejected() {
    let h = setup();

    let request_id = 4u64;
    seed_pending_request(&h, request_id);
    let unit_id = seed_available_unit(&h);
    let payment_id = seed_locked_payment(&h, request_id);

    h.coord.allocate_units(
        &request_id,
        &vec![&h.env, unit_id],
        &payment_id,
        &h.admin,
        &BloodType::OPositive,
    );

    // Skip confirm_delivery — settle must fail.
    let result = h.coord.try_settle_payment(&request_id, &h.admin);
    assert_eq!(
        result,
        Err(Ok(CoordinatorError::DeliveryNotConfirmed)),
        "settle_payment must fail with DeliveryNotConfirmed when delivery has not been confirmed"
    );

    // Payment must remain Locked — no funds released.
    assert_eq!(
        get_payment(&h, payment_id).status,
        PaymentStatus::Locked,
        "payment must remain Locked after rejected settle"
    );
}

/// rollback must be rejected for an already-settled workflow.
#[test]
fn test_rollback_after_settlement_is_rejected() {
    let h = setup();

    let request_id = 5u64;
    seed_pending_request(&h, request_id);
    let unit_id = seed_available_unit(&h);
    let payment_id = seed_locked_payment(&h, request_id);

    h.coord.allocate_units(
        &request_id,
        &vec![&h.env, unit_id],
        &payment_id,
        &h.admin,
        &BloodType::OPositive,
    );
    h.coord.confirm_delivery(
        &request_id,
        &h.admin,
        &String::from_str(&h.env, "facility-b"),
    );
    h.coord.settle_payment(&request_id, &h.admin);

    let result = h.coord.try_rollback(&request_id);
    assert_eq!(
        result,
        Err(Ok(CoordinatorError::CannotRollbackSettled)),
        "rollback must fail with CannotRollbackSettled on a settled workflow"
    );
}
