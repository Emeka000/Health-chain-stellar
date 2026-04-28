use crate::storage;
use crate::types::{BloodStatus, BloodType};
use crate::{InventoryContract, InventoryContractClient};
use soroban_sdk::{
    testutils::{Address as _, Ledger},
    vec, Address, Env, String,
};

/// Standard shelf life used by register_blood (35 days in seconds).
const SHELF_LIFE_SECS: u64 = 35 * 86400;

fn create_test_contract<'a>() -> (Env, Address, InventoryContractClient<'a>, Address) {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(InventoryContract, ());
    let client = InventoryContractClient::new(&env, &contract_id);

    let admin = Address::generate(&env);

    client.initialize(&admin);

    (env, admin, client, contract_id)
}

#[test]
fn test_initialize_success() {
    let (env, admin, _client, contract_id) = create_test_contract();

    // Verify admin is set
    let stored_admin = env.as_contract(&contract_id, || storage::get_admin(&env));

    assert_eq!(stored_admin, admin);
}

#[test]
#[should_panic(expected = "Error(Contract, #100)")]
fn test_initialize_already_initialized() {
    let (_env, admin, client, _contract_id) = create_test_contract();

    // Try to initialize again
    client.initialize(&admin);
}

#[test]
fn test_register_blood_success() {
    let (env, admin, client, _contract_id) = create_test_contract();

    let bank = admin.clone(); // Admin is authorized by default
    let blood_type = BloodType::APositive;
    let quantity_ml = 450u32;

    let current_time = 1000u64;
    env.ledger().set_timestamp(current_time);

    let donor = Address::generate(&env);

    let blood_unit_id = client.register_blood(
        &bank,
        &blood_type,
        &quantity_ml,
        &Some(donor.clone()),
    );

    assert_eq!(blood_unit_id, 1);

    // Verify blood unit was stored
    let stored_unit = client.get_blood_unit(&blood_unit_id);
    assert_eq!(stored_unit.id, 1);
    assert_eq!(stored_unit.blood_type, blood_type);
    assert_eq!(stored_unit.quantity_ml, quantity_ml);
    assert_eq!(stored_unit.bank_id, bank);
    assert_eq!(stored_unit.donor_id, Some(donor));
    // Both timestamps must derive from ledger time
    assert_eq!(stored_unit.donation_timestamp, current_time);
    assert_eq!(stored_unit.expiration_timestamp, current_time + SHELF_LIFE_SECS);
    assert_eq!(stored_unit.status, BloodStatus::Available);
}

#[test]
fn test_register_blood_anonymous_donor() {
    let (env, admin, client, _contract_id) = create_test_contract();

    let bank = admin.clone();
    let current_time = 1000u64;
    env.ledger().set_timestamp(current_time);

    let blood_unit_id = client.register_blood(
        &bank,
        &BloodType::ONegative,
        &450u32,
        &None, // Anonymous donor
    );

    let stored_unit = client.get_blood_unit(&blood_unit_id);
    assert_eq!(stored_unit.donor_id, None);
}

#[test]
fn test_register_blood_increments_id() {
    let (env, admin, client, _contract_id) = create_test_contract();

    let bank = admin.clone();
    let current_time = 1000u64;
    env.ledger().set_timestamp(current_time);

    // Register first unit
    let id1 = client.register_blood(&bank, &BloodType::APositive, &450u32, &None);
    assert_eq!(id1, 1);

    // Register second unit
    let id2 = client.register_blood(&bank, &BloodType::BPositive, &450u32, &None);
    assert_eq!(id2, 2);

    // Register third unit
    let id3 = client.register_blood(&bank, &BloodType::ONegative, &450u32, &None);
    assert_eq!(id3, 3);
}

#[test]
#[should_panic(expected = "Error(Contract, #116)")]
fn test_register_blood_quantity_too_low() {
    let (env, admin, client, _contract_id) = create_test_contract();

    let bank = admin.clone();
    let current_time = 1000u64;
    env.ledger().set_timestamp(current_time);

    client.register_blood(
        &bank,
        &BloodType::APositive,
        &50u32, // Too low
        &None,
    );
}

#[test]
#[should_panic(expected = "Error(Contract, #116)")]
fn test_register_blood_quantity_too_high() {
    let (env, admin, client, _contract_id) = create_test_contract();

    let bank = admin.clone();
    let current_time = 1000u64;
    env.ledger().set_timestamp(current_time);

    client.register_blood(
        &bank,
        &BloodType::APositive,
        &700u32, // Too high
        &None,
    );
}

#[test]
#[should_panic(expected = "Error(Contract, #132)")]
fn test_register_blood_unauthorized_bank() {
    let (env, _admin, client, _contract_id) = create_test_contract();

    let unauthorized_bank = Address::generate(&env);
    let current_time = 1000u64;
    env.ledger().set_timestamp(current_time);

    client.register_blood(
        &unauthorized_bank,
        &BloodType::APositive,
        &450u32,
        &None,
    );
}

#[test]
fn test_register_all_blood_types() {
    let (env, admin, client, _contract_id) = create_test_contract();

    let bank = admin.clone();
    let current_time = 1000u64;
    env.ledger().set_timestamp(current_time);

    let blood_types = vec![
        &env,
        BloodType::APositive,
        BloodType::ANegative,
        BloodType::BPositive,
        BloodType::BNegative,
        BloodType::ABPositive,
        BloodType::ABNegative,
        BloodType::OPositive,
        BloodType::ONegative,
    ];

    for (i, blood_type) in blood_types.iter().enumerate() {
        let id = client.register_blood(&bank, &blood_type, &450u32, &None);

        assert_eq!(id, (i + 1) as u64);

        let unit = client.get_blood_unit(&id);
        assert_eq!(unit.blood_type, blood_type);
    }
}

#[test]
#[should_panic(expected = "Error(Contract, #121)")]
fn test_get_blood_unit_not_found() {
    let (_env, _admin, client, _contract_id) = create_test_contract();

    client.get_blood_unit(&999);
}

/// Verify that expiration_timestamp is always computed as ledger time + 35 days,
/// regardless of when register_blood is called.
#[test]
fn test_register_blood_expiry_derived_from_ledger_time() {
    let (env, admin, client, _contract_id) = create_test_contract();

    let bank = admin.clone();

    // Register at ledger time 1000
    let t1 = 1000u64;
    env.ledger().set_timestamp(t1);
    let id1 = client.register_blood(&bank, &BloodType::APositive, &450u32, &None);
    let unit1 = client.get_blood_unit(&id1);
    assert_eq!(unit1.donation_timestamp, t1);
    assert_eq!(unit1.expiration_timestamp, t1 + SHELF_LIFE_SECS);

    // Register at a later ledger time
    let t2 = 500_000u64;
    env.ledger().set_timestamp(t2);
    let id2 = client.register_blood(&bank, &BloodType::BPositive, &450u32, &None);
    let unit2 = client.get_blood_unit(&id2);
    assert_eq!(unit2.donation_timestamp, t2);
    assert_eq!(unit2.expiration_timestamp, t2 + SHELF_LIFE_SECS);
}

