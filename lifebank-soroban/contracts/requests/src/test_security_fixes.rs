use crate::{BloodComponent, BloodType, ContractError, RequestContract, RequestStatus, Urgency};
use soroban_sdk::{
    testutils::{Address as _, Events as _, Ledger as _},
    Address, Env, String, Vec,
};
use soroban_sdk::{
    testutils::{Address as _, Events as _, Ledger as _},
    Address, Env, String,
};

/// #1151: Verify cancel_request requires caller authorization and must be hospital owner or admin.
/// A third party cannot cancel a hospital's blood request.
#[test]
fn test_cancel_request_requires_ownership() {
    let env = Env::default();
    let admin = Address::generate(&env);
    let hospital_a = Address::generate(&env);
    let hospital_b = Address::generate(&env);

    env.mock_all_auths();

    RequestContract::initialize(env.clone(), admin.clone(), Address::generate(&env)).unwrap();
    RequestContract::authorize_hospital(env.clone(), hospital_a.clone()).unwrap();
    RequestContract::authorize_hospital(env.clone(), hospital_b.clone()).unwrap();

    env.ledger().set_timestamp(1_000);

    // Hospital A creates a request
    let request_id = RequestContract::create_request(
        env.clone(),
        hospital_a.clone(),
        BloodType::OPositive,
        BloodComponent::WholeBlood,
        500,
        Urgency::Urgent,
        1_600,
    )
    .unwrap();

    // Hospital B attempts to cancel Hospital A's request
    let result = RequestContract::cancel_request(
        env.clone(),
        hospital_b.clone(),
        request_id,
        String::from_str(&env, "unauthorized cancel"),
    );

    // Should fail: Hospital B is not the owner and not admin
    assert_eq!(result, Err(ContractError::NotRequestOwner));
}

/// #1151: Verify cancel_request succeeds for hospital owner.
#[test]
fn test_cancel_request_by_owner_succeeds() {
    let env = Env::default();
    let admin = Address::generate(&env);
    let hospital = Address::generate(&env);

    env.mock_all_auths();

    RequestContract::initialize(env.clone(), admin.clone(), Address::generate(&env)).unwrap();
    RequestContract::authorize_hospital(env.clone(), hospital.clone()).unwrap();

    env.ledger().set_timestamp(1_000);

    let request_id = RequestContract::create_request(
        env.clone(),
        hospital.clone(),
        BloodType::OPositive,
        BloodComponent::WholeBlood,
        500,
        Urgency::Urgent,
        1_600,
    )
    .unwrap();

    let result = RequestContract::cancel_request(
        env.clone(),
        hospital.clone(),
        request_id,
        String::from_str(&env, "owned cancel"),
    );

    assert!(result.is_ok());
}

/// #1151: Verify cancel_request succeeds for admin.
#[test]
fn test_cancel_request_by_admin_succeeds() {
    let env = Env::default();
    let admin = Address::generate(&env);
    let hospital = Address::generate(&env);

    env.mock_all_auths();

    RequestContract::initialize(env.clone(), admin.clone(), Address::generate(&env)).unwrap();
    RequestContract::authorize_hospital(env.clone(), hospital.clone()).unwrap();

    env.ledger().set_timestamp(1_000);

    let request_id = RequestContract::create_request(
        env.clone(),
        hospital.clone(),
        BloodType::OPositive,
        BloodComponent::WholeBlood,
        500,
        Urgency::Urgent,
        1_600,
    )
    .unwrap();

    let result = RequestContract::cancel_request(
        env.clone(),
        admin.clone(),
        request_id,
        String::from_str(&env, "admin cancel"),
    );

    assert!(result.is_ok());
}

