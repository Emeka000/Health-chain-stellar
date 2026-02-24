use crate::storage;
use crate::types::{BloodStatus, BloodType};
use crate::{InventoryContract, InventoryContractClient};
use soroban_sdk::{
    testutils::{Address as _, Ledger},
    vec, Address, Env, String,
};

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
#[should_panic(expected = "Error(Contract, #0)")]
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

    // Set current time and calculate expiration (30 days from now)
    let current_time = 1000u64;
    env.ledger().set_timestamp(current_time);
    let expiration = current_time + (30 * 86400);

    let donor = Address::generate(&env);

    let blood_unit_id = client.register_blood(
        &bank,
        &blood_type,
        &quantity_ml,
        &expiration,
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
    assert_eq!(stored_unit.donation_timestamp, current_time);
    assert_eq!(stored_unit.expiration_timestamp, expiration);
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
        &(current_time + 30 * 86400),
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
    let expiration = current_time + (30 * 86400);

    // Register first unit
    let id1 = client.register_blood(&bank, &BloodType::APositive, &450u32, &expiration, &None);
    assert_eq!(id1, 1);

    // Register second unit
    let id2 = client.register_blood(&bank, &BloodType::BPositive, &450u32, &expiration, &None);
    assert_eq!(id2, 2);

    // Register third unit
    let id3 = client.register_blood(&bank, &BloodType::ONegative, &450u32, &expiration, &None);
    assert_eq!(id3, 3);
}

#[test]
#[should_panic(expected = "Error(Contract, #16)")]
fn test_register_blood_quantity_too_low() {
    let (env, admin, client, _contract_id) = create_test_contract();

    let bank = admin.clone();
    let current_time = 1000u64;
    env.ledger().set_timestamp(current_time);

    client.register_blood(
        &bank,
        &BloodType::APositive,
        &50u32, // Too low
        &(current_time + 30 * 86400),
        &None,
    );
}

#[test]
#[should_panic(expected = "Error(Contract, #16)")]
fn test_register_blood_quantity_too_high() {
    let (env, admin, client, _contract_id) = create_test_contract();

    let bank = admin.clone();
    let current_time = 1000u64;
    env.ledger().set_timestamp(current_time);

    client.register_blood(
        &bank,
        &BloodType::APositive,
        &700u32, // Too high
        &(current_time + 30 * 86400),
        &None,
    );
}

#[test]
#[should_panic(expected = "Error(Contract, #17)")]
fn test_register_blood_expiration_in_past() {
    let (env, admin, client, _contract_id) = create_test_contract();

    let bank = admin.clone();
    let current_time = 1000u64;
    env.ledger().set_timestamp(current_time);

    client.register_blood(
        &bank,
        &BloodType::APositive,
        &450u32,
        &(current_time - 100), // In the past
        &None,
    );
}

#[test]
#[should_panic(expected = "Error(Contract, #17)")]
fn test_register_blood_expiration_too_far_future() {
    let (env, admin, client, _contract_id) = create_test_contract();

    let bank = admin.clone();
    let current_time = 1000u64;
    env.ledger().set_timestamp(current_time);

    // 60 days is beyond the 42-day maximum for whole blood
    client.register_blood(
        &bank,
        &BloodType::APositive,
        &450u32,
        &(current_time + 60 * 86400),
        &None,
    );
}

#[test]
#[should_panic(expected = "Error(Contract, #17)")]
fn test_register_blood_insufficient_shelf_life() {
    let (env, admin, client, _contract_id) = create_test_contract();

    let bank = admin.clone();
    let current_time = 1000u64;
    env.ledger().set_timestamp(current_time);

    // Only 12 hours shelf life (less than minimum 1 day)
    client.register_blood(
        &bank,
        &BloodType::APositive,
        &450u32,
        &(current_time + 43200),
        &None,
    );
}

#[test]
#[should_panic(expected = "Error(Contract, #32)")]
fn test_register_blood_unauthorized_bank() {
    let (env, admin, client, _contract_id) = create_test_contract();

    let unauthorized_bank = Address::generate(&env);
    let current_time = 1000u64;
    env.ledger().set_timestamp(current_time);

    client.register_blood(
        &unauthorized_bank,
        &BloodType::APositive,
        &450u32,
        &(current_time + 30 * 86400),
        &None,
    );
}

#[test]
fn test_register_all_blood_types() {
    let (env, admin, client, _contract_id) = create_test_contract();

    let bank = admin.clone();
    let current_time = 1000u64;
    env.ledger().set_timestamp(current_time);
    let expiration = current_time + (30 * 86400);

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
        let id = client.register_blood(&bank, &blood_type, &450u32, &expiration, &None);

        assert_eq!(id, (i + 1) as u64);

        let unit = client.get_blood_unit(&id);
        assert_eq!(unit.blood_type, blood_type);
    }
}

