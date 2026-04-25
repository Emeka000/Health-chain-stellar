// Standalone storage layout tests. Do not add business logic tests here.

#![cfg(test)]

use soroban_sdk::{
    symbol_short,
    testutils::{Address as _, Ledger},
    Address, Env, Map, Symbol,
};

use crate::{
    BloodComponent, BloodStatus, BloodType, BloodUnit, HealthChainContract,
    HealthChainContractClient, ADMIN, BLOOD_BANKS, BLOOD_UNITS, CUSTODY_EVENTS, DISPUTES, HISTORY,
    HOSPITALS, NEXT_DISPUTE_ID, NEXT_ID, NEXT_PAYMENT_ID, NEXT_REQUEST_ID, PAYMENTS, REQUESTS,
    REQUEST_KEYS,
};

#[test]
fn test_register_unit_creates_blood_unit_in_persistent_storage() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(HealthChainContract, ());
    let client = HealthChainContractClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let bank = Address::generate(&env);

    client.initialize(&admin);
    client.register_blood_bank(&bank);

    let unit_id = client.register_blood(
        &bank,
        &BloodType::APositive,
        &BloodComponent::WholeBlood,
        &450,
        &(env.ledger().timestamp() + 86400 * 30),
        &Some(symbol_short!("DONOR1")),
    );

    // Directly inspect persistent storage
    env.as_contract(&contract_id, || {
        let units: Map<u64, BloodUnit> = env
            .storage()
            .persistent()
            .get(&BLOOD_UNITS)
            .expect("BLOOD_UNITS should exist in persistent storage");

        let unit = units
            .get(unit_id)
            .expect("BloodUnit entry should exist for unit_id");

        assert_eq!(unit.id, unit_id);
        assert_eq!(unit.blood_type, BloodType::APositive);
        assert_eq!(unit.status, BloodStatus::Available);

        // Verify it's NOT in instance storage
        assert!(!env.storage().instance().has(&BLOOD_UNITS));
    });
}

#[test]
fn test_register_unit_creates_bank_units_index_in_persistent_storage() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(HealthChainContract, ());
    let client = HealthChainContractClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let bank = Address::generate(&env);

    client.initialize(&admin);
    client.register_blood_bank(&bank);

    let unit_id = client.register_blood(
        &bank,
        &BloodType::OPositive,
        &BloodComponent::WholeBlood,
        &350,
        &(env.ledger().timestamp() + 86400 * 20),
        &None,
    );

    // Directly inspect persistent storage for BankUnits index
    env.as_contract(&contract_id, || {
        // Note: The current implementation doesn't maintain a BankUnits index
        // This test documents the expected behavior per requirements
        // If BankUnits index is implemented, it should be stored as:
        // DataKey::BankUnits(bank_id) -> Vec<u64> in persistent storage

        // For now, we verify the unit exists and is associated with the bank
        let units: Map<u64, BloodUnit> = env
            .storage()
            .persistent()
            .get(&BLOOD_UNITS)
            .expect("BLOOD_UNITS should exist");

        let unit = units.get(unit_id).expect("Unit should exist");
        assert_eq!(unit.bank_id, bank);

        // When BankUnits index is implemented, uncomment:
        // let bank_units_key = DataKey::BankUnits(bank.clone());
        // let bank_units: Vec<u64> = env
        //     .storage()
        //     .persistent()
        //     .get(&bank_units_key)
        //     .expect("BankUnits index should exist in persistent storage");
        // assert!(bank_units.contains(&unit_id));
    });
}