/// #1151: Verify update_request_status requires admin authorization.
/// Only admin can call this function.
#[test]
fn test_update_request_status_requires_admin() {
    let env = Env::default();
    let admin = Address::generate(&env);
    let hospital = Address::generate(&env);
    let non_admin = Address::generate(&env);

    env.mock_all_auths();

    RequestContract::initialize(env.clone(), admin.clone(), Address::generate(&env)).unwrap();
    RequestContract::authorize_hospital(env.clone(), hospital.clone()).unwrap();

    env.ledger().set_timestamp(1_000);

    let request_id = RequestContract::create_request(
        env.clone(),
        hospital.clone(),
        BloodType::OPositive,
        BloodComponent::WholeBlood,
        500,
        Urgency::Urgent,
        1_600,
    )
    .unwrap();

    // Non-admin attempts to update request status
    let result = RequestContract::update_request_status(
        env.clone(),
        non_admin,
        request_id,
        RequestStatus::Approved,
        String::from_str(&env, "status update"),
    );

    // Should fail: caller is not admin
    assert_eq!(result, Err(ContractError::Unauthorized));
}

/// #1151: Verify update_request_status succeeds for admin.
#[test]
fn test_update_request_status_by_admin_succeeds() {
    let env = Env::default();
    let admin = Address::generate(&env);
    let hospital = Address::generate(&env);

    env.mock_all_auths();

    RequestContract::initialize(env.clone(), admin.clone(), Address::generate(&env)).unwrap();
    RequestContract::authorize_hospital(env.clone(), hospital.clone()).unwrap();

    env.ledger().set_timestamp(1_000);

    let request_id = RequestContract::create_request(
        env.clone(),
        hospital.clone(),
        BloodType::OPositive,
        BloodComponent::WholeBlood,
        500,
        Urgency::Urgent,
        1_600,
    )
    .unwrap();

    let result = RequestContract::update_request_status(
        env.clone(),
        admin.clone(),
        request_id,
        RequestStatus::Approved,
        String::from_str(&env, "admin status update"),
    );

    assert!(result.is_ok());
}

fn setup_authorized_hospital() -> (Env, Address, Address) {
    let env = Env::default();
    let admin = Address::generate(&env);
    let hospital = Address::generate(&env);
    env.mock_all_auths();
    RequestContract::initialize(env.clone(), admin.clone(), Address::generate(&env)).unwrap();
    RequestContract::authorize_hospital(env.clone(), hospital.clone()).unwrap();
    env.ledger().set_timestamp(1_000);
    (env, admin, hospital)
}

fn create_urgent_request(env: &Env, hospital: &Address) -> u64 {
    RequestContract::create_request(
        env.clone(),
        hospital.clone(),
        BloodType::OPositive,
        BloodComponent::WholeBlood,
        500,
        Urgency::Urgent,
        1_600,
    )
    .unwrap()
}

/// #1302: A second set_reservation_id call must not overwrite the first ID.
#[test]
fn test_set_reservation_id_rejects_overwrite() {
    let (env, admin, hospital) = setup_authorized_hospital();
    let request_id = create_urgent_request(&env, &hospital);

    RequestContract::update_request_status(
        env.clone(),
        admin.clone(),
        request_id,
        RequestStatus::Approved,
        String::from_str(&env, "Approved"),
    )
    .unwrap();

    RequestContract::set_reservation_id(env.clone(), admin.clone(), request_id, 11).unwrap();

    let result = RequestContract::set_reservation_id(env.clone(), admin.clone(), request_id, 22);

    assert_eq!(result, Err(ContractError::ReservationAlreadySet));

    let request = RequestContract::get_request(env.clone(), request_id).unwrap();
    assert_eq!(request.reservation_id, Some(11));
}

/// #1302: A legitimate first set_reservation_id call records history and emits an event.
#[test]
fn test_set_reservation_id_records_history_and_event() {
    let (env, admin, hospital) = setup_authorized_hospital();
    let request_id = create_urgent_request(&env, &hospital);

    RequestContract::update_request_status(
        env.clone(),
        admin.clone(),
        request_id,
        RequestStatus::Approved,
        String::from_str(&env, "Approved"),
    )
    .unwrap();

    let events_before = env.events().all().len();

    RequestContract::set_reservation_id(env.clone(), admin.clone(), request_id, 42).unwrap();

    assert_eq!(env.events().all().len(), events_before + 1);

    let request = RequestContract::get_request(env.clone(), request_id).unwrap();
    assert_eq!(request.reservation_id, Some(42));

    let history = RequestContract::get_request_history(env.clone(), request_id).unwrap();
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
    let (env, admin, hospital) = setup_authorized_hospital();
    let request_id = create_urgent_request(&env, &hospital);

    let result = RequestContract::set_reservation_id(env.clone(), admin.clone(), request_id, 42);

    assert_eq!(result, Err(ContractError::InvalidRequestStatus));

    let request = RequestContract::get_request(env.clone(), request_id).unwrap();
    assert_eq!(request.reservation_id, None);
}

