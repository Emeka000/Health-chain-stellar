#![cfg(test)]

//! Coordinator tests.
//!
//! Most tests register lightweight mock implementations of the three domain
//! contracts (mirroring the coordinator's proxy structs exactly) so that
//! workflow state can be driven directly. `test_allocate_units_end_to_end_real_contracts`
//! additionally registers the *real* requests, inventory and payments contracts
//! and runs the whole allocate → confirm → settle sequence across them.

use soroban_sdk::{
    contract, contractimpl, contracttype, testutils::Address as _, testutils::Ledger as _,
    vec, Address, Env, Map, String, Vec,
};

use super::{
    BloodComponent, BloodRequest, BloodStatus, BloodType, BloodUnit, CoordinatorContract,
    CoordinatorContractClient, CoordinatorError, ExcursionSummary, Payment, PaymentStatus,
    RequestStatus, Urgency, WorkflowStatus,
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

    let coord = CoordinatorContractClient::new(&env, &coord_id);
    coord.initialize(&admin, &req_id, &inv_id, &pay_id);

    MockInventoryContractClient::new(&env, &inv_id).initialize(&admin);
    MockRequestContractClient::new(&env, &req_id).set_inventory(&inv_id);

    Harness {
        env,
        admin,
        coord,
        req_id,
        inv_id,
        pay_id,
    }
}

fn seed_request(h: &Harness, id: u64, status: RequestStatus) -> Address {
    let hospital = Address::generate(&h.env);
    MockRequestContractClient::new(&h.env, &h.req_id).seed_request_with_hospital(
        &id,
        &hospital,
        &status,
        &BloodType::OPositive,
    );
    hospital
}

fn seed_pending_request(h: &Harness, id: u64) -> Address {
    seed_request(h, id, RequestStatus::Pending)
}

fn register_unit(h: &Harness) -> u64 {
    MockInventoryContractClient::new(&h.env, &h.inv_id).register_unit()
}

fn create_locked_payment(h: &Harness, request_id: u64) -> u64 {
    seed_payment(h, request_id, PaymentStatus::Locked)
}

fn seed_unit(h: &Harness, status: BloodStatus) -> u64 {
    MockInventoryContractClient::new(&h.env, &h.inv_id).seed_unit(&BloodType::OPositive, &status)
}

fn seed_unit_of_type(h: &Harness, blood_type: BloodType, status: BloodStatus) -> u64 {
    MockInventoryContractClient::new(&h.env, &h.inv_id).seed_unit(&blood_type, &status)
}

fn seed_payment(h: &Harness, request_id: u64, status: PaymentStatus) -> u64 {
    MockPaymentContractClient::new(&h.env, &h.pay_id).seed_payment(&request_id, &status)
}

fn get_unit(h: &Harness, unit_id: u64) -> BloodUnit {
    MockInventoryContractClient::new(&h.env, &h.inv_id).get_blood_unit(&unit_id)
}

fn get_payment(h: &Harness, payment_id: u64) -> Payment {
    MockPaymentContractClient::new(&h.env, &h.pay_id).get_payment(&payment_id)
}

/// Allocate a single Available unit and a Locked payment for a Pending request.
fn allocate(h: &Harness, request_id: u64, unit_id: u64, payment_id: u64) {
    h.coord.allocate_units(
        &request_id,
        &vec![&h.env, unit_id],
        &payment_id,
        &h.admin,
    );
}

fn allocate_and_deliver(h: &Harness, request_id: u64, unit_id: u64, payment_id: u64) {
    allocate(h, request_id, unit_id, payment_id);
    h.coord.confirm_delivery(
        &request_id,
        &h.admin,
        &String::from_str(&h.env, "Hospital-A-GPS"),
    );
}

// ── Happy path ────────────────────────────────────────────────────────────────

#[test]
fn test_full_happy_path() {
    let h = setup();
    seed_request(&h, 1, RequestStatus::Pending);
    let unit_id = seed_unit(&h, BloodStatus::Available);
    let payment_id = seed_payment(&h, 1, PaymentStatus::Locked);

    allocate(&h, 1, unit_id, payment_id);

    let wf = h.coord.get_workflow(&1u64);
    assert_eq!(wf.status, WorkflowStatus::Allocated);
    assert!(!wf.delivery_confirmed);
    assert_eq!(wf.payment_id, payment_id);
    assert_eq!(wf.unit_ids.get(0).unwrap(), unit_id);
    assert_eq!(get_unit(&h, unit_id).status, BloodStatus::Reserved);
    assert_eq!(get_payment(&h, payment_id).status, PaymentStatus::Locked);

    h.coord.confirm_delivery(
        &1u64,
        &h.admin,
        &String::from_str(&h.env, "Hospital-A-GPS"),
    );

    let wf = h.coord.get_workflow(&1u64);
    assert_eq!(wf.status, WorkflowStatus::Delivered);
    assert!(wf.delivery_confirmed);
    assert_eq!(
        wf.delivery_location,
        Some(String::from_str(&h.env, "Hospital-A-GPS"))
    );
    assert_eq!(get_unit(&h, unit_id).status, BloodStatus::Delivered);

    h.coord.settle_payment(&1u64, &h.admin);

    assert_eq!(h.coord.get_workflow(&1u64).status, WorkflowStatus::Settled);
    assert_eq!(get_payment(&h, payment_id).status, PaymentStatus::Released);
}

