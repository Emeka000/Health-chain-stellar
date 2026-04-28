use crate::storage;
use crate::{
    BloodComponent, BloodType, ContractMetadata, RequestContract, RequestContractClient,
    RequestStatus, Urgency,
};
use soroban_sdk::{
    testutils::{Address as _, Events as _, Ledger as _},
    Address, Env, String,
};

fn create_uninitialized_contract<'a>() -> (Env, RequestContractClient<'a>, Address) {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(RequestContract, ());
    let client = RequestContractClient::new(&env, &contract_id);

    (env, client, contract_id)
}

fn create_initialized_contract<'a>() -> (Env, RequestContractClient<'a>, Address, Address, Address) {
    let (env, client, contract_id) = create_uninitialized_contract();
    let admin = Address::generate(&env);
    let inventory_contract = Address::generate(&env);
    client.initialize(&admin, &inventory_contract);
    (env, client, contract_id, admin, inventory_contract)
}

fn authorize_hospital(env: &Env, client: &RequestContractClient<'_>) -> Address {
    let hospital = Address::generate(env);
    client.authorize_hospital(&hospital);
    hospital
}

#[test]
fn test_initialize_sets_admin_inventory_counter_and_metadata() {
    let (env, client, contract_id, admin, inventory_contract) = create_initialized_contract();

    assert!(client.is_initialized());
    assert_eq!(client.get_admin(), admin.clone());
    assert_eq!(client.get_inventory_contract(), inventory_contract.clone());
    assert_eq!(client.get_request_counter(), 0);
    assert_eq!(
        client.get_metadata(),
        ContractMetadata {
            name: String::from_str(&env, "Blood Request Management"),
            version: 1,
        }
    );

    let stored_admin = env.as_contract(&contract_id, || storage::get_admin(&env));
    let stored_inventory =
        env.as_contract(&contract_id, || storage::get_inventory_contract(&env));
    let stored_counter =
        env.as_contract(&contract_id, || storage::get_request_counter(&env));

    assert_eq!(stored_admin, admin);
    assert_eq!(stored_inventory, inventory_contract);
    assert_eq!(stored_counter, 0);
}

#[test]
fn test_initialize_emits_initialized_event() {
    let (env, _client, _contract_id, _admin, _inventory_contract) = create_initialized_contract();
    assert_eq!(env.events().all().len(), 1);
}

#[test]
#[should_panic(expected = "Error(Contract, #300)")]
fn test_initialize_cannot_run_twice() {
    let (env, client, _contract_id) = create_uninitialized_contract();
    let admin = Address::generate(&env);
    let inventory_contract = Address::generate(&env);

    client.initialize(&admin, &inventory_contract);
    client.initialize(&admin, &inventory_contract);
}

#[test]
#[should_panic(expected = "Error(Contract, #301)")]
fn test_readers_fail_before_initialization() {
    let (_env, client, _contract_id) = create_uninitialized_contract();
    let _ = client.get_admin();
}

#[test]
fn test_authorize_and_revoke_hospital() {
    let (env, client, _contract_id, _admin, _inventory_contract) = create_initialized_contract();
    let hospital = Address::generate(&env);

    assert!(!client.is_hospital_authorized(&hospital));

    client.authorize_hospital(&hospital);
    assert!(client.is_hospital_authorized(&hospital));

    client.revoke_hospital(&hospital);
    assert!(!client.is_hospital_authorized(&hospital));
}

#[test]
fn test_create_request_success() {
    let (env, client, _contract_id, _admin, _inventory_contract) = create_initialized_contract();
    let hospital = authorize_hospital(&env, &client);

    env.ledger().set_timestamp(1_000);

    let request_id = client.create_request(
        &hospital,
        &BloodType::APositive,
        &BloodComponent::WholeBlood,
        &450u32,
        &Urgency::Urgent,
        &1_600u64,
    );

    assert_eq!(request_id, 1);
    assert_eq!(client.get_request_counter(), 1);

    let request = client.get_request(&request_id);
    assert_eq!(request.id, 1);
    assert_eq!(request.hospital_id, hospital);
    assert_eq!(request.blood_type, BloodType::APositive);
    assert_eq!(request.component, BloodComponent::WholeBlood);
    assert_eq!(request.quantity_ml, 450);
    assert_eq!(request.urgency, Urgency::Urgent);
    assert_eq!(request.created_timestamp, 1_000);
    assert_eq!(request.required_by_timestamp, 1_600);
    assert_eq!(request.status, RequestStatus::Pending);
    assert_eq!(request.fulfilled_quantity_ml, 0);
    assert_eq!(request.assigned_units.len(), 0);
}

