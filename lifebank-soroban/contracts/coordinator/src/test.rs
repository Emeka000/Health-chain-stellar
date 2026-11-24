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
    contract, contractimpl, contracttype, testutils::Address as _, testutils::Ledger as _,
    vec, Address, Env, Map, String, Vec,
};

use super::{
    BloodComponent, BloodRequest, BloodStatus, BloodType, BloodUnit, CoordinatorContract,
    CoordinatorContractClient, CoordinatorError, ExcursionSummary, Payment, PaymentStatus,
    RequestStatus, Urgency, WorkflowStatus,
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


// ── Mock: Requests contract ───────────────────────────────────────────────────

#[contracttype]
enum ReqKey {
    Request(u64),
    Hospital(u64),
    Inventory,
}

/// Default request volume; matches the default mock unit volume so single-unit
/// allocations cover the request.
const DEFAULT_REQUEST_ML: u32 = 450;

fn make_request(
    env: &Env,
    id: u64,
    hospital: Address,
    status: RequestStatus,
    blood_type: BloodType,
    quantity_ml: u32,
) -> BloodRequest {
    BloodRequest {
        id,
        hospital_id: hospital,
        blood_type,
        component: BloodComponent::WholeBlood,
        quantity_ml,
        urgency: Urgency::Routine,
        created_timestamp: 0,
        required_by_timestamp: u64::MAX,
        status,
        assigned_units: Vec::new(env),
        fulfilled_quantity_ml: 0,
        reservation_id: None,
        fulfilled_by: None,
        history_len: 0,
    }
}

#[contract]
struct MockRequestContract;

#[contractimpl]
impl MockRequestContract {
    /// Point the mock at the inventory mock so cancellation can release the
    /// request's reservation, as the real requests contract does.
    pub fn set_inventory(env: Env, inventory: Address) {
        env.storage().instance().set(&ReqKey::Inventory, &inventory);
    }

    pub fn seed_request(env: Env, id: u64, status: RequestStatus) {
        Self::seed_request_of_type(env, id, status, BloodType::OPositive);
    }

    pub fn seed_request_of_type(env: Env, id: u64, status: RequestStatus, blood_type: BloodType) {
        let hospital = env.current_contract_address();
        Self::seed_request_with_hospital(env, id, hospital, status, blood_type);
    }

    pub fn seed_request_with_hospital(
        env: Env,
        id: u64,
        hospital: Address,
        status: RequestStatus,
        blood_type: BloodType,
    ) {
        Self::seed_request_with_quantity(env, id, hospital, status, blood_type, DEFAULT_REQUEST_ML);
    }

    pub fn seed_request_with_quantity(
        env: Env,
        id: u64,
        hospital: Address,
        status: RequestStatus,
        blood_type: BloodType,
        quantity_ml: u32,
    ) {
        env.storage().persistent().set(
            &ReqKey::Request(id),
            &make_request(&env, id, hospital.clone(), status, blood_type, quantity_ml),
        );
        env.storage()
            .persistent()
            .set(&ReqKey::Hospital(id), &hospital);
    }

    pub fn get_hospital(env: Env, request_id: u64) -> Address {
        env.storage()
            .persistent()
            .get(&ReqKey::Hospital(request_id))
            .expect("hospital not found")
    }

    pub fn get_request(env: Env, request_id: u64) -> BloodRequest {
        env.storage()
            .persistent()
            .get(&ReqKey::Request(request_id))
            .expect("request not found")
    }

    pub fn get_admin(env: Env) -> Address {
        env.current_contract_address()
    }

    pub fn update_request_status(
        env: Env,
        _caller: Address,
        request_id: u64,
        new_status: RequestStatus,
        _reason: String,
    ) {
        let mut request = Self::get_request(env.clone(), request_id);
        request.status = new_status;
        env.storage()
            .persistent()
            .set(&ReqKey::Request(request_id), &request);
    }

    pub fn set_reservation_id(env: Env, _caller: Address, request_id: u64, reservation_id: u64) {
        let mut request = Self::get_request(env.clone(), request_id);
        assert!(request.reservation_id.is_none(), "reservation already set");
        request.reservation_id = Some(reservation_id);
        env.storage()
            .persistent()
            .set(&ReqKey::Request(request_id), &request);
    }

    /// Mirrors the real `cancel_request`: Pending/Approved only, and the
    /// request's inventory reservation is released.
    pub fn cancel_request(env: Env, _caller: Address, request_id: u64, _reason: String) {
        let mut request = Self::get_request(env.clone(), request_id);
        assert!(matches!(
            request.status,
            RequestStatus::Pending | RequestStatus::Approved
        ));
        if let Some(res_id) = request.reservation_id {
            let inventory: Address = env.storage().instance().get(&ReqKey::Inventory).unwrap();
            MockInventoryContractClient::new(&env, &inventory)
                .release_reservation(&env.current_contract_address(), &res_id);
            request.reservation_id = None;
        }
        request.status = RequestStatus::Cancelled;
        env.storage()
            .persistent()
            .set(&ReqKey::Request(request_id), &request);
    }
}

// ── Mock: Inventory contract ──────────────────────────────────────────────────

#[contracttype]
enum InvKey {
    Unit(u64),
    Counter,
    Admin,
    Bank,
    Reservation(u64),
    ReservationCounter,
}

/// Mirrors inventory's `Reservation`.
#[contracttype]
#[derive(Clone, Debug)]
struct MockReservation {
    unit_ids: Vec<u64>,
    requester: Address,
    expiration_timestamp: u64,
    request_id: u64,
}

#[contract]
struct MockInventoryContract;

#[contractimpl]
impl MockInventoryContract {
    pub fn initialize(env: Env, admin: Address) {
        env.storage().instance().set(&InvKey::Admin, &admin);
        env.storage().instance().set(&InvKey::Counter, &0u64);
        env.storage().instance().set(&InvKey::Bank, &admin);
    }

    pub fn get_admin(env: Env) -> Address {
        env.storage().instance().get(&InvKey::Admin).unwrap()
    }

    pub fn register_unit(env: Env) -> u64 {
        Self::register_unit_of_type(env, BloodType::OPositive)
    }

    pub fn register_unit_of_type(env: Env, blood_type: BloodType) -> u64 {
        Self::seed_unit(env, blood_type, BloodStatus::Available)
    }

    pub fn seed_unit(env: Env, blood_type: BloodType, status: BloodStatus) -> u64 {
        let bank: Address = env.storage().instance().get(&InvKey::Bank).unwrap();
        Self::seed_unit_full(env, blood_type, status, 450, bank)
    }

    pub fn seed_unit_full(
        env: Env,
        blood_type: BloodType,
        status: BloodStatus,
        quantity_ml: u32,
        bank_id: Address,
    ) -> u64 {
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
                blood_type,
                quantity_ml,
                bank_id,
                donor_id: None,
                donation_timestamp: 0,
                expiration_timestamp: u64::MAX,
                status,
                metadata: Map::new(&env),
            },
        );
        id
    }

    pub fn get_blood_unit(env: Env, blood_unit_id: u64) -> BloodUnit {
        env.storage()
            .persistent()
            .get(&InvKey::Unit(blood_unit_id))
            .expect("unit not found")
    }

    pub fn update_status(
        env: Env,
        unit_id: u64,
        new_status: BloodStatus,
        _authorized_by: Address,
        _reason: Option<String>,
    ) -> BloodUnit {
        let mut unit = Self::get_blood_unit(env.clone(), unit_id);
        unit.status = new_status;
        env.storage()
            .persistent()
            .set(&InvKey::Unit(unit_id), &unit);
        unit
    }

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

    /// Mirrors the real `reserve_blood`: every unit must be Available, owned
    /// by `requester` and listed once; all of them move to Reserved.
    pub fn reserve_blood(
        env: Env,
        requester: Address,
        _hospital_id: Address,
        unit_ids: Vec<u64>,
        request_id: u64,
        duration_seconds: u64,
    ) -> u64 {
        for i in 0..unit_ids.len() {
            let uid = unit_ids.get(i).unwrap();
            for j in (i + 1)..unit_ids.len() {
                assert_ne!(uid, unit_ids.get(j).unwrap(), "duplicate unit");
            }
            let unit = Self::get_blood_unit(env.clone(), uid);
            assert_eq!(unit.bank_id, requester, "not unit owner");
            assert_eq!(unit.status, BloodStatus::Available, "unit not available");
        }
        for i in 0..unit_ids.len() {
            Self::update_status(
                env.clone(),
                unit_ids.get(i).unwrap(),
                BloodStatus::Reserved,
                requester.clone(),
                None,
            );
        }
        let id: u64 = env
            .storage()
            .instance()
            .get(&InvKey::ReservationCounter)
            .unwrap_or(0u64)
            + 1;
        env.storage()
            .instance()
            .set(&InvKey::ReservationCounter, &id);
        env.storage().persistent().set(
            &InvKey::Reservation(id),
            &MockReservation {
                unit_ids,
                requester,
                expiration_timestamp: env.ledger().timestamp() + duration_seconds,
                request_id,
            },
        );
        id
    }

    pub fn has_reservation(env: Env, reservation_id: u64) -> bool {
        env.storage()
            .persistent()
            .has(&InvKey::Reservation(reservation_id))
    }

    pub fn release_reservation(env: Env, _caller: Address, reservation_id: u64) {
        let reservation: MockReservation = env
            .storage()
            .persistent()
            .get(&InvKey::Reservation(reservation_id))
            .expect("reservation not found");
        for i in 0..reservation.unit_ids.len() {
            let uid = reservation.unit_ids.get(i).unwrap();
            if Self::get_blood_unit(env.clone(), uid).status == BloodStatus::Reserved {
                Self::update_status(
                    env.clone(),
                    uid,
                    BloodStatus::Available,
                    reservation.requester.clone(),
                    None,
                );
            }
        }
        env.storage()
            .persistent()
            .remove(&InvKey::Reservation(reservation_id));
    }

    pub fn expire_reservation(env: Env, reservation_id: u64) {
        let reservation: MockReservation = env
            .storage()
            .persistent()
            .get(&InvKey::Reservation(reservation_id))
            .expect("reservation not found");
        assert!(
            env.ledger().timestamp() >= reservation.expiration_timestamp,
            "reservation not expired"
        );
        Self::release_reservation(env.clone(), env.current_contract_address(), reservation_id);
    }
}

