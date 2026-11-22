#![cfg(test)]
//! Coordinator tests.
//!
//! Every test registers the *real* requests, inventory and payments contracts
//! next to the coordinator, wired the way a deployment must be:
//!   * the coordinator is the payments contract's admin;
//!   * inventory and requests each trust the coordinator contract via
//!     `set_coordinator_contract`.
//!
//! The coordinator authorizes every cross-contract call as itself, so the auth
//! tests run without `mock_all_auths` and assert the exact auth tree.

extern crate std;

use soroban_sdk::{
    testutils::{
        Address as _, AuthorizedFunction, AuthorizedInvocation, Ledger as _, MockAuth,
        MockAuthInvoke,
    },
    token, vec, Address, Env, IntoVal, String, Symbol, TryFromVal, Val, Vec,
};

use super::{
    BloodComponent, BloodRequest, BloodType, CoordinatorContract, CoordinatorContractClient,
    CoordinatorError, DataKey, RequestStatus, Urgency, WorkflowStatus,
};

use inventory_contract::{
    BloodStatus as InvStatus, BloodType as InvBloodType, InventoryContract,
    InventoryContractClient,
};
use payment_contract::{
    DisputeReason as PayDisputeReason, PaymentContract, PaymentContractClient,
    PaymentStatus as PayStatus,
};
use request_contract::{
    BloodComponent as ReqComponent, BloodType as ReqBloodType, RequestContract,
    RequestContractClient, RequestStatus as ReqStatus, Urgency as ReqUrgency,
};

const ESCROW_AMOUNT: i128 = 500;
const HOSPITAL_FUNDS: i128 = 10_000;

// ── Harness ───────────────────────────────────────────────────────────────────

struct World<'a> {
    env: Env,
    /// Coordinator admin — the only key a workflow step needs.
    admin: Address,
    /// Inventory admin; also the blood bank that owns every registered unit.
    inv_admin: Address,
    hospital: Address,
    /// Payee of every escrow.
    blood_bank: Address,
    coord: CoordinatorContractClient<'a>,
    req: RequestContractClient<'a>,
    inv: InventoryContractClient<'a>,
    pay: PaymentContractClient<'a>,
    token: token::Client<'a>,
}

fn setup<'a>() -> World<'a> {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().with_mut(|l| l.timestamp = 1_000);

    let admin = Address::generate(&env);
    let req_admin = Address::generate(&env);
    let inv_admin = Address::generate(&env);
    let hospital = Address::generate(&env);
    let blood_bank = Address::generate(&env);

    let req_id = env.register(RequestContract, ());
    let inv_id = env.register(InventoryContract, ());
    let pay_id = env.register(PaymentContract, ());
    let coord_id = env.register(CoordinatorContract, ());

    let inv = InventoryContractClient::new(&env, &inv_id);
    inv.initialize(&inv_admin);
    inv.set_requests_contract(&inv_admin, &req_id);
    inv.set_coordinator_contract(&inv_admin, &coord_id);

    let req = RequestContractClient::new(&env, &req_id);
    req.initialize(&req_admin, &inv_id);
    req.authorize_hospital(&hospital);
    req.set_payments_contract(&pay_id);
    req.set_coordinator_contract(&coord_id);

    let pay = PaymentContractClient::new(&env, &pay_id);
    pay.initialize(&coord_id, &Some(req_id.clone()));
    let token_id = env
        .register_stellar_asset_contract_v2(admin.clone())
        .address();
    token::StellarAssetClient::new(&env, &token_id).mint(&hospital, &HOSPITAL_FUNDS);
    pay.add_allowed_token(&coord_id, &token_id);

    let coord = CoordinatorContractClient::new(&env, &coord_id);
    coord.initialize(&admin, &req_id, &inv_id, &pay_id);

    let token = token::Client::new(&env, &token_id);

    World {
        env,
        admin,
        inv_admin,
        hospital,
        blood_bank,
        coord,
        req,
        inv,
        pay,
        token,
    }
}

