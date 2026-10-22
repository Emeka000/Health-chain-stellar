use crate::{
    BloodComponent, BloodType, ContractError, RequestContract, RequestContractClient,
    RequestStatus, Urgency,
};
use soroban_sdk::{
    contract, contractimpl,
    testutils::{Address as _, Events as _, Ledger as _},
    Address, Env, String, Vec,
};

/// Minimal inventory mock so cross-contract release calls succeed in tests.
#[contract]
struct MockInventory;

#[contractimpl]
impl MockInventory {
    pub fn release_reservation(_env: Env, _caller: Address, _reservation_id: u64) {}
    pub fn release_reservation_by_contract(
        _env: Env,
        _authorized_contract: Address,
        _reservation_id: u64,
    ) {
    }
}

fn setup_authorized_hospital<'a>() -> (Env, RequestContractClient<'a>, Address, Address) {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register(RequestContract, ());
    let client = RequestContractClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    let inventory_id = env.register(MockInventory, ());
    client.initialize(&admin, &inventory_id);
    let hospital = Address::generate(&env);
    client.authorize_hospital(&hospital);
    env.ledger().set_timestamp(1_000);
    (env, client, admin, hospital)
}

fn create_urgent_request(client: &RequestContractClient<'_>, hospital: &Address) -> u64 {
    client.create_request(
        hospital,
        &BloodType::OPositive,
        &BloodComponent::WholeBlood,
        &500u32,
        &Urgency::Urgent,
        &1_600u64,
    )
}

fn batch_entries(env: &Env, count: u32) -> Vec<(BloodType, BloodComponent, u32, Urgency, u64)> {
    let mut entries = Vec::new(env);
    for _ in 0..count {
        entries.push_back((
            BloodType::OPositive,
            BloodComponent::WholeBlood,
            500u32,
            Urgency::Urgent,
            1_600u64,
        ));
    }
    entries
}

// ── #1151: cancel_request ownership ──────────────────────────────────────────

/// #1151: A third party cannot cancel a hospital's blood request.
#[test]
fn test_cancel_request_requires_ownership() {
    let (env, client, _admin, hospital_a) = setup_authorized_hospital();
    let hospital_b = Address::generate(&env);
    client.authorize_hospital(&hospital_b);

    let request_id = create_urgent_request(&client, &hospital_a);

    let result = client.try_cancel_request(
        &hospital_b,
        &request_id,
        &String::from_str(&env, "unauthorized cancel"),
    );

    assert_eq!(result, Err(Ok(ContractError::NotRequestOwner)));
}

/// #1151: The owning hospital can cancel its own request.
#[test]
fn test_cancel_request_by_owner_succeeds() {
    let (env, client, _admin, hospital) = setup_authorized_hospital();
    let request_id = create_urgent_request(&client, &hospital);

    client.cancel_request(
        &hospital,
        &request_id,
        &String::from_str(&env, "owned cancel"),
    );
}

/// #1151: Admin can cancel any request.
#[test]
fn test_cancel_request_by_admin_succeeds() {
    let (env, client, admin, hospital) = setup_authorized_hospital();
    let request_id = create_urgent_request(&client, &hospital);

    client.cancel_request(&admin, &request_id, &String::from_str(&env, "admin cancel"));
}

// ── #1151: update_request_status authorization ────────────────────────────────

/// #1151: A non-admin, non-rider cannot update request status.
#[test]
fn test_update_request_status_requires_admin() {
    let (env, client, _admin, hospital) = setup_authorized_hospital();
    let non_admin = Address::generate(&env);
    let request_id = create_urgent_request(&client, &hospital);

    let result = client.try_update_request_status(
        &non_admin,
        &request_id,
        &RequestStatus::Approved,
        &String::from_str(&env, "status update"),
    );

    assert_eq!(result, Err(Ok(ContractError::Unauthorized)));
}

/// #1151: Admin can update request status.
#[test]
fn test_update_request_status_by_admin_succeeds() {
    let (env, client, admin, hospital) = setup_authorized_hospital();
    let request_id = create_urgent_request(&client, &hospital);

    client.update_request_status(
        &admin,
        &request_id,
        &RequestStatus::Approved,
        &String::from_str(&env, "admin status update"),
    );
}

// ── #1302: set_reservation_id ─────────────────────────────────────────────────