/// Simulate the concurrent registration scenario described in issue #97.
///
/// In Soroban's ledger model each transaction within a batch sees committed
/// state from preceding transactions, so the auto-increment counter prevents
/// ID collisions by design. This test verifies the defense-in-depth guard:
/// even if an ID slot is manually pre-populated, `register_blood` will
/// detect the duplicate via `blood_unit_exists` and return DuplicateBloodUnit.
#[test]
fn test_duplicate_registration_prevented() {
    let (env, admin, client, contract_id) = create_test_contract();

    let bank = admin.clone();
    let current_time = 1000u64;
    env.ledger().set_timestamp(current_time);

    // Register first unit — gets ID 1
    let id1 = client.register_blood(&bank, &BloodType::APositive, &450u32, &None);
    assert_eq!(id1, 1);

    // Register second unit — gets ID 2 (no collision)
    let id2 = client.register_blood(&bank, &BloodType::BPositive, &450u32, &None);
    assert_eq!(id2, 2);

    // Both units exist and are distinct
    let unit1 = client.get_blood_unit(&id1);
    let unit2 = client.get_blood_unit(&id2);
    assert_eq!(unit1.blood_type, BloodType::APositive);
    assert_eq!(unit2.blood_type, BloodType::BPositive);

    // Simulate the race condition: manually write a blood unit at the next
    // counter position (ID 3), as if a concurrent transaction already stored
    // a unit there before our counter increment was committed.
    env.as_contract(&contract_id, || {
        use crate::types::{DataKey, BloodUnit, BloodStatus};
        use soroban_sdk::Map;

        let rogue_unit = BloodUnit {
            id: 3,
            blood_type: BloodType::ONegative,
            quantity_ml: 450,
            bank_id: bank.clone(),
            donor_id: None,
            donation_timestamp: current_time,
            expiration_timestamp: current_time + SHELF_LIFE_SECS,
            status: BloodStatus::Available,
            metadata: Map::new(&env),
        };
        env.storage()
            .persistent()
            .set(&DataKey::BloodUnit(3u64), &rogue_unit);
    });

    // Now register_blood will try to claim ID 3 (counter is at 2, next is 3),
    // but the slot is already occupied — must return DuplicateBloodUnit (#24).
    let result = client.try_register_blood(
        &bank,
        &BloodType::ABPositive,
        &450u32,
        &None,
    );
    assert!(result.is_err());
}

#[test]
fn test_sequential_registration_no_id_collision() {
    let (env, admin, client, _contract_id) = create_test_contract();

    let bank = admin.clone();
    let current_time = 1000u64;
    env.ledger().set_timestamp(current_time);

    // Register 10 units rapidly — simulates multiple registrations in the
    // same ledger. Each must get a unique, sequential ID.
    let mut ids = soroban_sdk::Vec::new(&env);
    for _ in 0..10 {
        let id =
            client.register_blood(&bank, &BloodType::APositive, &450u32, &None);
        ids.push_back(id);
    }

    // All IDs must be unique and sequential (1..=10)
    for i in 0..10 {
        let expected_id = (i + 1) as u64;
        assert_eq!(ids.get(i).unwrap(), expected_id);
        let unit = client.get_blood_unit(&expected_id);
        assert_eq!(unit.id, expected_id);
    }
}

#[test]
fn test_register_blood_edge_case_quantities() {
    let (env, admin, client, _contract_id) = create_test_contract();

    let bank = admin.clone();
    let current_time = 1000u64;
    env.ledger().set_timestamp(current_time);

    // Minimum valid quantity
    let id1 = client.register_blood(&bank, &BloodType::APositive, &100u32, &None);
    let unit1 = client.get_blood_unit(&id1);
    assert_eq!(unit1.quantity_ml, 100);

    // Maximum valid quantity
    let id2 = client.register_blood(&bank, &BloodType::BPositive, &600u32, &None);
    let unit2 = client.get_blood_unit(&id2);
    assert_eq!(unit2.quantity_ml, 600);
}

#[test]
fn test_update_status_available_to_reserved() {
    let (env, admin, client, _contract_id) = create_test_contract();

    let bank = admin.clone();
    let current_time = 1000u64;
    env.ledger().set_timestamp(current_time);

    let unit_id = client.register_blood(&bank, &BloodType::APositive, &450u32, &None);

    // Update to Reserved
    let updated_unit = client.update_status(
        &unit_id,
        &BloodStatus::Reserved,
        &admin,
        &Some(String::from_str(&env, "Reserved for Hospital A")),
    );

    assert_eq!(updated_unit.status, BloodStatus::Reserved);

    // Verify it persisted
    let stored = client.get_blood_unit(&unit_id);
    assert_eq!(stored.status, BloodStatus::Reserved);
}

#[test]
fn test_update_status_complete_flow() {
    let (env, admin, client, _contract_id) = create_test_contract();

    let bank = admin.clone();
    let current_time = 1000u64;
    env.ledger().set_timestamp(current_time);

    let unit_id = client.register_blood(&bank, &BloodType::APositive, &450u32, &None);

    // Available -> Reserved
    let unit = client.update_status(
        &unit_id,
        &BloodStatus::Reserved,
        &admin,
        &Some(String::from_str(&env, "Reserved")),
    );
    assert_eq!(unit.status, BloodStatus::Reserved);

    // Reserved -> InTransit
    let unit = client.update_status(
        &unit_id,
        &BloodStatus::InTransit,
        &admin,
        &Some(String::from_str(&env, "In transit")),
    );
    assert_eq!(unit.status, BloodStatus::InTransit);

    // InTransit -> Delivered
    let unit = client.update_status(
        &unit_id,
        &BloodStatus::Delivered,
        &admin,
        &Some(String::from_str(&env, "Delivered to Hospital A")),
    );
    assert_eq!(unit.status, BloodStatus::Delivered);
}

#[test]
#[should_panic(expected = "Error(Contract, #141)")]
fn test_update_status_invalid_available_to_delivered() {
    let (env, admin, client, _contract_id) = create_test_contract();

    let bank = admin.clone();
    let current_time = 1000u64;
    env.ledger().set_timestamp(current_time);

    let unit_id = client.register_blood(&bank, &BloodType::APositive, &450u32, &None);

    // Available -> Delivered (skipping forward — invalid)
    client.update_status(
        &unit_id,
        &BloodStatus::Delivered,
        &admin,
        &Some(String::from_str(&env, "Skip to delivered")),
    );
}

#[test]
#[should_panic(expected = "Error(Contract, #141)")]
fn test_update_status_invalid_available_to_intransit() {
    let (env, admin, client, _contract_id) = create_test_contract();

    let bank = admin.clone();
    let current_time = 1000u64;
    env.ledger().set_timestamp(current_time);

    let unit_id = client.register_blood(&bank, &BloodType::APositive, &450u32, &None);

    // Available -> InTransit (skipping Reserved — invalid)
    client.update_status(&unit_id, &BloodStatus::InTransit, &admin, &None);
}

#[test]
#[should_panic(expected = "Error(Contract, #141)")]
fn test_update_status_invalid_reserved_to_delivered() {
    let (env, admin, client, _contract_id) = create_test_contract();

    let bank = admin.clone();
    let current_time = 1000u64;
    env.ledger().set_timestamp(current_time);

    let unit_id = client.register_blood(&bank, &BloodType::APositive, &450u32, &None);
    client.update_status(&unit_id, &BloodStatus::Reserved, &admin, &None);

    // Reserved -> Delivered (skipping InTransit — invalid)
    client.update_status(&unit_id, &BloodStatus::Delivered, &admin, &None);
}

#[test]
#[should_panic(expected = "Error(Contract, #141)")]
fn test_update_status_invalid_intransit_to_available() {
    let (env, admin, client, _contract_id) = create_test_contract();

    let bank = admin.clone();
    let current_time = 1000u64;
    env.ledger().set_timestamp(current_time);

    let unit_id = client.register_blood(&bank, &BloodType::APositive, &450u32, &None);
    client.update_status(&unit_id, &BloodStatus::Reserved, &admin, &None);
    client.update_status(&unit_id, &BloodStatus::InTransit, &admin, &None);

    // InTransit -> Available (backwards — invalid)
    client.update_status(&unit_id, &BloodStatus::Available, &admin, &None);
}

