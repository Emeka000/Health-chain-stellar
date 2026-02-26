#![no_main]

use libfuzzer_sys::fuzz_target;
use arbitrary::Arbitrary;
use soroban_sdk::{
    testutils::{Address as _, Ledger},
    Address, Env, String as SorobanString, Symbol,
};

// Import the contract types
use health_chain_contract::{
    BloodStatus, BloodType, CustodyStatus, Error, HealthChainContract, HealthChainContractClient,
};

/// Represents a custody transfer operation
#[derive(Arbitrary, Debug, Clone)]
enum CustodyOperation {
    InitiateTransfer { unit_id: u8 },
    ConfirmTransfer { event_id_index: u8 },
    CancelTransfer { event_id_index: u8 },
    AdvanceTime { seconds: u16 },
}

/// Represents the condition of a blood unit during transfer
#[derive(Arbitrary, Debug, Clone, Copy)]
enum UnitConditionFuzz {
    Normal,
    NearExpiry,
    Expired,
}

/// Fuzz input structure
#[derive(Arbitrary, Debug)]
struct FuzzInput {
    operations: Vec<CustodyOperation>,
    unit_conditions: Vec<UnitConditionFuzz>,
    caller_variations: Vec<u8>, // 0 = bank, 1 = hospital, 2 = other
}

