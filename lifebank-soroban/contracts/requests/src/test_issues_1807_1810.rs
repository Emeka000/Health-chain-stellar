//! Acceptance tests for #1807 (pause), #1808 (fulfilling org ownership),
//! #1809 (reservation validation) and #1810 (paginated history).
use crate::storage::HISTORY_PAGE_SIZE;
use crate::test_utils::{seed_reservation, MockInventory};
use crate::{
    BloodComponent, BloodType, ContractError, RequestContract, RequestContractClient,
    RequestStatus, Urgency,
};
use soroban_sdk::{
    testutils::{Address as _, Ledger as _},
    Address, Env, String, Vec,
};

fn setup<'a>() -> (Env, RequestContractClient<'a>, Address, Address) {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register(RequestContract, ());
    let client = RequestContractClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    let inventory_id = env.register(MockInventory, ());
    client.initialize(&admin, &inventory_id);
    let hospital = Address::generate(&env);
    client.authorize_hospital(&hospital);
    env.ledger().set_timestamp(1_000);
    (env, client, admin, hospital)
}

fn approved_request(env: &Env, client: &RequestContractClient<'_>, admin: &Address, hospital: &Address) -> u64 {
    let id = client.create_request(
        hospital,
        &BloodType::OPositive,
        &BloodComponent::WholeBlood,
        &500u32,
        &Urgency::Urgent,
        &1_600u64,
    );
    client.update_request_status(admin, &id, &RequestStatus::Approved, &String::from_str(env, "ok"));
    id
}

fn assert_paused<E>(err: Option<Result<ContractError, E>>)
where
    E: core::fmt::Debug,
{
    assert_eq!(err.unwrap().unwrap(), ContractError::ContractPaused);
}

// ── #1807: pause circuit breaker ─────────────────────────────────────────────

#[test]
fn test_pause_blocks_every_mutating_entrypoint() {
    let (env, client, admin, hospital) = setup();
    let id = approved_request(&env, &client, &admin, &hospital);
    let bank = Address::generate(&env);
    client.authorize_blood_bank(&bank);
    let rider = Address::generate(&env);
    client.authorize_rider(&rider);
    seed_reservation(&env, &client, 9, id, &bank);
    client.set_payments_contract(&admin);

    assert!(!client.is_paused());
    client.pause(&admin);
    assert!(client.is_paused());

    let r = String::from_str(&env, "reason");
    assert_paused(client.try_create_request(&hospital, &BloodType::OPositive, &BloodComponent::WholeBlood, &500u32, &Urgency::Urgent, &1_600u64).err());
    let mut entries = Vec::new(&env);
    entries.push_back((BloodType::OPositive, BloodComponent::WholeBlood, 500u32, Urgency::Urgent, 1_600u64));
    assert_paused(client.try_batch_create_requests(&hospital, &entries).err());
    assert_paused(client.try_update_request_status(&admin, &id, &RequestStatus::Fulfilled, &r).err());
    assert_paused(client.try_partial_fulfill_request(&admin, &id, &100u32, &r).err());
    assert_paused(client.try_set_reservation_id(&admin, &id, &9u64).err());
    assert_paused(client.try_set_fulfilling_org(&admin, &id, &bank).err());
    assert_paused(client.try_reassign_fulfilling_org(&id, &bank, &r).err());
    assert_paused(client.try_assign_rider(&admin, &id, &rider).err());
    assert_paused(client.try_cancel_request(&hospital, &id, &r).err());
    assert_paused(client.try_cancel_request_by_contract(&admin, &id, &r).err());

    client.unpause(&admin);
    assert!(!client.is_paused());
    client.set_reservation_id(&admin, &id, &9u64);
    assert_eq!(client.get_request(&id).reservation_id, Some(9));
}

#[test]
fn test_pause_requires_admin() {
    let (env, client, _admin, _hospital) = setup();
    let other = Address::generate(&env);
    assert_eq!(client.try_pause(&other), Err(Ok(ContractError::Unauthorized)));
    assert_eq!(client.try_unpause(&other), Err(Ok(ContractError::Unauthorized)));
    assert!(!client.is_paused());
}

// ── #1809: set_reservation_id validates the reservation ──────────────────────

#[test]
fn test_set_reservation_id_rejects_missing_reservation() {
    let (env, client, admin, hospital) = setup();
    let id = approved_request(&env, &client, &admin, &hospital);
    assert_eq!(
        client.try_set_reservation_id(&admin, &id, &404u64),
        Err(Ok(ContractError::ReservationNotFound))
    );
    assert_eq!(client.get_request(&id).reservation_id, None);
}

#[test]
fn test_set_reservation_id_rejects_reservation_for_other_request() {
    let (env, client, admin, hospital) = setup();
    let id = approved_request(&env, &client, &admin, &hospital);
    seed_reservation(&env, &client, 7, id + 100, &Address::generate(&env));
    assert_eq!(
        client.try_set_reservation_id(&admin, &id, &7u64),
        Err(Ok(ContractError::ReservationRequestMismatch))
    );
}