// ── Mock: Temperature contract ────────────────────────────────────────────────

#[contracttype]
enum TempKey {
    Compromised(u64),
}

#[contract]
struct MockTemperatureContract;

#[contractimpl]
impl MockTemperatureContract {
    pub fn set_compromised(env: Env, unit_id: u64, compromised: bool) {
        env.storage()
            .persistent()
            .set(&TempKey::Compromised(unit_id), &compromised);
    }

    pub fn is_compromised(env: Env, unit_id: u64) -> bool {
        env.storage()
            .persistent()
            .get(&TempKey::Compromised(unit_id))
            .unwrap_or(false)
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
    /// Test helper — seed a payment for `request_id` with the given status.
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
                payer: env.current_contract_address(),
                payee: env.current_contract_address(),
                amount: 100,
                status,
                created_at: 0,
                updated_at: 0,
                dispute_reason_code: None,
                dispute_case_id: None,
                dispute_resolved: false,
                token: None,
            },
        );
        id
    }

    pub fn get_payment(env: Env, payment_id: u64) -> Payment {
        env.storage()
            .persistent()
            .get(&PayKey::Payment(payment_id))
            .expect("payment not found")
    }

    pub fn update_status(env: Env, payment_id: u64, status: PaymentStatus, _caller: Address) {
        let mut payment = Self::get_payment(env.clone(), payment_id);
        payment.status = status;
        env.storage()
            .persistent()
            .set(&PayKey::Payment(payment_id), &payment);
    }

    /// Mirror of the payments contract's `refund_locked_payment`: only a
    /// Locked payment is refunded; any other state is left untouched.
    pub fn refund_locked_payment(env: Env, payment_id: u64, _caller: Address) {
        let mut p: Payment = env
            .storage()
            .persistent()
            .get(&PayKey::Payment(payment_id))
            .unwrap();
        if p.status == PaymentStatus::Locked {
            p.status = PaymentStatus::Refunded;
        }
        env.storage()
            .persistent()
            .set(&PayKey::Payment(payment_id), &p);
    }

    pub fn record_dispute(
        env: Env,
        payment_id: u64,
        _reason: super::payment_client::DisputeReason,
        case_id: String,
        _caller: Address,
    ) {
        let mut payment = Self::get_payment(env.clone(), payment_id);
        payment.status = PaymentStatus::Disputed;
        payment.dispute_case_id = Some(case_id);
        payment.dispute_resolved = false;
        env.storage()
            .persistent()
            .set(&PayKey::Payment(payment_id), &payment);
    }
}

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

    MockInventoryContractClient::new(&env, &inv_id).initialize(&admin);
    MockRequestContractClient::new(&env, &req_id).set_inventory(&inv_id);

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