fuzz_target!(|input: FuzzInput| {
    // Limit operations to prevent timeout
    if input.operations.len() > 50 {
        return;
    }

    let env = Env::default();
    env.mock_all_auths();

    // Setup contract
    let admin = Address::generate(&env);
    let contract_id = env.register(HealthChainContract, ());
    let client = HealthChainContractClient::new(&env, &contract_id);
    
    client.initialize(&admin);

    // Register blood bank and hospital
    let bank = Address::generate(&env);
    let hospital = Address::generate(&env);
    let other_address = Address::generate(&env);
    
    client.register_blood_bank(&bank);
    client.register_hospital(&hospital);

    // Create blood units with different conditions
    let mut unit_ids = Vec::new();
    let base_time = env.ledger().timestamp();
    
    for (idx, condition) in input.unit_conditions.iter().enumerate().take(10) {
        let expiration = match condition {
            UnitConditionFuzz::Normal => base_time + 7 * 86400, // 7 days
            UnitConditionFuzz::NearExpiry => base_time + 1800,  // 30 minutes
            UnitConditionFuzz::Expired => base_time + 100,      // Already expired
        };

        let unit_id = client.register_blood(
            &bank,
            &BloodType::OPositive,
            &450,
            &expiration,
            &Some(Symbol::new(&env, &format!("DONOR{}", idx))),
        );
        
        unit_ids.push(unit_id);
        
        // Allocate to hospital to prepare for transfer
        let _ = client.allocate_blood(&bank, &unit_id, &hospital);
    }

    // Track pending event IDs for confirm/cancel operations
    let mut pending_event_ids: Vec<SorobanString> = Vec::new();
    let mut confirmed_transfers: Vec<u64> = Vec::new();

    // Execute operations and check invariants
    for op in input.operations.iter() {
        match op {
            CustodyOperation::InitiateTransfer { unit_id } => {
                if unit_ids.is_empty() {
                    continue;
                }
                
                let unit_idx = (*unit_id as usize) % unit_ids.len();
                let unit_id = unit_ids[unit_idx];

                // Check invariant: unit should not have pending transfer
                let unit_result = client.try_get_blood_unit(&unit_id);
                if let Ok(unit) = unit_result {
                    // Only initiate if status is Reserved
                    if unit.status == BloodStatus::Reserved {
                        let result = client.try_initiate_transfer(&bank, &unit_id);
                        
                        if let Ok(event_id) = result {
                            pending_event_ids.push(event_id.clone());
                            
                            // INVARIANT 1: A unit can never have two pending transfers simultaneously
                            let custody_event = client.get_custody_event(&event_id).unwrap();
                            assert_eq!(custody_event.status, CustodyStatus::Pending);
                            
                            // Verify no other pending transfers for this unit
                            let count = pending_event_ids.iter().filter(|eid| {
                                if let Ok(evt) = client.try_get_custody_event(eid) {
                                    evt.unit_id == unit_id && evt.status == CustodyStatus::Pending
                                } else {
                                    false
                                }
                            }).count();
                            
                            assert!(count <= 1, "INVARIANT VIOLATION: Multiple pending transfers for unit {}", unit_id);
                        }
                    }
                }
            }

            CustodyOperation::ConfirmTransfer { event_id_index } => {
                if pending_event_ids.is_empty() {
                    continue;
                }
                
                let idx = (*event_id_index as usize) % pending_event_ids.len();
                let event_id = pending_event_ids[idx].clone();

                let custody_event_result = client.try_get_custody_event(&event_id);
                if let Ok(custody_event) = custody_event_result {
                    if custody_event.status == CustodyStatus::Pending {
                        let unit_id = custody_event.unit_id;
                        let old_unit = client.get_blood_unit(&unit_id);
                        
                        let result = client.try_confirm_transfer(&hospital, &event_id);
                        
                        if result.is_ok() {
                            // INVARIANT 2: A confirmed transfer always updates current_custodian
                            let updated_unit = client.get_blood_unit(&unit_id);
                            assert_eq!(updated_unit.status, BloodStatus::Delivered, 
                                "INVARIANT VIOLATION: Confirmed transfer didn't update status to Delivered");
                            
                            // INVARIANT 3: Confirmed transfer updates custody event status
                            let updated_event = client.get_custody_event(&event_id).unwrap();
                            assert_eq!(updated_event.status, CustodyStatus::Confirmed,
                                "INVARIANT VIOLATION: Confirmed transfer didn't update event status");
                            
                            confirmed_transfers.push(unit_id);
                            pending_event_ids.remove(idx);
                            
                            // INVARIANT 4: total_custody_events equals confirmed transfers only
                            let metadata = client.get_custody_trail_metadata(&unit_id);
                            let confirmed_count = confirmed_transfers.iter().filter(|&&id| id == unit_id).count();
                            assert_eq!(metadata.total_events as usize, confirmed_count,
                                "INVARIANT VIOLATION: total_custody_events ({}) != confirmed transfers ({})",
                                metadata.total_events, confirmed_count);
                        }
                    }
                }
            }

            CustodyOperation::CancelTransfer { event_id_index } => {
                if pending_event_ids.is_empty() {
                    continue;
                }
                
                let idx = (*event_id_index as usize) % pending_event_ids.len();
                let event_id = pending_event_ids[idx].clone();

                let custody_event_result = client.try_get_custody_event(&event_id);
                if let Ok(custody_event) = custody_event_result {
                    if custody_event.status == CustodyStatus::Pending {
                        let unit_id = custody_event.unit_id;
                        
                        // Advance time to make transfer cancellable
                        let current_time = env.ledger().timestamp();
                        env.ledger().with_mut(|li| {
                            li.timestamp = current_time + 1800; // 30 minutes
                        });
                        
                        let result = client.try_cancel_transfer(&bank, &event_id);
                        
                        if result.is_ok() {
                            // INVARIANT 3: A cancelled transfer never updates current_custodian
                            let updated_unit = client.get_blood_unit(&unit_id);
                            assert_eq!(updated_unit.status, BloodStatus::Reserved,
                                "INVARIANT VIOLATION: Cancelled transfer changed status from Reserved");
                            
                            // Verify custody event is cancelled
                            let updated_event = client.get_custody_event(&event_id).unwrap();
                            assert_eq!(updated_event.status, CustodyStatus::Cancelled,
                                "INVARIANT VIOLATION: Cancelled transfer didn't update event status");
                            
                            pending_event_ids.remove(idx);
                            
                            // INVARIANT 4: Cancelled transfers should NOT increment total_custody_events
                            let metadata = client.get_custody_trail_metadata(&unit_id);
                            let confirmed_count = confirmed_transfers.iter().filter(|&&id| id == unit_id).count();
                            assert_eq!(metadata.total_events as usize, confirmed_count,
                                "INVARIANT VIOLATION: Cancelled transfer incremented total_custody_events");
                        }
                    }
                }
            }

            CustodyOperation::AdvanceTime { seconds } => {
                let current_time = env.ledger().timestamp();
                let advance = (*seconds as u64).min(86400); // Max 1 day advance
                env.ledger().with_mut(|li| {
                    li.timestamp = current_time + advance;
                });
            }
        }

        // Global invariant check after every operation
        for unit_id in &unit_ids {
            // Count pending transfers for this unit
            let pending_count = pending_event_ids.iter().filter(|eid| {
                if let Ok(evt) = client.try_get_custody_event(eid) {
                    evt.unit_id == *unit_id && evt.status == CustodyStatus::Pending
                } else {
                    false
                }
            }).count();
            
            assert!(pending_count <= 1, 
                "GLOBAL INVARIANT VIOLATION: Unit {} has {} pending transfers", 
                unit_id, pending_count);
        }
    }
});