// ── Sequence enforcement ──────────────────────────────────────────────────────

#[test]
fn test_settle_blocked_without_delivery() {
    let h = setup();
    seed_request(&h, 1, RequestStatus::Pending);
    let unit_id = seed_unit(&h, BloodStatus::Available);
    let payment_id = seed_payment(&h, 1, PaymentStatus::Locked);

    h.coord.allocate_units(
        &1u64,
        &vec![&h.env, unit_id],
        &payment_id,
        &h.admin,
    );

    let result = h.coord.try_settle_payment(&1u64, &h.admin);
    assert_eq!(result, Err(Ok(CoordinatorError::DeliveryNotConfirmed)));
    assert_eq!(get_payment(&h, payment_id).status, PaymentStatus::Locked);
}

#[test]
fn test_settle_blocked_for_unlocked_payment() {
    let h = setup();
    seed_request(&h, 1, RequestStatus::Pending);
    let unit_id = seed_unit(&h, BloodStatus::Available);
    let payment_id = seed_payment(&h, 1, PaymentStatus::Pending);

    allocate_and_deliver(&h, 1, unit_id, payment_id);

    let result = h.coord.try_settle_payment(&1u64, &h.admin);
    assert_eq!(result, Err(Ok(CoordinatorError::InvalidPaymentState)));
}

#[test]
fn test_double_allocation_blocked() {
    let h = setup();
    seed_request(&h, 1, RequestStatus::Pending);
    let unit_id = seed_unit(&h, BloodStatus::Available);
    let payment_id = seed_payment(&h, 1, PaymentStatus::Locked);

    h.coord.allocate_units(
        &1u64,
        &vec![&h.env, unit_id],
        &payment_id,
        &h.admin,
    );

    let unit_id2 = seed_unit(&h, BloodStatus::Available);
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
    seed_request(&h, 1, RequestStatus::Pending);
    let unit_id = seed_unit(&h, BloodStatus::Reserved);
    let payment_id = seed_payment(&h, 1, PaymentStatus::Locked);

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

    h.coord.allocate_units(
        &1u64,
        &vec![&h.env, unit_id],
        &payment_id,
        &h.admin,
    );
    h.coord
        .confirm_delivery(&1u64, &h.admin, &String::from_str(&h.env, "Hospital-A-GPS"));

    let result = h.coord.try_settle_payment(&1u64, &h.admin);
    assert_eq!(result, Err(Ok(CoordinatorError::InvalidPaymentState)));
}

#[test]
fn test_confirm_delivery_blocked_before_allocation() {
    let h = setup();
    let result = h.coord.try_confirm_delivery(
        &99u64,
        &h.admin,
        &String::from_str(&h.env, "Hospital-A-GPS"),
    );
    assert_eq!(result, Err(Ok(CoordinatorError::WorkflowNotFound)));
}

#[test]
fn test_allocate_blocked_for_non_pending_request() {
    let h = setup();
    seed_request(&h, 1, RequestStatus::Approved);
    let unit_id = seed_unit(&h, BloodStatus::Available);
    let payment_id = seed_payment(&h, 1, PaymentStatus::Locked);

    let result = h.coord.try_allocate_units(
        &1u64,
        &vec![&h.env, unit_id],
        &payment_id,
        &h.admin,
    );
    assert_eq!(result, Err(Ok(CoordinatorError::InvalidRequestState)));
}

#[test]
fn test_allocate_units_rejects_empty_unit_ids() {
    let h = setup();
    seed_request(&h, 1, RequestStatus::Pending);
    let payment_id = seed_payment(&h, 1, PaymentStatus::Locked);

    let result = h.coord.try_allocate_units(
        &1u64,
        &vec![&h.env],
        &payment_id,
        &h.admin,
    );
    assert_eq!(result, Err(Ok(CoordinatorError::NoUnitsSpecified)));
    assert!(h.coord.try_get_workflow(&1u64).is_err());
}

#[test]
fn test_allocate_units_rejects_mismatched_payment() {
    let h = setup();
    seed_request(&h, 1, RequestStatus::Pending);
    seed_request(&h, 2, RequestStatus::Pending);
    let unit_id = seed_unit(&h, BloodStatus::Available);
    let payment_for_request_2 = seed_payment(&h, 2, PaymentStatus::Locked);

    let result = h.coord.try_allocate_units(
        &1u64,
        &vec![&h.env, unit_id],
        &payment_for_request_2,
        &h.admin,
    );
    assert_eq!(result, Err(Ok(CoordinatorError::PaymentRequestMismatch)));
    assert!(h.coord.try_get_workflow(&1u64).is_err());
}

#[test]
fn test_allocate_units_rejects_incompatible_unit_blood_type() {
    let h = setup();
    seed_request(&h, 1, RequestStatus::Pending);
    // AB- units cannot donate to an O+ recipient.
    let unit_id = MockInventoryContractClient::new(&h.env, &h.inv_id)
        .seed_unit(&BloodType::ABNegative, &BloodStatus::Available);
    let payment_id = seed_payment(&h, 1, PaymentStatus::Locked);

    let result = h.coord.try_allocate_units(
        &1u64,
        &vec![&h.env, unit_id],
        &payment_id,
        &h.admin,
    );
    assert_eq!(result, Err(Ok(CoordinatorError::IncompatibleBloodType)));
}