/// Like `setup`, but the payment contract is the real one. The payments admin
/// stays a separate key and the coordinator is registered as its settlement
/// coordinator, so it can drive release_escrow / refund_escrow (#1792).
fn setup_with_escrow<'a>() -> EscrowHarness<'a> {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let hospital = Address::generate(&env);
    let blood_bank = Address::generate(&env);

    let req_id = env.register(MockRequestContract, ());
    let inv_id = env.register(MockInventoryContract, ());
    let pay_id = env.register(payment_contract::PaymentContract, ());
    let coord_id = env.register(CoordinatorContract, ());

    MockInventoryContractClient::new(&env, &inv_id).initialize(&admin);
    MockRequestContractClient::new(&env, &req_id).set_inventory(&inv_id);

    let token_id = env
        .register_stellar_asset_contract_v2(admin.clone())
        .address();
    soroban_sdk::token::StellarAssetClient::new(&env, &token_id).mint(&hospital, &1_000);

    let pay = payment_contract::PaymentContractClient::new(&env, &pay_id);
    pay.initialize(&admin, &Some(req_id.clone()));
    pay.add_allowed_token(&admin, &token_id);
    pay.set_coordinator(&admin, &coord_id);

    let coord = CoordinatorContractClient::new(&env, &coord_id);
    coord.initialize(&admin, &req_id, &inv_id, &pay_id);

#[test]
fn test_propose_and_accept_admin_transfer() {
    let w = setup();
    let new_admin = Address::generate(&w.env);

    w.coord.propose_admin(&w.admin, &new_admin);
    w.coord.accept_admin(&new_admin);

fn seed_escrow_request(e: &EscrowHarness, request_id: u64) {
    MockRequestContractClient::new(&e.h.env, &e.h.req_id).seed_request_with_hospital(
        &request_id,
        &e.hospital,
        &RequestStatus::Pending,
        &BloodType::OPositive,
    );
}

fn allocate_and_deliver_escrow(e: &EscrowHarness, request_id: u64) -> u64 {
    let h = &e.h;
    seed_escrow_request(e, request_id);
    let unit_id = register_unit(h);
    let escrow_id = e.pay.create_escrow(
        &request_id,
        &e.hospital,
        &e.blood_bank,
        &500,
        &e.token.address,
    );
    h.coord
        .allocate_units(&request_id, &vec![&h.env, unit_id], &escrow_id, &h.admin);
    h.coord.confirm_delivery(
        &request_id,
        &h.admin,
        &String::from_str(&h.env, "Hospital-A-GPS"),
    );
    escrow_id
}

#[test]
fn test_settle_escrow_pays_out_after_hospital_confirms_receipt() {
    let e = setup_with_escrow();
    let escrow_id = allocate_and_deliver_escrow(&e, 1);
    assert_eq!(e.token.balance(&e.pay.address), 500);

    e.h.coord.settle_payment(&1u64, &e.h.admin);

    // Coordinator's half of the two-party release is recorded; funds stay
    // locked until the hospital confirms receipt, so the workflow must not be
    // Settled yet (#1790).
    assert_eq!(
        e.h.coord.get_workflow(&1u64).status,
        WorkflowStatus::AwaitingReceipt
    );
    assert_eq!(
        e.pay.get_payment(&escrow_id).status,
        payment_contract::PaymentStatus::Locked
    );
    assert_eq!(e.token.balance(&e.blood_bank), 0);

    // Finalizing before the hospital confirms is refused.
    assert_eq!(
        e.h.coord.try_finalize_settlement(&1u64),
        Err(Ok(CoordinatorError::ReceiptNotConfirmed))
    );

    e.pay.confirm_receipt(&escrow_id, &e.hospital);

    w.coord.propose_admin(&w.admin, &new_admin);
    assert_eq!(
        w.coord.try_accept_admin(&wrong),
        Err(Ok(CoordinatorError::Unauthorized))
    );
    assert_eq!(e.token.balance(&e.blood_bank), 500);
    assert_eq!(e.token.balance(&e.pay.address), 0);

    // Once the hospital has confirmed, the workflow can be finalized.
    e.h.coord.finalize_settlement(&1u64);
    assert_eq!(
        e.h.coord.get_workflow(&1u64).status,
        WorkflowStatus::Settled
    );
}

#[test]
fn test_awaiting_receipt_workflow_can_be_rolled_back() {
    let e = setup_with_escrow();
    let escrow_id = allocate_and_deliver_escrow(&e, 1);
    e.h.coord.settle_payment(&1u64, &e.h.admin);
    assert_eq!(
        e.h.coord.get_workflow(&1u64).status,
        WorkflowStatus::AwaitingReceipt
    );

    e.h.coord.rollback(&1u64);

    assert_eq!(
        e.h.coord.get_workflow(&1u64).status,
        WorkflowStatus::RolledBack
    );
    assert_eq!(
        e.pay.get_payment(&escrow_id).status,
        payment_contract::PaymentStatus::Refunded
    );
    assert_eq!(e.token.balance(&e.hospital), 1_000);
}

#[test]
fn test_awaiting_receipt_workflow_expires_and_refunds() {
    let e = setup_with_escrow();
    let escrow_id = allocate_and_deliver_escrow(&e, 1);
    e.h.coord.settle_payment(&1u64, &e.h.admin);

    let wf = e.h.coord.get_workflow(&1u64);
    assert_eq!(wf.status, WorkflowStatus::AwaitingReceipt);
    assert_eq!(
        e.h.coord.try_expire_workflow(&1u64),
        Err(Ok(CoordinatorError::WorkflowNotExpired))
    );

    e.h.env.ledger().with_mut(|l| l.timestamp = wf.expires_at);
    e.h.coord.expire_workflow(&1u64);

    assert_eq!(
        e.h.coord.get_workflow(&1u64).status,
        WorkflowStatus::RolledBack
    );
    assert_eq!(
        e.pay.get_payment(&escrow_id).status,
        payment_contract::PaymentStatus::Refunded
    );
}

// ── Instance storage TTL ──────────────────────────────────────────────────────

    e.h.coord.settle_payment(&1u64, &e.h.admin);

    assert_eq!(
        e.pay.get_payment(&escrow_id).status,
        payment_contract::PaymentStatus::Released
    );
    assert_eq!(e.token.balance(&e.blood_bank), 500);
    assert_eq!(
        e.h.coord.get_workflow(&1u64).status,
        WorkflowStatus::Settled
    );
}

#[test]
fn test_rollback_refunds_escrow_to_hospital() {
    let e = setup_with_escrow();
    let h = &e.h;
    seed_escrow_request(&e, 1);
    let unit_id = register_unit(h);
    let escrow_id = e
        .pay
        .create_escrow(&1u64, &e.hospital, &e.blood_bank, &500, &e.token.address);
    h.coord
        .allocate_units(&1u64, &vec![&h.env, unit_id], &escrow_id, &h.admin);
    assert_eq!(e.token.balance(&e.hospital), 500);

    advance_past_default_instance_ttl(&h.env);
    assert!(h.coord.is_initialized());
    h.coord.pause(&h.admin);
    assert!(h.coord.is_paused());

    advance_past_default_instance_ttl(&h.env);
    h.coord.unpause(&h.admin);
    assert!(!h.coord.is_paused());
    let oracle = Address::generate(&h.env);
    h.coord.set_temperature_oracle(&h.admin, &oracle);

    advance_past_default_instance_ttl(&h.env);
    assert!(h.coord.is_initialized());
    assert!(!h.coord.is_emergency_halted());
}

// ── Cold-chain checks against the temperature contract (#1791) ───────────────

fn setup_temperature(h: &Harness) -> MockTemperatureContractClient<'_> {
    let temp_id = h.env.register(MockTemperatureContract, ());
    h.coord.set_temperature_contract(&h.admin, &temp_id);
    assert_eq!(h.coord.get_temperature_contract(), Some(temp_id.clone()));
    MockTemperatureContractClient::new(&h.env, &temp_id)
}