fn new_request(w: &World) -> u64 {
    w.req.create_request(
        &w.hospital,
        &ReqBloodType::OPositive,
        &ReqComponent::WholeBlood,
        &450u32,
        &ReqUrgency::Urgent,
        &(w.env.ledger().timestamp() + 86_400),
    )
}

fn register_unit(w: &World, serial: &str) -> u64 {
    w.inv.register_blood(
        &w.inv_admin,
        &String::from_str(&w.env, serial),
        &InvBloodType::ONegative,
        &450u32,
        &None,
    )
}

fn new_escrow(w: &World, request_id: u64) -> u64 {
    w.pay.create_escrow(
        &request_id,
        &w.hospital,
        &w.blood_bank,
        &ESCROW_AMOUNT,
        &w.token.address,
    )
}

fn unit_status(w: &World, unit_id: u64) -> InvStatus {
    w.inv.get_blood_unit(&unit_id).status
}

fn request_status(w: &World, request_id: u64) -> ReqStatus {
    w.req.get_request(&request_id).status
}

fn payment_status(w: &World, payment_id: u64) -> PayStatus {
    w.pay.get_payment(&payment_id).status
}

fn location(w: &World) -> String {
    String::from_str(&w.env, "Hospital-A-GPS")
}

/// Create a request, one unit and a Locked escrow, then allocate them.
fn allocated(w: &World, serial: &str) -> (u64, u64, u64) {
    let request_id = new_request(w);
    let unit_id = register_unit(w, serial);
    let escrow_id = new_escrow(w, request_id);
    w.coord
        .allocate_units(&request_id, &vec![&w.env, unit_id], &escrow_id, &w.admin);
    (request_id, unit_id, escrow_id)
}

fn invocation(
    env: &Env,
    contract: &Address,
    fn_name: &str,
    args: Vec<Val>,
) -> AuthorizedInvocation {
    AuthorizedInvocation {
        function: AuthorizedFunction::Contract((
            contract.clone(),
            Symbol::new(env, fn_name),
            args,
        )),
        sub_invocations: std::vec![],
    }
}

// ── BloodRequest mirror (#1786) ───────────────────────────────────────────────

/// Builds a real `requests::BloodRequest` with every field spelled out and
/// decodes it into the coordinator's mirror. Adding a field to the requests
/// struct breaks this test: the literal below stops compiling, and once it is
/// updated the decode fails until the mirror gets the same field.
#[test]
fn test_blood_request_mirror_matches_requests_contract() {
    let env = Env::default();
    let hospital = Address::generate(&env);
    let org = Address::generate(&env);

    let real = request_contract::BloodRequest {
        id: 7,
        hospital_id: hospital.clone(),
        blood_type: ReqBloodType::ABNegative,
        component: ReqComponent::Platelets,
        quantity_ml: 300,
        urgency: ReqUrgency::Critical,
        created_timestamp: 11,
        required_by_timestamp: 22,
        status: ReqStatus::InProgress,
        assigned_units: vec![&env, 1u64, 2u64],
        fulfilled_quantity_ml: 150,
        reservation_id: Some(9),
        fulfilled_by: Some(org.clone()),
        history_len: 4,
    };

    let val: Val = real.into_val(&env);
    let mirror = BloodRequest::try_from_val(&env, &val)
        .expect("coordinator BloodRequest mirror must decode requests::BloodRequest");

    assert_eq!(
        mirror,
        BloodRequest {
            id: 7,
            hospital_id: hospital,
            blood_type: BloodType::ABNegative,
            component: BloodComponent::Platelets,
            quantity_ml: 300,
            urgency: Urgency::Critical,
            created_timestamp: 11,
            required_by_timestamp: 22,
            status: RequestStatus::InProgress,
            assigned_units: vec![&env, 1u64, 2u64],
            fulfilled_quantity_ml: 150,
            reservation_id: Some(9),
            fulfilled_by: Some(org),
            history_len: 4,
        }
    );
}

