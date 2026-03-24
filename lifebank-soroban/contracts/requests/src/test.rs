use crate::storage;
use crate::{
    BloodComponent, BloodType, ContractMetadata, RequestContract, RequestContractClient,
    RequestStatus, Urgency,
};
use soroban_sdk::{
    testutils::{Address as _, Events, Ledger},
use crate::{ContractMetadata, RequestContract, RequestContractClient};
use soroban_sdk::{
    testutils::{Address as _, Events},
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
#[test]
fn test_initialize_sets_admin_inventory_counter_and_metadata() {
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
#[should_panic(expected = "Error(Contract, #0)")]
fn test_initialize_cannot_run_twice() {
    let (env, client, _contract_id) = create_uninitialized_contract();
    let admin = Address::generate(&env);
    let inventory_contract = Address::generate(&env);

    client.initialize(&admin, &inventory_contract);
    client.initialize(&admin, &inventory_contract);
}

#[test]
#[should_panic(expected = "Error(Contract, #1)")]
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
#[should_panic(expected = "Error(Contract, #5)")]
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
#[should_panic(expected = "Error(Contract, #3)")]
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
#[should_panic(expected = "Error(Contract, #4)")]
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

    let events = env.events().all();
    assert_eq!(events.len(), 1);
}

#[test]
#[should_panic(expected = "Error(Contract, #0)")]
fn test_initialize_cannot_run_twice() {
    let (env, client, _contract_id) = create_uninitialized_contract();
    let admin = Address::generate(&env);
    let inventory_contract = Address::generate(&env);

    client.initialize(&admin, &inventory_contract);
    client.initialize(&admin, &inventory_contract);
}

#[test]
#[should_panic(expected = "Error(Contract, #1)")]
fn test_readers_fail_before_initialization() {
    let (_env, client, _contract_id) = create_uninitialized_contract();
    let _ = client.get_admin();
}