fn batch_entries(
    env: &Env,
    count: u32,
) -> Vec<(BloodType, BloodComponent, u32, Urgency, u64)> {
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

/// #1303: A batch larger than MAX_BATCH_SIZE (50) is rejected before any writes.
#[test]
fn test_batch_create_requests_rejects_over_cap() {
    let (env, _admin, hospital) = setup_authorized_hospital();
    let entries = batch_entries(&env, 51);

    let result = RequestContract::batch_create_requests(env.clone(), hospital, entries);

    assert_eq!(result, Err(ContractError::BatchTooLarge));
    assert_eq!(RequestContract::get_request_counter(env.clone()).unwrap(), 0);
}

/// #1303: A batch at the MAX_BATCH_SIZE boundary succeeds.
#[test]
fn test_batch_create_requests_at_cap_succeeds() {
    let (env, _admin, hospital) = setup_authorized_hospital();
    let entries = batch_entries(&env, 50);

    let ids = RequestContract::batch_create_requests(env.clone(), hospital, entries).unwrap();

    assert_eq!(ids.len(), 50);
    assert_eq!(RequestContract::get_request_counter(env.clone()).unwrap(), 50);
}

/// #1305: Verify set_fulfilling_org requires blood bank authorization.
/// An unauthorized blood bank cannot mark itself as fulfilling a request.
#[test]
fn test_set_fulfilling_org_rejects_unauthorized_blood_bank() {
    let (env, admin, hospital) = setup_authorized_hospital();
    let request_id = create_urgent_request(&env, &hospital);

    // Approve the request
    RequestContract::update_request_status(
        env.clone(),
        admin.clone(),
        request_id,
        RequestStatus::Approved,
        String::from_str(&env, "Approved"),
    )
    .unwrap();

    // An unauthorized blood bank tries to mark itself as fulfilling
    let unauthorized_blood_bank = Address::generate(&env);
    let result = RequestContract::set_fulfilling_org(
        env.clone(),
        unauthorized_blood_bank.clone(),
        request_id,
        unauthorized_blood_bank.clone(),
    );

    // Should fail: blood bank not authorized
    assert_eq!(result, Err(ContractError::NotAuthorizedBloodBank));
}

/// #1305: Verify set_fulfilling_org allows authorized blood banks to mark themselves.
#[test]
fn test_set_fulfilling_org_authorized_blood_bank_succeeds() {
    let (env, admin, hospital) = setup_authorized_hospital();
    let request_id = create_urgent_request(&env, &hospital);

    // Authorize a blood bank
    let blood_bank = Address::generate(&env);
    RequestContract::authorize_blood_bank(env.clone(), blood_bank.clone()).unwrap();

    // Approve the request
    RequestContract::update_request_status(
        env.clone(),
        admin.clone(),
        request_id,
        RequestStatus::Approved,
        String::from_str(&env, "Approved"),
    )
    .unwrap();

    // Authorized blood bank marks itself as fulfilling
    let result = RequestContract::set_fulfilling_org(
        env.clone(),
        blood_bank.clone(),
        request_id,
        blood_bank.clone(),
    );

    assert!(result.is_ok());

    let request = RequestContract::get_request(env.clone(), request_id).unwrap();
    assert_eq!(request.fulfilled_by, Some(blood_bank.clone()));
}

/// #1305: Verify set_fulfilling_org admin can still mark any org as fulfilling.
#[test]
fn test_set_fulfilling_org_admin_can_set_any_org() {
    let (env, admin, hospital) = setup_authorized_hospital();
    let request_id = create_urgent_request(&env, &hospital);

    // Approve the request
    RequestContract::update_request_status(
        env.clone(),
        admin.clone(),
        request_id,
        RequestStatus::Approved,
        String::from_str(&env, "Approved"),
    )
    .unwrap();

    // Admin marks any org (e.g., an unauthorized one) as fulfilling
    let any_org = Address::generate(&env);
    let result = RequestContract::set_fulfilling_org(
        env.clone(),
        admin.clone(),
        request_id,
        any_org.clone(),
    );

    assert!(result.is_ok());

    let request = RequestContract::get_request(env.clone(), request_id).unwrap();
    assert_eq!(request.fulfilled_by, Some(any_org));
}

/// #1304: Verify per-hospital index-based pagination scales with hospital's request count,
/// not the global request counter.
#[test]
fn test_get_requests_by_hospital_uses_per_hospital_index() {
    let env = Env::default();
    let admin = Address::generate(&env);
    let hospital_a = Address::generate(&env);
    let hospital_b = Address::generate(&env);

    env.mock_all_auths();

    RequestContract::initialize(env.clone(), admin.clone(), Address::generate(&env)).unwrap();
    RequestContract::authorize_hospital(env.clone(), hospital_a.clone()).unwrap();
    RequestContract::authorize_hospital(env.clone(), hospital_b.clone()).unwrap();

    env.ledger().set_timestamp(1_000);

    // Hospital A creates 3 requests
    let req_a1 = RequestContract::create_request(
        env.clone(),
        hospital_a.clone(),
        BloodType::OPositive,
        BloodComponent::WholeBlood,
        500,
        Urgency::Urgent,
        1_600,
    )
    .unwrap();
    let req_a2 = RequestContract::create_request(
        env.clone(),
        hospital_a.clone(),
        BloodType::APositive,
        BloodComponent::Plasma,
        300,
        Urgency::Routine,
        2_000,
    )
    .unwrap();
    let req_a3 = RequestContract::create_request(
        env.clone(),
        hospital_a.clone(),
        BloodType::BPositive,
        BloodComponent::RedCells,
        400,
        Urgency::Critical,
        1_800,
    )
    .unwrap();

    // Hospital B creates 2 requests
    let req_b1 = RequestContract::create_request(
        env.clone(),
        hospital_b.clone(),
        BloodType::ONegative,
        BloodComponent::Platelets,
        100,
        Urgency::Scheduled,
        2_500,
    )
    .unwrap();
    let req_b2 = RequestContract::create_request(
        env.clone(),
        hospital_b.clone(),
        BloodType::ABNegative,
        BloodComponent::Cryoprecipitate,
        50,
        Urgency::Urgent,
        1_700,
    )
    .unwrap();

    // Get all requests for hospital A (page 0, size 10)
    let results_a = RequestContract::get_requests_by_hospital(
        env.clone(),
        hospital_a.clone(),
        0,
        10,
    )
    .unwrap();

    assert_eq!(results_a.len(), 3);
    let ids_a: Vec<u64> = (0..results_a.len())
        .map(|i| results_a.get(i).unwrap().id)
        .collect();
    assert_eq!(ids_a, vec![req_a1, req_a2, req_a3]);

    // Get all requests for hospital B (page 0, size 10)
    let results_b = RequestContract::get_requests_by_hospital(
        env.clone(),
        hospital_b.clone(),
        0,
        10,
    )
    .unwrap();

    assert_eq!(results_b.len(), 2);
    let ids_b: Vec<u64> = (0..results_b.len())
        .map(|i| results_b.get(i).unwrap().id)
        .collect();
    assert_eq!(ids_b, vec![req_b1, req_b2]);

    // Test pagination: get first page with size 2 for hospital A
    let page_0_a = RequestContract::get_requests_by_hospital(
        env.clone(),
        hospital_a.clone(),
        0,
        2,
    )
    .unwrap();

    assert_eq!(page_0_a.len(), 2);
    assert_eq!(page_0_a.get(0).unwrap().id, req_a1);
    assert_eq!(page_0_a.get(1).unwrap().id, req_a2);

    // Get second page for hospital A
    let page_1_a = RequestContract::get_requests_by_hospital(
        env.clone(),
        hospital_a.clone(),
        1,
        2,
    )
    .unwrap();

    assert_eq!(page_1_a.len(), 1);
    assert_eq!(page_1_a.get(0).unwrap().id, req_a3);
}
