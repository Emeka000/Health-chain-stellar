#![cfg(test)]

use super::*;

#[contract]
struct MockRequestContract;

#[contractimpl]
impl MockRequestContract {
    pub fn get_request_counter(_env: Env) -> u64 {
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
            min_celsius_x100: DEFAULT_MIN_TEMPERATURE_C_X100,
            max_celsius_x100: DEFAULT_MAX_TEMPERATURE_C_X100,
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

    let result =
        client.try_record_compliance_attestation(&admin, &delivery_id, &compliance_hash, &true);
    assert!(result.is_ok());

    let events = env.events().all();
    assert!(!events.is_empty());
}

#[test]
fn test_get_compliance_attestation_roundtrip() {
    let (env, client, _contract_id, admin, _request_contract) = create_initialized_contract();
    let delivery_id = 99u64;
    let compliance_hash = Bytes::from_slice(&env, b"test_hash_data");

    client.record_compliance_attestation(&admin, &delivery_id, &compliance_hash, &false);

    let (retrieved_hash, is_compliant) = client.get_compliance_attestation(&delivery_id);
    assert_eq!(retrieved_hash, compliance_hash);
    assert!(!is_compliant);
}

#[test]
fn test_get_compliance_attestation_not_found() {
    let (_env, client, _contract_id, _admin, _request_contract) = create_initialized_contract();
    let unknown_delivery_id = 999u64;

    let result = client.try_get_compliance_attestation(&unknown_delivery_id);
    assert_eq!(result, Err(Ok(Error::DeliveryNotFound)));
}

#[test]
fn test_record_compliance_attestation_rejects_non_admin() {
    let (env, client, _contract_id, _admin, _request_contract) = create_initialized_contract();

    let unauthorized_caller = Address::generate(&env);
    let delivery_id = 55u64;
    let compliance_hash = Bytes::from_slice(&env, b"hash");

    let result = client.try_record_compliance_attestation(
        &unauthorized_caller,
        &delivery_id,
        &compliance_hash,
        &true,
    );
    assert!(result.is_err());
}

#[test]
fn test_record_compliance_attestation_rejects_unknown_delivery() {
    let (env, client, _contract_id, admin, _request_contract) = create_initialized_contract();
    let delivery_id = 101u64;
    let compliance_hash = Bytes::from_slice(&env, b"hash");

    let result =
        client.try_record_compliance_attestation(&admin, &delivery_id, &compliance_hash, &true);

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

/// #1833: `record_compliance_attestation` must only attest requests that are
/// actually in flight or delivered, must cap the hash length, and must offer an
/// auditable admin amendment path.
mod compliance_attestation_hardening {
    use super::*;
    extern crate std;
    use soroban_sdk::TryFromVal as _;

    fn head_event(
        env: &Env,
    ) -> (
        soroban_sdk::Address,
        soroban_sdk::Vec<soroban_sdk::Val>,
        soroban_sdk::Val,
    ) {
        let evs = env.events().all();
        evs.get(0u32).unwrap()
    }

    fn payload_len(env: &Env, data: &soroban_sdk::Val) -> u32 {
        soroban_sdk::Vec::<soroban_sdk::Val>::try_from_val(env, data)
            .expect("event data should be a vec")
            .len()
    }

    #[test]
    fn record_rejects_oversized_hash() {
        let (env, client, _cid, admin, _req) = create_initialized_contract();
        let oversized = Bytes::from_slice(&env, &[0u8; 65]);

        let result = client.try_record_compliance_attestation(&admin, &42u64, &oversized, &true);
        assert_eq!(result, Err(Ok(Error::ComplianceHashTooLong)));
    }

    #[test]
    fn record_rejects_cancelled_or_pending_request() {
        let (env, client, _cid, admin, _req) = create_initialized_contract();
        let hash = Bytes::from_slice(&env, b"hash");

        // The mock request contract reports no in-flight/delivered request, so
        // attestation must fail rather than blindly trusting the counter.
        let result = client.try_record_compliance_attestation(&admin, &42u64, &hash, &true);
        assert_eq!(result, Err(Ok(Error::RequestNotDeliverable)));
    }

    #[test]
    fn amend_requires_existing_attestation() {
        let (env, client, _cid, admin, _req) = create_initialized_contract();
        let hash = Bytes::from_slice(&env, b"hash");

        let result = client.try_amend_compliance_attestation(&admin, &42u64, &hash, &true);
        assert_eq!(result, Err(Ok(Error::DeliveryNotFound)));
    }

    #[test]
    fn amend_emits_previous_value_for_audit() {
        let (env, client, _cid, admin, _req) = create_initialized_contract();
        let original = Bytes::from_slice(&env, b"original_hash");
        let amended = Bytes::from_slice(&env, b"amended_hash");

        // Seed an attestation directly so the amendment path can be exercised
        // without depending on the request-status gate.
        env.as_contract(&_cid, || {
            env.storage().persistent().set(
                &DataKey::ComplianceAttestation(42u64),
                &(original.clone(), true),
            );
        });

        client.amend_compliance_attestation(&admin, &42u64, &amended, &false);

        let (retrieved_hash, is_compliant) = client.get_compliance_attestation(&42u64);
        assert_eq!(retrieved_hash, amended);
        assert!(!is_compliant);

        // The amendment event carries the previous value so it is auditable.
        let (_cid, _topics, data) = head_event(&env);
        assert_eq!(payload_len(&env, &data), 3);
    }
}

/// #1480: the two admin setters that redefine what counts as a compliant
/// delivery published no event, so indexers and the backend that later calls
/// `record_compliance_attestation` had no way to see the compliance bar move.
mod threshold_proof_events {
    use super::*;
    extern crate std;
    use soroban_sdk::TryFromVal as _;

    fn thresholds(min: i32, max: i32) -> TemperatureThresholds {
        TemperatureThresholds {
            min_celsius_x100: min,
            max_celsius_x100: max,
        }
    }

    fn proofs(photo: bool, sig: bool, log: bool) -> ProofRequirements {
        ProofRequirements {
            requires_photo_proof: photo,
            requires_recipient_signature: sig,
            requires_temperature_log: log,
        }
    }

    /// `env.events()` exposes only the most recent batch, so these tests assert
    /// on the event at the head rather than on a cumulative count.
    fn head_event(
        env: &Env,
    ) -> (
        soroban_sdk::Address,
        soroban_sdk::Vec<soroban_sdk::Val>,
        soroban_sdk::Val,
    ) {
        let evs = env.events().all();
        evs.get(0u32).unwrap()
    }

    fn payload_len(env: &Env, data: &soroban_sdk::Val) -> u32 {
        soroban_sdk::Vec::<soroban_sdk::Val>::try_from_val(env, data)
            .expect("event data should be a vec")
            .len()
    }

    #[test]
    fn set_temperature_thresholds_emits_event() {
        let (env, client, _cid, admin, _req) = create_initialized_contract();
        // initialize() emitted DeliveryInitialized: 2 topics, 2 data fields.
        let (init_cid, init_topics, init_data) = head_event(&env);
        assert_eq!(payload_len(&env, &init_data), 2);

        client.set_temperature_thresholds(&admin, &thresholds(-1000, 1000));

        let (cid, topics, data) = head_event(&env);
        assert_eq!(cid, init_cid);
        assert!(
            topics != init_topics,
            "topics should identify the new event"
        );
        assert_eq!(payload_len(&env, &data), 2);
    }

    #[test]
    fn set_proof_requirements_emits_event() {
        let (env, client, _cid, admin, _req) = create_initialized_contract();
        let (init_cid, init_topics, _init_data) = head_event(&env);

        client.set_proof_requirements(&admin, &proofs(false, false, false));

        let (cid, topics, data) = head_event(&env);
        assert_eq!(cid, init_cid);
        assert!(
            topics != init_topics,
            "topics should identify the new event"
        );
        assert_eq!(payload_len(&env, &data), 3);
    }
}