// ── End-to-end across the real contracts (#1786, #1788) ──────────────────────

#[test]
fn test_allocate_confirm_settle_real_contracts() {
    let w = setup();
    let request_id = new_request(&w);
    let unit_id = register_unit(&w, "SN-1");
    let escrow_id = new_escrow(&w, request_id);
    assert_eq!(w.token.balance(&w.pay.address), ESCROW_AMOUNT);

    w.coord
        .allocate_units(&request_id, &vec![&w.env, unit_id], &escrow_id, &w.admin);

    let wf = w.coord.get_workflow(&request_id);
    assert_eq!(wf.status, WorkflowStatus::Allocated);
    assert_eq!(wf.payment_id, escrow_id);
    assert_eq!(unit_status(&w, unit_id), InvStatus::Reserved);
    assert_eq!(request_status(&w, request_id), ReqStatus::Approved);

    w.coord.confirm_delivery(&request_id, &w.admin, &location(&w));

    let wf = w.coord.get_workflow(&request_id);
    assert_eq!(wf.status, WorkflowStatus::Delivered);
    assert_eq!(wf.delivery_location, Some(location(&w)));
    assert_eq!(unit_status(&w, unit_id), InvStatus::Delivered);
    assert_eq!(request_status(&w, request_id), ReqStatus::InProgress);

    w.coord.settle_payment(&request_id, &w.admin);

    assert_eq!(
        w.coord.get_workflow(&request_id).status,
        WorkflowStatus::Settled
    );
    assert_eq!(request_status(&w, request_id), ReqStatus::Fulfilled);

    // Coordinator's half of the two-party release is recorded; the tokens move
    // once the hospital confirms receipt.
    assert_eq!(payment_status(&w, escrow_id), PayStatus::Locked);
    w.pay.confirm_receipt(&escrow_id, &w.hospital);
    assert_eq!(payment_status(&w, escrow_id), PayStatus::Released);
    assert_eq!(w.token.balance(&w.blood_bank), ESCROW_AMOUNT);
    assert_eq!(w.token.balance(&w.pay.address), 0);
}

#[test]
fn test_second_allocation_of_settled_request_fails() {
    let w = setup();
    let (request_id, _, escrow_id) = allocated(&w, "SN-1");
    w.coord.confirm_delivery(&request_id, &w.admin, &location(&w));
    w.coord.settle_payment(&request_id, &w.admin);
    assert_eq!(request_status(&w, request_id), ReqStatus::Fulfilled);

    let unit_2 = register_unit(&w, "SN-2");
    let result =
        w.coord
            .try_allocate_units(&request_id, &vec![&w.env, unit_2], &escrow_id, &w.admin);
    assert_eq!(result, Err(Ok(CoordinatorError::WorkflowAlreadyStarted)));

    // Once the terminal workflow record has archived, the request's Fulfilled
    // status still blocks a new allocation.
    w.env.as_contract(&w.coord.address, || {
        w.env
            .storage()
            .persistent()
            .remove(&DataKey::Workflow(request_id));
    });
    let result =
        w.coord
            .try_allocate_units(&request_id, &vec![&w.env, unit_2], &escrow_id, &w.admin);
    assert_eq!(result, Err(Ok(CoordinatorError::InvalidRequestState)));
    assert_eq!(unit_status(&w, unit_2), InvStatus::Available);
}

#[test]
fn test_double_allocation_blocked() {
    let w = setup();
    let (request_id, _, escrow_id) = allocated(&w, "SN-1");

    let unit_2 = register_unit(&w, "SN-2");
    let result =
        w.coord
            .try_allocate_units(&request_id, &vec![&w.env, unit_2], &escrow_id, &w.admin);
    assert_eq!(result, Err(Ok(CoordinatorError::WorkflowAlreadyStarted)));
    assert_eq!(unit_status(&w, unit_2), InvStatus::Available);
}