#[test]
#[should_panic(expected = "Error(Contract, #141)")]
fn test_update_status_invalid_intransit_to_reserved() {
    let (env, admin, client, _contract_id) = create_test_contract();

    let bank = admin.clone();
    let current_time = 1000u64;
    env.ledger().set_timestamp(current_time);

    let unit_id = client.register_blood(&bank, &BloodType::APositive, &450u32, &None);
    client.update_status(&unit_id, &BloodStatus::Reserved, &admin, &None);
    client.update_status(&unit_id, &BloodStatus::InTransit, &admin, &None);

    // InTransit -> Reserved (backwards — invalid)
    client.update_status(&unit_id, &BloodStatus::Reserved, &admin, &None);
}

#[test]
#[should_panic(expected = "Error(Contract, #141)")]
fn test_update_status_invalid_delivered_to_available() {
    let (env, admin, client, _contract_id) = create_test_contract();

    let bank = admin.clone();
    let current_time = 1000u64;
    env.ledger().set_timestamp(current_time);

    let unit_id = client.register_blood(&bank, &BloodType::APositive, &450u32, &None);
    client.update_status(&unit_id, &BloodStatus::Reserved, &admin, &None);
    client.update_status(&unit_id, &BloodStatus::InTransit, &admin, &None);
    client.update_status(&unit_id, &BloodStatus::Delivered, &admin, &None);

    // Delivered -> Available (backwards from terminal — invalid)
    client.update_status(&unit_id, &BloodStatus::Available, &admin, &None);
}

#[test]
#[should_panic(expected = "Error(Contract, #141)")]
fn test_update_status_invalid_delivered_to_reserved() {
    let (env, admin, client, _contract_id) = create_test_contract();

    let bank = admin.clone();
    let current_time = 1000u64;
    env.ledger().set_timestamp(current_time);

    let unit_id = client.register_blood(&bank, &BloodType::APositive, &450u32, &None);
    client.update_status(&unit_id, &BloodStatus::Reserved, &admin, &None);
    client.update_status(&unit_id, &BloodStatus::InTransit, &admin, &None);
    client.update_status(&unit_id, &BloodStatus::Delivered, &admin, &None);

    // Delivered -> Reserved (backwards from terminal — invalid)
    client.update_status(&unit_id, &BloodStatus::Reserved, &admin, &None);
}

#[test]
#[should_panic(expected = "Error(Contract, #141)")]
fn test_update_status_invalid_delivered_to_intransit() {
    let (env, admin, client, _contract_id) = create_test_contract();

    let bank = admin.clone();
    let current_time = 1000u64;
    env.ledger().set_timestamp(current_time);

    let unit_id = client.register_blood(&bank, &BloodType::APositive, &450u32, &None);
    client.update_status(&unit_id, &BloodStatus::Reserved, &admin, &None);
    client.update_status(&unit_id, &BloodStatus::InTransit, &admin, &None);
    client.update_status(&unit_id, &BloodStatus::Delivered, &admin, &None);

    // Delivered -> InTransit (backwards from terminal — invalid)
    client.update_status(&unit_id, &BloodStatus::InTransit, &admin, &None);
}

#[test]
#[should_panic(expected = "Error(Contract, #141)")]
fn test_update_status_invalid_expired_to_available() {
    let (env, admin, client, _contract_id) = create_test_contract();

    let bank = admin.clone();
    let current_time = 1000u64;
    env.ledger().set_timestamp(current_time);

    let unit_id = client.register_blood(&bank, &BloodType::APositive, &450u32, &None);
    client.update_status(&unit_id, &BloodStatus::Expired, &admin, &None);

    // Expired -> Available (backwards from terminal — invalid)
    client.update_status(&unit_id, &BloodStatus::Available, &admin, &None);
}

#[test]
#[should_panic(expected = "Error(Contract, #141)")]
fn test_update_status_invalid_expired_to_reserved() {
    let (env, admin, client, _contract_id) = create_test_contract();

    let bank = admin.clone();
    let current_time = 1000u64;
    env.ledger().set_timestamp(current_time);

    let unit_id = client.register_blood(&bank, &BloodType::APositive, &450u32, &None);
    client.update_status(&unit_id, &BloodStatus::Expired, &admin, &None);

    // Expired -> Reserved (backwards from terminal — invalid)
    client.update_status(&unit_id, &BloodStatus::Reserved, &admin, &None);
}

#[test]
fn test_update_status_reserved_back_to_available() {
    let (env, admin, client, _contract_id) = create_test_contract();

    let bank = admin.clone();
    let current_time = 1000u64;
    env.ledger().set_timestamp(current_time);

    let unit_id = client.register_blood(&bank, &BloodType::APositive, &450u32, &None);
    client.update_status(&unit_id, &BloodStatus::Reserved, &admin, &None);

    // Reserved -> Available (valid cancellation)
    let unit = client.update_status(&unit_id, &BloodStatus::Available, &admin, &None);
    assert_eq!(unit.status, BloodStatus::Available);
}

#[test]
fn test_update_status_expire_from_any_non_terminal() {
    let (env, admin, client, _contract_id) = create_test_contract();

    let bank = admin.clone();
    let current_time = 1000u64;
    env.ledger().set_timestamp(current_time);

    // Available -> Expired
    let id1 = client.register_blood(&bank, &BloodType::APositive, &450u32, &None);
    let unit1 = client.update_status(&id1, &BloodStatus::Expired, &admin, &None);
    assert_eq!(unit1.status, BloodStatus::Expired);

    // Reserved -> Expired
    let id2 = client.register_blood(&bank, &BloodType::BPositive, &450u32, &None);
    client.update_status(&id2, &BloodStatus::Reserved, &admin, &None);
    let unit2 = client.update_status(&id2, &BloodStatus::Expired, &admin, &None);
    assert_eq!(unit2.status, BloodStatus::Expired);

    // InTransit -> Expired
    let id3 = client.register_blood(&bank, &BloodType::ONegative, &450u32, &None);
    client.update_status(&id3, &BloodStatus::Reserved, &admin, &None);
    client.update_status(&id3, &BloodStatus::InTransit, &admin, &None);
    let unit3 = client.update_status(&id3, &BloodStatus::Expired, &admin, &None);
    assert_eq!(unit3.status, BloodStatus::Expired);
}

#[test]
#[should_panic(expected = "Error(Contract, #102)")]
fn test_update_status_unauthorized() {
    let (env, admin, client, _contract_id) = create_test_contract();

    let bank = admin.clone();
    let current_time = 1000u64;
    env.ledger().set_timestamp(current_time);

    let unit_id = client.register_blood(&bank, &BloodType::APositive, &450u32, &None);

    let unauthorized = Address::generate(&env);

    // Try to update without authorization
    client.update_status(&unit_id, &BloodStatus::Reserved, &unauthorized, &None);
}

#[test]
#[should_panic(expected = "Error(Contract, #121)")]
fn test_update_status_nonexistent_unit() {
    let (_env, admin, client, _contract_id) = create_test_contract();

    // Try to update unit that doesn't exist
    client.update_status(&999, &BloodStatus::Reserved, &admin, &None);
}

#[test]
#[should_panic(expected = "Error(Contract, #123)")]
fn test_update_status_expired_unit() {
    let (env, admin, client, _contract_id) = create_test_contract();

    let bank = admin.clone();
    let current_time = 1000u64;
    env.ledger().set_timestamp(current_time);

    let unit_id = client.register_blood(&bank, &BloodType::APositive, &450u32, &None);

    // Move time past expiration (ledger-computed: current_time + 35 days)
    let expiration = current_time + SHELF_LIFE_SECS;
    env.ledger().set_timestamp(expiration + 100);

    // Try to update expired unit
    client.update_status(&unit_id, &BloodStatus::Reserved, &admin, &None);
}

