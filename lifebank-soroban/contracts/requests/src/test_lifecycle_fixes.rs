//! Regression tests for:
//! - #1811: a failed inventory release returns a typed error instead of panicking.
//! - #1806: overdue requests can be expired permissionlessly.
//! - #1812: hospitals can list their full request history, including closed requests.
//! - #1813: `initialize` does not authorize the admin as a hospital.

use crate::inventory_client::InventoryReservation;
use crate::{
    BloodComponent, BloodType, ContractError, RequestContract, RequestContractClient,
    RequestStatus, Urgency,
};
use soroban_sdk::{
    contract, contracterror, contractimpl, symbol_short,
    testutils::{Address as _, Ledger as _},
    Address, Env, String, Vec,
};

/// Mirrors the inventory contract's error codes used by the release path.
#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum MockInventoryError {
    ReservationNotFound = 150,
    ContractPaused = 160,
}

/// Inventory mock that can be paused. While paused, releasing a reservation
/// fails with `ContractPaused`, exactly like the real inventory contract's
/// `require_not_paused` guard.
#[contract]
pub struct PausableInventory;

#[contractimpl]
impl PausableInventory {
    pub fn set_paused(env: Env, paused: bool) {
        env.storage()
            .instance()
            .set(&symbol_short!("paused"), &paused);
    }

    pub fn released(env: Env) -> u32 {
        env.storage()
            .instance()
            .get(&symbol_short!("released"))
            .unwrap_or(0)
    }

    pub fn release_reservation_by_contract(
        env: Env,
        _authorized_contract: Address,
        _reservation_id: u64,
    ) -> Result<(), MockInventoryError> {
        let paused: bool = env
            .storage()
            .instance()
            .get(&symbol_short!("paused"))
            .unwrap_or(false);
        if paused {
            return Err(MockInventoryError::ContractPaused);
        }
        let released = Self::released(env.clone()) + 1;
        env.storage()
            .instance()
            .set(&symbol_short!("released"), &released);
        Ok(())
    }

    /// Store a reservation for `request_id` so `set_reservation_id` (which
    /// validates the reservation, #1809) accepts it.
    pub fn seed_reservation(env: Env, reservation_id: u64, request_id: u64, requester: Address) {
        let reservation = InventoryReservation {
            unit_ids: Vec::new(&env),
            requester: requester.clone(),
            reserved_by: requester,
            created_timestamp: 0,
            expiration_timestamp: u64::MAX,
            request_id,
        };
        env.storage()
            .persistent()
            .set(&reservation_id, &reservation);
    }

    pub fn get_reservation(
        env: Env,
        reservation_id: u64,
    ) -> Result<InventoryReservation, MockInventoryError> {
        env.storage()
            .persistent()
            .get(&reservation_id)
            .ok_or(MockInventoryError::ReservationNotFound)
    }
}

struct Harness<'a> {
    env: Env,
    client: RequestContractClient<'a>,
    inventory: PausableInventoryClient<'a>,
    admin: Address,
    hospital: Address,
}

fn setup<'a>() -> Harness<'a> {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().set_timestamp(1_000);

    let inventory_id = env.register(PausableInventory, ());
    let inventory = PausableInventoryClient::new(&env, &inventory_id);

    let contract_id = env.register(RequestContract, ());
    let client = RequestContractClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    client.initialize(&admin, &inventory_id);

    let hospital = Address::generate(&env);
    client.authorize_hospital(&hospital);

    Harness {
        env,
        client,
        inventory,
        admin,
        hospital,
    }
}

fn create(h: &Harness<'_>, required_by: u64) -> u64 {
    h.client.create_request(
        &h.hospital,
        &BloodType::OPositive,
        &BloodComponent::WholeBlood,
        &500u32,
        &Urgency::Urgent,
        &required_by,
    )
}

fn approve(h: &Harness<'_>, request_id: u64) {
    h.client.update_request_status(
        &h.admin,
        &request_id,
        &RequestStatus::Approved,
        &String::from_str(&h.env, "Approved"),
    );
}