#[test]
#[should_panic(expected = "Error(Contract, #21)")]
fn test_get_blood_unit_not_found() {
    let (_env, _admin, client, _contract_id) = create_test_contract();

    client.get_blood_unit(&999);
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
    let expiration = current_time + (30 * 86400);

    // Register first unit — gets ID 1
    let id1 = client.register_blood(&bank, &BloodType::APositive, &450u32, &expiration, &None);
    assert_eq!(id1, 1);

    // Register second unit — gets ID 2 (no collision)
    let id2 = client.register_blood(&bank, &BloodType::BPositive, &450u32, &expiration, &None);
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
            expiration_timestamp: expiration,
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
        &expiration,
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
    let expiration = current_time + (30 * 86400);

    // Register 10 units rapidly — simulates multiple registrations in the
    // same ledger. Each must get a unique, sequential ID.
    let mut ids = soroban_sdk::Vec::new(&env);
    for _ in 0..10 {
        let id =
            client.register_blood(&bank, &BloodType::APositive, &450u32, &expiration, &None);
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
    let expiration = current_time + (30 * 86400);

    // Minimum valid quantity
    let id1 = client.register_blood(&bank, &BloodType::APositive, &100u32, &expiration, &None);
    let unit1 = client.get_blood_unit(&id1);
    assert_eq!(unit1.quantity_ml, 100);

    // Maximum valid quantity
    let id2 = client.register_blood(&bank, &BloodType::BPositive, &600u32, &expiration, &None);
    let unit2 = client.get_blood_unit(&id2);
    assert_eq!(unit2.quantity_ml, 600);
}

#[test]
fn test_register_blood_edge_case_expiration() {
    let (env, admin, client, _contract_id) = create_test_contract();

    let bank = admin.clone();
    let current_time = 1000u64;
    env.ledger().set_timestamp(current_time);

    // Minimum shelf life (1 day + 1 second)
    let min_expiration = current_time + 86400 + 1;
    let id1 = client.register_blood(
        &bank,
        &BloodType::APositive,
        &450u32,
        &min_expiration,
        &None,
    );
    let unit1 = client.get_blood_unit(&id1);
    assert_eq!(unit1.expiration_timestamp, min_expiration);

    // Maximum shelf life (42 days)
    let max_expiration = current_time + (42 * 86400);
    let id2 = client.register_blood(
        &bank,
        &BloodType::BPositive,
        &450u32,
        &max_expiration,
        &None,
    );
    let unit2 = client.get_blood_unit(&id2);
    assert_eq!(unit2.expiration_timestamp, max_expiration);
}

#[test]
fn test_update_status_available_to_reserved() {
    let (env, admin, client, _contract_id) = create_test_contract();

    let bank = admin.clone();
    let current_time = 1000u64;
    env.ledger().set_timestamp(current_time);
    let expiration = current_time + (30 * 86400);

    let unit_id = client.register_blood(&bank, &BloodType::APositive, &450u32, &expiration, &None);

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
    let expiration = current_time + (30 * 86400);

    let unit_id = client.register_blood(&bank, &BloodType::APositive, &450u32, &expiration, &None);

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
#[should_panic(expected = "Error(Contract, #41)")]
fn test_update_status_invalid_transition() {
    let (env, admin, client, _contract_id) = create_test_contract();

    let bank = admin.clone();
    let current_time = 1000u64;
    env.ledger().set_timestamp(current_time);
    let expiration = current_time + (30 * 86400);

    let unit_id = client.register_blood(&bank, &BloodType::APositive, &450u32, &expiration, &None);

    // Try to go directly from Available to Delivered (invalid)
    client.update_status(
        &unit_id,
        &BloodStatus::Delivered,
        &admin,
        &Some(String::from_str(&env, "Skip to delivered")),
    );
}

#[test]
#[should_panic(expected = "Error(Contract, #2)")]
fn test_update_status_unauthorized() {
    let (env, admin, client, _contract_id) = create_test_contract();

    let bank = admin.clone();
    let current_time = 1000u64;
    env.ledger().set_timestamp(current_time);
    let expiration = current_time + (30 * 86400);

    let unit_id = client.register_blood(&bank, &BloodType::APositive, &450u32, &expiration, &None);

    let unauthorized = Address::generate(&env);

    // Try to update without authorization
    client.update_status(&unit_id, &BloodStatus::Reserved, &unauthorized, &None);
}

#[test]
#[should_panic(expected = "Error(Contract, #21)")]
fn test_update_status_nonexistent_unit() {
    let (env, admin, client, _contract_id) = create_test_contract();

    // Try to update unit that doesn't exist
    client.update_status(&999, &BloodStatus::Reserved, &admin, &None);
}

#[test]
#[should_panic(expected = "Error(Contract, #23)")]
fn test_update_status_expired_unit() {
    let (env, admin, client, _contract_id) = create_test_contract();

    let bank = admin.clone();
    let current_time = 1000u64;
    env.ledger().set_timestamp(current_time);
    let expiration = current_time + (5 * 86400); // 5 days

    let unit_id = client.register_blood(&bank, &BloodType::APositive, &450u32, &expiration, &None);

    // Move time past expiration
    env.ledger().set_timestamp(expiration + 100);

    // Try to update expired unit
    client.update_status(&unit_id, &BloodStatus::Reserved, &admin, &None);
}

#[test]
#[should_panic(expected = "Error(Contract, #41)")]
fn test_update_status_from_terminal_delivered() {
    let (env, admin, client, _contract_id) = create_test_contract();

    let bank = admin.clone();
    let current_time = 1000u64;
    env.ledger().set_timestamp(current_time);
    let expiration = current_time + (30 * 86400);

    let unit_id = client.register_blood(&bank, &BloodType::APositive, &450u32, &expiration, &None);

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
    let expiration = current_time + (30 * 86400);

    let unit_id = client.register_blood(&bank, &BloodType::APositive, &450u32, &expiration, &None);

    // Set to Reserved first (should be InTransit in real scenario, but for test)
    client.update_status(&unit_id, &BloodStatus::Reserved, &admin, &None);
    client.update_status(&unit_id, &BloodStatus::InTransit, &admin, &None);

    // Mark as delivered
    let updated = client.mark_delivered(&unit_id, &admin, &String::from_str(&env, "Hospital A"));

    assert_eq!(updated.status, BloodStatus::Delivered);
}

#[test]
#[should_panic(expected = "Error(Contract, #41)")]
fn test_mark_delivered_from_available() {
    let (env, admin, client, _contract_id) = create_test_contract();

    let bank = admin.clone();
    let current_time = 1000u64;
    env.ledger().set_timestamp(current_time);
    let expiration = current_time + (30 * 86400);

    let unit_id = client.register_blood(&bank, &BloodType::APositive, &450u32, &expiration, &None);

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
    let expiration = current_time + (30 * 86400);

    let unit_id = client.register_blood(&bank, &BloodType::APositive, &450u32, &expiration, &None);

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
    let expiration = current_time + (30 * 86400);

    let unit_id = client.register_blood(&bank, &BloodType::APositive, &450u32, &expiration, &None);

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
    let expiration = current_time + (30 * 86400);

    let unit_id = client.register_blood(&bank, &BloodType::APositive, &450u32, &expiration, &None);

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
    let expiration = current_time + (30 * 86400);

    let unit_id = client.register_blood(&bank, &BloodType::APositive, &450u32, &expiration, &None);

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
    let expiration = current_time + (30 * 86400);

    // Create multiple blood units
    let id1 = client.register_blood(&bank, &BloodType::APositive, &450u32, &expiration, &None);
    let id2 = client.register_blood(&bank, &BloodType::BPositive, &450u32, &expiration, &None);
    let id3 = client.register_blood(&bank, &BloodType::ONegative, &450u32, &expiration, &None);

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
    let expiration = current_time + (30 * 86400);

    let unit_id = client.register_blood(&bank, &BloodType::APositive, &450u32, &expiration, &None);

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
#[should_panic(expected = "Error(Contract, #21)")]
fn test_batch_update_status_nonexistent_unit() {
    let (env, admin, client, _contract_id) = create_test_contract();

    let bank = admin.clone();
    let current_time = 1000u64;
    env.ledger().set_timestamp(current_time);
    let expiration = current_time + (30 * 86400);

    let unit_id = client.register_blood(&bank, &BloodType::APositive, &450u32, &expiration, &None);

    // Try batch update with one nonexistent unit
    let unit_ids = vec![&env, unit_id, 999];
    client.batch_update_status(&unit_ids, &BloodStatus::Reserved, &admin, &None);
}

#[test]
#[should_panic(expected = "Error(Contract, #2)")]
fn test_batch_update_status_unauthorized() {
    let (env, admin, client, _contract_id) = create_test_contract();

    let bank = admin.clone();
    let current_time = 1000u64;
    env.ledger().set_timestamp(current_time);
    let expiration = current_time + (30 * 86400);

    let unit_id = client.register_blood(&bank, &BloodType::APositive, &450u32, &expiration, &None);

    let unauthorized = Address::generate(&env);

    let unit_ids = vec![&env, unit_id];
    client.batch_update_status(&unit_ids, &BloodStatus::Reserved, &unauthorized, &None);
}

#[test]
#[should_panic(expected = "Error(Contract, #41)")]
fn test_batch_update_status_invalid_transition() {
    let (env, admin, client, _contract_id) = create_test_contract();

    let bank = admin.clone();
    let current_time = 1000u64;
    env.ledger().set_timestamp(current_time);
    let expiration = current_time + (30 * 86400);

    let id1 = client.register_blood(&bank, &BloodType::APositive, &450u32, &expiration, &None);
    let id2 = client.register_blood(&bank, &BloodType::BPositive, &450u32, &expiration, &None);

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