#[test]
#[should_panic(expected = "Error(Contract, #141)")]
fn test_update_status_from_terminal_delivered() {
    let (env, admin, client, _contract_id) = create_test_contract();

    let bank = admin.clone();
    let current_time = 1000u64;
    env.ledger().set_timestamp(current_time);

    let unit_id = client.register_blood(&bank, &BloodType::APositive, &450u32, &None);

    // Move to Delivered
    client.update_status(&unit_id, &BloodStatus::Reserved, &admin, &None);
    client.update_status(&unit_id, &BloodStatus::InTransit, &admin, &None);
    client.update_status(&unit_id, &BloodStatus::Delivered, &admin, &None);

    // Try to update from terminal state
    client.update_status(&unit_id, &BloodStatus::Expired, &admin, &None);
}

// ==================== Mark Delivered Tests ====================

#[test]
fn test_mark_delivered_success() {
    let (env, admin, client, _contract_id) = create_test_contract();

    let bank = admin.clone();
    let current_time = 1000u64;
    env.ledger().set_timestamp(current_time);

    let unit_id = client.register_blood(&bank, &BloodType::APositive, &450u32, &None);

    // Set to Reserved first (should be InTransit in real scenario, but for test)
    client.update_status(&unit_id, &BloodStatus::Reserved, &admin, &None);
    client.update_status(&unit_id, &BloodStatus::InTransit, &admin, &None);

    // Mark as delivered
    let updated = client.mark_delivered(&unit_id, &admin, &String::from_str(&env, "Hospital A"));

    assert_eq!(updated.status, BloodStatus::Delivered);
}

#[test]
#[should_panic(expected = "Error(Contract, #141)")]
fn test_mark_delivered_from_available() {
    let (env, admin, client, _contract_id) = create_test_contract();

    let bank = admin.clone();
    let current_time = 1000u64;
    env.ledger().set_timestamp(current_time);

    let unit_id = client.register_blood(&bank, &BloodType::APositive, &450u32, &None);

    // Try to mark as delivered when still Available (invalid transition)
    client.mark_delivered(&unit_id, &admin, &String::from_str(&env, "Hospital A"));
}

// ==================== Mark Expired Tests ====================

#[test]
fn test_mark_expired_success() {
    let (env, admin, client, _contract_id) = create_test_contract();

    let bank = admin.clone();
    let current_time = 1000u64;
    env.ledger().set_timestamp(current_time);

    let unit_id = client.register_blood(&bank, &BloodType::APositive, &450u32, &None);

    // Mark as expired from Available state (valid transition)
    let updated = client.mark_expired(&unit_id, &admin);

    assert_eq!(updated.status, BloodStatus::Expired);
}

#[test]
fn test_mark_expired_from_reserved() {
    let (env, admin, client, _contract_id) = create_test_contract();

    let bank = admin.clone();
    let current_time = 1000u64;
    env.ledger().set_timestamp(current_time);

    let unit_id = client.register_blood(&bank, &BloodType::APositive, &450u32, &None);

    // Move to Reserved
    client.update_status(&unit_id, &BloodStatus::Reserved, &admin, &None);

    // Mark as expired
    let updated = client.mark_expired(&unit_id, &admin);

    assert_eq!(updated.status, BloodStatus::Expired);
}

// ==================== Status History Tests ====================

#[test]
fn test_status_history_tracking() {
    let (env, admin, client, _contract_id) = create_test_contract();

    let bank = admin.clone();
    let current_time = 1000u64;
    env.ledger().set_timestamp(current_time);

    let unit_id = client.register_blood(&bank, &BloodType::APositive, &450u32, &None);

    // Perform status changes
    client.update_status(
        &unit_id,
        &BloodStatus::Reserved,
        &admin,
        &Some(String::from_str(&env, "Reserved")),
    );
    env.ledger().set_timestamp(current_time + 100);
    client.update_status(
        &unit_id,
        &BloodStatus::InTransit,
        &admin,
        &Some(String::from_str(&env, "In transit")),
    );
    env.ledger().set_timestamp(current_time + 200);
    client.update_status(
        &unit_id,
        &BloodStatus::Delivered,
        &admin,
        &Some(String::from_str(&env, "Delivered")),
    );

    // Get history
    let history = client.get_status_history(&unit_id);

    // Should have 3 history entries
    assert_eq!(history.len(), 3);

    // Check first transition: Available -> Reserved
    let h0 = history.get(0).unwrap();
    assert_eq!(h0.from_status, BloodStatus::Available);
    assert_eq!(h0.to_status, BloodStatus::Reserved);
    assert_eq!(h0.authorized_by, admin);

    // Check second transition: Reserved -> InTransit
    let h1 = history.get(1).unwrap();
    assert_eq!(h1.from_status, BloodStatus::Reserved);
    assert_eq!(h1.to_status, BloodStatus::InTransit);

    // Check third transition: InTransit -> Delivered
    let h2 = history.get(2).unwrap();
    assert_eq!(h2.from_status, BloodStatus::InTransit);
    assert_eq!(h2.to_status, BloodStatus::Delivered);
}

#[test]
fn test_status_change_count() {
    let (env, admin, client, _contract_id) = create_test_contract();

    let bank = admin.clone();
    let current_time = 1000u64;
    env.ledger().set_timestamp(current_time);

    let unit_id = client.register_blood(&bank, &BloodType::APositive, &450u32, &None);

    // Initial count should be 0 (no changes yet)
    assert_eq!(client.get_status_change_count(&unit_id), 0);

    // Make changes
    client.update_status(&unit_id, &BloodStatus::Reserved, &admin, &None);
    assert_eq!(client.get_status_change_count(&unit_id), 1);

    client.update_status(&unit_id, &BloodStatus::InTransit, &admin, &None);
    assert_eq!(client.get_status_change_count(&unit_id), 2);

    client.update_status(&unit_id, &BloodStatus::Delivered, &admin, &None);
    assert_eq!(client.get_status_change_count(&unit_id), 3);
}

// ==================== Batch Update Tests ====================

#[test]
fn test_batch_update_status_success() {
    let (env, admin, client, _contract_id) = create_test_contract();

    let bank = admin.clone();
    let current_time = 1000u64;
    env.ledger().set_timestamp(current_time);

    // Create multiple blood units
    let id1 = client.register_blood(&bank, &BloodType::APositive, &450u32, &None);
    let id2 = client.register_blood(&bank, &BloodType::BPositive, &450u32, &None);
    let id3 = client.register_blood(&bank, &BloodType::ONegative, &450u32, &None);

    // Batch update to Reserved
    let unit_ids = vec![&env, id1, id2, id3];
    let count = client.batch_update_status(
        &unit_ids,
        &BloodStatus::Reserved,
        &admin,
        &Some(String::from_str(&env, "Batch reserved")),
    );

    assert_eq!(count, 3);

    // Verify all units were updated
    assert_eq!(client.get_blood_unit(&id1).status, BloodStatus::Reserved);
    assert_eq!(client.get_blood_unit(&id2).status, BloodStatus::Reserved);
    assert_eq!(client.get_blood_unit(&id3).status, BloodStatus::Reserved);
}