#[test]
fn test_create_request_generates_unique_ids() {
    let (env, client, _contract_id, _admin, _inventory_contract) = create_initialized_contract();
    let hospital = authorize_hospital(&env, &client);

    env.ledger().set_timestamp(5_000);

    let first = client.create_request(
        &hospital,
        &BloodType::OPositive,
        &BloodComponent::RedCells,
        &300u32,
        &Urgency::Routine,
        &5_500u64,
    );

    let second = client.create_request(
        &hospital,
        &BloodType::ONegative,
        &BloodComponent::Plasma,
        &250u32,
        &Urgency::Critical,
        &5_700u64,
    );

    assert_eq!(first, 1);
    assert_eq!(second, 2);
    assert_eq!(client.get_request_counter(), 2);
}

#[test]
#[should_panic(expected = "Error(Contract, #305)")]
fn test_create_request_requires_authorized_hospital() {
    let (env, client, _contract_id, _admin, _inventory_contract) = create_initialized_contract();
    let hospital = Address::generate(&env);

    env.ledger().set_timestamp(100);

    client.create_request(
        &hospital,
        &BloodType::BPositive,
        &BloodComponent::Platelets,
        &200u32,
        &Urgency::Scheduled,
        &200u64,
    );
}

#[test]
#[should_panic(expected = "Error(Contract, #303)")]
fn test_create_request_rejects_past_timestamp() {
    let (env, client, _contract_id, _admin, _inventory_contract) = create_initialized_contract();
    let hospital = authorize_hospital(&env, &client);

    env.ledger().set_timestamp(2_000);

    client.create_request(
        &hospital,
        &BloodType::ABPositive,
        &BloodComponent::Plasma,
        &250u32,
        &Urgency::Routine,
        &2_000u64,
    );
}

#[test]
#[should_panic(expected = "Error(Contract, #304)")]
fn test_create_request_rejects_zero_quantity() {
    let (env, client, _contract_id, _admin, _inventory_contract) = create_initialized_contract();
    let hospital = authorize_hospital(&env, &client);

    env.ledger().set_timestamp(2_000);

    client.create_request(
        &hospital,
        &BloodType::ABNegative,
        &BloodComponent::Cryoprecipitate,
        &0u32,
        &Urgency::Critical,
        &2_100u64,
    );
}

#[test]
fn test_partial_fulfillment_transitions_and_accounting() {
    let (env, client, _contract_id, admin, _inventory_contract) = create_initialized_contract();
    let hospital = authorize_hospital(&env, &client);
    env.ledger().set_timestamp(3_000);

    let request_id = client.create_request(
        &hospital,
        &BloodType::OPositive,
        &BloodComponent::WholeBlood,
        &500u32,
        &Urgency::Urgent,
        &3_600u64,
    );

    client.update_request_status(
        &admin,
        &request_id,
        &RequestStatus::Approved,
        &String::from_str(&env, "Approved for dispatch"),
    );

    client.partial_fulfill_request(
        &admin,
        &request_id,
        &200u32,
        &String::from_str(&env, "First leg delivered"),
    );
    let partial = client.get_request(&request_id);
    assert_eq!(partial.status, RequestStatus::InProgress);
    assert_eq!(partial.fulfilled_quantity_ml, 200);

    client.partial_fulfill_request(
        &admin,
        &request_id,
        &300u32,
        &String::from_str(&env, "Final leg delivered"),
    );
    let fulfilled = client.get_request(&request_id);
    assert_eq!(fulfilled.status, RequestStatus::Fulfilled);
    assert_eq!(fulfilled.fulfilled_quantity_ml, 500);
}