// ── Rollback & expiry ─────────────────────────────────────────────────────────

#[test]
fn test_rollback_releases_units_and_refunds_payment() {
    let h = setup();
    seed_request(&h, 1, RequestStatus::Pending);
    let unit_id = seed_unit(&h, BloodStatus::Available);
    let payment_id = seed_payment(&h, 1, PaymentStatus::Locked);

    allocate(&h, 1, unit_id, payment_id);
    h.coord.rollback(&1u64);

    assert_eq!(
        h.coord.get_workflow(&1u64).status,
        WorkflowStatus::RolledBack
    );
    assert_eq!(get_unit(&h, unit_id).status, BloodStatus::Available);
    assert_eq!(get_payment(&h, payment_id).status, PaymentStatus::Refunded);
}

#[test]
fn test_rollback_leaves_other_payment_states_untouched() {
    let h = setup();
    seed_request(&h, 1, RequestStatus::Pending);
    let unit_id = seed_unit(&h, BloodStatus::Available);
    let payment_id = seed_payment(&h, 1, PaymentStatus::Pending);

    seed_pending_request(&h, 20);
    let unit_id = register_unit(&h);
    let pay_id = create_locked_payment(&h, 20);
    h.coord.allocate_units(
        &20u64,
        &vec![&h.env, unit_id],
        &pay_id,
        &h.admin,
    );
    assert_eq!(
        h.coord.get_workflow(&20u64).status,
        WorkflowStatus::Allocated
    );
}

#[test]
fn test_rollback_blocked_after_settlement() {
    let h = setup();
    seed_request(&h, 1, RequestStatus::Pending);
    let unit_id = seed_unit(&h, BloodStatus::Available);
    let payment_id = seed_payment(&h, 1, PaymentStatus::Locked);

    allocate_and_deliver(&h, 1, unit_id, payment_id);
    h.coord.settle_payment(&1u64, &h.admin);

    let result = h.coord.try_rollback(&1u64);
    assert_eq!(result, Err(Ok(CoordinatorError::CannotRollbackSettled)));
}

#[test]
fn test_rollback_blocked_after_delivery() {
    let h = setup();
    seed_request(&h, 1, RequestStatus::Pending);
    let unit_id = seed_unit(&h, BloodStatus::Available);
    let payment_id = seed_payment(&h, 1, PaymentStatus::Locked);

    allocate_and_deliver(&h, 1, unit_id, payment_id);

    let result = h.coord.try_rollback(&1u64);
    assert_eq!(result, Err(Ok(CoordinatorError::InvalidWorkflowState)));
    assert_eq!(h.coord.get_workflow(&1u64).status, WorkflowStatus::Delivered);
    assert_ne!(get_unit(&h, unit_id).status, BloodStatus::Available);
}

#[test]
fn test_allocate_units_allows_reallocation_after_rollback() {
    let h = setup();
    seed_request(&h, 1, RequestStatus::Pending);
    let unit_id = seed_unit(&h, BloodStatus::Available);
    let payment_id = seed_payment(&h, 1, PaymentStatus::Locked);

    allocate(&h, 1, unit_id, payment_id);
    h.coord.rollback(&1u64);

    seed_request(&h, 1, RequestStatus::Pending);
    let unit_id2 = seed_unit(&h, BloodStatus::Available);
    let payment_id2 = seed_payment(&h, 1, PaymentStatus::Locked);

    let result = h.coord.try_allocate_units(
        &1u64,
        &vec![&h.env, unit_id2],
        &payment_id2,
        &h.admin,
    );
    assert!(result.is_ok());

    let wf = h.coord.get_workflow(&1u64);
    assert_eq!(wf.status, WorkflowStatus::Allocated);
    assert_eq!(wf.payment_id, payment_id2);
}

#[test]
fn test_expire_workflow_rolls_back_after_deadline() {
    let h = setup();
    h.env.ledger().with_mut(|l| l.timestamp = 1_000);

    seed_request(&h, 1, RequestStatus::Pending);
    let unit_id = seed_unit(&h, BloodStatus::Available);
    let payment_id = seed_payment(&h, 1, PaymentStatus::Locked);

    allocate(&h, 1, unit_id, payment_id);

    let wf = h.coord.get_workflow(&1u64);
    assert_eq!(wf.expires_at, 1_000 + 6 * 60 * 60);

    h.env.ledger().with_mut(|l| l.timestamp = wf.expires_at + 1);
    h.coord.expire_workflow(&1u64);

    assert_eq!(
        h.coord.get_workflow(&1u64).status,
        WorkflowStatus::RolledBack
    );
    assert_eq!(get_unit(&h, unit_id).status, BloodStatus::Available);
    assert_eq!(get_payment(&h, payment_id).status, PaymentStatus::Refunded);
}

#[test]
fn test_expire_workflow_blocked_before_deadline() {
    let h = setup();
    h.env.ledger().with_mut(|l| l.timestamp = 1_000);

    seed_pending_request(&h, 1);
    let unit_id = register_unit(&h);
    let payment_id = create_locked_payment(&h, 1);
    allocate(&h, 1, unit_id, payment_id);

    // Time has NOT advanced past expires_at.
    let result = h.coord.try_expire_workflow(&1u64);
    assert_eq!(
        result,
        Err(Ok(CoordinatorError::WorkflowNotExpired)),
        "expire_workflow must fail before deadline"
    );
}