/// Approved request holding inventory reservation 7.
fn reserved_request(h: &Harness<'_>, required_by: u64) -> u64 {
    let request_id = create(h, required_by);
    approve(h, request_id);
    h.inventory
        .seed_reservation(&7u64, &request_id, &Address::generate(&h.env));
    h.client.set_reservation_id(&h.admin, &request_id, &7u64);
    request_id
}

// ── #1811: failed inventory release returns a typed error ────────────────────

#[test]
fn test_cancel_with_paused_inventory_returns_typed_error() {
    let h = setup();
    let request_id = reserved_request(&h, 5_000);
    h.inventory.set_paused(&true);

    let result = h.client.try_cancel_request(
        &h.hospital,
        &request_id,
        &String::from_str(&h.env, "no longer needed"),
    );
    assert_eq!(result, Err(Ok(ContractError::InventoryReleaseFailed)));

    // Nothing changed: the request still holds its reservation and is open.
    let request = h.client.get_request(&request_id);
    assert_eq!(request.status, RequestStatus::Approved);
    assert_eq!(request.reservation_id, Some(7));
    assert_eq!(
        h.client
            .get_requests_by_hospital(&h.hospital, &0, &10)
            .len(),
        1
    );
}

#[test]
fn test_cancel_by_contract_with_paused_inventory_returns_typed_error() {
    let h = setup();
    let request_id = reserved_request(&h, 5_000);
    let payments = Address::generate(&h.env);
    h.client.set_payments_contract(&payments);
    h.inventory.set_paused(&true);

    let result = h.client.try_cancel_request_by_contract(
        &payments,
        &request_id,
        &String::from_str(&h.env, "Dispute expired; escrow auto-refunded"),
    );
    assert_eq!(result, Err(Ok(ContractError::InventoryReleaseFailed)));
    assert_eq!(
        h.client.get_request(&request_id).status,
        RequestStatus::Approved
    );
}

#[test]
fn test_reject_with_paused_inventory_returns_typed_error() {
    let h = setup();
    let request_id = reserved_request(&h, 5_000);
    h.inventory.set_paused(&true);

    let result = h.client.try_update_request_status(
        &h.admin,
        &request_id,
        &RequestStatus::Rejected,
        &String::from_str(&h.env, "no stock"),
    );
    assert_eq!(result, Err(Ok(ContractError::InventoryReleaseFailed)));
    assert_eq!(h.client.get_request(&request_id).reservation_id, Some(7));
}

#[test]
fn test_cancel_succeeds_once_inventory_unpaused() {
    let h = setup();
    let request_id = reserved_request(&h, 5_000);
    h.inventory.set_paused(&true);
    let reason = String::from_str(&h.env, "no longer needed");
    assert!(h
        .client
        .try_cancel_request(&h.hospital, &request_id, &reason)
        .is_err());

    h.inventory.set_paused(&false);
    h.client.cancel_request(&h.hospital, &request_id, &reason);

    let request = h.client.get_request(&request_id);
    assert_eq!(request.status, RequestStatus::Cancelled);
    assert_eq!(request.reservation_id, None);
    assert_eq!(h.inventory.released(), 1);
}

#[test]
fn test_cancel_without_reservation_ignores_paused_inventory() {
    let h = setup();
    let request_id = create(&h, 5_000);
    h.inventory.set_paused(&true);

    h.client.cancel_request(
        &h.hospital,
        &request_id,
        &String::from_str(&h.env, "no longer needed"),
    );
    assert_eq!(
        h.client.get_request(&request_id).status,
        RequestStatus::Cancelled
    );
}

// ── #1806: expire_request ────────────────────────────────────────────────────

#[test]
fn test_expire_request_fails_before_deadline() {
    let h = setup();
    let request_id = create(&h, 5_000);

    h.env.ledger().set_timestamp(4_999);
    assert_eq!(
        h.client.try_expire_request(&request_id),
        Err(Ok(ContractError::RequestNotExpired))
    );

    // The deadline itself is still in time.
    h.env.ledger().set_timestamp(5_000);
    assert_eq!(
        h.client.try_expire_request(&request_id),
        Err(Ok(ContractError::RequestNotExpired))
    );
    assert_eq!(
        h.client.get_request(&request_id).status,
        RequestStatus::Pending
    );
}