/// #1302: A second set_reservation_id call must not overwrite the first ID.
#[test]
fn test_set_reservation_id_rejects_overwrite() {
    let (env, client, admin, hospital) = setup_authorized_hospital();
    let request_id = create_urgent_request(&client, &hospital);

    client.update_request_status(
        &admin,
        &request_id,
        &RequestStatus::Approved,
        &String::from_str(&env, "Approved"),
    );

    client.set_reservation_id(&admin, &request_id, &11u64);

    let result = client.try_set_reservation_id(&admin, &request_id, &22u64);
    assert_eq!(result, Err(Ok(ContractError::ReservationAlreadySet)));

    let request = client.get_request(&request_id);
    assert_eq!(request.reservation_id, Some(11));
}

/// #1302: A legitimate first set_reservation_id call records history and emits an event.
#[test]
fn test_set_reservation_id_records_history_and_event() {
    let (env, client, admin, hospital) = setup_authorized_hospital();
    let request_id = create_urgent_request(&client, &hospital);

    client.update_request_status(
        &admin,
        &request_id,
        &RequestStatus::Approved,
        &String::from_str(&env, "Approved"),
    );

    client.set_reservation_id(&admin, &request_id, &42u64);

    // Client-mode events show last invocation only; verify exactly 1 event emitted.
    assert_eq!(env.events().all().len(), 1);

    let request = client.get_request(&request_id);
    assert_eq!(request.reservation_id, Some(42));

    let history = client.get_request_history(&request_id);
    let last = history.get(history.len() - 1).unwrap();
    assert_eq!(last.actor, admin);
    assert_eq!(last.previous_status, RequestStatus::Approved);
    assert_eq!(last.new_status, RequestStatus::Approved);
    assert_eq!(last.reason, String::from_str(&env, "Reservation ID set"));
    assert_eq!(last.timestamp, 1_000);
}

/// #1302: set_reservation_id is restricted to Approved and InProgress requests.
#[test]
fn test_set_reservation_id_rejects_wrong_status() {
    let (_env, client, admin, hospital) = setup_authorized_hospital();
    let request_id = create_urgent_request(&client, &hospital);

    let result = client.try_set_reservation_id(&admin, &request_id, &42u64);
    assert_eq!(result, Err(Ok(ContractError::InvalidRequestStatus)));

    let request = client.get_request(&request_id);
    assert_eq!(request.reservation_id, None);
}

// ── #1303: batch_create_requests ─────────────────────────────────────────────

/// #1303: A batch larger than MAX_BATCH_SIZE (50) is rejected before any writes.
#[test]
fn test_batch_create_requests_rejects_over_cap() {
    let (env, client, _admin, hospital) = setup_authorized_hospital();
    let entries = batch_entries(&env, 51);

    let result = client.try_batch_create_requests(&hospital, &entries);
    assert_eq!(result, Err(Ok(ContractError::BatchTooLarge)));
    assert_eq!(client.get_request_counter(), 0);
}

/// #1303: A batch at the MAX_BATCH_SIZE boundary succeeds.
#[test]
fn test_batch_create_requests_at_cap_succeeds() {
    let (env, client, _admin, hospital) = setup_authorized_hospital();
    let entries = batch_entries(&env, 50);

    let ids = client.batch_create_requests(&hospital, &entries);
    assert_eq!(ids.len(), 50);
    assert_eq!(client.get_request_counter(), 50);
}

// ── #1305: set_fulfilling_org (pre-existing auth tests) ──────────────────────

/// #1305: An unauthorized blood bank cannot mark itself as fulfilling a request.
#[test]
fn test_set_fulfilling_org_rejects_unauthorized_blood_bank() {
    let (env, client, admin, hospital) = setup_authorized_hospital();
    let request_id = create_urgent_request(&client, &hospital);

    client.update_request_status(
        &admin,
        &request_id,
        &RequestStatus::Approved,
        &String::from_str(&env, "Approved"),
    );

    let unauthorized_bb = Address::generate(&env);
    let result = client.try_set_fulfilling_org(&unauthorized_bb, &request_id, &unauthorized_bb);
    assert_eq!(result, Err(Ok(ContractError::NotAuthorizedBloodBank)));
}

/// #1305: An authorized blood bank can mark itself as the fulfilling org.
#[test]
fn test_set_fulfilling_org_authorized_blood_bank_succeeds() {
    let (env, client, admin, hospital) = setup_authorized_hospital();
    let request_id = create_urgent_request(&client, &hospital);

    let blood_bank = Address::generate(&env);
    client.authorize_blood_bank(&blood_bank);

    client.update_request_status(
        &admin,
        &request_id,
        &RequestStatus::Approved,
        &String::from_str(&env, "Approved"),
    );

    client.set_fulfilling_org(&blood_bank, &request_id, &blood_bank);

    let request = client.get_request(&request_id);
    assert_eq!(request.fulfilled_by, Some(blood_bank));
}