#[test]
fn test_batch_update_status_single_unit() {
    let (env, admin, client, _contract_id) = create_test_contract();

    let bank = admin.clone();
    let current_time = 1000u64;
    env.ledger().set_timestamp(current_time);

    let unit_id = client.register_blood(&bank, &BloodType::APositive, &450u32, &None);

    let unit_ids = vec![&env, unit_id];
    let count = client.batch_update_status(&unit_ids, &BloodStatus::Reserved, &admin, &None);

    assert_eq!(count, 1);
    assert_eq!(
        client.get_blood_unit(&unit_id).status,
        BloodStatus::Reserved
    );
}

#[test]
fn test_batch_update_status_empty_list() {
    let (env, admin, client, _contract_id) = create_test_contract();

    let empty_list = vec![&env];
    let count = client.batch_update_status(&empty_list, &BloodStatus::Reserved, &admin, &None);

    assert_eq!(count, 0);
}

#[test]
#[should_panic(expected = "Error(Contract, #121)")]
fn test_batch_update_status_nonexistent_unit() {
    let (env, admin, client, _contract_id) = create_test_contract();

    let bank = admin.clone();
    let current_time = 1000u64;
    env.ledger().set_timestamp(current_time);

    let unit_id = client.register_blood(&bank, &BloodType::APositive, &450u32, &None);

    // Try batch update with one nonexistent unit
    let unit_ids = vec![&env, unit_id, 999];
    client.batch_update_status(&unit_ids, &BloodStatus::Reserved, &admin, &None);
}

#[test]
#[should_panic(expected = "Error(Contract, #102)")]
fn test_batch_update_status_unauthorized() {
    let (env, admin, client, _contract_id) = create_test_contract();

    let bank = admin.clone();
    let current_time = 1000u64;
    env.ledger().set_timestamp(current_time);

    let unit_id = client.register_blood(&bank, &BloodType::APositive, &450u32, &None);

    let unauthorized = Address::generate(&env);

    let unit_ids = vec![&env, unit_id];
    client.batch_update_status(&unit_ids, &BloodStatus::Reserved, &unauthorized, &None);
}

#[test]
#[should_panic(expected = "Error(Contract, #141)")]
fn test_batch_update_status_invalid_transition() {
    let (env, admin, client, _contract_id) = create_test_contract();

    let bank = admin.clone();
    let current_time = 1000u64;
    env.ledger().set_timestamp(current_time);

    let id1 = client.register_blood(&bank, &BloodType::APositive, &450u32, &None);
    let id2 = client.register_blood(&bank, &BloodType::BPositive, &450u32, &None);

    // Move id1 to Reserved
    client.update_status(&id1, &BloodStatus::Reserved, &admin, &None);

    // Try batch update to an invalid transition for id1
    let unit_ids = vec![&env, id1, id2];
    client.batch_update_status(
        &unit_ids,
        &BloodStatus::Delivered, // Invalid from Available and Reserved
        &admin,
        &None,
    );
}

// ==================== Dispose Tests ====================

#[test]
fn test_dispose_from_expired_success() {
    let (env, admin, client, _contract_id) = create_test_contract();

    let bank = admin.clone();
    let current_time = 1000u64;
    env.ledger().set_timestamp(current_time);

    let unit_id = client.register_blood(&bank, &BloodType::APositive, &450u32, &None);

    // Expire the unit first
    client.mark_expired(&unit_id, &admin);

    // Now dispose it
    let disposed = client.dispose(
        &unit_id,
        &admin,
        &Some(String::from_str(&env, "Disposed after expiry")),
    );

    assert_eq!(disposed.status, BloodStatus::Disposed);

    // Verify persisted status
    let stored = client.get_blood_unit(&unit_id);
    assert_eq!(stored.status, BloodStatus::Disposed);
}

#[test]
fn test_dispose_records_history() {
    let (env, admin, client, _contract_id) = create_test_contract();

    let bank = admin.clone();
    let current_time = 1000u64;
    env.ledger().set_timestamp(current_time);

    let unit_id = client.register_blood(&bank, &BloodType::BPositive, &450u32, &None);

    client.mark_expired(&unit_id, &admin);
    client.dispose(&unit_id, &admin, &None);

    let history = client.get_status_history(&unit_id);
    // Should have 2 entries: Available->Expired, Expired->Disposed
    assert_eq!(history.len(), 2);

    let h0 = history.get(0).unwrap();
    assert_eq!(h0.from_status, BloodStatus::Available);
    assert_eq!(h0.to_status, BloodStatus::Expired);

    let h1 = history.get(1).unwrap();
    assert_eq!(h1.from_status, BloodStatus::Expired);
    assert_eq!(h1.to_status, BloodStatus::Disposed);
}

#[test]
#[should_panic(expected = "Error(Contract, #141)")]
fn test_dispose_from_available_invalid() {
    let (env, admin, client, _contract_id) = create_test_contract();

    let bank = admin.clone();
    env.ledger().set_timestamp(1000u64);

    let unit_id = client.register_blood(&bank, &BloodType::APositive, &450u32, &None);

    // Cannot dispose an Available unit directly (must expire first)
    client.dispose(&unit_id, &admin, &None);
}

#[test]
#[should_panic(expected = "Error(Contract, #141)")]
fn test_dispose_from_reserved_invalid() {
    let (env, admin, client, _contract_id) = create_test_contract();

    let bank = admin.clone();
    env.ledger().set_timestamp(1000u64);

    let unit_id = client.register_blood(&bank, &BloodType::APositive, &450u32, &None);
    client.update_status(&unit_id, &BloodStatus::Reserved, &admin, &None);

    // Cannot dispose a Reserved unit directly
    client.dispose(&unit_id, &admin, &None);
}

#[test]
#[should_panic(expected = "Error(Contract, #141)")]
fn test_transition_from_disposed_is_invalid() {
    let (env, admin, client, _contract_id) = create_test_contract();

    let bank = admin.clone();
    env.ledger().set_timestamp(1000u64);

    let unit_id = client.register_blood(&bank, &BloodType::APositive, &450u32, &None);
    client.mark_expired(&unit_id, &admin);
    client.dispose(&unit_id, &admin, &None);

    // Disposed is terminal — no further transitions allowed
    client.update_status(&unit_id, &BloodStatus::Available, &admin, &None);
}

#[test]
fn test_dispose_is_terminal_state_in_type() {
    assert!(BloodStatus::Disposed.is_terminal());
    // Expired is no longer terminal — units can still move to Disposed
    assert!(!BloodStatus::Expired.is_terminal());
}

#[test]
fn test_batch_dispose_after_expiry() {
    let (env, admin, client, _contract_id) = create_test_contract();

    let bank = admin.clone();
    env.ledger().set_timestamp(1000u64);

    let id1 = client.register_blood(&bank, &BloodType::APositive, &450u32, &None);
    let id2 = client.register_blood(&bank, &BloodType::BPositive, &450u32, &None);

    client.mark_expired(&id1, &admin);
    client.mark_expired(&id2, &admin);

    // Batch dispose both expired units
    let unit_ids = vec![&env, id1, id2];
    let count = client.batch_update_status(
        &unit_ids,
        &BloodStatus::Disposed,
        &admin,
        &Some(String::from_str(&env, "Monthly disposal run")),
    );

    assert_eq!(count, 2);
    assert_eq!(client.get_blood_unit(&id1).status, BloodStatus::Disposed);
    assert_eq!(client.get_blood_unit(&id2).status, BloodStatus::Disposed);
}

// =============================================================================
// 100% branch-coverage tests for is_valid_transition and update_status
// Naming convention: test_transition_{from}_{to}_{succeeds|fails}
// =============================================================================

// ── Valid transitions (one test per pair) ─────────────────────────────────────