#[test]
fn test_expire_pending_request_after_deadline() {
    let h = setup();
    let request_id = create(&h, 5_000);

    h.env.ledger().set_timestamp(5_001);
    h.client.expire_request(&request_id);

    let request = h.client.get_request(&request_id);
    assert_eq!(request.status, RequestStatus::Cancelled);
    let last = h.client.get_request_history(&request_id).last().unwrap();
    assert_eq!(last.previous_status, RequestStatus::Pending);
    assert_eq!(last.new_status, RequestStatus::Cancelled);
    assert_eq!(last.reason, String::from_str(&h.env, "Request expired"));
    assert_eq!(last.actor, h.client.address);
    assert!(!last.released_reservation);

    // Leaves the open index but stays in the hospital's history.
    assert_eq!(
        h.client
            .get_requests_by_hospital(&h.hospital, &0, &10)
            .len(),
        0
    );
    let history = h.client.get_hospital_request_history(&h.hospital, &0, &10);
    assert_eq!(history.len(), 1);
    assert_eq!(history.get(0).unwrap().status, RequestStatus::Cancelled);
}

#[test]
fn test_expire_approved_request_releases_reservation() {
    let h = setup();
    let request_id = reserved_request(&h, 5_000);

    h.env.ledger().set_timestamp(6_000);
    h.client.expire_request(&request_id);

    let request = h.client.get_request(&request_id);
    assert_eq!(request.status, RequestStatus::Cancelled);
    assert_eq!(request.reservation_id, None);
    assert!(
        h.client
            .get_request_history(&request_id)
            .last()
            .unwrap()
            .released_reservation
    );
    assert_eq!(h.inventory.released(), 1);
}

#[test]
fn test_expire_request_is_permissionless() {
    let h = setup();
    let request_id = create(&h, 5_000);
    h.env.ledger().set_timestamp(5_001);

    // Drop every mocked authorization: a call that needed any auth would fail.
    h.env.set_auths(&[]);
    h.client.expire_request(&request_id);
    assert_eq!(
        h.client.get_request(&request_id).status,
        RequestStatus::Cancelled
    );
}

#[test]
fn test_expire_request_rejects_in_progress_and_terminal_requests() {
    let h = setup();
    let in_progress = create(&h, 5_000);
    approve(&h, in_progress);
    let rider = Address::generate(&h.env);
    h.client.authorize_rider(&rider);
    h.client.assign_rider(&h.admin, &in_progress, &rider);
    h.client.update_request_status(
        &rider,
        &in_progress,
        &RequestStatus::InProgress,
        &String::from_str(&h.env, "picked up"),
    );
    let already_expired = create(&h, 5_000);

    h.env.ledger().set_timestamp(5_001);
    // Units already in transit are never expired.
    assert_eq!(
        h.client.try_expire_request(&in_progress),
        Err(Ok(ContractError::InvalidRequestStatus))
    );

    h.client.expire_request(&already_expired);
    assert_eq!(
        h.client.try_expire_request(&already_expired),
        Err(Ok(ContractError::InvalidRequestStatus))
    );
    assert_eq!(
        h.client.try_expire_request(&999u64),
        Err(Ok(ContractError::RequestNotFound))
    );
}

#[test]
fn test_expire_with_paused_inventory_returns_typed_error() {
    let h = setup();
    let request_id = reserved_request(&h, 5_000);
    h.inventory.set_paused(&true);

    h.env.ledger().set_timestamp(5_001);
    assert_eq!(
        h.client.try_expire_request(&request_id),
        Err(Ok(ContractError::InventoryReleaseFailed))
    );
    assert_eq!(
        h.client.get_request(&request_id).status,
        RequestStatus::Approved
    );
}

// ── #1812: hospital request history ──────────────────────────────────────────