/// #1305: Admin can set any org as the fulfilling org.
#[test]
fn test_set_fulfilling_org_admin_can_set_any_org() {
    let (env, client, admin, hospital) = setup_authorized_hospital();
    let request_id = create_urgent_request(&client, &hospital);

    client.update_request_status(
        &admin,
        &request_id,
        &RequestStatus::Approved,
        &String::from_str(&env, "Approved"),
    );

    let any_org = Address::generate(&env);
    client.set_fulfilling_org(&admin, &request_id, &any_org);

    let request = client.get_request(&request_id);
    assert_eq!(request.fulfilled_by, Some(any_org));
}

// ── #1304: per-hospital index pagination ─────────────────────────────────────

/// #1304: Pagination uses the per-hospital index, not the global counter.
#[test]
fn test_get_requests_by_hospital_uses_per_hospital_index() {
    let (env, client, _admin, hospital_a) = setup_authorized_hospital();
    let hospital_b = Address::generate(&env);
    client.authorize_hospital(&hospital_b);

    let req_a1 = client.create_request(
        &hospital_a,
        &BloodType::OPositive,
        &BloodComponent::WholeBlood,
        &500u32,
        &Urgency::Urgent,
        &1_600u64,
    );
    let req_a2 = client.create_request(
        &hospital_a,
        &BloodType::APositive,
        &BloodComponent::Plasma,
        &300u32,
        &Urgency::Routine,
        &2_000u64,
    );
    let req_a3 = client.create_request(
        &hospital_a,
        &BloodType::BPositive,
        &BloodComponent::RedCells,
        &400u32,
        &Urgency::Critical,
        &1_800u64,
    );

    let req_b1 = client.create_request(
        &hospital_b,
        &BloodType::ONegative,
        &BloodComponent::Platelets,
        &100u32,
        &Urgency::Scheduled,
        &2_500u64,
    );
    let req_b2 = client.create_request(
        &hospital_b,
        &BloodType::ABNegative,
        &BloodComponent::Cryoprecipitate,
        &50u32,
        &Urgency::Urgent,
        &1_700u64,
    );

    let results_a = client.get_requests_by_hospital(&hospital_a, &0u32, &10u32);
    assert_eq!(results_a.len(), 3);
    assert_eq!(results_a.get(0).unwrap().id, req_a1);
    assert_eq!(results_a.get(1).unwrap().id, req_a2);
    assert_eq!(results_a.get(2).unwrap().id, req_a3);

    let results_b = client.get_requests_by_hospital(&hospital_b, &0u32, &10u32);
    assert_eq!(results_b.len(), 2);
    assert_eq!(results_b.get(0).unwrap().id, req_b1);
    assert_eq!(results_b.get(1).unwrap().id, req_b2);

    let page_0_a = client.get_requests_by_hospital(&hospital_a, &0u32, &2u32);
    assert_eq!(page_0_a.len(), 2);
    assert_eq!(page_0_a.get(0).unwrap().id, req_a1);
    assert_eq!(page_0_a.get(1).unwrap().id, req_a2);

    let page_1_a = client.get_requests_by_hospital(&hospital_a, &1u32, &2u32);
    assert_eq!(page_1_a.len(), 1);
    assert_eq!(page_1_a.get(0).unwrap().id, req_a3);
}

// ── #1468: set_fulfilling_org audit trail & status guard ─────────────────────

/// #1468: set_fulfilling_org must reject requests in non-actionable states.
#[test]
fn test_set_fulfilling_org_rejects_pending_status() {
    let (env, client, admin, hospital) = setup_authorized_hospital();
    let request_id = create_urgent_request(&client, &hospital);

    let blood_bank = Address::generate(&env);
    client.authorize_blood_bank(&blood_bank);

    // Still Pending — must reject
    let result = client.try_set_fulfilling_org(&blood_bank, &request_id, &blood_bank);
    assert_eq!(result, Err(Ok(ContractError::InvalidRequestStatus)));

    // Cancel, then try again — still must reject
    client.cancel_request(&admin, &request_id, &String::from_str(&env, "cancelled"));
    let result2 = client.try_set_fulfilling_org(&admin, &request_id, &blood_bank);
    assert_eq!(result2, Err(Ok(ContractError::InvalidRequestStatus)));
}