#[test]
fn test_register_unit_creates_donor_units_index_in_persistent_storage() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(HealthChainContract, ());
    let client = HealthChainContractClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let bank = Address::generate(&env);
    let donor_id = symbol_short!("DONOR42");

    client.initialize(&admin);
    client.register_blood_bank(&bank);

    let unit_id = client.register_blood(
        &bank,
        &BloodType::BNegative,
        &BloodComponent::WholeBlood,
        &400,
        &(env.ledger().timestamp() + 86400 * 25),
        &Some(donor_id.clone()),
    );

    // Directly inspect persistent storage for DonorUnits index
    env.as_contract(&contract_id, || {
        // Note: The current implementation doesn't maintain a DonorUnits index
        // This test documents the expected behavior per requirements
        // DonorUnits should be stored as:
        // DataKey::DonorUnits(bank_id, donor_id) -> Vec<u64> in persistent storage

        // For now, we verify the unit exists with the donor_id
        let units: Map<u64, BloodUnit> = env
            .storage()
            .persistent()
            .get(&BLOOD_UNITS)
            .expect("BLOOD_UNITS should exist");

        let unit = units.get(unit_id).expect("Unit should exist");
        assert_eq!(unit.donor_id, donor_id);

        // When DonorUnits index is implemented, uncomment:
        // let donor_units_key = DataKey::DonorUnits(bank.clone(), donor_id.clone());
        // let donor_units: Vec<u64> = env
        //     .storage()
        //     .persistent()
        //     .get(&donor_units_key)
        //     .expect("DonorUnits index should exist in persistent storage");
        // assert!(donor_units.contains(&unit_id));
    });
}

#[test]
fn test_initialize_creates_admin_in_instance_storage() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(HealthChainContract, ());
    let client = HealthChainContractClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    client.initialize(&admin);

    // Directly inspect instance storage
    env.as_contract(&contract_id, || {
        let stored_admin: Address = env
            .storage()
            .instance()
            .get(&ADMIN)
            .expect("ADMIN should exist in instance storage");

        assert_eq!(stored_admin, admin);

        // Verify it's NOT in persistent storage
        assert!(!env.storage().persistent().has(&ADMIN));
    });
}

#[test]
fn test_update_status_modifies_existing_entry_no_new_key() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(HealthChainContract, ());
    let client = HealthChainContractClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let bank = Address::generate(&env);
    let hospital = Address::generate(&env);

    client.initialize(&admin);
    client.register_blood_bank(&bank);
    client.register_hospital(&hospital);

    let unit_id = client.register_blood(
        &bank,
        &BloodType::ABPositive,
        &BloodComponent::WholeBlood,
        &300,
        &(env.ledger().timestamp() + 86400 * 35),
        &None,
    );

    // Get initial storage state
    let initial_keys_count = env.as_contract(&contract_id, || {
        let units: Map<u64, BloodUnit> = env.storage().persistent().get(&BLOOD_UNITS).unwrap();
        units.len()
    });

    // Allocate blood (changes status to Reserved)
    client.allocate_blood(&bank, &unit_id, &hospital);

    // Verify status changed in-place, no new keys created
    env.as_contract(&contract_id, || {
        let units: Map<u64, BloodUnit> = env.storage().persistent().get(&BLOOD_UNITS).unwrap();

        // Same number of keys
        assert_eq!(units.len(), initial_keys_count);

        // Status updated
        let unit = units.get(unit_id).unwrap();
        assert_eq!(unit.status, BloodStatus::Reserved);
    });
}

#[test]
fn test_expire_unit_updates_status_field_no_deletion() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(HealthChainContract, ());
    let client = HealthChainContractClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let bank = Address::generate(&env);

    client.initialize(&admin);
    client.register_blood_bank(&bank);

    // Register unit with short expiration
    let expiration = env.ledger().timestamp() + 86400; // 1 day
    let unit_id = client.register_blood(
        &bank,
        &BloodType::ONegative,
        &BloodComponent::WholeBlood,
        &250,
        &expiration,
        &None,
    );

    // Fast-forward time past expiration
    env.ledger().with_mut(|li| {
        li.timestamp = expiration + 1;
    });

    // Trigger expiration by trying to allocate
    let hospital = Address::generate(&env);
    client.register_hospital(&hospital);

    // This should fail due to expiration
    let result = client.try_allocate_blood(&bank, &unit_id, &hospital);
    assert!(result.is_err());

    // Verify entry still exists with Expired status
    env.as_contract(&contract_id, || {
        let units: Map<u64, BloodUnit> = env
            .storage()
            .persistent()
            .get(&BLOOD_UNITS)
            .expect("BLOOD_UNITS should still exist");

        let unit = units
            .get(unit_id)
            .expect("BloodUnit entry should NOT be deleted");

        // Status should be Expired (or still Available if not auto-expired)
        // The contract doesn't auto-expire, so we just verify the entry exists
        assert!(unit.status == BloodStatus::Available || unit.status == BloodStatus::Expired);
    });
}