#[test]
fn test_set_reservation_id_rejects_reservation_of_other_bank_than_fulfiller() {
    let (env, client, admin, hospital) = setup();
    let id = approved_request(&env, &client, &admin, &hospital);
    let bank_a = Address::generate(&env);
    let bank_b = Address::generate(&env);
    client.set_fulfilling_org(&admin, &id, &bank_a);
    seed_reservation(&env, &client, 7, id, &bank_b);
    assert_eq!(
        client.try_set_reservation_id(&admin, &id, &7u64),
        Err(Ok(ContractError::ReservationOwnerMismatch))
    );
    seed_reservation(&env, &client, 8, id, &bank_a);
    client.set_reservation_id(&admin, &id, &8u64);
    assert_eq!(client.get_request(&id).reservation_id, Some(8));
}

// ── #1808: fulfilling org must own the reservation; admin can correct ────────

#[test]
fn test_bank_b_cannot_claim_request_reserved_by_bank_a() {
    let (env, client, admin, hospital) = setup();
    let id = approved_request(&env, &client, &admin, &hospital);
    let bank_a = Address::generate(&env);
    let bank_b = Address::generate(&env);
    client.authorize_blood_bank(&bank_a);
    client.authorize_blood_bank(&bank_b);

    // No reservation yet: nobody can self-claim.
    assert_eq!(
        client.try_set_fulfilling_org(&bank_b, &id, &bank_b),
        Err(Ok(ContractError::ReservationRequired))
    );

    seed_reservation(&env, &client, 3, id, &bank_a);
    client.set_reservation_id(&admin, &id, &3u64);

    assert_eq!(
        client.try_set_fulfilling_org(&bank_b, &id, &bank_b),
        Err(Ok(ContractError::ReservationOwnerMismatch))
    );
    client.set_fulfilling_org(&bank_a, &id, &bank_a);
    assert_eq!(client.get_request(&id).fulfilled_by, Some(bank_a));
}

#[test]
fn test_admin_can_correct_fulfilled_by_with_reason() {
    let (env, client, admin, hospital) = setup();
    let id = approved_request(&env, &client, &admin, &hospital);
    let wrong = Address::generate(&env);
    let right = Address::generate(&env);
    client.set_fulfilling_org(&admin, &id, &wrong);

    assert_eq!(
        client.try_reassign_fulfilling_org(&id, &right, &String::from_str(&env, "")),
        Err(Ok(ContractError::InvalidReason))
    );
    let reason = String::from_str(&env, "wrong bank recorded");
    client.reassign_fulfilling_org(&id, &right, &reason);

    assert_eq!(client.get_request(&id).fulfilled_by, Some(right));
    let history = client.get_request_history(&id);
    let last = history.get(history.len() - 1).unwrap();
    assert_eq!(last.actor, admin);
    assert_eq!(last.reason, reason);
}

// ── #1810: paginated history ──────────────────────────────────────────────────

#[test]
fn test_history_is_paginated() {
    let (env, client, admin, hospital) = setup();
    let id = approved_request(&env, &client, &admin, &hospital);
    let extra = HISTORY_PAGE_SIZE + 5;
    for _ in 0..extra {
        client.reassign_fulfilling_org(&id, &Address::generate(&env), &String::from_str(&env, "fix"));
    }
    let total = 2 + extra; // created + approved + reassignments
    assert_eq!(client.get_request(&id).history_len, total);
    assert_eq!(client.get_request_history_page(&id, &0).len(), HISTORY_PAGE_SIZE);
    assert_eq!(client.get_request_history_page(&id, &1).len(), total - HISTORY_PAGE_SIZE);
    assert_eq!(client.get_request_history_page(&id, &2).len(), 0);
    let all = client.get_request_history(&id);
    assert_eq!(all.len(), total);
    assert!(all.get(0).unwrap().is_initial_transition);
    assert_eq!(
        client.try_get_request_history_page(&999u64, &0),
        Err(Ok(ContractError::RequestNotFound))
    );
}

#[test]
fn test_get_request_cost_does_not_grow_with_history() {
    let (env, client, admin, hospital) = setup();
    let short_id = approved_request(&env, &client, &admin, &hospital);
    let long_id = approved_request(&env, &client, &admin, &hospital);
    for _ in 0..(HISTORY_PAGE_SIZE * 3) {
        client.reassign_fulfilling_org(&long_id, &admin, &String::from_str(&env, "a long free-text reason"));
    }
    // Make the two requests otherwise identical in shape.
    client.reassign_fulfilling_org(&short_id, &admin, &String::from_str(&env, "a long free-text reason"));

    env.cost_estimate().budget().reset_default();
    client.get_request(&short_id);
    let short_cost = env.cost_estimate().budget().cpu_instruction_cost();

    env.cost_estimate().budget().reset_default();
    client.get_request(&long_id);
    let long_cost = env.cost_estimate().budget().cpu_instruction_cost();

    assert_eq!(client.get_request(&long_id).history_len, 2 + HISTORY_PAGE_SIZE * 3);
    // Allow a tiny tolerance for u32 encoding differences.
    assert!(
        long_cost <= short_cost + short_cost / 100,
        "get_request cost grew with history: short={short_cost} long={long_cost}"
    );
}