#[test]
fn test_confirm_delivery_rejects_compromised_unit() {
    let h = setup();
    let temp = setup_temperature(&h);
    seed_pending_request(&h, 1);
    let unit_id = register_unit(&h);
    let payment_id = create_locked_payment(&h, 1);
    allocate(&h, 1, unit_id, payment_id);

    temp.set_compromised(&unit_id, &true);

    let result = h.coord.try_confirm_delivery(
        &1u64,
        &h.admin,
        &String::from_str(&h.env, "Hospital-A-GPS"),
    );
    assert_eq!(result, Err(Ok(CoordinatorError::UnitCompromised)));
    assert_eq!(h.coord.get_workflow(&1u64).status, WorkflowStatus::Allocated);
    assert_eq!(get_unit(&h, unit_id).status, BloodStatus::Reserved);
    assert_eq!(get_payment(&h, payment_id).status, PaymentStatus::Locked);

    // The undeliverable workflow can be unwound, refunding the payment.
    h.coord.rollback(&1u64);
    assert_eq!(get_payment(&h, payment_id).status, PaymentStatus::Refunded);
    assert_eq!(get_unit(&h, unit_id).status, BloodStatus::Available);
}

#[test]
fn test_settle_payment_rejects_unit_compromised_after_delivery() {
    let h = setup();
    let temp = setup_temperature(&h);
    seed_pending_request(&h, 1);
    let unit_id = register_unit(&h);
    let payment_id = create_locked_payment(&h, 1);
    allocate_and_deliver(&h, 1, unit_id, payment_id);

    temp.set_compromised(&unit_id, &true);

    let result = h.coord.try_settle_payment(&1u64, &h.admin);
    assert_eq!(result, Err(Ok(CoordinatorError::UnitCompromised)));
    assert_eq!(get_payment(&h, payment_id).status, PaymentStatus::Locked);
    assert_eq!(h.coord.get_workflow(&1u64).status, WorkflowStatus::Delivered);
}