#[test]
fn test_expire_workflow_not_found() {
    let h = setup();
    let result = h.coord.try_expire_workflow(&9999u64);
    assert_eq!(result, Err(Ok(CoordinatorError::WorkflowNotFound)));
}

// ── Pause circuit breaker ─────────────────────────────────────────────────────

#[test]
fn test_pause_blocks_allocate_units() {
    let h = setup();
    h.coord.pause(&h.admin);
    assert!(h.coord.is_paused());

    seed_request(&h, 1, RequestStatus::Pending);
    let unit_id = seed_unit(&h, BloodStatus::Available);
    let payment_id = seed_payment(&h, 1, PaymentStatus::Locked);

    let result = h.coord.try_allocate_units(
        &1u64,
        &vec![&h.env, unit_id],
        &payment_id,
        &h.admin,
    );
    assert_eq!(result, Err(Ok(CoordinatorError::ContractPaused)));
}

#[test]
fn test_pause_allows_get_workflow_and_unpause_restores_writes() {
    let h = setup();
    seed_request(&h, 1, RequestStatus::Pending);
    let unit_id = seed_unit(&h, BloodStatus::Available);
    let payment_id = seed_payment(&h, 1, PaymentStatus::Locked);
    allocate(&h, 1, unit_id, payment_id);

    h.coord.pause(&h.admin);
    assert_eq!(h.coord.get_workflow(&1u64).request_id, 1);

    h.coord.unpause(&h.admin);
    assert!(!h.coord.is_paused());

    h.coord
        .confirm_delivery(&1u64, &h.admin, &String::from_str(&h.env, "Location-A"));
    assert_eq!(h.coord.get_workflow(&1u64).status, WorkflowStatus::Delivered);
}

#[test]
fn test_rollback_blocked_when_paused() {
    let h = setup();
    seed_pending_request(&h, 1);
    seed_pending_request(&h, 2);
    let unit_id1 = register_unit(&h);
    let unit_id2 = register_unit(&h);

    // Create payment for request 2
    let payment_id_for_req2 = create_locked_payment(&h, 2);
    // Allocate request 1 with payment for request 1
    let payment_id_for_req1 = create_locked_payment(&h, 1);
    h.coord.allocate_units(
        &1u64,
        &vec![&h.env, unit_id1],
        &payment_id_for_req1,
        &h.admin,
    );

    h.coord.pause(&h.admin);
    let result = h.coord.try_rollback(&1u64);
    assert_eq!(result, Err(Ok(CoordinatorError::ContractPaused)));
    assert_eq!(h.coord.get_workflow(&1u64).status, WorkflowStatus::Allocated);
}

#[test]
fn test_non_admin_cannot_pause() {
    let h = setup();
    let attacker = Address::generate(&h.env);
    let result = h.coord.try_pause(&attacker);
    assert_eq!(result, Err(Ok(CoordinatorError::Unauthorized)));
    assert!(!h.coord.is_paused());
}

// ── Emergency halt ────────────────────────────────────────────────────────────

#[test]
fn test_emergency_halt_blocks_workflow_steps() {
    let h = setup();
    seed_request(&h, 1, RequestStatus::Pending);
    let unit_id = seed_unit(&h, BloodStatus::Available);
    let payment_id = seed_payment(&h, 1, PaymentStatus::Locked);
    allocate_and_deliver(&h, 1, unit_id, payment_id);

    h.coord.emergency_halt(&h.admin);
    assert!(h.coord.is_emergency_halted());

    let result = h.coord.try_settle_payment(&1u64, &h.admin);
    assert_eq!(result, Err(Ok(CoordinatorError::EmergencyHalted)));
    assert_eq!(get_payment(&h, payment_id).status, PaymentStatus::Locked);
}

#[test]
fn test_emergency_halt_blocks_new_allocations() {
    let h = setup();
    seed_request(&h, 1, RequestStatus::Pending);
    let unit_id = seed_unit(&h, BloodStatus::Available);
    let payment_id = seed_payment(&h, 1, PaymentStatus::Locked);

    h.coord.emergency_halt(&h.admin);

    let result = h.coord.try_allocate_units(
        &1u64,
        &vec![&h.env, unit_id],
        &payment_id,
        &h.admin,
    );
    assert_eq!(result, Err(Ok(CoordinatorError::EmergencyHalted)));
}

#[test]
fn test_emergency_halt_non_admin_fails() {
    let h = setup();
    let attacker = Address::generate(&h.env);

    let result = h.coord.try_emergency_halt(&attacker);
    assert_eq!(result, Err(Ok(CoordinatorError::Unauthorized)));
    assert!(!h.coord.is_emergency_halted());
}

