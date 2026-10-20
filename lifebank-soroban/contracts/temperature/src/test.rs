//! Tests for the temperature contract.
//!
//! These tests exercise the oracle-to-unit assignment enforcement added for
//! issue #1648: a whitelisted oracle may only log readings for units it has
//! been explicitly assigned to, preventing a single compromised sensor key
//! from masking excursions or fabricating them across the fleet.
//!
//! They also cover the threshold-change lifecycle from issue #1649: pending
//! proposals are TTL-extended so they survive the governance delay, and
//! replacing/cancelling a proposal is observable through events.

use super::*;
use soroban_sdk::{testutils::{Address as _, Events as _, Ledger as _}, Address, Env, IntoVal, Symbol};

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
fn replacing_pending_threshold_change_emits_event() {
    let (env, client, admin, _oracle) = setup();
    let unit_id = 12u64;

    client.propose_threshold_change(&admin, &unit_id, &500);
    client.propose_threshold_change(&admin, &unit_id, &600);

    let events = env.events().all();
    let replaced = events.iter().any(|(_, topics, _)| {
        topics
            .get(0)
            .map(|t| t == Symbol::new(&env, "ThresholdProposalReplaced").into_val(&env))
            .unwrap_or(false)
    });
    assert!(replaced, "expected ThresholdProposalReplaced event");
}

#[test]
fn cancel_threshold_change_removes_pending_proposal() {
    let (env, client, admin, _oracle) = setup();
    let unit_id = 13u64;

    client.propose_threshold_change(&admin, &unit_id, &500);
    client.cancel_threshold_change(&admin, &unit_id);

    let events = env.events().all();
    let cancelled = events.iter().any(|(_, topics, _)| {
        topics
            .get(0)
            .map(|t| t == Symbol::new(&env, "ThresholdProposalCancelled").into_val(&env))
            .unwrap_or(false)
    });
    assert!(cancelled, "expected ThresholdProposalCancelled event");

    // Applying after cancellation must fail since no proposal remains.
    env.ledger().with_mut(|li| {
        li.timestamp += GOVERNANCE_DELAY_SECONDS + 1;
    });
    let result = client.try_apply_threshold_change(&admin, &unit_id);
    assert!(result.is_err());
}