#[test]
fn test_transition_available_to_reserved_succeeds() {
    let (env, admin, client, _) = create_test_contract();
    env.ledger().set_timestamp(1000u64);
    let id = client.register_blood(&admin, &BloodType::APositive, &450u32, &None);
    let unit = client.update_status(&id, &BloodStatus::Reserved, &admin, &None);
    assert_eq!(unit.status, BloodStatus::Reserved);
}

#[test]
fn test_transition_available_to_expired_succeeds() {
    let (env, admin, client, _) = create_test_contract();
    env.ledger().set_timestamp(1000u64);
    let id = client.register_blood(&admin, &BloodType::APositive, &450u32, &None);
    let unit = client.update_status(&id, &BloodStatus::Expired, &admin, &None);
    assert_eq!(unit.status, BloodStatus::Expired);
}

#[test]
fn test_transition_reserved_to_intransit_succeeds() {
    let (env, admin, client, _) = create_test_contract();
    env.ledger().set_timestamp(1000u64);
    let id = client.register_blood(&admin, &BloodType::APositive, &450u32, &None);
    client.update_status(&id, &BloodStatus::Reserved, &admin, &None);
    let unit = client.update_status(&id, &BloodStatus::InTransit, &admin, &None);
    assert_eq!(unit.status, BloodStatus::InTransit);
}

#[test]
fn test_transition_reserved_to_available_succeeds() {
    let (env, admin, client, _) = create_test_contract();
    env.ledger().set_timestamp(1000u64);
    let id = client.register_blood(&admin, &BloodType::APositive, &450u32, &None);
    client.update_status(&id, &BloodStatus::Reserved, &admin, &None);
    let unit = client.update_status(&id, &BloodStatus::Available, &admin, &None);
    assert_eq!(unit.status, BloodStatus::Available);
}

#[test]
fn test_transition_reserved_to_expired_succeeds() {
    let (env, admin, client, _) = create_test_contract();
    env.ledger().set_timestamp(1000u64);
    let id = client.register_blood(&admin, &BloodType::APositive, &450u32, &None);
    client.update_status(&id, &BloodStatus::Reserved, &admin, &None);
    let unit = client.update_status(&id, &BloodStatus::Expired, &admin, &None);
    assert_eq!(unit.status, BloodStatus::Expired);
}

#[test]
fn test_transition_intransit_to_delivered_succeeds() {
    let (env, admin, client, _) = create_test_contract();
    env.ledger().set_timestamp(1000u64);
    let id = client.register_blood(&admin, &BloodType::APositive, &450u32, &None);
    client.update_status(&id, &BloodStatus::Reserved, &admin, &None);
    client.update_status(&id, &BloodStatus::InTransit, &admin, &None);
    let unit = client.update_status(&id, &BloodStatus::Delivered, &admin, &None);
    assert_eq!(unit.status, BloodStatus::Delivered);
}

#[test]
fn test_transition_intransit_to_expired_succeeds() {
    let (env, admin, client, _) = create_test_contract();
    env.ledger().set_timestamp(1000u64);
    let id = client.register_blood(&admin, &BloodType::APositive, &450u32, &None);
    client.update_status(&id, &BloodStatus::Reserved, &admin, &None);
    client.update_status(&id, &BloodStatus::InTransit, &admin, &None);
    let unit = client.update_status(&id, &BloodStatus::Expired, &admin, &None);
    assert_eq!(unit.status, BloodStatus::Expired);
}

#[test]
fn test_transition_expired_to_disposed_succeeds() {
    let (env, admin, client, _) = create_test_contract();
    env.ledger().set_timestamp(1000u64);
    let id = client.register_blood(&admin, &BloodType::APositive, &450u32, &None);
    client.update_status(&id, &BloodStatus::Expired, &admin, &None);
    let unit = client.update_status(&id, &BloodStatus::Disposed, &admin, &None);
    assert_eq!(unit.status, BloodStatus::Disposed);
}

#[test]
fn test_transition_compromised_to_disposed_succeeds() {
    let (env, admin, client, contract_id) = create_test_contract();
    env.ledger().set_timestamp(1000u64);
    let id = client.register_blood(&admin, &BloodType::APositive, &450u32, &None);

    // Seed Compromised status directly — Available→Compromised is not a defined
    // transition, so we write it via storage to test the Compromised→Disposed path.
    env.as_contract(&contract_id, || {
        use crate::storage;
        let mut unit = storage::get_blood_unit(&env, id).unwrap();
        unit.status = BloodStatus::Compromised;
        storage::set_blood_unit(&env, &unit);
    });

    let unit = client.update_status(&id, &BloodStatus::Disposed, &admin, &None);
    assert_eq!(unit.status, BloodStatus::Disposed);
}

// ── Invalid high-risk transitions ─────────────────────────────────────────────

#[test]
#[should_panic(expected = "Error(Contract, #141)")]
fn test_transition_delivered_to_collected_fails() {
    // "Collected" maps to Available in this contract's terminology.
    let (env, admin, client, _) = create_test_contract();
    env.ledger().set_timestamp(1000u64);
    let id = client.register_blood(&admin, &BloodType::APositive, &450u32, &None);
    client.update_status(&id, &BloodStatus::Reserved, &admin, &None);
    client.update_status(&id, &BloodStatus::InTransit, &admin, &None);
    client.update_status(&id, &BloodStatus::Delivered, &admin, &None);
    // Delivered → Available (backwards from terminal)
    client.update_status(&id, &BloodStatus::Available, &admin, &None);
}

#[test]
#[should_panic(expected = "Error(Contract, #141)")]
fn test_transition_disposed_to_cleared_fails() {
    // "Cleared" maps to Available in this contract's terminology.
    let (env, admin, client, _) = create_test_contract();
    env.ledger().set_timestamp(1000u64);
    let id = client.register_blood(&admin, &BloodType::APositive, &450u32, &None);
    client.update_status(&id, &BloodStatus::Expired, &admin, &None);
    client.update_status(&id, &BloodStatus::Disposed, &admin, &None);
    // Disposed → Available (backwards from terminal)
    client.update_status(&id, &BloodStatus::Available, &admin, &None);
}

#[test]
#[should_panic(expected = "Error(Contract, #141)")]
fn test_transition_transfused_to_dispatched_fails() {
    // "Transfused" maps to Delivered; "Dispatched" maps to InTransit.
    let (env, admin, client, _) = create_test_contract();
    env.ledger().set_timestamp(1000u64);
    let id = client.register_blood(&admin, &BloodType::APositive, &450u32, &None);
    client.update_status(&id, &BloodStatus::Reserved, &admin, &None);
    client.update_status(&id, &BloodStatus::InTransit, &admin, &None);
    client.update_status(&id, &BloodStatus::Delivered, &admin, &None);
    // Delivered → InTransit (backwards from terminal)
    client.update_status(&id, &BloodStatus::InTransit, &admin, &None);
}

#[test]
#[should_panic(expected = "Error(Contract, #141)")]
fn test_transition_delivered_to_reserved_fails() {
    let (env, admin, client, _) = create_test_contract();
    env.ledger().set_timestamp(1000u64);
    let id = client.register_blood(&admin, &BloodType::APositive, &450u32, &None);
    client.update_status(&id, &BloodStatus::Reserved, &admin, &None);
    client.update_status(&id, &BloodStatus::InTransit, &admin, &None);
    client.update_status(&id, &BloodStatus::Delivered, &admin, &None);
    client.update_status(&id, &BloodStatus::Reserved, &admin, &None);
}

#[test]
#[should_panic(expected = "Error(Contract, #141)")]
fn test_transition_intransit_to_available_fails() {
    let (env, admin, client, _) = create_test_contract();
    env.ledger().set_timestamp(1000u64);
    let id = client.register_blood(&admin, &BloodType::APositive, &450u32, &None);
    client.update_status(&id, &BloodStatus::Reserved, &admin, &None);
    client.update_status(&id, &BloodStatus::InTransit, &admin, &None);
    client.update_status(&id, &BloodStatus::Available, &admin, &None);
}

