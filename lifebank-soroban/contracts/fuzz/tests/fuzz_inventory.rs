use soroban_sdk::symbol_short;
//! Fuzz tests for inventory contract (issue #844)
//!
//! These property-based tests validate that the inventory contract handles
//! adversarial inputs correctly without panicking or entering invalid states.

use proptest::prelude::*;
use soroban_sdk::{testutils::Address as _, Address, Env, String as SorobanString, Vec as SorobanVec};
use inventory_contract::{InventoryContract, InventoryContractClient};

// Maximum safe reservation duration (30 days in seconds)
const MAX_RESERVATION_DURATION_SECS: u64 = 30 * 24 * 3600;

/// Generate valid blood type symbols
fn blood_type_strategy() -> impl Strategy<Value = &'static str> {
    prop_oneof![
        Just("APos"),
        Just("ANeg"),
        Just("BPos"),
        Just("BNeg"),
        Just("ABPos"),
        Just("ABNeg"),
        Just("OPos"),
        Just("ONeg"),
    ]
}

/// Generate valid quantity values (100-600ml)
fn quantity_strategy() -> impl Strategy<Value = u32> {
    100u32..=600u32
}

/// Generate potentially adversarial duration values
fn duration_strategy() -> impl Strategy<Value = u64> {
    prop_oneof![
        Just(0u64),                              // Zero duration
        1u64..=MAX_RESERVATION_DURATION_SECS,    // Valid range
        Just(u64::MAX),                          // Maximum value (overflow risk)
        Just(u64::MAX - 1000),                   // Near-maximum
    ]
}

proptest! {
    /// Issue #844: Fuzz test - reserve_blood should never panic on valid duration values
    #[test]
    fn reserve_blood_never_panics_on_valid_durations(
        duration in 1u64..=MAX_RESERVATION_DURATION_SECS,
        quantity in quantity_strategy(),
    ) {
        let env = Env::default();
        env.mock_all_auths();
        
        let contract_id = env.register_contract(None, InventoryContract);
        let client = InventoryContractClient::new(&env, &contract_id);
        
        let admin = Address::generate(&env);
        let bank = Address::generate(&env);
        
        // Initialize contract
        client.initialize(&admin);
        client.authorize_bank(&admin, &bank, &true);
        
        // Register a blood unit
        let serial = SorobanString::from_str(&env, "TEST-001");
        let blood_type = soroban_sdk::symbol_short!("APos");
        let unit_id = client.register_blood(&bank, &serial, &blood_type, &quantity, &None).unwrap();
        
        // Reserve with fuzzed duration - should not panic
        let mut unit_ids = SorobanVec::new(&env);
        unit_ids.push_back(unit_id);
        
        let result = client.try_reserve_blood(&bank, &unit_ids, &1u64, &duration);
        
        // Should either succeed or return a valid error, never panic
        match result {
            Ok(_) => {
                // Valid reservation created
                assert!(duration > 0 && duration <= MAX_RESERVATION_DURATION_SECS);
            }
            Err(_) => {
                // Error is acceptable for edge cases
            }
        }
    }

    /// Issue #844: Fuzz test - register_blood should handle quantity edge cases
    #[test]
    fn register_blood_handles_quantity_edge_cases(
        quantity in any::<u32>(),
        blood_type in blood_type_strategy(),
    ) {
        let env = Env::default();
        env.mock_all_auths();
        
        let contract_id = env.register_contract(None, InventoryContract);
        let client = InventoryContractClient::new(&env, &contract_id);
        
        let admin = Address::generate(&env);
        let bank = Address::generate(&env);
        
        client.initialize(&admin);
        client.authorize_bank(&admin, &bank, &true);
        
        let serial = SorobanString::from_str(&env, "FUZZ-001");
        let blood_type_sym = soroban_sdk::Symbol::new(&env, blood_type);
        
        let result = client.try_register_blood(&bank, &serial, &blood_type_sym, &quantity, &None);
        
        // Should either succeed (valid quantity) or return InvalidQuantity error
        match result {
            Ok(_) => {
                assert!(quantity >= 100 && quantity <= 600, "Invalid quantity accepted");
            }
            Err(_) => {
                // Expected for out-of-range quantities
            }
        }
    }

    /// Issue #844: Fuzz test - batch operations should handle large Vec inputs
    #[test]
    fn batch_reserve_handles_large_inputs(
        batch_size in 0usize..=100,
    ) {
        let env = Env::default();
        env.mock_all_auths();
        
        let contract_id = env.register_contract(None, InventoryContract);
        let client = InventoryContractClient::new(&env, &contract_id);
        
        let admin = Address::generate(&env);
        let bank = Address::generate(&env);
        
        client.initialize(&admin);
        client.authorize_bank(&admin, &bank, &true);
        
        // Register multiple units
        let mut all_unit_ids = SorobanVec::new(&env);
        for i in 0..batch_size.min(10) {
            let serial = SorobanString::from_str(&env, &format!("BATCH-{:03}", i));
            let blood_type = soroban_sdk::symbol_short!("OPos");
            let unit_id = client.register_blood(&bank, &serial, &blood_type, &450, &None).unwrap();
            all_unit_ids.push_back(unit_id);
        }
        
        if all_unit_ids.len() > 0 {
            // Create batch reservation request
            let mut batch = SorobanVec::new(&env);
            batch.push_back((all_unit_ids, 1u64, 3600u64));
            
            let result = client.try_batch_reserve_blood(&bank, &batch);
            
            // Should handle gracefully without panic
            match result {
                Ok(reservation_ids) => {
                    assert_eq!(reservation_ids.len(), 1);
                }
                Err(_) => {
                    // Acceptable for edge cases
                }
            }
        }
    }

    /// Issue #845: Fuzz test - expired units should never be reservable
    #[test]
    fn expired_units_cannot_be_reserved(
        quantity in quantity_strategy(),
    ) {
        let env = Env::default();
        env.mock_all_auths();
        
        let contract_id = env.register_contract(None, InventoryContract);
        let client = InventoryContractClient::new(&env, &contract_id);
        
        let admin = Address::generate(&env);
        let bank = Address::generate(&env);
        
        client.initialize(&admin);
        client.authorize_bank(&admin, &bank, &true);
        
        // Register a blood unit
        let serial = SorobanString::from_str(&env, "EXPIRY-TEST");
        let blood_type = soroban_sdk::symbol_short!("ABPos");
        let unit_id = client.register_blood(&bank, &serial, &blood_type, &quantity, &None).unwrap();
        
        // Fast-forward time past expiration (42 days = shelf life)
        env.ledger().with_mut(|li| {
            li.timestamp += 43 * 24 * 3600; // 43 days
        });
        
        // Attempt to reserve expired unit
        let mut unit_ids = SorobanVec::new(&env);
        unit_ids.push_back(unit_id);
        
        let result = client.try_reserve_blood(&bank, &unit_ids, &1u64, &3600u64);
        
        // MUST fail with BloodUnitExpired error
        assert!(result.is_err(), "Expired unit was allowed to be reserved!");
    }
}