#[test]
fn test_clear_emergency_halt_restores_operation() {
    let h = setup();
    seed_request(&h, 1, RequestStatus::Pending);
    let unit_id = seed_unit(&h, BloodStatus::Available);
    let payment_id = seed_payment(&h, 1, PaymentStatus::Locked);
    allocate_and_deliver(&h, 1, unit_id, payment_id);

    h.coord.emergency_halt(&h.admin);
    assert!(h.coord.is_emergency_halted());

    h.coord.clear_emergency_halt(&h.admin);
    assert!(!h.coord.is_emergency_halted());

    h.coord.settle_payment(&1u64, &h.admin);
    assert_eq!(get_payment(&h, payment_id).status, PaymentStatus::Released);
}

#[test]
fn test_clear_emergency_halt_non_admin_fails() {
    let h = setup();
    let attacker = Address::generate(&h.env);
    h.coord.emergency_halt(&h.admin);

    let result = h.coord.try_clear_emergency_halt(&attacker);
    assert_eq!(result, Err(Ok(CoordinatorError::Unauthorized)));
    assert!(h.coord.is_emergency_halted());
}

#[test]
fn test_unpause_does_not_clear_emergency_halt() {
    let h = setup();
    h.coord.emergency_halt(&h.admin);
    h.coord.pause(&h.admin);
    h.coord.unpause(&h.admin);

    assert!(h.coord.is_emergency_halted());

    seed_request(&h, 1, RequestStatus::Pending);
    let unit_id = seed_unit(&h, BloodStatus::Available);
    let payment_id = seed_payment(&h, 1, PaymentStatus::Locked);

    let result = h.coord.try_allocate_units(
        &1u64,
        &vec![&h.env, unit_id],
        &payment_id,
        &h.admin,
    );
    assert_eq!(result, Err(Ok(CoordinatorError::EmergencyHalted)));
}

// ── Role checks on workflow entry points ──────────────────────────────────────

#[test]
fn test_allocate_units_rejects_non_admin_caller() {
    let h = setup();
    seed_request(&h, 1, RequestStatus::Pending);
    let unit_id = seed_unit(&h, BloodStatus::Available);
    let payment_id = seed_payment(&h, 1, PaymentStatus::Locked);
    let attacker = Address::generate(&h.env);

    let result = h.coord.try_allocate_units(
        &1u64,
        &vec![&h.env, unit_id],
        &payment_id,
        &attacker,
    );
    assert_eq!(result, Err(Ok(CoordinatorError::Unauthorized)));
}

#[test]
fn test_confirm_delivery_rejects_non_admin_caller() {
    let h = setup();
    seed_pending_request(&h, 1);
    let unit_id = register_unit(&h);
    let payment_id = create_locked_payment(&h, 1);
    h.coord.allocate_units(
        &1u64,
        &vec![&h.env, unit_id],
        &payment_id,
        &h.admin,
    );

    let attacker = Address::generate(&h.env);
    let result = h.coord.try_confirm_delivery(
        &1u64,
        &attacker,
        &String::from_str(&h.env, "Fabricated-Location"),
    );
    assert_eq!(result, Err(Ok(CoordinatorError::Unauthorized)));
}

#[test]
fn test_settle_payment_rejects_non_admin_caller() {
    let h = setup();
    seed_pending_request(&h, 1);
    let unit_id = register_unit(&h);
    let payment_id = create_locked_payment(&h, 1);
    h.coord.allocate_units(
        &1u64,
        &vec![&h.env, unit_id],
        &payment_id,
        &h.admin,
    );
    h.coord
        .confirm_delivery(&1u64, &h.admin, &String::from_str(&h.env, "Hospital-A"));

    let attacker = Address::generate(&h.env);
    let result = h.coord.try_settle_payment(&1u64, &attacker);
    assert_eq!(result, Err(Ok(CoordinatorError::Unauthorized)));
}

// ── report_temperature_breach: ids must belong to the workflow ────────────────

#[test]
fn test_report_temperature_breach_disputes_bound_payment() {
    let h = setup();
    seed_request(&h, 1, RequestStatus::Pending);
    let unit_id = seed_unit(&h, BloodStatus::Available);
    let payment_id = seed_payment(&h, 1, PaymentStatus::Locked);
    allocate_and_deliver(&h, 1, unit_id, payment_id);

    h.coord
        .report_temperature_breach(&1u64, &unit_id, &payment_id);

    assert_eq!(get_payment(&h, payment_id).status, PaymentStatus::Disputed);
}

#[test]
fn test_report_temperature_breach_rejects_unit_outside_workflow() {
    let h = setup();
    seed_request(&h, 1, RequestStatus::Pending);
    let allocated_unit = seed_unit(&h, BloodStatus::Available);
    let unrelated_unit = seed_unit(&h, BloodStatus::Available);
    let payment_id = seed_payment(&h, 1, PaymentStatus::Locked);
    allocate_and_deliver(&h, 1, allocated_unit, payment_id);

    let result = h
        .coord
        .try_report_temperature_breach(&1u64, &unrelated_unit, &payment_id);
    assert_eq!(result, Err(Ok(CoordinatorError::UnitNotFound)));
    assert_eq!(get_payment(&h, payment_id).status, PaymentStatus::Locked);
}