#[test]
fn test_uncompromised_units_deliver_and_settle_with_temperature_contract() {
    let h = setup();
    let _temp = setup_temperature(&h);
    seed_pending_request(&h, 1);
    let unit_id = register_unit(&h);
    let payment_id = create_locked_payment(&h, 1);
    allocate_and_deliver(&h, 1, unit_id, payment_id);
    h.coord.settle_payment(&1u64, &h.admin);

    assert_eq!(h.coord.get_workflow(&1u64).status, WorkflowStatus::Settled);
    assert_eq!(get_payment(&h, payment_id).status, PaymentStatus::Released);
}

#[test]
fn test_set_temperature_contract_rejects_non_admin_caller() {
    let h = setup();
    let attacker = Address::generate(&h.env);
    let result = h
        .coord
        .try_set_temperature_contract(&attacker, &Address::generate(&h.env));
    assert_eq!(result, Err(Ok(CoordinatorError::Unauthorized)));
}

// ── Allocation through inventory reservations (#1793) ────────────────────────

#[test]
fn test_allocate_records_reservation_and_cancel_releases_units() {
    let h = setup();
    seed_pending_request(&h, 1);
    let unit_id = register_unit(&h);
    let payment_id = create_locked_payment(&h, 1);
    allocate(&h, 1, unit_id, payment_id);

    let req_client = MockRequestContractClient::new(&h.env, &h.req_id);
    let inv = MockInventoryContractClient::new(&h.env, &h.inv_id);
    let request = req_client.get_request(&1u64);
    let reservation_id = request.reservation_id.expect("reservation id recorded");
    assert_eq!(request.status, RequestStatus::Approved);
    assert!(inv.has_reservation(&reservation_id));
    assert_eq!(get_unit(&h, unit_id).status, BloodStatus::Reserved);

    req_client.cancel_request(&h.admin, &1u64, &String::from_str(&h.env, "Not needed"));

    assert_eq!(get_unit(&h, unit_id).status, BloodStatus::Available);
    assert!(!inv.has_reservation(&reservation_id));
}