#[test]
#[should_panic(expected = "Error(Contract, #141)")]
fn test_transition_available_to_delivered_fails() {
    let (env, admin, client, _) = create_test_contract();
    env.ledger().set_timestamp(1000u64);
    let id = client.register_blood(&admin, &BloodType::APositive, &450u32, &None);
    client.update_status(&id, &BloodStatus::Delivered, &admin, &None);
}

#[test]
#[should_panic(expected = "Error(Contract, #141)")]
fn test_transition_available_to_intransit_fails() {
    let (env, admin, client, _) = create_test_contract();
    env.ledger().set_timestamp(1000u64);
    let id = client.register_blood(&admin, &BloodType::APositive, &450u32, &None);
    client.update_status(&id, &BloodStatus::InTransit, &admin, &None);
}

#[test]
#[should_panic(expected = "Error(Contract, #141)")]
fn test_transition_reserved_to_delivered_fails() {
    let (env, admin, client, _) = create_test_contract();
    env.ledger().set_timestamp(1000u64);
    let id = client.register_blood(&admin, &BloodType::APositive, &450u32, &None);
    client.update_status(&id, &BloodStatus::Reserved, &admin, &None);
    client.update_status(&id, &BloodStatus::Delivered, &admin, &None);
}

// ── Boundary conditions: Expired → every other status ─────────────────────────

#[test]
#[should_panic(expected = "Error(Contract, #141)")]
fn test_transition_expired_to_available_fails() {
    let (env, admin, client, _) = create_test_contract();
    env.ledger().set_timestamp(1000u64);
    let id = client.register_blood(&admin, &BloodType::APositive, &450u32, &None);
    client.update_status(&id, &BloodStatus::Expired, &admin, &None);
    client.update_status(&id, &BloodStatus::Available, &admin, &None);
}

#[test]
#[should_panic(expected = "Error(Contract, #141)")]
fn test_transition_expired_to_reserved_fails() {
    let (env, admin, client, _) = create_test_contract();
    env.ledger().set_timestamp(1000u64);
    let id = client.register_blood(&admin, &BloodType::APositive, &450u32, &None);
    client.update_status(&id, &BloodStatus::Expired, &admin, &None);
    client.update_status(&id, &BloodStatus::Reserved, &admin, &None);
}

#[test]
#[should_panic(expected = "Error(Contract, #141)")]
fn test_transition_expired_to_intransit_fails() {
    let (env, admin, client, _) = create_test_contract();
    env.ledger().set_timestamp(1000u64);
    let id = client.register_blood(&admin, &BloodType::APositive, &450u32, &None);
    client.update_status(&id, &BloodStatus::Expired, &admin, &None);
    client.update_status(&id, &BloodStatus::InTransit, &admin, &None);
}

#[test]
#[should_panic(expected = "Error(Contract, #141)")]
fn test_transition_expired_to_delivered_fails() {
    let (env, admin, client, _) = create_test_contract();
    env.ledger().set_timestamp(1000u64);
    let id = client.register_blood(&admin, &BloodType::APositive, &450u32, &None);
    client.update_status(&id, &BloodStatus::Expired, &admin, &None);
    client.update_status(&id, &BloodStatus::Delivered, &admin, &None);
}

#[test]
#[should_panic(expected = "Error(Contract, #141)")]
fn test_transition_expired_to_compromised_fails() {
    let (env, admin, client, _) = create_test_contract();
    env.ledger().set_timestamp(1000u64);
    let id = client.register_blood(&admin, &BloodType::APositive, &450u32, &None);
    client.update_status(&id, &BloodStatus::Expired, &admin, &None);
    client.update_status(&id, &BloodStatus::Compromised, &admin, &None);
}

// ── Boundary conditions: Disposed → every other status ────────────────────────

#[test]
#[should_panic(expected = "Error(Contract, #141)")]
fn test_transition_disposed_to_available_fails() {
    let (env, admin, client, _) = create_test_contract();
    env.ledger().set_timestamp(1000u64);
    let id = client.register_blood(&admin, &BloodType::APositive, &450u32, &None);
    client.update_status(&id, &BloodStatus::Expired, &admin, &None);
    client.update_status(&id, &BloodStatus::Disposed, &admin, &None);
    client.update_status(&id, &BloodStatus::Available, &admin, &None);
}

#[test]
#[should_panic(expected = "Error(Contract, #141)")]
fn test_transition_disposed_to_reserved_fails() {
    let (env, admin, client, _) = create_test_contract();
    env.ledger().set_timestamp(1000u64);
    let id = client.register_blood(&admin, &BloodType::APositive, &450u32, &None);
    client.update_status(&id, &BloodStatus::Expired, &admin, &None);
    client.update_status(&id, &BloodStatus::Disposed, &admin, &None);
    client.update_status(&id, &BloodStatus::Reserved, &admin, &None);
}

#[test]
#[should_panic(expected = "Error(Contract, #141)")]
fn test_transition_disposed_to_intransit_fails() {
    let (env, admin, client, _) = create_test_contract();
    env.ledger().set_timestamp(1000u64);
    let id = client.register_blood(&admin, &BloodType::APositive, &450u32, &None);
    client.update_status(&id, &BloodStatus::Expired, &admin, &None);
    client.update_status(&id, &BloodStatus::Disposed, &admin, &None);
    client.update_status(&id, &BloodStatus::InTransit, &admin, &None);
}

#[test]
#[should_panic(expected = "Error(Contract, #141)")]
fn test_transition_disposed_to_delivered_fails() {
    let (env, admin, client, _) = create_test_contract();
    env.ledger().set_timestamp(1000u64);
    let id = client.register_blood(&admin, &BloodType::APositive, &450u32, &None);
    client.update_status(&id, &BloodStatus::Expired, &admin, &None);
    client.update_status(&id, &BloodStatus::Disposed, &admin, &None);
    client.update_status(&id, &BloodStatus::Delivered, &admin, &None);
}

#[test]
#[should_panic(expected = "Error(Contract, #141)")]
fn test_transition_disposed_to_expired_fails() {
    let (env, admin, client, _) = create_test_contract();
    env.ledger().set_timestamp(1000u64);
    let id = client.register_blood(&admin, &BloodType::APositive, &450u32, &None);
    client.update_status(&id, &BloodStatus::Expired, &admin, &None);
    client.update_status(&id, &BloodStatus::Disposed, &admin, &None);
    client.update_status(&id, &BloodStatus::Expired, &admin, &None);
}

#[test]
#[should_panic(expected = "Error(Contract, #141)")]
fn test_transition_disposed_to_compromised_fails() {
    let (env, admin, client, _) = create_test_contract();
    env.ledger().set_timestamp(1000u64);
    let id = client.register_blood(&admin, &BloodType::APositive, &450u32, &None);
    client.update_status(&id, &BloodStatus::Expired, &admin, &None);
    client.update_status(&id, &BloodStatus::Disposed, &admin, &None);
    client.update_status(&id, &BloodStatus::Compromised, &admin, &None);
}

// ── Pure is_valid_transition unit tests (no storage, exhaustive) ──────────────

#[test]
fn test_transition_pure_all_valid_pairs_succeeds() {
    use crate::types::is_valid_transition;
    use BloodStatus::*;

    let valid = [
        (Available, Reserved),
        (Available, Expired),
        (Available, Compromised),
        (Reserved, InTransit),
        (Reserved, Available),
        (Reserved, Expired),
        (Reserved, Compromised),
        (InTransit, Delivered),
        (InTransit, Expired),
        (InTransit, Compromised),
        (Expired, Disposed),
        (Compromised, Disposed),
    ];

    for (from, to) in valid.iter() {
        assert!(
            is_valid_transition(from, to),
            "Expected valid: {:?} -> {:?}",
            from,
            to
        );
    }
}