#[test]
fn test_fulfilled_request_stays_in_hospital_history() {
    let h = setup();
    let fulfilled = create(&h, 5_000);
    let open = create(&h, 5_000);

    approve(&h, fulfilled);
    h.client.update_request_status(
        &h.admin,
        &fulfilled,
        &RequestStatus::Fulfilled,
        &String::from_str(&h.env, "delivered"),
    );

    // Open index: only the open request.
    let open_list = h.client.get_requests_by_hospital(&h.hospital, &0, &10);
    assert_eq!(open_list.len(), 1);
    assert_eq!(open_list.get(0).unwrap().id, open);

    // History: both, in creation order, with their current status.
    let history = h.client.get_hospital_request_history(&h.hospital, &0, &10);
    assert_eq!(history.len(), 2);
    assert_eq!(history.get(0).unwrap().id, fulfilled);
    assert_eq!(history.get(0).unwrap().status, RequestStatus::Fulfilled);
    assert_eq!(history.get(1).unwrap().id, open);
    assert_eq!(history.get(1).unwrap().status, RequestStatus::Pending);
    assert_eq!(h.client.get_hospital_request_count(&h.hospital), 2);
}

#[test]
fn test_hospital_history_keeps_every_terminal_status() {
    let h = setup();
    let cancelled = create(&h, 5_000);
    let rejected = create(&h, 5_000);
    let partially_fulfilled = create(&h, 5_000);

    h.client.cancel_request(
        &h.hospital,
        &cancelled,
        &String::from_str(&h.env, "not needed"),
    );
    h.client.update_request_status(
        &h.admin,
        &rejected,
        &RequestStatus::Rejected,
        &String::from_str(&h.env, "no stock"),
    );
    approve(&h, partially_fulfilled);
    h.client.partial_fulfill_request(
        &h.admin,
        &partially_fulfilled,
        &500u32,
        &String::from_str(&h.env, "delivered"),
    );

    assert_eq!(
        h.client
            .get_requests_by_hospital(&h.hospital, &0, &10)
            .len(),
        0
    );
    let history = h.client.get_hospital_request_history(&h.hospital, &0, &10);
    assert_eq!(history.len(), 3);
    assert_eq!(history.get(0).unwrap().status, RequestStatus::Cancelled);
    assert_eq!(history.get(1).unwrap().status, RequestStatus::Rejected);
    assert_eq!(history.get(2).unwrap().status, RequestStatus::Fulfilled);
}

#[test]
fn test_hospital_history_paginates_and_is_per_hospital() {
    let h = setup();
    let mut entries = soroban_sdk::Vec::new(&h.env);
    for _ in 0..5 {
        entries.push_back((
            BloodType::APositive,
            BloodComponent::Plasma,
            200u32,
            Urgency::Routine,
            5_000u64,
        ));
    }
    let ids = h.client.batch_create_requests(&h.hospital, &entries);

    let other = Address::generate(&h.env);
    h.client.authorize_hospital(&other);
    h.client.create_request(
        &other,
        &BloodType::BPositive,
        &BloodComponent::RedCells,
        &300u32,
        &Urgency::Urgent,
        &5_000u64,
    );

    assert_eq!(h.client.get_hospital_request_count(&h.hospital), 5);
    let page_0 = h.client.get_hospital_request_history(&h.hospital, &0, &2);
    let page_2 = h.client.get_hospital_request_history(&h.hospital, &2, &2);
    let page_3 = h.client.get_hospital_request_history(&h.hospital, &3, &2);
    assert_eq!(page_0.len(), 2);
    assert_eq!(page_0.get(0).unwrap().id, ids.get(0).unwrap());
    assert_eq!(page_2.len(), 1);
    assert_eq!(page_2.get(0).unwrap().id, ids.get(4).unwrap());
    assert_eq!(page_3.len(), 0);

    let other_history = h.client.get_hospital_request_history(&other, &0, &10);
    assert_eq!(other_history.len(), 1);
    assert_eq!(other_history.get(0).unwrap().hospital_id, other);
}

// ── #1813: admin is not implicitly a hospital ────────────────────────────────

#[test]
fn test_initialize_does_not_authorize_admin_as_hospital() {
    let h = setup();
    assert!(!h.client.is_hospital_authorized(&h.admin));

    let result = h.client.try_create_request(
        &h.admin,
        &BloodType::OPositive,
        &BloodComponent::WholeBlood,
        &500u32,
        &Urgency::Urgent,
        &5_000u64,
    );
    assert_eq!(result, Err(Ok(ContractError::NotAuthorizedHospital)));
}

#[test]
fn test_admin_can_be_authorized_as_hospital_explicitly() {
    let h = setup();
    h.client.authorize_hospital(&h.admin);
    assert!(h.client.is_hospital_authorized(&h.admin));
}