#[test]
fn test_allocate_rejects_under_allocation() {
    let h = setup();
    MockRequestContractClient::new(&h.env, &h.req_id).seed_request_with_quantity(
        &1u64,
        &Address::generate(&h.env),
        &RequestStatus::Pending,
        &BloodType::OPositive,
        &2_000u32,
    );
    let unit_id = register_unit(&h); // 450 ml
    let payment_id = create_locked_payment(&h, 1);

    let result =
        h.coord
            .try_allocate_units(&1u64, &vec![&h.env, unit_id], &payment_id, &h.admin);
    assert_eq!(result, Err(Ok(CoordinatorError::InsufficientQuantity)));
    assert_eq!(get_unit(&h, unit_id).status, BloodStatus::Available);
    assert!(h.coord.try_get_workflow(&1u64).is_err());
    assert_eq!(
        MockRequestContractClient::new(&h.env, &h.req_id)
            .get_request(&1u64)
            .reservation_id,
        None
    );
}

#[test]
fn test_allocate_accepts_units_covering_requested_quantity() {
    let h = setup();
    MockRequestContractClient::new(&h.env, &h.req_id).seed_request_with_quantity(
        &1u64,
        &Address::generate(&h.env),
        &RequestStatus::Pending,
        &BloodType::OPositive,
        &1_000u32,
    );
    let units = vec![
        &h.env,
        register_unit(&h),
        register_unit(&h),
        register_unit(&h),
    ]; // 3 × 450 ml
    let payment_id = create_locked_payment(&h, 1);

    h.coord.allocate_units(&1u64, &units, &payment_id, &h.admin);
    assert_eq!(h.coord.get_workflow(&1u64).status, WorkflowStatus::Allocated);
}