#[test]
#[should_panic(expected = "Error(Contract, #302)")]
fn test_partial_fulfillment_restricted_to_admin() {
    let (env, client, _contract_id, admin, _inventory_contract) = create_initialized_contract();
    let hospital = authorize_hospital(&env, &client);
    env.ledger().set_timestamp(4_000);
    let request_id = client.create_request(
        &hospital,
        &BloodType::APositive,
        &BloodComponent::RedCells,
        &300u32,
        &Urgency::Routine,
        &4_500u64,
    );
    client.update_request_status(
        &admin,
        &request_id,
        &RequestStatus::Approved,
        &String::from_str(&env, "Approved"),
    );

    client.partial_fulfill_request(
        &hospital,
        &request_id,
        &100u32,
        &String::from_str(&env, "Unauthorized attempt"),
    );
}

#[test]
#[should_panic(expected = "Error(Contract, #309)")]
fn test_cancel_requires_reason() {
    let (env, client, _contract_id, _admin, _inventory_contract) = create_initialized_contract();
    let hospital = authorize_hospital(&env, &client);
    env.ledger().set_timestamp(5_000);
    let request_id = client.create_request(
        &hospital,
        &BloodType::BPositive,
        &BloodComponent::Plasma,
        &250u32,
        &Urgency::Routine,
        &5_500u64,
    );
    client.cancel_request(&hospital, &request_id, &String::from_str(&env, ""));
}

#[test]
#[should_panic(expected = "Error(Contract, #309)")]
fn test_reject_requires_reason() {
    let (env, client, _contract_id, admin, _inventory_contract) = create_initialized_contract();
    let hospital = authorize_hospital(&env, &client);
    env.ledger().set_timestamp(6_000);
    let request_id = client.create_request(
        &hospital,
        &BloodType::ABPositive,
        &BloodComponent::Platelets,
        &100u32,
        &Urgency::Urgent,
        &6_500u64,
    );
    client.update_request_status(
        &admin,
        &request_id,
        &RequestStatus::Rejected,
        &String::from_str(&env, ""),
    );
}

#[test]
fn test_request_history_captures_transition_rationale() {
    let (env, client, _contract_id, admin, _inventory_contract) = create_initialized_contract();
    let hospital = authorize_hospital(&env, &client);
    env.ledger().set_timestamp(7_000);
    let request_id = client.create_request(
        &hospital,
        &BloodType::ONegative,
        &BloodComponent::WholeBlood,
        &400u32,
        &Urgency::Critical,
        &7_300u64,
    );
    client.update_request_status(
        &admin,
        &request_id,
        &RequestStatus::Approved,
        &String::from_str(&env, "Stock confirmed"),
    );
    client.partial_fulfill_request(
        &admin,
        &request_id,
        &150u32,
        &String::from_str(&env, "Initial transport completed"),
    );
    client.cancel_request(
        &hospital,
        &request_id,
        &String::from_str(&env, "Hospital no longer needs remaining units"),
    );

    let history = client.get_request_history(&request_id);
    assert_eq!(history.len(), 4);
    let created = history.get(0).unwrap();
    assert_eq!(created.new_status, RequestStatus::Pending);
    assert_eq!(created.reason, String::from_str(&env, "Request created"));

    let approved = history.get(1).unwrap();
    assert_eq!(approved.new_status, RequestStatus::Approved);
    assert_eq!(approved.reason, String::from_str(&env, "Stock confirmed"));

    let partial = history.get(2).unwrap();
    assert_eq!(partial.new_status, RequestStatus::InProgress);
    assert_eq!(partial.fulfilled_delta_ml, 150);
    assert_eq!(
        partial.reason,
        String::from_str(&env, "Initial transport completed")
    );

    let cancelled = history.get(3).unwrap();
    assert_eq!(cancelled.new_status, RequestStatus::Cancelled);
    assert_eq!(
        cancelled.reason,
        String::from_str(&env, "Hospital no longer needs remaining units")
    );
}