#[test]
fn test_report_temperature_breach_rejects_payment_of_other_request() {
    let h = setup();
    seed_request(&h, 1, RequestStatus::Pending);
    seed_request(&h, 2, RequestStatus::Pending);
    let unit_id = seed_unit(&h, BloodStatus::Available);
    let payment_id = seed_payment(&h, 1, PaymentStatus::Locked);
    let other_requests_payment = seed_payment(&h, 2, PaymentStatus::Locked);
    allocate_and_deliver(&h, 1, unit_id, payment_id);

    let result = h.coord.try_report_temperature_breach(
        &1u64,
        &unit_id,
        &other_requests_payment,
    );
    assert_eq!(result, Err(Ok(CoordinatorError::PaymentRequestMismatch)));
    assert_eq!(
        get_payment(&h, other_requests_payment).status,
        PaymentStatus::Locked,
        "an unrelated hospital's escrow must not be frozen"
    );
}

#[test]
fn test_report_temperature_breach_blocked_when_halted() {
    let h = setup();
    seed_request(&h, 1, RequestStatus::Pending);
    let unit_id = seed_unit(&h, BloodStatus::Available);
    let payment_id = seed_payment(&h, 1, PaymentStatus::Locked);
    allocate_and_deliver(&h, 1, unit_id, payment_id);

    h.coord.emergency_halt(&h.admin);

    let result = h
        .coord
        .try_report_temperature_breach(&1u64, &unit_id, &payment_id);
    assert_eq!(result, Err(Ok(CoordinatorError::EmergencyHalted)));
}

// ── flag_temperature_breach (temperature oracle path) ─────────────────────────

fn make_excursion(unit_id: u64) -> ExcursionSummary {
    ExcursionSummary {
        unit_id,
        violation_count: 3,
        peak_celsius_x100: 1200,
        detected_at: 1000,
    }
}

#[test]
fn test_flag_temperature_breach_transitions_locked_to_disputed() {
    let h = setup();
    let payment_id = seed_payment(&h, 99, PaymentStatus::Locked);

    h.coord
        .flag_temperature_breach(&h.admin, &payment_id, &make_excursion(42));

    assert_eq!(get_payment(&h, payment_id).status, PaymentStatus::Disputed);
}

#[test]
fn test_flag_temperature_breach_allows_configured_oracle() {
    let h = setup();
    let payment_id = seed_payment(&h, 99, PaymentStatus::Locked);
    let oracle = Address::generate(&h.env);
    h.coord.set_temperature_oracle(&h.admin, &oracle);

    h.coord
        .flag_temperature_breach(&oracle, &payment_id, &make_excursion(42));

    assert_eq!(get_payment(&h, payment_id).status, PaymentStatus::Disputed);
}

#[test]
fn test_flag_temperature_breach_rejects_unconfigured_caller() {
    let h = setup();
    let payment_id = seed_payment(&h, 99, PaymentStatus::Locked);
    let attacker = Address::generate(&h.env);

    let result =
        h.coord
            .try_flag_temperature_breach(&attacker, &payment_id, &make_excursion(42));
    assert_eq!(result, Err(Ok(CoordinatorError::Unauthorized)));
}

#[test]
fn test_flag_temperature_breach_non_locked_payment_fails() {
    let h = setup();
    seed_pending_request(&h, 1);
    let unit_id = register_unit(&h);
    let payment_id = create_locked_payment(&h, 1);

    h.coord.allocate_units(
        &1u64,
        &vec![&h.env, unit_id],
        &payment_id,
        &h.admin,
    );

    h.coord.confirm_delivery(
        &1u64,
        &h.admin,
        &String::from_str(&h.env, "Hospital-A-GPS"),
    );

    let result = h
        .coord
        .try_flag_temperature_breach(&h.admin, &payment_id, &make_excursion(1));
    assert_eq!(result, Err(Ok(CoordinatorError::InvalidPaymentState)));
}

#[test]
fn test_flag_temperature_breach_missing_payment_fails() {
    let h = setup();
    let result = h
        .coord
        .try_flag_temperature_breach(&h.admin, &9999u64, &make_excursion(1));
    assert_eq!(result, Err(Ok(CoordinatorError::PaymentNotFound)));
}

#[test]
fn test_flag_temperature_breach_blocked_when_paused() {
    let h = setup();
    let payment_id = seed_payment(&h, 1, PaymentStatus::Locked);
    h.coord.pause(&h.admin);

    let result = h
        .coord
        .try_flag_temperature_breach(&h.admin, &payment_id, &make_excursion(1));
    assert_eq!(result, Err(Ok(CoordinatorError::ContractPaused)));
    assert_eq!(get_payment(&h, payment_id).status, PaymentStatus::Locked);
}

#[test]
fn test_set_temperature_oracle_rejects_non_admin_caller() {
    let h = setup();
    let attacker = Address::generate(&h.env);
    let oracle = Address::generate(&h.env);

    let result = h.coord.try_set_temperature_oracle(&attacker, &oracle);
    assert_eq!(result, Err(Ok(CoordinatorError::Unauthorized)));
}

// ── Admin transfer ────────────────────────────────────────────────────────────

#[test]
fn test_propose_and_accept_admin_transfer() {
    let h = setup();
    let new_admin = Address::generate(&h.env);

    h.coord.propose_admin(&h.admin, &new_admin);
    h.coord.accept_admin(&new_admin);

    // The new admin can drive admin-only entry points.
    h.coord.pause(&new_admin);
    assert!(h.coord.is_paused());
}