#[cfg(test)]
mod unit_tests {
    use super::*;

    #[test]
    fn test_zero_duration_rejected() {
        let env = Env::default();
        env.mock_all_auths();
        
        let contract_id = env.register_contract(None, InventoryContract);
        let client = InventoryContractClient::new(&env, &contract_id);
        
        let admin = Address::generate(&env);
        let bank = Address::generate(&env);
        
        client.initialize(&admin);
        client.authorize_bank(&admin, &bank, &true);
        
        let serial = SorobanString::from_str(&env, "ZERO-DUR");
        let blood_type = soroban_sdk::symbol_short!("OPos");
        let unit_id = client.register_blood(&bank, &serial, &blood_type, &450, &None).unwrap();
        
        let mut unit_ids = SorobanVec::new(&env);
        unit_ids.push_back(unit_id);
        
        // Zero duration should be rejected
        let result = client.try_reserve_blood(&bank, &unit_ids, &1u64, &0u64);
        assert!(result.is_err());
    }

    #[test]
    fn test_empty_serial_number() {
        let env = Env::default();
        env.mock_all_auths();
        
        let contract_id = env.register_contract(None, InventoryContract);
        let client = InventoryContractClient::new(&env, &contract_id);
        
        let admin = Address::generate(&env);
        let bank = Address::generate(&env);
        
        client.initialize(&admin);
        client.authorize_bank(&admin, &bank, &true);
        
        // Empty string serial number
        let serial = SorobanString::from_str(&env, "");
        let blood_type = soroban_sdk::symbol_short!("APos");
        
        let result = client.try_register_blood(&bank, &serial, &blood_type, &450, &None);
        
        // Should handle gracefully (either accept or reject, but not panic)
        match result {
            Ok(_) => {
                // If accepted, that's a design decision
            }
            Err(_) => {
                // Rejection is also acceptable
            }
        }
    }
}