/// #1468: set_fulfilling_org must reject a second call that would silently overwrite.
#[test]
fn test_set_fulfilling_org_rejects_overwrite() {
    let (env, client, admin, hospital) = setup_authorized_hospital();
    let request_id = create_urgent_request(&client, &hospital);

    client.update_request_status(
        &admin,
        &request_id,
        &RequestStatus::Approved,
        &String::from_str(&env, "Approved"),
    );

    let blood_bank = Address::generate(&env);
    client.authorize_blood_bank(&blood_bank);
    client.set_fulfilling_org(&blood_bank, &request_id, &blood_bank);

    let result = client.try_set_fulfilling_org(&admin, &request_id, &blood_bank);
    assert_eq!(result, Err(Ok(ContractError::FulfillingOrgAlreadySet)));
}

/// #1468: set_fulfilling_org must record a history entry and emit an event.
#[test]
fn test_set_fulfilling_org_records_history_and_event() {
    let (env, client, admin, hospital) = setup_authorized_hospital();
    let request_id = create_urgent_request(&client, &hospital);

    client.update_request_status(
        &admin,
        &request_id,
        &RequestStatus::Approved,
        &String::from_str(&env, "Approved"),
    );

    let blood_bank = Address::generate(&env);
    client.authorize_blood_bank(&blood_bank);

    let events_before = env.events().all().len();
    client.set_fulfilling_org(&blood_bank, &request_id, &blood_bank);
    assert_eq!(env.events().all().len(), events_before + 1);

    let history = client.get_request_history(&request_id);
    let last = history.get(history.len() - 1).unwrap();
    assert_eq!(last.actor, blood_bank);
    assert_eq!(last.previous_status, RequestStatus::Approved);
    assert_eq!(last.new_status, RequestStatus::Approved);
    assert_eq!(last.reason, String::from_str(&env, "Fulfilling org set"));
}

// ── #1469: rider authorization wired into InProgress transition ───────────────

/// #1469: An authorized rider can drive the Approved → InProgress transition.
#[test]
fn test_authorized_rider_can_set_inprogress() {
    let (env, client, admin, hospital) = setup_authorized_hospital();
    let request_id = create_urgent_request(&client, &hospital);

    client.update_request_status(
        &admin,
        &request_id,
        &RequestStatus::Approved,
        &String::from_str(&env, "Approved"),
    );

    let rider = Address::generate(&env);
    client.authorize_rider(&rider);

    // #1626: the rider must be assigned to the request before pickup.
    client.assign_rider(&admin, &request_id, &rider);

    client.update_request_status(
        &rider,
        &request_id,
        &RequestStatus::InProgress,
        &String::from_str(&env, "Rider picked up blood"),
    );

    let request = client.get_request(&request_id);
    assert_eq!(request.status, RequestStatus::InProgress);
}

/// #1469: An unauthorized rider cannot update any status.
#[test]
fn test_unauthorized_rider_cannot_update_status() {
    let (env, client, admin, hospital) = setup_authorized_hospital();
    let request_id = create_urgent_request(&client, &hospital);

    client.update_request_status(
        &admin,
        &request_id,
        &RequestStatus::Approved,
        &String::from_str(&env, "Approved"),
    );

    let non_rider = Address::generate(&env);
    let result = client.try_update_request_status(
        &non_rider,
        &request_id,
        &RequestStatus::InProgress,
        &String::from_str(&env, "Unauthorized pickup"),
    );
    assert_eq!(result, Err(Ok(ContractError::Unauthorized)));
}

/// #1469: An authorized rider cannot drive non-InProgress transitions.
#[test]
fn test_authorized_rider_cannot_approve_or_reject() {
    let (env, client, admin, hospital) = setup_authorized_hospital();
    let request_id = create_urgent_request(&client, &hospital);

    let rider = Address::generate(&env);
    client.authorize_rider(&rider);

    // Rider cannot approve
    let result = client.try_update_request_status(
        &rider,
        &request_id,
        &RequestStatus::Approved,
        &String::from_str(&env, "Unauthorized approval"),
    );
    assert_eq!(result, Err(Ok(ContractError::Unauthorized)));

    // Admin approves so we can test further
    client.update_request_status(
        &admin,
        &request_id,
        &RequestStatus::Approved,
        &String::from_str(&env, "Approved"),
    );

    // Rider cannot reject
    let result2 = client.try_update_request_status(
        &rider,
        &request_id,
        &RequestStatus::Rejected,
        &String::from_str(&env, "Unauthorized rejection"),
    );
    assert_eq!(result2, Err(Ok(ContractError::Unauthorized)));
}

// ── #1470: hospital index pruned on terminal transitions ──────────────────────