#[test]
fn test_transition_pure_all_invalid_pairs_fails() {
    use crate::types::is_valid_transition;
    use BloodStatus::*;

    let all_statuses = [
        Available, Reserved, InTransit, Delivered, Expired, Compromised, Disposed,
    ];

    let valid_set = [
        (Available, Reserved),
        (Available, Expired),
        (Available, Compromised),
        (Reserved, InTransit),
        (Reserved, Available),
        (Reserved, Expired),
        (Reserved, Compromised),
        (InTransit, Delivered),
        (InTransit, Expired),
        (InTransit, Compromised),
        (Expired, Disposed),
        (Compromised, Disposed),
    ];

    for from in all_statuses.iter() {
        for to in all_statuses.iter() {
            let pair = (*from, *to);
            let expected_valid = valid_set.contains(&pair);
            assert_eq!(
                is_valid_transition(from, to),
                expected_valid,
                "Mismatch for {:?} -> {:?}: expected valid={}, got {}",
                from,
                to,
                expected_valid,
                is_valid_transition(from, to)
            );
        }
    }
}


// ── Circuit breaker tests ─────────────────────────────────────────────────────

#[test]
fn test_pause_blocks_write_functions() {
    let (env, admin, client, _) = create_test_contract();
    env.ledger().set_timestamp(1000);

    // Pause the contract
    client.pause(&admin);
    assert!(client.is_paused());

    // register_blood should fail with ContractPaused (#160)
    let result = client.try_register_blood(&admin, &BloodType::OPositive, &450u32, &None);
    assert!(result.is_err());
}

#[test]
fn test_pause_allows_read_functions() {
    let (env, admin, client, _) = create_test_contract();
    env.ledger().set_timestamp(1000);

    // Register a unit before pausing
    let unit_id = client.register_blood(&admin, &BloodType::OPositive, &450u32, &None);

    // Pause
    client.pause(&admin);

    // Read functions still work
    let unit = client.get_blood_unit(&unit_id);
    assert_eq!(unit.id, unit_id);
    assert!(!client.get_status_history(&unit_id).is_empty() || client.get_status_change_count(&unit_id) == 0);
}

#[test]
fn test_unpause_restores_functionality() {
    let (env, admin, client, _) = create_test_contract();
    env.ledger().set_timestamp(1000);

    client.pause(&admin);
    assert!(client.is_paused());

    client.unpause(&admin);
    assert!(!client.is_paused());

    // Write should succeed after unpause
    let unit_id = client.register_blood(&admin, &BloodType::APositive, &300u32, &None);
    assert!(unit_id > 0);
}

#[test]
#[should_panic(expected = "Error(Contract, #102)")]
fn test_non_admin_cannot_pause() {
    let (env, _admin, client, _) = create_test_contract();
    let attacker = Address::generate(&env);
    client.pause(&attacker);
}

// ── Paginated history tests ───────────────────────────────────────────────────

/// Verify that get_status_history_page returns only the entries for the
/// requested page and that get_history_page_count reflects the correct
/// last page number after many transitions.
#[test]
fn test_paginated_history_single_page() {
    let (env, admin, client, _) = create_test_contract();
    env.ledger().set_timestamp(1000u64);

    let id = client.register_blood(&admin, &BloodType::APositive, &450u32, &None);

    // 3 transitions — all fit on page 0 (page size = 50)
    client.update_status(&id, &BloodStatus::Reserved, &admin, &None);
    client.update_status(&id, &BloodStatus::InTransit, &admin, &None);
    client.update_status(&id, &BloodStatus::Delivered, &admin, &None);

    // Page 0 should have all 3 entries
    let page0 = client.get_status_history_page(&id, &0u32);
    assert_eq!(page0.len(), 3);

    // Page count should still be 0 (only one page used)
    assert_eq!(client.get_history_page_count(&id), 0);
}

/// Verify that full history via get_status_history matches the sum of all pages.
#[test]
fn test_paginated_history_full_matches_pages() {
    let (env, admin, client, _) = create_test_contract();
    env.ledger().set_timestamp(1000u64);

    let id = client.register_blood(&admin, &BloodType::APositive, &450u32, &None);

    // 5 transitions
    client.update_status(&id, &BloodStatus::Reserved, &admin, &None);
    client.update_status(&id, &BloodStatus::Available, &admin, &None);
    client.update_status(&id, &BloodStatus::Reserved, &admin, &None);
    client.update_status(&id, &BloodStatus::InTransit, &admin, &None);
    client.update_status(&id, &BloodStatus::Delivered, &admin, &None);

    let full = client.get_status_history(&id);
    assert_eq!(full.len(), 5);

    // All entries should be on page 0
    let page0 = client.get_status_history_page(&id, &0u32);
    assert_eq!(page0.len(), 5);
}

// ── batch_register_blood tests ────────────────────────────────────────────────

#[test]
fn test_batch_register_blood_success() {
    let (env, admin, client, _) = create_test_contract();
    env.ledger().set_timestamp(1000u64);

    let entries = vec![
        &env,
        (BloodType::APositive, 450u32, None::<Address>),
        (BloodType::BNegative, 300u32, None::<Address>),
        (BloodType::ONegative, 500u32, None::<Address>),
    ];

    let ids = client.batch_register_blood(&admin, &entries);

    assert_eq!(ids.len(), 3);
    assert_eq!(ids.get(0).unwrap(), 1u64);
    assert_eq!(ids.get(1).unwrap(), 2u64);
    assert_eq!(ids.get(2).unwrap(), 3u64);

    // Verify each unit was stored correctly
    let u1 = client.get_blood_unit(&1u64);
    assert_eq!(u1.blood_type, BloodType::APositive);
    assert_eq!(u1.quantity_ml, 450);

    let u2 = client.get_blood_unit(&2u64);
    assert_eq!(u2.blood_type, BloodType::BNegative);

    let u3 = client.get_blood_unit(&3u64);
    assert_eq!(u3.blood_type, BloodType::ONegative);
}

#[test]
fn test_batch_register_blood_empty_list() {
    let (env, admin, client, _) = create_test_contract();
    env.ledger().set_timestamp(1000u64);

    let empty: soroban_sdk::Vec<(BloodType, u32, Option<Address>)> =
        soroban_sdk::Vec::new(&env);
    let ids = client.batch_register_blood(&admin, &empty);
    assert_eq!(ids.len(), 0);
}

#[test]
#[should_panic(expected = "Error(Contract, #116)")]
fn test_batch_register_blood_invalid_quantity_aborts_all() {
    let (env, admin, client, _) = create_test_contract();
    env.ledger().set_timestamp(1000u64);

    // Second entry has invalid quantity — entire batch should fail
    let entries = vec![
        &env,
        (BloodType::APositive, 450u32, None::<Address>),
        (BloodType::BNegative, 50u32, None::<Address>), // too low
    ];
    client.batch_register_blood(&admin, &entries);
}

#[test]
#[should_panic(expected = "Error(Contract, #132)")]
fn test_batch_register_blood_unauthorized_bank() {
    let (env, _admin, client, _) = create_test_contract();
    env.ledger().set_timestamp(1000u64);

    let unauthorized = Address::generate(&env);
    let entries = vec![&env, (BloodType::APositive, 450u32, None::<Address>)];
    client.batch_register_blood(&unauthorized, &entries);
}
