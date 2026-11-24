//! #1805: an InProgress request whose delivery failed can go back to Approved
//! (retry with a new rider) or to Rejected (its reserved units are marked
//! Compromised in inventory, not returned to Available).
//!
//! These tests run against the real inventory contract so the effect on the
//! reservation and its units is observed end to end.

use crate::{
    BloodComponent, BloodType, ContractError, RequestContract, RequestContractClient,
    RequestStatus, Urgency,
};
use inventory_contract::{
    BloodStatus, BloodType as InvBloodType, InventoryContract, InventoryContractClient,
};
use soroban_sdk::{
    testutils::{Address as _, Ledger as _},
    vec, Address, Env, String,
};

struct Harness<'a> {
    env: Env,
    client: RequestContractClient<'a>,
    inventory: InventoryContractClient<'a>,
    admin: Address,
    bank: Address,
    rider: Address,
    request_id: u64,
    unit_id: u64,
    reservation_id: u64,
}

/// An InProgress request holding a real inventory reservation of one unit,
/// picked up by `rider`.
fn in_progress<'a>() -> Harness<'a> {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().set_timestamp(1_000);

    let admin = Address::generate(&env);

    let inventory_id = env.register(InventoryContract, ());
    let inventory = InventoryContractClient::new(&env, &inventory_id);
    inventory.initialize(&admin);

    let contract_id = env.register(RequestContract, ());
    let client = RequestContractClient::new(&env, &contract_id);
    client.initialize(&admin, &inventory_id);
    inventory.set_requests_contract(&admin, &contract_id);

    let hospital = Address::generate(&env);
    client.authorize_hospital(&hospital);
    let bank = Address::generate(&env);
    inventory.authorize_bank(&admin, &bank, &true);

    let request_id = client.create_request(
        &hospital,
        &BloodType::OPositive,
        &BloodComponent::WholeBlood,
        &450u32,
        &Urgency::Urgent,
        &50_000u64,
    );
    client.update_request_status(
        &admin,
        &request_id,
        &RequestStatus::Approved,
        &String::from_str(&env, "Approved"),
    );

    let unit_id = inventory.register_blood(
        &bank,
        &String::from_str(&env, "SN-1805"),
        &InvBloodType::OPositive,
        &450u32,
        &None,
    );
    let reservation_id =
        inventory.reserve_blood(&bank, &hospital, &vec![&env, unit_id], &request_id, &3_600);
    client.set_reservation_id(&admin, &request_id, &reservation_id);

    let rider = Address::generate(&env);
    client.authorize_rider(&rider);
    client.assign_rider(&admin, &request_id, &rider);
    client.update_request_status(
        &rider,
        &request_id,
        &RequestStatus::InProgress,
        &String::from_str(&env, "Picked up"),
    );
    // The unit leaves the bank with the rider.
    inventory.update_status(&unit_id, &BloodStatus::InTransit, &bank, &None);

    Harness {
        env,
        client,
        inventory,
        admin,
        bank,
        rider,
        request_id,
        unit_id,
        reservation_id,
    }
}

fn reason(h: &Harness<'_>, text: &str) -> String {
    String::from_str(&h.env, text)
}

// ── InProgress → Approved (retry) ────────────────────────────────────────────

#[test]
fn test_failed_delivery_retry_returns_to_approved_and_keeps_reservation() {
    let h = in_progress();

    h.client.update_request_status(
        &h.admin,
        &h.request_id,
        &RequestStatus::Approved,
        &reason(&h, "Rider accident, retry"),
    );

    let request = h.client.get_request(&h.request_id);
    assert_eq!(request.status, RequestStatus::Approved);
    // The reservation is kept so the units stay held for this request.
    assert_eq!(request.reservation_id, Some(h.reservation_id));
    assert!(h.inventory.try_get_reservation(&h.reservation_id).is_ok());

    // The rider assignment is cleared.
    assert_eq!(h.client.get_request_rider(&h.request_id), None);

    let last = h.client.get_request_history(&h.request_id).last().unwrap();
    assert_eq!(last.previous_status, RequestStatus::InProgress);
    assert_eq!(last.new_status, RequestStatus::Approved);
    assert_eq!(last.reason, reason(&h, "Rider accident, retry"));
    assert_eq!(last.actor, h.admin);
    assert!(!last.released_reservation);
}

#[test]
fn test_failed_delivery_retry_requires_rider_reassignment() {
    let h = in_progress();
    h.client.update_request_status(
        &h.admin,
        &h.request_id,
        &RequestStatus::Approved,
        &reason(&h, "Rider accident, retry"),
    );

    // The old rider can no longer pick the request up.
    let result = h.client.try_update_request_status(
        &h.rider,
        &h.request_id,
        &RequestStatus::InProgress,
        &reason(&h, "Picked up again"),
    );
    assert_eq!(result, Err(Ok(ContractError::Unauthorized)));

    // A newly assigned rider can.
    let new_rider = Address::generate(&h.env);
    h.client.authorize_rider(&new_rider);
    h.client.assign_rider(&h.admin, &h.request_id, &new_rider);
    h.client.update_request_status(
        &new_rider,
        &h.request_id,
        &RequestStatus::InProgress,
        &reason(&h, "Picked up by new rider"),
    );
    assert_eq!(
        h.client.get_request(&h.request_id).status,
        RequestStatus::InProgress
    );
}