#[test]
fn test_allocate_rejects_unit_already_reserved() {
    let w = setup();
    let (_, unit_id, _) = allocated(&w, "SN-1");

    let request_2 = new_request(&w);
    let escrow_2 = new_escrow(&w, request_2);
    let result =
        w.coord
            .try_allocate_units(&request_2, &vec![&w.env, unit_id], &escrow_2, &w.admin);
    assert_eq!(result, Err(Ok(CoordinatorError::UnitNotAvailable)));
    assert_eq!(request_status(&w, request_2), ReqStatus::Pending);
}

#[test]
fn test_allocate_rejects_incompatible_unit_and_reserves_nothing() {
    let w = setup();
    let request_id = new_request(&w); // O+ recipient
    let compatible = register_unit(&w, "SN-1");
    let incompatible = w.inv.register_blood(
        &w.inv_admin,
        &String::from_str(&w.env, "SN-2"),
        &InvBloodType::ABNegative,
        &450u32,
        &None,
    );
    let escrow_id = new_escrow(&w, request_id);

    let result = w.coord.try_allocate_units(
        &request_id,
        &vec![&w.env, compatible, incompatible],
        &escrow_id,
        &w.admin,
    );
    assert_eq!(result, Err(Ok(CoordinatorError::IncompatibleBloodType)));
    assert_eq!(unit_status(&w, compatible), InvStatus::Available);
    assert_eq!(request_status(&w, request_id), ReqStatus::Pending);
    assert!(w.coord.try_get_workflow(&request_id).is_err());
}

#[test]
fn test_allocate_rejects_empty_unit_ids() {
    let w = setup();
    let request_id = new_request(&w);
    let escrow_id = new_escrow(&w, request_id);

    let result = w
        .coord
        .try_allocate_units(&request_id, &vec![&w.env], &escrow_id, &w.admin);
    assert_eq!(result, Err(Ok(CoordinatorError::NoUnitsSpecified)));
}

#[test]
fn test_allocate_rejects_payment_of_other_request() {
    let w = setup();
    let request_1 = new_request(&w);
    let request_2 = new_request(&w);
    let unit_id = register_unit(&w, "SN-1");
    let escrow_for_2 = new_escrow(&w, request_2);

    let result =
        w.coord
            .try_allocate_units(&request_1, &vec![&w.env, unit_id], &escrow_for_2, &w.admin);
    assert_eq!(result, Err(Ok(CoordinatorError::PaymentRequestMismatch)));
}

#[test]
fn test_allocate_rejects_non_admin_caller() {
    let w = setup();
    let request_id = new_request(&w);
    let unit_id = register_unit(&w, "SN-1");
    let escrow_id = new_escrow(&w, request_id);
    let attacker = Address::generate(&w.env);

    let result =
        w.coord
            .try_allocate_units(&request_id, &vec![&w.env, unit_id], &escrow_id, &attacker);
    assert_eq!(result, Err(Ok(CoordinatorError::Unauthorized)));
}

// ── Payment binding (#1789) ───────────────────────────────────────────────────

fn assert_allocation_rejected(w: &World, request_id: u64, payment_id: u64, err: CoordinatorError) {
    let unit_id = register_unit(w, "SN-REJECT");
    let result =
        w.coord
            .try_allocate_units(&request_id, &vec![&w.env, unit_id], &payment_id, &w.admin);
    assert_eq!(result, Err(Ok(err)));
    assert_eq!(unit_status(w, unit_id), InvStatus::Available);
    assert_eq!(request_status(w, request_id), ReqStatus::Pending);
    assert!(w.coord.try_get_workflow(&request_id).is_err());
}

