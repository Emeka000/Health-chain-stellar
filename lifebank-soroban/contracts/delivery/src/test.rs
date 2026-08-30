#![cfg(test)]

use super::*;

#[contract]
struct MockRequestContract;

#[contractimpl]
impl MockRequestContract {
    fn get_request_counter(_env: Env) -> u64 {
        100
    }
}
use soroban_sdk::{
    testutils::{Address as _, Events as _},
    Address, Env,
};

fn create_uninitialized_contract<'a>() -> (Env, DeliveryContractClient<'a>, Address) {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(DeliveryContract, ());
    let client = DeliveryContractClient::new(&env, &contract_id);

    (env, client, contract_id)
}

fn create_initialized_contract<'a>() -> (Env, DeliveryContractClient<'a>, Address, Address, Address)
{
    let (env, client, contract_id) = create_uninitialized_contract();
    let admin = Address::generate(&env);
    let request_contract = env.register(MockRequestContract, ());

    client.initialize(&admin, &request_contract);

    (env, client, contract_id, admin, request_contract)
}

#[test]
fn test_initialize_sets_admin_request_contract_and_counter() {
    let (_env, client, _contract_id, admin, request_contract) = create_initialized_contract();

    assert!(client.is_initialized());
    assert_eq!(client.get_admin(), admin);
    assert_eq!(client.get_request_contract(), request_contract);
    assert_eq!(client.get_delivery_counter(), 0);
}

#[test]
fn test_initialize_sets_temperature_thresholds() {
    let (_env, client, _contract_id, _admin, _request_contract) = create_initialized_contract();

    assert_eq!(
        client.get_temperature_thresholds(),
        TemperatureThresholds {
            min_celsius: DEFAULT_MIN_TEMPERATURE_C,
            max_celsius: DEFAULT_MAX_TEMPERATURE_C,
        }
    );
}

#[test]
fn test_initialize_sets_proof_requirements() {
    let (_env, client, _contract_id, _admin, _request_contract) = create_initialized_contract();

    assert_eq!(
        client.get_proof_requirements(),
        ProofRequirements {
            requires_photo_proof: true,
            requires_recipient_signature: true,
            requires_temperature_log: true,
        }
    );
}

#[test]
fn test_initialize_emits_event() {
    let (env, _client, _contract_id, _admin, _request_contract) = create_initialized_contract();

    assert_eq!(env.events().all().len(), 1);
}

#[test]
fn test_initialize_cannot_run_twice() {
    let (env, client, _contract_id) = create_uninitialized_contract();
    let admin = Address::generate(&env);
    let request_contract = Address::generate(&env);

    client.initialize(&admin, &request_contract);

    let result = client.try_initialize(&admin, &request_contract);
    assert_eq!(result, Err(Ok(Error::AlreadyInitialized)));
}

#[test]
fn test_getters_fail_before_initialization() {
    let (_env, client, _contract_id) = create_uninitialized_contract();

    assert_eq!(client.try_get_admin(), Err(Ok(Error::NotInitialized)));
    assert_eq!(
        client.try_get_request_contract(),
        Err(Ok(Error::NotInitialized))
    );
    assert_eq!(
        client.try_get_delivery_counter(),
        Err(Ok(Error::NotInitialized))
    );
    assert_eq!(
        client.try_get_temperature_thresholds(),
        Err(Ok(Error::NotInitialized))
    );
    assert_eq!(
        client.try_get_proof_requirements(),
        Err(Ok(Error::NotInitialized))
    );
}

#[test]
fn test_record_compliance_attestation_succeeds() {
    let (env, client, _contract_id, admin, _request_contract) = create_initialized_contract();
    let delivery_id = 42u64;
    let compliance_hash = Bytes::from_slice(&env, b"hash_value");

    let result = client.try_record_compliance_attestation(&admin, &delivery_id, &compliance_hash, &true);
    assert!(result.is_ok());

    let events = env.events().all();
    assert!(events.len() >= 1);
}

#[test]
fn test_get_compliance_attestation_roundtrip() {
    let (env, client, _contract_id, admin, _request_contract) = create_initialized_contract();
    let delivery_id = 99u64;
    let compliance_hash = Bytes::from_slice(&env, b"test_hash_data");

    client.record_compliance_attestation(&admin, &delivery_id, &compliance_hash, &false);

    let (retrieved_hash, is_compliant) = client.get_compliance_attestation(&delivery_id);
    assert_eq!(retrieved_hash, compliance_hash);
    assert_eq!(is_compliant, false);
}

#[test]
fn test_get_compliance_attestation_not_found() {
    let (_env, client, _contract_id, _admin, _request_contract) = create_initialized_contract();
    let unknown_delivery_id = 999u64;

    let result = client.try_get_compliance_attestation(&unknown_delivery_id);
    assert_eq!(result, Err(Ok(Error::DeliveryNotFound)));
}

#[test]
fn test_record_compliance_attestation_requires_admin_auth() {
    let (env, client, _contract_id, _admin, _request_contract) = create_initialized_contract();
    env.mock_all_auths_allow_last_error();

    let unauthorized_caller = Address::generate(&env);
    let delivery_id = 55u64;
    let compliance_hash = Bytes::from_slice(&env, b"hash");

    let result = client.try_record_compliance_attestation(&unauthorized_caller, &delivery_id, &compliance_hash, &true);
    assert!(result.is_err());
}

#[test]
fn test_record_compliance_attestation_rejects_unknown_delivery() {
    let (env, client, _contract_id, admin, _request_contract) = create_initialized_contract();
    let delivery_id = 101u64;
    let compliance_hash = Bytes::from_slice(&env, b"hash");

    let result = client.try_record_compliance_attestation(
        &admin,
        &delivery_id,
        &compliance_hash,
        &true,
    );

    assert_eq!(result, Err(Ok(Error::DeliveryNotFound)));
}

#[test]
fn test_record_compliance_attestation_updates_delivery_counter() {
    let (env, client, _contract_id, admin, _request_contract) = create_initialized_contract();
    let delivery_id = 42u64;
    let compliance_hash = Bytes::from_slice(&env, b"hash");

    client.record_compliance_attestation(&admin, &delivery_id, &compliance_hash, &true);

    assert_eq!(client.get_delivery_counter(), 100);
}