#[test]
fn test_accept_admin_wrong_address_fails() {
    let h = setup();
    let new_admin = Address::generate(&h.env);
    let wrong_address = Address::generate(&h.env);

    h.coord.propose_admin(&h.admin, &new_admin);
    let result = h.coord.try_accept_admin(&wrong_address);
    assert_eq!(result, Err(Ok(CoordinatorError::Unauthorized)));
}

#[test]
fn test_propose_admin_non_admin_fails() {
    let h = setup();
    let attacker = Address::generate(&h.env);
    let new_admin = Address::generate(&h.env);

    let result = h.coord.try_propose_admin(&attacker, &new_admin);
    assert_eq!(result, Err(Ok(CoordinatorError::Unauthorized)));
}

// ── End-to-end across the real requests / inventory / payments contracts ──────

/// Acceptance test for #1616: the coordinator mirrors the full `BloodRequest`,
/// `BloodUnit` and `Payment` structs, so the real contracts' return values
/// decode. This drives the whole workflow against the real domain contracts.
#[test]
fn test_allocate_units_blocks_for_active_non_terminal_workflow() {
    let h = setup();
    seed_pending_request(&h, 7);
    let unit_id1 = register_unit(&h);
    let payment_id = create_locked_payment(&h, 7);

    // First allocation succeeds
    h.coord.allocate_units(
        &7u64,
        &vec![&h.env, unit_id1],
        &payment_id,
        &h.admin,
    );

    assert_eq!(
        h.coord.get_workflow(&7u64).status,
        WorkflowStatus::Allocated
    );

    // Attempt to allocate again for the same request with different units
    let unit_id2 = register_unit(&h);
    let result = h.coord.try_allocate_units(
        &7u64,
        &vec![&h.env, unit_id2],
        &payment_id,
        &h.admin,
    );
    assert_eq!(result, Err(Ok(CoordinatorError::WorkflowAlreadyStarted)));
}

/// #1313: allocate_units should allow re-allocation after a Settled workflow.
/// Once payment is settled, the workflow is terminal and can be replaced.
#[test]
fn test_allocate_units_allows_reallocation_after_settled() {
    let h = setup();
    seed_pending_request(&h, 9);
    let unit_id1 = register_unit(&h);
    let payment_id = create_locked_payment(&h, 9);

    // First allocation through settlement
    h.coord.allocate_units(
        &9u64,
        &vec![&h.env, unit_id1],
        &payment_id,
        &h.admin,
    );

    h.coord
        .confirm_delivery(&9u64, &h.admin, &String::from_str(&h.env, "Hospital-C"));
    h.coord.settle_payment(&9u64, &h.admin);

    assert_eq!(
        h.coord.get_workflow(&9u64).status,
        WorkflowStatus::Settled
    );

    seed_pending_request(&h, 9);
    let unit_id2 = register_unit(&h);
    let payment_id2 = create_locked_payment(&h, 9);

    let result = h.coord.try_allocate_units(
        &9u64,
        &vec![&h.env, unit_id2],
        &payment_id2,
        &h.admin,
    );
    assert!(result.is_ok());

    // New allocation should have replaced the old settled one
    let wf = h.coord.get_workflow(&9u64);
    assert_eq!(wf.status, WorkflowStatus::Allocated);
    assert_eq!(wf.payment_id, payment_id2);
}

// ── Inventory reservation (#1608) ─────────────────────────────────────────────

#[test]
fn test_allocate_rejects_unit_already_in_active_workflow() {
    let h = setup();
    seed_pending_request(&h, 1);
    seed_pending_request(&h, 2);
    let unit_id = register_unit(&h);
    let payment_1 = create_locked_payment(&h, 1);
    let payment_2 = create_locked_payment(&h, 2);

    h.coord
        .allocate_units(&1u64, &vec![&h.env, unit_id], &payment_1, &h.admin);

    let result =
        h.coord
            .try_allocate_units(&2u64, &vec![&h.env, unit_id], &payment_2, &h.admin);
    assert_eq!(result, Err(Ok(CoordinatorError::UnitNotAvailable)));
}

#[test]
fn test_allocate_rejects_duplicate_unit_in_same_call() {
    let h = setup();
    seed_pending_request(&h, 1);
    let unit_id = register_unit(&h);
    let payment_id = create_locked_payment(&h, 1);

    let result = h.coord.try_allocate_units(
        &1u64,
        &vec![&h.env, unit_id, unit_id],
        &payment_id,
        &h.admin,
    );
    assert_eq!(result, Err(Ok(CoordinatorError::UnitNotAvailable)));

    let unit = MockInventoryContractClient::new(&h.env, &h.inv_id).get_blood_unit(&unit_id);
    assert_eq!(unit.status, BloodStatus::Available);
}

#[test]
fn test_confirm_delivery_marks_every_unit_delivered() {
    let h = setup();
    seed_pending_request(&h, 1);
    let unit_1 = register_unit(&h);
    let unit_2 = register_unit(&h);
    let unit_3 = register_unit(&h);
    let payment_id = create_locked_payment(&h, 1);

    h.coord.allocate_units(
        &1u64,
        &vec![&h.env, unit_1, unit_2, unit_3],
        &payment_id,
        &h.admin,
    );

    let inv = MockInventoryContractClient::new(&h.env, &h.inv_id);
    for unit_id in [unit_1, unit_2, unit_3] {
        assert_eq!(inv.get_blood_unit(&unit_id).status, BloodStatus::Reserved);
    }

    h.coord
        .confirm_delivery(&1u64, &h.admin, &String::from_str(&h.env, "Hospital-A-GPS"));

    for unit_id in [unit_1, unit_2, unit_3] {
        assert_eq!(inv.get_blood_unit(&unit_id).status, BloodStatus::Delivered);
    }
}