#[test]
fn test_allocate_rejects_pending_payment() {
    let w = setup();
    let request_id = new_request(&w);
    let payment_id = w
        .pay
        .create_payment(&request_id, &w.hospital, &w.blood_bank, &ESCROW_AMOUNT);
    assert_eq!(payment_status(&w, payment_id), PayStatus::Pending);

    assert_allocation_rejected(&w, request_id, payment_id, CoordinatorError::PaymentNotLocked);
}

#[test]
fn test_allocate_rejects_disputed_payment() {
    let w = setup();
    let request_id = new_request(&w);
    let escrow_id = new_escrow(&w, request_id);
    w.pay.record_dispute(
        &escrow_id,
        &PayDisputeReason::PaymentContested,
        &String::from_str(&w.env, "CASE-1"),
        &w.hospital,
    );
    assert_eq!(payment_status(&w, escrow_id), PayStatus::Disputed);

    assert_allocation_rejected(&w, request_id, escrow_id, CoordinatorError::PaymentNotLocked);
}

#[test]
fn test_allocate_rejects_locked_payment_without_escrow() {
    let w = setup();
    let request_id = new_request(&w);
    let payment_id = w
        .pay
        .create_payment(&request_id, &w.hospital, &w.blood_bank, &ESCROW_AMOUNT);
    // A bookkeeping payment can be marked Locked by the payments admin without
    // any tokens behind it.
    w.pay
        .update_status(&payment_id, &PayStatus::Locked, &w.coord.address);
    assert_eq!(payment_status(&w, payment_id), PayStatus::Locked);
    assert!(w.pay.get_payment(&payment_id).token.is_none());

    assert_allocation_rejected(
        &w,
        request_id,
        payment_id,
        CoordinatorError::PaymentNotEscrowed,
    );
}

// ── Rollback & expiry (#1787, #1788) ──────────────────────────────────────────

#[test]
fn test_rollback_releases_units_refunds_escrow_and_cancels_request() {
    let w = setup();
    let (request_id, unit_id, escrow_id) = allocated(&w, "SN-1");
    assert_eq!(w.token.balance(&w.hospital), HOSPITAL_FUNDS - ESCROW_AMOUNT);

    w.coord.rollback(&request_id);

    assert_eq!(
        w.coord.get_workflow(&request_id).status,
        WorkflowStatus::RolledBack
    );
    assert_eq!(unit_status(&w, unit_id), InvStatus::Available);
    assert_eq!(payment_status(&w, escrow_id), PayStatus::Refunded);
    assert_eq!(w.token.balance(&w.hospital), HOSPITAL_FUNDS);
    assert_eq!(request_status(&w, request_id), ReqStatus::Cancelled);

    // The rolled-back request cannot be allocated again.
    let unit_2 = register_unit(&w, "SN-2");
    let result =
        w.coord
            .try_allocate_units(&request_id, &vec![&w.env, unit_2], &escrow_id, &w.admin);
    assert_eq!(result, Err(Ok(CoordinatorError::WorkflowAlreadyStarted)));
}

#[test]
fn test_rollback_blocked_after_delivery_and_settlement() {
    let w = setup();
    let (request_id, unit_id, _) = allocated(&w, "SN-1");
    w.coord.confirm_delivery(&request_id, &w.admin, &location(&w));

    assert_eq!(
        w.coord.try_rollback(&request_id),
        Err(Ok(CoordinatorError::InvalidWorkflowState))
    );
    assert_eq!(unit_status(&w, unit_id), InvStatus::Delivered);

    w.coord.settle_payment(&request_id, &w.admin);
    assert_eq!(
        w.coord.try_rollback(&request_id),
        Err(Ok(CoordinatorError::CannotRollbackSettled))
    );
}