#[test]
fn test_failed_delivery_retry_requires_reason() {
    let h = in_progress();
    let result = h.client.try_update_request_status(
        &h.admin,
        &h.request_id,
        &RequestStatus::Approved,
        &reason(&h, ""),
    );
    assert_eq!(result, Err(Ok(ContractError::InvalidReason)));
    assert_eq!(
        h.client.get_request(&h.request_id).status,
        RequestStatus::InProgress
    );
}

#[test]
fn test_rider_cannot_mark_delivery_failed() {
    let h = in_progress();
    for status in [RequestStatus::Approved, RequestStatus::Rejected] {
        let result = h.client.try_update_request_status(
            &h.rider,
            &h.request_id,
            &status,
            &reason(&h, "Failed"),
        );
        assert_eq!(result, Err(Ok(ContractError::Unauthorized)));
    }
}

// ── InProgress → Rejected ────────────────────────────────────────────────────

#[test]
fn test_failed_delivery_reject_compromises_reserved_units() {
    let h = in_progress();

    h.client.update_request_status(
        &h.admin,
        &h.request_id,
        &RequestStatus::Rejected,
        &reason(&h, "Cold-chain breach"),
    );

    let request = h.client.get_request(&h.request_id);
    assert_eq!(request.status, RequestStatus::Rejected);
    assert_eq!(request.reservation_id, None);
    assert_eq!(h.client.get_request_rider(&h.request_id), None);

    // Units are Compromised, not returned to Available, and the reservation
    // is gone from inventory.
    assert_eq!(
        h.inventory.get_blood_unit(&h.unit_id).status,
        BloodStatus::Compromised
    );
    assert!(h.inventory.try_get_reservation(&h.reservation_id).is_err());

    let last = h.client.get_request_history(&h.request_id).last().unwrap();
    assert_eq!(last.previous_status, RequestStatus::InProgress);
    assert_eq!(last.new_status, RequestStatus::Rejected);
    assert_eq!(last.reason, reason(&h, "Cold-chain breach"));
    assert!(last.released_reservation);

    // The request left the hospital's open index.
    assert_eq!(
        h.client
            .get_requests_by_hospital(&request.hospital_id, &0, &10)
            .len(),
        0
    );
}

#[test]
fn test_failed_delivery_reject_requires_reason() {
    let h = in_progress();
    let result = h.client.try_update_request_status(
        &h.admin,
        &h.request_id,
        &RequestStatus::Rejected,
        &reason(&h, ""),
    );
    assert_eq!(result, Err(Ok(ContractError::InvalidReason)));
    assert_eq!(
        h.inventory.get_blood_unit(&h.unit_id).status,
        BloodStatus::InTransit
    );
}

#[test]
fn test_failed_delivery_reject_rolls_back_when_inventory_paused() {
    let h = in_progress();
    h.inventory.pause(&h.admin);

    let result = h.client.try_update_request_status(
        &h.admin,
        &h.request_id,
        &RequestStatus::Rejected,
        &reason(&h, "Hospital refused units"),
    );
    assert_eq!(result, Err(Ok(ContractError::InventoryReleaseFailed)));

    let request = h.client.get_request(&h.request_id);
    assert_eq!(request.status, RequestStatus::InProgress);
    assert_eq!(request.reservation_id, Some(h.reservation_id));
    assert_eq!(
        h.client.get_request_rider(&h.request_id),
        Some(h.rider.clone())
    );
}

#[test]
fn test_reject_from_approved_still_releases_units_to_available() {
    // Rejecting a request that never went out keeps the old behaviour: the
    // units go back to Available.
    let h = in_progress();
    h.client.update_request_status(
        &h.admin,
        &h.request_id,
        &RequestStatus::Approved,
        &reason(&h, "Rider accident, retry"),
    );

    // A second, untouched unit reserved for a fresh request.
    let unit2 = h.inventory.register_blood(
        &h.bank,
        &String::from_str(&h.env, "SN-1805-B"),
        &InvBloodType::OPositive,
        &450u32,
        &None,
    );
    let hospital = h.client.get_request(&h.request_id).hospital_id;
    let request2 = h.client.create_request(
        &hospital,
        &BloodType::OPositive,
        &BloodComponent::WholeBlood,
        &450u32,
        &Urgency::Urgent,
        &50_000u64,
    );
    h.client.update_request_status(
        &h.admin,
        &request2,
        &RequestStatus::Approved,
        &reason(&h, "Approved"),
    );
    let res2 =
        h.inventory
            .reserve_blood(&h.bank, &hospital, &vec![&h.env, unit2], &request2, &3_600);
    h.client.set_reservation_id(&h.admin, &request2, &res2);

    h.client.update_request_status(
        &h.admin,
        &request2,
        &RequestStatus::Rejected,
        &reason(&h, "Duplicate request"),
    );
    assert_eq!(
        h.inventory.get_blood_unit(&unit2).status,
        BloodStatus::Available
    );
}
