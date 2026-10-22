//! Tests for the temperature contract.
//!
//! These tests exercise the oracle-to-unit assignment enforcement added for
//! issue #1648: a whitelisted oracle may only log readings for units it has
//! been explicitly assigned to, preventing a single compromised sensor key
//! from masking excursions or fabricating them across the fleet.
//!
//! They also cover the threshold-change lifecycle from issue #1649: pending
//! proposals are TTL-extended so they survive the governance delay, and a
//! second proposal for the same unit is rejected while one is pending.
//!
//! Every test here is written to fail against the pre-fix contract.

use super::*;
use soroban_sdk::{testutils::{Address as _, Ledger as _}, Address, Env};

fn setup() -> (Env, TemperatureContractClient<'static>, Address, Address) {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register_contract(None, TemperatureContract);
    let client = TemperatureContractClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    client.initialize(&admin);
    let oracle = Address::generate(&env);
    client.add_oracle(&admin, &oracle);
    (env, client, admin, oracle)
}

#[test]
fn assigned_oracle_can_log_reading() {
    let (env, client, admin, oracle) = setup();
    let unit_id = 1u64;
    client.assign_oracle(&admin, &unit_id, &oracle);

    client.log_reading(&oracle, &unit_id, &400);
    let reading = client.get_latest_reading(&unit_id).unwrap();
    assert_eq!(reading.temperature_celsius_x100, 400);
}

#[test]
fn unassigned_oracle_cannot_log_reading() {
    let (_env, client, _admin, oracle) = setup();
    let unit_id = 7u64;

    let result = client.try_log_reading(&oracle, &unit_id, &400);
    assert_eq!(result, Err(Ok(ContractError::OracleNotAssignedToUnit)));
}

#[test]
fn oracle_assigned_to_other_unit_cannot_log() {
    let (_env, client, admin, oracle) = setup();
    client.assign_oracle(&admin, &1u64, &oracle);

    let result = client.try_log_reading(&oracle, &2u64, &400);
    assert_eq!(result, Err(Ok(ContractError::OracleNotAssignedToUnit)));
}

#[test]
fn unassigned_oracle_cannot_mask_excursion() {
    let (env, client, admin, oracle) = setup();
    let unit_id = 42u64;
    client.assign_oracle(&admin, &unit_id, &oracle);

    // Two genuine violations from the assigned oracle.
    client.log_reading(&oracle, &unit_id, &900);
    client.log_reading(&oracle, &unit_id, &900);

    // A different whitelisted but unassigned oracle attempts to inject an
    // in-range reading to reset the streak.
    let rogue = Address::generate(&env);
    client.add_oracle(&admin, &rogue);
    let result = client.try_log_reading(&rogue, &unit_id, &400);
    assert_eq!(result, Err(Ok(ContractError::OracleNotAssignedToUnit)));

    // Streak must remain intact; a third violation compromises the unit.
    client.log_reading(&oracle, &unit_id, &900);
    assert!(client.is_compromised(&unit_id));
}

#[test]
fn unassigned_oracle_cannot_fabricate_excursion() {
    let (env, client, admin, oracle) = setup();
    let unit_id = 99u64;
    client.assign_oracle(&admin, &unit_id, &oracle);

    let rogue = Address::generate(&env);
    client.add_oracle(&admin, &rogue);

    for _ in 0..3 {
        let result = client.try_log_reading(&rogue, &unit_id, &900);
        assert_eq!(result, Err(Ok(ContractError::OracleNotAssignedToUnit)));
    }
    assert!(!client.is_compromised(&unit_id));
}

#[test]
fn revoked_oracle_cannot_log_reading() {
    let (_env, client, admin, oracle) = setup();
    let unit_id = 5u64;
    client.assign_oracle(&admin, &unit_id, &oracle);
    client.revoke_oracle(&admin, &unit_id, &oracle);

    let result = client.try_log_reading(&oracle, &unit_id, &400);
    assert_eq!(result, Err(Ok(ContractError::OracleNotAssignedToUnit)));
}

#[test]
fn pending_threshold_change_survives_governance_delay() {
    let (env, client, admin, _oracle) = setup();
    let unit_id = 11u64;

    client.propose_threshold_change(&admin, &unit_id, &500);

    // Advance the ledger past the 7-day governance delay.
    env.ledger().with_mut(|li| {
        li.timestamp += GOVERNANCE_DELAY_SECONDS + 1;
    });

    // The proposal must still be applicable after the delay.
    client.apply_threshold_change(&admin, &unit_id);
    assert_eq!(client.get_threshold(&unit_id), 500);
}

#[test]
fn second_proposal_rejected_while_pending() {
    let (_env, client, admin, _oracle) = setup();
    let unit_id = 12u64;

    client.propose_threshold_change(&admin, &unit_id, &500);

    // A second proposal must not silently replace the first and restart the
    // governance clock.
    let result = client.try_propose_threshold_change(&admin, &unit_id, &600);
    assert!(
        result.is_err(),
        "second propose_threshold_change must be rejected while one is pending"
    );
}

#[test]
fn pending_proposal_not_silently_replaced() {
    let (env, client, admin, _oracle) = setup();
    let unit_id = 14u64;

    client.propose_threshold_change(&admin, &unit_id, &500);
    let _ = client.try_propose_threshold_change(&admin, &unit_id, &600);

    // After the delay the originally proposed value must apply, not the
    // replacement.
    env.ledger().with_mut(|li| {
        li.timestamp += GOVERNANCE_DELAY_SECONDS + 1;
    });
    client.apply_threshold_change(&admin, &unit_id);
    assert_eq!(client.get_threshold(&unit_id), 500);
}

#[test]
fn set_threshold_cannot_bypass_timelock() {
    let (env, client, admin, _oracle) = setup();
    let unit_id = 15u64;

    // Establish a threshold through the timelocked path.
    client.propose_threshold_change(&admin, &unit_id, &500);
    env.ledger().with_mut(|li| {
        li.timestamp += GOVERNANCE_DELAY_SECONDS + 1;
    });
    client.apply_threshold_change(&admin, &unit_id);
    assert_eq!(client.get_threshold(&unit_id), 500);

    // No single call may change an existing threshold without the timelock.
    let result = client.try_set_threshold(&admin, &unit_id, &5000);
    assert!(
        result.is_err(),
        "set_threshold must not change an existing threshold without the timelock"
    );
    assert_eq!(client.get_threshold(&unit_id), 500);
}

#[test]
fn pending_threshold_change_survives_ttl_archive() {
    let (env, client, admin, _oracle) = setup();
    let unit_id = 16u64;

    client.propose_threshold_change(&admin, &unit_id, &500);

    // Advance the ledger past the governance delay and well beyond a default
    // temporary-storage TTL so an unextended entry would be archived.
    env.ledger().with_mut(|li| {
        li.timestamp += GOVERNANCE_DELAY_SECONDS + 1;
        li.sequence_number += 100_000;
    });

    client.apply_threshold_change(&admin, &unit_id);
    assert_eq!(client.get_threshold(&unit_id), 500);
}