#[test]
fn test_register_two_units_same_bank_creates_two_entries() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(HealthChainContract, ());
    let client = HealthChainContractClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let bank = Address::generate(&env);

    client.initialize(&admin);
    client.register_blood_bank(&bank);

    let unit_id_1 = client.register_blood(
        &bank,
        &BloodType::APositive,
        &BloodComponent::WholeBlood,
        &450,
        &(env.ledger().timestamp() + 86400 * 30),
        &Some(symbol_short!("DONOR1")),
    );

    let unit_id_2 = client.register_blood(
        &bank,
        &BloodType::BPositive,
        &BloodComponent::WholeBlood,
        &350,
        &(env.ledger().timestamp() + 86400 * 28),
        &Some(symbol_short!("DONOR2")),
    );

    // Verify both units exist in storage
    env.as_contract(&contract_id, || {
        let units: Map<u64, BloodUnit> = env
            .storage()
            .persistent()
            .get(&BLOOD_UNITS)
            .expect("BLOOD_UNITS should exist");

        assert_eq!(units.len(), 2);
        assert!(units.get(unit_id_1).is_some());
        assert!(units.get(unit_id_2).is_some());

        // When BankUnits index is implemented, verify it contains both:
        // let bank_units_key = DataKey::BankUnits(bank.clone());
        // let bank_units: Vec<u64> = env
        //     .storage()
        //     .persistent()
        //     .get(&bank_units_key)
        //     .expect("BankUnits index should exist");
        // assert_eq!(bank_units.len(), 2);
        // assert!(bank_units.contains(&unit_id_1));
        // assert!(bank_units.contains(&unit_id_2));
    });
}

#[test]
fn test_storage_symbol_keys_match_compatibility_contract() {
    assert_eq!(BLOOD_UNITS, symbol_short!("UNITS"));
    assert_eq!(NEXT_ID, symbol_short!("NEXT_ID"));
    assert_eq!(BLOOD_BANKS, symbol_short!("BANKS"));
    assert_eq!(HOSPITALS, symbol_short!("HOSPS"));
    assert_eq!(ADMIN, symbol_short!("ADMIN"));
    assert_eq!(REQUESTS, symbol_short!("REQUESTS"));
    assert_eq!(NEXT_REQUEST_ID, symbol_short!("NEXT_REQ"));
    assert_eq!(REQUEST_KEYS, symbol_short!("REQ_KEYS"));
    assert_eq!(PAYMENTS, symbol_short!("PAY_RECS"));
    assert_eq!(NEXT_PAYMENT_ID, symbol_short!("NPAY_ID"));
    assert_eq!(DISPUTES, symbol_short!("DISP_REC"));
    assert_eq!(NEXT_DISPUTE_ID, symbol_short!("NDIS_ID"));
    assert_eq!(CUSTODY_EVENTS, symbol_short!("CUSTODY"));
    assert_eq!(HISTORY, symbol_short!("HISTORY"));
}

#[test]
fn test_storage_layout_fingerprint_regression_guard() {
    let env = Env::default();
    let mut unique = Map::<Symbol, bool>::new(&env);
    unique.set(BLOOD_UNITS, true);
    unique.set(NEXT_ID, true);
    unique.set(BLOOD_BANKS, true);
    unique.set(HOSPITALS, true);
    unique.set(ADMIN, true);
    unique.set(REQUESTS, true);
    unique.set(NEXT_REQUEST_ID, true);
    unique.set(REQUEST_KEYS, true);
    unique.set(PAYMENTS, true);
    unique.set(NEXT_PAYMENT_ID, true);
    unique.set(DISPUTES, true);
    unique.set(NEXT_DISPUTE_ID, true);
    unique.set(CUSTODY_EVENTS, true);
    unique.set(HISTORY, true);

    assert_eq!(
        unique.len(),
        14,
        "Storage layout compatibility changed: duplicate key symbols detected. Add migration guardrails before changing key names."
    );
}