#[test]
fn test_confirm_delivery_rejected_after_hospital_cancels_then_rollback_succeeds() {
    let w = setup();
    let (request_id, unit_id, escrow_id) = allocated(&w, "SN-1");

    w.req.cancel_request(
        &w.hospital,
        &request_id,
        &String::from_str(&w.env, "No longer needed"),
    );
    assert_eq!(request_status(&w, request_id), ReqStatus::Cancelled);

    let result = w
        .coord
        .try_confirm_delivery(&request_id, &w.admin, &location(&w));
    assert_eq!(result, Err(Ok(CoordinatorError::InvalidRequestState)));
    assert_eq!(unit_status(&w, unit_id), InvStatus::Reserved);

    // Rollback still unwinds the workflow; the request is already closed.
    w.coord.rollback(&request_id);
    assert_eq!(unit_status(&w, unit_id), InvStatus::Available);
    assert_eq!(payment_status(&w, escrow_id), PayStatus::Refunded);
    assert_eq!(request_status(&w, request_id), ReqStatus::Cancelled);
}

#[test]
fn test_expire_workflow_blocked_before_deadline() {
    let w = setup();
    let (request_id, _, _) = allocated(&w, "SN-1");

    let wf = w.coord.get_workflow(&request_id);
    assert_eq!(wf.expires_at, 1_000 + 6 * 60 * 60);

    assert_eq!(
        w.coord.try_expire_workflow(&request_id),
        Err(Ok(CoordinatorError::WorkflowNotExpired))
    );
}

#[test]
fn test_expire_workflow_not_found() {
    let w = setup();
    assert_eq!(
        w.coord.try_expire_workflow(&9_999u64),
        Err(Ok(CoordinatorError::WorkflowNotFound))
    );
}

/// `expire_workflow` is permissionless: with auth enforcement on and no
/// signatures at all, it releases the units, refunds the escrow and cancels
/// the request. The only authorizations involved are the coordinator's own
/// direct sub-calls, so the recorded auth tree is empty.
#[test]
fn test_expire_workflow_needs_no_signature() {
    let w = setup();
    let (request_id, unit_id, escrow_id) = allocated(&w, "SN-1");

    let expires_at = w.coord.get_workflow(&request_id).expires_at;
    w.env.ledger().with_mut(|l| l.timestamp = expires_at);

    // Stop mocking: enforce auth with no authorization entries.
    w.env.set_auths(&[]);
    w.coord.expire_workflow(&request_id);
    assert_eq!(w.env.auths(), std::vec![]);

    assert_eq!(
        w.coord.get_workflow(&request_id).status,
        WorkflowStatus::RolledBack
    );
    assert_eq!(unit_status(&w, unit_id), InvStatus::Available);
    assert_eq!(payment_status(&w, escrow_id), PayStatus::Refunded);
    assert_eq!(w.token.balance(&w.hospital), HOSPITAL_FUNDS);
    assert_eq!(request_status(&w, request_id), ReqStatus::Cancelled);
}

// ── Exact auth trees (#1787) ──────────────────────────────────────────────────