/// #1470: Cancelling a request removes it from the hospital's index.
#[test]
fn test_hospital_index_pruned_on_cancel() {
    let (env, client, admin, hospital) = setup_authorized_hospital();
    let req1 = create_urgent_request(&client, &hospital);
    let req2 = client.create_request(
        &hospital,
        &BloodType::APositive,
        &BloodComponent::Plasma,
        &300u32,
        &Urgency::Routine,
        &2_000u64,
    );

    client.cancel_request(&admin, &req1, &String::from_str(&env, "no longer needed"));

    let results = client.get_requests_by_hospital(&hospital, &0u32, &10u32);
    assert_eq!(results.len(), 1);
    assert_eq!(results.get(0).unwrap().id, req2);
}

/// #1470: Fulfilling a request removes it from the hospital's index.
#[test]
fn test_hospital_index_pruned_on_fulfill() {
    let (env, client, admin, hospital) = setup_authorized_hospital();
    let req1 = create_urgent_request(&client, &hospital);
    let req2 = client.create_request(
        &hospital,
        &BloodType::BNegative,
        &BloodComponent::RedCells,
        &200u32,
        &Urgency::Critical,
        &1_800u64,
    );

    client.update_request_status(
        &admin,
        &req1,
        &RequestStatus::Approved,
        &String::from_str(&env, "Approved"),
    );
    client.partial_fulfill_request(
        &admin,
        &req1,
        &500u32,
        &String::from_str(&env, "fully delivered"),
    );

    let results = client.get_requests_by_hospital(&hospital, &0u32, &10u32);
    assert_eq!(results.len(), 1);
    assert_eq!(results.get(0).unwrap().id, req2);
}

// ── #1754: cancel_request_by_contract must not cancel InProgress requests ─────

/// #1754: The contract-only cancellation path must reject an InProgress request
/// and leave the reservation intact, so in-transit units are never released.
#[test]
fn test_cancel_request_by_contract_rejects_inprogress() {
    let (env, client, admin, hospital) = setup_authorized_hospital();
    let request_id = create_urgent_request(&client, &hospital);

    client.update_request_status(
        &admin,
        &request_id,
        &RequestStatus::Approved,
        &String::from_str(&env, "Approved"),
    );
    client.set_reservation_id(&admin, &request_id, &77u64);

    let rider = Address::generate(&env);
    client.authorize_rider(&rider);
    client.assign_rider(&admin, &request_id, &rider);
    client.update_request_status(
        &rider,
        &request_id,
        &RequestStatus::InProgress,
        &String::from_str(&env, "Rider picked up blood"),
    );

    let result = client.try_cancel_request_by_contract(
        &admin,
        &request_id,
        &String::from_str(&env, "dispute expired"),
    );
    assert_eq!(result, Err(Ok(ContractError::InvalidRequestStatus)));

    let request = client.get_request(&request_id);
    assert_eq!(request.status, RequestStatus::InProgress);
    assert_eq!(request.reservation_id, Some(77));
}

/// #1754: Cancelling Pending/Approved requests through the contract path still works.
#[test]
fn test_cancel_request_by_contract_allows_approved() {
    let (env, client, admin, hospital) = setup_authorized_hospital();
    let request_id = create_urgent_request(&client, &hospital);

    client.update_request_status(
        &admin,
        &request_id,
        &RequestStatus::Approved,
        &String::from_str(&env, "Approved"),
    );
    client.set_reservation_id(&admin, &request_id, &88u64);

    client.cancel_request_by_contract(
        &admin,
        &request_id,
        &String::from_str(&env, "dispute expired"),
    );

    let request = client.get_request(&request_id);
    assert_eq!(request.status, RequestStatus::Cancelled);
}

/// #1470: Rejecting a request removes it from the hospital's index.
#[test]
fn test_hospital_index_pruned_on_reject() {
    let (env, client, admin, hospital) = setup_authorized_hospital();
    let req1 = create_urgent_request(&client, &hospital);
    let req2 = client.create_request(
        &hospital,
        &BloodType::ABPositive,
        &BloodComponent::Platelets,
        &150u32,
        &Urgency::Scheduled,
        &2_200u64,
    );

    client.update_request_status(
        &admin,
        &req1,
        &RequestStatus::Rejected,
        &String::from_str(&env, "no stock available"),
    );

    let results = client.get_requests_by_hospital(&hospital, &0u32, &10u32);
    assert_eq!(results.len(), 1);
    assert_eq!(results.get(0).unwrap().id, req2);
}
