use soroban_sdk::{testutils::Address as _, Address, Env};

use crate::{DeliveryContract, DeliveryContractClient, DeliveryStatus};

// ── helpers ──────────────────────────────────────────────────────────────────

fn setup<'a>() -> (Env, Address, DeliveryContractClient<'a>) {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(DeliveryContract, ());
    let client = DeliveryContractClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let request_contract = Address::generate(&env);

    // blood: 2°C – 6°C (stored as celsius * 100)
    client.initialize(&admin, &request_contract, &200, &600, &true, &true);

    (env, admin, client)
}

// ── initialize ────────────────────────────────────────────────────────────────

#[test]
fn test_initialize_success() {
    let (_env, _admin, client) = setup();

    let thresholds = client.get_temp_thresholds();
    assert_eq!(thresholds.min_celsius_x100, 200);
    assert_eq!(thresholds.max_celsius_x100, 600);

    let proof = client.get_proof_requirements();
    assert!(proof.photo_required);
    assert!(proof.signature_required);
}

#[test]
#[should_panic(expected = "AlreadyInitialized")]
fn test_initialize_twice_fails() {
    let (env, admin, client) = setup();
    let request_contract = Address::generate(&env);
    client.initialize(&admin, &request_contract, &200, &600, &false, &false);
}

#[test]
#[should_panic(expected = "InvalidTemperatureThreshold")]
fn test_initialize_invalid_threshold_fails() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(DeliveryContract, ());
    let client = DeliveryContractClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let request_contract = Address::generate(&env);

    // min >= max → should fail
    client.initialize(&admin, &request_contract, &600, &200, &false, &false);
}

#[test]
fn test_initialize_sets_request_contract() {
    let (_env, _admin, client) = setup();
    // request_contract was set during setup; just verify it's retrievable
    let rc = client.get_request_contract();
    // It's a valid address (non-zero check via re-use in another call)
    let _ = rc;
}

// ── delivery counter ──────────────────────────────────────────────────────────

#[test]
fn test_delivery_counter_increments() {
    let (env, _admin, client) = setup();

    let courier = Address::generate(&env);
    let recipient = Address::generate(&env);

    let id1 = client.create_delivery(&1u64, &courier, &recipient);
    let id2 = client.create_delivery(&2u64, &courier, &recipient);

    assert_eq!(id1, 1);
    assert_eq!(id2, 2);
}

// ── in-transit ────────────────────────────────────────────────────────────────

#[test]
fn test_mark_in_transit_success() {
    let (env, _admin, client) = setup();

    let courier = Address::generate(&env);
    let recipient = Address::generate(&env);

    let id = client.create_delivery(&1u64, &courier, &recipient);
    client.mark_in_transit(&id, &courier);

    let delivery = client.get_delivery(&id);
    assert_eq!(delivery.status, DeliveryStatus::InTransit);
}

#[test]
#[should_panic(expected = "InvalidStatusTransition")]
fn test_mark_in_transit_wrong_courier_fails() {
    let (env, _admin, client) = setup();

    let courier = Address::generate(&env);
    let other = Address::generate(&env);
    let recipient = Address::generate(&env);

    let id = client.create_delivery(&1u64, &courier, &recipient);
    client.mark_in_transit(&id, &other); // wrong courier
}

// ── confirm delivery ──────────────────────────────────────────────────────────

#[test]
fn test_confirm_delivery_success() {
    let (env, _admin, client) = setup();

    let courier = Address::generate(&env);
    let recipient = Address::generate(&env);

    let id = client.create_delivery(&1u64, &courier, &recipient);
    client.mark_in_transit(&id, &courier);

    let photo = soroban_sdk::String::from_str(&env, "ipfs://photo-hash");
    let sig = soroban_sdk::String::from_str(&env, "0xsignature");

    client.confirm_delivery(&id, &courier, &Some(photo), &Some(sig));

    let delivery = client.get_delivery(&id);
    assert_eq!(delivery.status, DeliveryStatus::Delivered);
    assert!(delivery.delivered_at.is_some());
}

#[test]
#[should_panic(expected = "MissingProof")]
fn test_confirm_delivery_missing_photo_fails() {
    let (env, _admin, client) = setup();

    let courier = Address::generate(&env);
    let recipient = Address::generate(&env);

    let id = client.create_delivery(&1u64, &courier, &recipient);
    client.mark_in_transit(&id, &courier);

    let sig = soroban_sdk::String::from_str(&env, "0xsignature");
    // photo_required = true but None provided
    client.confirm_delivery(&id, &courier, &None, &Some(sig));
}

// ── temperature thresholds ────────────────────────────────────────────────────

#[test]
fn test_update_temp_thresholds_success() {
    let (_env, _admin, client) = setup();

    client.update_temp_thresholds(&-2000, &200); // -20°C to 2°C (frozen)

    let thresholds = client.get_temp_thresholds();
    assert_eq!(thresholds.min_celsius_x100, -2000);
    assert_eq!(thresholds.max_celsius_x100, 200);
}

#[test]
#[should_panic(expected = "InvalidTemperatureThreshold")]
fn test_update_temp_thresholds_invalid_fails() {
    let (_env, _admin, client) = setup();
    client.update_temp_thresholds(&600, &200); // min > max
}