/// Each workflow step is signed by the coordinator admin alone. Inventory,
/// requests and payments are authorized by the coordinator contract itself,
/// so they never appear in the tree and no inventory-admin key is needed.
#[test]
fn test_workflow_steps_need_only_coordinator_admin_signature() {
    let w = setup();
    let request_id = new_request(&w);
    let unit_id = register_unit(&w, "SN-1");
    let escrow_id = new_escrow(&w, request_id);
    let coord = w.coord.address.clone();

    // allocate_units
    let units = vec![&w.env, unit_id];
    let args: Vec<Val> = (request_id, units.clone(), escrow_id, w.admin.clone()).into_val(&w.env);
    w.env.mock_auths(&[MockAuth {
        address: &w.admin,
        invoke: &MockAuthInvoke {
            contract: &coord,
            fn_name: "allocate_units",
            args: args.clone(),
            sub_invokes: &[],
        },
    }]);
    w.coord
        .allocate_units(&request_id, &units, &escrow_id, &w.admin);
    assert_eq!(
        w.env.auths(),
        std::vec![(
            w.admin.clone(),
            invocation(&w.env, &coord, "allocate_units", args)
        )]
    );

    // confirm_delivery
    let args: Vec<Val> = (request_id, w.admin.clone(), location(&w)).into_val(&w.env);
    w.env.mock_auths(&[MockAuth {
        address: &w.admin,
        invoke: &MockAuthInvoke {
            contract: &coord,
            fn_name: "confirm_delivery",
            args: args.clone(),
            sub_invokes: &[],
        },
    }]);
    w.coord
        .confirm_delivery(&request_id, &w.admin, &location(&w));
    assert_eq!(
        w.env.auths(),
        std::vec![(
            w.admin.clone(),
            invocation(&w.env, &coord, "confirm_delivery", args)
        )]
    );

    // settle_payment
    let args: Vec<Val> = (request_id, w.admin.clone()).into_val(&w.env);
    w.env.mock_auths(&[MockAuth {
        address: &w.admin,
        invoke: &MockAuthInvoke {
            contract: &coord,
            fn_name: "settle_payment",
            args: args.clone(),
            sub_invokes: &[],
        },
    }]);
    w.coord.settle_payment(&request_id, &w.admin);
    assert_eq!(
        w.env.auths(),
        std::vec![(
            w.admin.clone(),
            invocation(&w.env, &coord, "settle_payment", args)
        )]
    );

    assert_eq!(unit_status(&w, unit_id), InvStatus::Delivered);
    assert_eq!(request_status(&w, request_id), ReqStatus::Fulfilled);
}

#[test]
fn test_rollback_needs_only_coordinator_admin_signature() {
    let w = setup();
    let (request_id, unit_id, _) = allocated(&w, "SN-1");
    let coord = w.coord.address.clone();

    let args: Vec<Val> = (request_id,).into_val(&w.env);
    w.env.mock_auths(&[MockAuth {
        address: &w.admin,
        invoke: &MockAuthInvoke {
            contract: &coord,
            fn_name: "rollback",
            args: args.clone(),
            sub_invokes: &[],
        },
    }]);
    w.coord.rollback(&request_id);
    assert_eq!(
        w.env.auths(),
        std::vec![(w.admin.clone(), invocation(&w.env, &coord, "rollback", args))]
    );
    assert_eq!(unit_status(&w, unit_id), InvStatus::Available);
}

#[test]
fn test_inventory_limits_coordinator_to_workflow_transitions() {
    let w = setup();
    let unit_id = register_unit(&w, "SN-1");

    // The coordinator may not expire, compromise or dispose units.
    let result = w
        .inv
        .try_update_status(&unit_id, &InvStatus::Compromised, &w.coord.address, &None);
    assert!(result.is_err());
    assert_eq!(unit_status(&w, unit_id), InvStatus::Available);

    // An address that is not the configured coordinator gets nothing.
    let impostor = Address::generate(&w.env);
    let result = w
        .inv
        .try_update_status(&unit_id, &InvStatus::Reserved, &impostor, &None);
    assert!(result.is_err());
    assert_eq!(unit_status(&w, unit_id), InvStatus::Available);
}

#[test]
fn test_requests_rejects_status_change_from_untrusted_contract() {
    let w = setup();
    let request_id = new_request(&w);
    let impostor = Address::generate(&w.env);

    let result = w.req.try_update_status_by_contract(
        &impostor,
        &request_id,
        &ReqStatus::Fulfilled,
        &String::from_str(&w.env, "forged"),
    );
    assert!(result.is_err());
    assert_eq!(request_status(&w, request_id), ReqStatus::Pending);
}

// ── Sequence enforcement ──────────────────────────────────────────────────────

#[test]
fn test_settle_blocked_without_delivery() {
    let w = setup();
    let (request_id, _, escrow_id) = allocated(&w, "SN-1");

    assert_eq!(
        w.coord.try_settle_payment(&request_id, &w.admin),
        Err(Ok(CoordinatorError::DeliveryNotConfirmed))
    );
    assert_eq!(payment_status(&w, escrow_id), PayStatus::Locked);
    assert_eq!(request_status(&w, request_id), ReqStatus::Approved);
}