// ── ABO/Rh compatibility (#1609) ──────────────────────────────────────────────

fn seed_request_of_type(h: &Harness, id: u64, blood_type: BloodType) {
    let hospital = Address::generate(&h.env);
    MockRequestContractClient::new(&h.env, &h.req_id).seed_request_with_hospital(
        &id,
        &hospital,
        &RequestStatus::Pending,
        &blood_type,
    );
}

fn register_unit_of_type(h: &Harness, blood_type: BloodType) -> u64 {
    MockInventoryContractClient::new(&h.env, &h.inv_id).register_unit_of_type(&blood_type)
}

#[test]
fn test_allocate_rejects_incompatible_unit_for_o_negative_recipient() {
    let h = setup();
    seed_request_of_type(&h, 1, BloodType::ONegative);
    let unit_id = register_unit_of_type(&h, BloodType::APositive);
    let payment_id = create_locked_payment(&h, 1);

    let result =
        h.coord
            .try_allocate_units(&1u64, &vec![&h.env, unit_id], &payment_id, &h.admin);
    assert_eq!(result, Err(Ok(CoordinatorError::IncompatibleBloodType)));
}

#[test]
fn test_allocate_accepts_o_negative_unit_for_o_negative_recipient() {
    let h = setup();
    seed_request_of_type(&h, 1, BloodType::ONegative);
    let unit_id = register_unit_of_type(&h, BloodType::ONegative);
    let payment_id = create_locked_payment(&h, 1);

    h.coord
        .allocate_units(&1u64, &vec![&h.env, unit_id], &payment_id, &h.admin);
    assert_eq!(
        h.coord.get_workflow(&1u64).status,
        WorkflowStatus::Allocated
    );
}

#[test]
fn test_allocate_accepts_any_unit_for_ab_positive_recipient() {
    let h = setup();
    seed_request_of_type(&h, 1, BloodType::ABPositive);
    let units = vec![
        &h.env,
        register_unit_of_type(&h, BloodType::APositive),
        register_unit_of_type(&h, BloodType::BNegative),
        register_unit_of_type(&h, BloodType::ABNegative),
        register_unit_of_type(&h, BloodType::OPositive),
    ];
    let payment_id = create_locked_payment(&h, 1);

    h.coord.allocate_units(&1u64, &units, &payment_id, &h.admin);
    assert_eq!(
        h.coord.get_workflow(&1u64).status,
        WorkflowStatus::Allocated
    );
}

#[test]
fn test_allocate_rejects_rh_mismatch_and_reserves_nothing() {
    let h = setup();
    seed_request_of_type(&h, 1, BloodType::ANegative);
    // A- is compatible; A+ is the same ABO group but Rh-positive.
    let compatible = register_unit_of_type(&h, BloodType::ANegative);
    let rh_mismatch = register_unit_of_type(&h, BloodType::APositive);
    let payment_id = create_locked_payment(&h, 1);

    let result = h.coord.try_allocate_units(
        &1u64,
        &vec![&h.env, compatible, rh_mismatch],
        &payment_id,
        &h.admin,
    );
    assert_eq!(result, Err(Ok(CoordinatorError::IncompatibleBloodType)));

    // The failed call must not leave the compatible unit reserved.
    let inv = MockInventoryContractClient::new(&h.env, &h.inv_id);
    assert_eq!(inv.get_blood_unit(&compatible).status, BloodStatus::Available);
    assert!(h.coord.try_get_workflow(&1u64).is_err());
}

// ── Escrow settlement against the real payments contract (#1611) ─────────────

struct EscrowHarness<'a> {
    h: Harness<'a>,
    pay: payment_contract::PaymentContractClient<'a>,
    token: soroban_sdk::token::Client<'a>,
    hospital: Address,
    blood_bank: Address,
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

    let token = soroban_sdk::token::Client::new(&env, &token_id);

    EscrowHarness {
        h: Harness {
            env,
            admin,
            coord,
            req_id,
            inv_id,
            pay_id,
        },
        pay,
        token,
        hospital,
        blood_bank,
    }
}

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

    assert_eq!(
        e.pay.get_payment(&escrow_id).status,
        payment_contract::PaymentStatus::Released
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

#[test]
fn test_settle_escrow_pays_out_immediately_when_hospital_confirmed_first() {
    let e = setup_with_escrow();
    let escrow_id = allocate_and_deliver_escrow(&e, 1);

    e.pay.confirm_receipt(&escrow_id, &e.hospital);
    assert_eq!(e.token.balance(&e.blood_bank), 0);

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

    h.coord.rollback(&1u64);

    assert_eq!(
        e.pay.get_payment(&escrow_id).status,
        payment_contract::PaymentStatus::Refunded
    );
    assert_eq!(e.token.balance(&e.hospital), 1_000);
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