#[test]
fn test_allocate_rejects_units_from_multiple_banks() {
    let h = setup();
    seed_pending_request(&h, 1);
    let inv = MockInventoryContractClient::new(&h.env, &h.inv_id);
    let own_unit = register_unit(&h);
    let other_bank_unit = inv.seed_unit_full(
        &BloodType::OPositive,
        &BloodStatus::Available,
        &450u32,
        &Address::generate(&h.env),
    );
    let payment_id = create_locked_payment(&h, 1);

    let result = h.coord.try_allocate_units(
        &1u64,
        &vec![&h.env, own_unit, other_bank_unit],
        &payment_id,
        &h.admin,
    );
    assert_eq!(result, Err(Ok(CoordinatorError::MixedBloodBanks)));
    assert_eq!(get_unit(&h, own_unit).status, BloodStatus::Available);
}

#[test]
fn test_rollback_releases_inventory_reservation() {
    let h = setup();
    seed_pending_request(&h, 1);
    let unit_id = register_unit(&h);
    let payment_id = create_locked_payment(&h, 1);
    allocate(&h, 1, unit_id, payment_id);

    let reservation_id = MockRequestContractClient::new(&h.env, &h.req_id)
        .get_request(&1u64)
        .reservation_id
        .unwrap();

    h.coord.rollback(&1u64);

    let inv = MockInventoryContractClient::new(&h.env, &h.inv_id);
    assert!(!inv.has_reservation(&reservation_id));
    assert_eq!(get_unit(&h, unit_id).status, BloodStatus::Available);
    assert_eq!(get_payment(&h, payment_id).status, PaymentStatus::Refunded);
}