#[test]
fn test_confirm_delivery_blocked_before_allocation() {
    let w = setup();
    assert_eq!(
        w.coord.try_confirm_delivery(&99u64, &w.admin, &location(&w)),
        Err(Ok(CoordinatorError::WorkflowNotFound))
    );
}

#[test]
fn test_confirm_delivery_and_settle_reject_non_admin_caller() {
    let w = setup();
    let (request_id, _, _) = allocated(&w, "SN-1");
    let attacker = Address::generate(&w.env);

    assert_eq!(
        w.coord
            .try_confirm_delivery(&request_id, &attacker, &location(&w)),
        Err(Ok(CoordinatorError::Unauthorized))
    );

    w.coord.confirm_delivery(&request_id, &w.admin, &location(&w));
    assert_eq!(
        w.coord.try_settle_payment(&request_id, &attacker),
        Err(Ok(CoordinatorError::Unauthorized))
    );
}

// ── Circuit breakers ──────────────────────────────────────────────────────────

#[test]
fn test_pause_blocks_allocate_and_unpause_restores_it() {
    let w = setup();
    let request_id = new_request(&w);
    let unit_id = register_unit(&w, "SN-1");
    let escrow_id = new_escrow(&w, request_id);

    w.coord.pause(&w.admin);
    assert!(w.coord.is_paused());
    assert_eq!(
        w.coord
            .try_allocate_units(&request_id, &vec![&w.env, unit_id], &escrow_id, &w.admin),
        Err(Ok(CoordinatorError::ContractPaused))
    );

    w.coord.unpause(&w.admin);
    w.coord
        .allocate_units(&request_id, &vec![&w.env, unit_id], &escrow_id, &w.admin);
    assert_eq!(
        w.coord.get_workflow(&request_id).status,
        WorkflowStatus::Allocated
    );
}

#[test]
fn test_non_admin_cannot_pause() {
    let w = setup();
    let attacker = Address::generate(&w.env);
    assert_eq!(
        w.coord.try_pause(&attacker),
        Err(Ok(CoordinatorError::Unauthorized))
    );
    assert!(!w.coord.is_paused());
}

#[test]
fn test_emergency_halt_blocks_settlement_until_cleared() {
    let w = setup();
    let (request_id, _, escrow_id) = allocated(&w, "SN-1");
    w.coord.confirm_delivery(&request_id, &w.admin, &location(&w));

    w.coord.emergency_halt(&w.admin);
    assert_eq!(
        w.coord.try_settle_payment(&request_id, &w.admin),
        Err(Ok(CoordinatorError::EmergencyHalted))
    );

    // unpause() must not lift the halt.
    w.coord.pause(&w.admin);
    w.coord.unpause(&w.admin);
    assert!(w.coord.is_emergency_halted());

    w.coord.clear_emergency_halt(&w.admin);
    w.coord.settle_payment(&request_id, &w.admin);
    assert_eq!(payment_status(&w, escrow_id), PayStatus::Locked);
    assert_eq!(request_status(&w, request_id), ReqStatus::Fulfilled);
}

// ── Admin transfer ────────────────────────────────────────────────────────────

#[test]
fn test_propose_and_accept_admin_transfer() {
    let w = setup();
    let new_admin = Address::generate(&w.env);

    w.coord.propose_admin(&w.admin, &new_admin);
    w.coord.accept_admin(&new_admin);

    w.coord.pause(&new_admin);
    assert!(w.coord.is_paused());
}

#[test]
fn test_accept_admin_wrong_address_fails() {
    let w = setup();
    let new_admin = Address::generate(&w.env);
    let wrong = Address::generate(&w.env);

    w.coord.propose_admin(&w.admin, &new_admin);
    assert_eq!(
        w.coord.try_accept_admin(&wrong),
        Err(Ok(CoordinatorError::Unauthorized))
    );
}
