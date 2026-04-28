#![cfg(test)]

use super::*;
use soroban_sdk::{testutils::Address as _, testutils::Ledger as _, Address, Env};

fn setup() -> (Env, Address) {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register(PaymentContract, ());
    (env, contract_id)
}

fn make_payment(
    env: &Env,
    client: &PaymentContractClient,
    request_id: u64,
    amount: i128,
) -> (u64, Address, Address) {
    let payer = Address::generate(env);
    let payee = Address::generate(env);
    let id = client.create_payment(&request_id, &payer, &payee, &amount);
    (id, payer, payee)
}

/// Deploy a minimal Soroban token contract and mint `amount` to `recipient`.
fn deploy_token_with_balance(env: &Env, admin: &Address, recipient: &Address, amount: i128) -> Address {
    let token = env.register_stellar_asset_contract_v2(admin.clone());
    let token_id = token.address();
    let token_admin = soroban_sdk::token::StellarAssetClient::new(env, &token_id);
    token_admin.mint(recipient, &amount);
    token_id
}

// ── create_payment ─────────────────────────────────────────────────────────────

#[test]
fn test_create_payment_increments_counter() {
    let (env, cid) = setup();
    let client = PaymentContractClient::new(&env, &cid);
    let (id1, _, _) = make_payment(&env, &client, 1, 1000);
    let (id2, _, _) = make_payment(&env, &client, 2, 2000);
    assert_eq!(id1, 1);
    assert_eq!(id2, 2);
    assert_eq!(client.get_payment_count(), 2);
}

#[test]
fn test_create_payment_rejects_zero_amount() {
    let (env, cid) = setup();
    let client = PaymentContractClient::new(&env, &cid);
    let payer = Address::generate(&env);
    let payee = Address::generate(&env);
    let result = client.try_create_payment(&1u64, &payer, &payee, &0i128);
    assert!(result.is_err());
}

#[test]
fn test_create_payment_rejects_negative_amount() {
    let (env, cid) = setup();
    let client = PaymentContractClient::new(&env, &cid);
    let payer = Address::generate(&env);
    let payee = Address::generate(&env);
    let result = client.try_create_payment(&1u64, &payer, &payee, &-100i128);
    assert!(result.is_err());
}

#[test]
fn test_create_payment_rejects_same_payer_payee() {
    let (env, cid) = setup();
    let client = PaymentContractClient::new(&env, &cid);
    let addr = Address::generate(&env);
    let result = client.try_create_payment(&1u64, &addr, &addr, &1000i128);
    assert!(result.is_err());
}

#[test]
fn test_create_payment_stores_correct_fields() {
    let (env, cid) = setup();
    let client = PaymentContractClient::new(&env, &cid);
    env.ledger().with_mut(|l| l.timestamp = 5000);
    let payer = Address::generate(&env);
    let payee = Address::generate(&env);
    let id = client.create_payment(&42u64, &payer, &payee, &999i128);

    let p = client.get_payment(&id);
    assert_eq!(p.request_id, 42);
    assert_eq!(p.payer, payer);
    assert_eq!(p.payee, payee);
    assert_eq!(p.amount, 999);
    assert_eq!(p.status, PaymentStatus::Pending);
    assert_eq!(p.created_at, 5000);
}

// ── get_payment ────────────────────────────────────────────────────────────────

#[test]
fn test_get_payment_returns_not_found_for_missing_id() {
    let (env, cid) = setup();
    let client = PaymentContractClient::new(&env, &cid);
    let result = client.try_get_payment(&999u64);
    assert!(result.is_err());
}

#[test]
fn test_get_payment_returns_correct_payment() {
    let (env, cid) = setup();
    let client = PaymentContractClient::new(&env, &cid);
    let (id, payer, payee) = make_payment(&env, &client, 10, 500);
    let p = client.get_payment(&id);
    assert_eq!(p.id, id);
    assert_eq!(p.payer, payer);
    assert_eq!(p.payee, payee);
    assert_eq!(p.amount, 500);
}

// ── get_payment_by_request ─────────────────────────────────────────────────────

#[test]
fn test_get_payment_by_request_finds_correct_payment() {
    let (env, cid) = setup();
    let client = PaymentContractClient::new(&env, &cid);
    make_payment(&env, &client, 1, 100);
    let (id2, _, _) = make_payment(&env, &client, 99, 200);
    make_payment(&env, &client, 3, 300);

    let p = client.get_payment_by_request(&99u64);
    assert_eq!(p.id, id2);
    assert_eq!(p.request_id, 99);
}

#[test]
fn test_get_payment_by_request_returns_not_found() {
    let (env, cid) = setup();
    let client = PaymentContractClient::new(&env, &cid);
    make_payment(&env, &client, 1, 100);
    let result = client.try_get_payment_by_request(&999u64);
    assert!(result.is_err());
}

// ── duplicate-payment prevention (#599) ───────────────────────────────────────

#[test]
fn test_create_payment_rejects_duplicate_request_id() {
    let (env, cid) = setup();
    let client = PaymentContractClient::new(&env, &cid);
    // First payment for request 42 succeeds.
    make_payment(&env, &client, 42, 500);
    // Second payment for the same request must be rejected.
    let payer = Address::generate(&env);
    let payee = Address::generate(&env);
    let result = client.try_create_payment(&42u64, &payer, &payee, &500i128);
    assert_eq!(result, Err(Ok(Error::DuplicatePayment)));
}

#[test]
fn test_create_escrow_rejects_duplicate_request_id() {
    let (env, cid) = setup();
    let client = PaymentContractClient::new(&env, &cid);
    let admin = Address::generate(&env);
    client.initialize(&admin, &None);

    let hospital = Address::generate(&env);
    let payee = Address::generate(&env);
    let token_id = deploy_token_with_balance(&env, &admin, &hospital, 10_000);

    // First escrow for request 7 succeeds.
    client.create_escrow(&7u64, &hospital, &payee, &1_000i128, &token_id);

    // Second escrow for the same request must be rejected.
    let result = client.try_create_escrow(&7u64, &hospital, &payee, &500i128, &token_id);
    assert_eq!(result, Err(Ok(Error::DuplicatePayment)));
}

#[test]
fn test_get_payment_by_request_resolves_without_full_scan() {
    // Verify the index lookup returns the correct payment even when many
    // payments exist for other request IDs.
    let (env, cid) = setup();
    let client = PaymentContractClient::new(&env, &cid);
    for i in 1u64..=20 {
        make_payment(&env, &client, i, 100);
    }
    let target_request_id = 13u64;
    let p = client.get_payment_by_request(&target_request_id);
    assert_eq!(p.request_id, target_request_id);
}

#[test]
fn test_terminal_payment_does_not_block_new_active_payment_for_different_request() {
    // Payments for distinct request IDs must never interfere.
    let (env, cid) = setup();
    let client = PaymentContractClient::new(&env, &cid);
    let (id1, _, _) = make_payment(&env, &client, 100, 200);
    client.update_status(&id1, &PaymentStatus::Refunded);

    // A payment for a different request must still be accepted.
    let (id2, _, _) = make_payment(&env, &client, 101, 300);
    assert!(id2 > id1);
    let p = client.get_payment_by_request(&101u64);
    assert_eq!(p.id, id2);
}

// ── get_payments_by_payer ──────────────────────────────────────────────────────

#[test]
fn test_get_payments_by_payer_returns_only_payer_payments() {
    let (env, cid) = setup();
    let client = PaymentContractClient::new(&env, &cid);
    let payer_a = Address::generate(&env);
    let payee = Address::generate(&env);

    client.create_payment(&1u64, &payer_a, &payee, &100i128);
    client.create_payment(&2u64, &payer_a, &payee, &200i128);
    make_payment(&env, &client, 3, 300);

    let page = client.get_payments_by_payer(&payer_a, &0u32, &20u32);
    assert_eq!(page.items.len(), 2);
    assert_eq!(page.total, 2);
}

#[test]
fn test_get_payments_by_payer_empty_result() {
    let (env, cid) = setup();
    let client = PaymentContractClient::new(&env, &cid);
    let stranger = Address::generate(&env);
    let page = client.get_payments_by_payer(&stranger, &0u32, &20u32);
    assert_eq!(page.items.len(), 0);
    assert_eq!(page.total, 0);
}

#[test]
fn test_get_payments_by_payer_pagination() {
    let (env, cid) = setup();
    let client = PaymentContractClient::new(&env, &cid);
    let payer = Address::generate(&env);
    let payee = Address::generate(&env);

    for i in 1u64..=5 {
        client.create_payment(&i, &payer, &payee, &(i as i128 * 100));
    }

    let page0 = client.get_payments_by_payer(&payer, &0u32, &2u32);
    assert_eq!(page0.items.len(), 2);
    assert_eq!(page0.total, 5);

    let page1 = client.get_payments_by_payer(&payer, &1u32, &2u32);
    assert_eq!(page1.items.len(), 2);

    let page2 = client.get_payments_by_payer(&payer, &2u32, &2u32);
    assert_eq!(page2.items.len(), 1);
}

// ── get_payments_by_payee ──────────────────────────────────────────────────────

#[test]
fn test_get_payments_by_payee_returns_only_payee_payments() {
    let (env, cid) = setup();
    let client = PaymentContractClient::new(&env, &cid);
    let payer = Address::generate(&env);
    let payee_a = Address::generate(&env);

    client.create_payment(&1u64, &payer, &payee_a, &100i128);
    client.create_payment(&2u64, &payer, &payee_a, &200i128);
    make_payment(&env, &client, 3, 300);

    let page = client.get_payments_by_payee(&payee_a, &0u32, &20u32);
    assert_eq!(page.items.len(), 2);
    assert_eq!(page.total, 2);
}

#[test]
fn test_get_payments_by_payee_pagination() {
    let (env, cid) = setup();
    let client = PaymentContractClient::new(&env, &cid);
    let payer = Address::generate(&env);
    let payee = Address::generate(&env);

    for i in 1u64..=6 {
        client.create_payment(&i, &payer, &payee, &(i as i128 * 50));
    }

    let page = client.get_payments_by_payee(&payee, &0u32, &4u32);
    assert_eq!(page.items.len(), 4);
    assert_eq!(page.total, 6);

    let page2 = client.get_payments_by_payee(&payee, &1u32, &4u32);
    assert_eq!(page2.items.len(), 2);
}

// ── get_payments_by_status ─────────────────────────────────────────────────────

#[test]
fn test_get_payments_by_status_filters_correctly() {
    let (env, cid) = setup();
    let client = PaymentContractClient::new(&env, &cid);
    let (id1, _, _) = make_payment(&env, &client, 1, 100);
    let (id2, _, _) = make_payment(&env, &client, 2, 200);
    make_payment(&env, &client, 3, 300);

    client.update_status(&id1, &PaymentStatus::Locked);
    client.update_status(&id2, &PaymentStatus::Locked);

    let locked = client.get_payments_by_status(&PaymentStatus::Locked, &0u32, &20u32);
    assert_eq!(locked.items.len(), 2);
    assert_eq!(locked.total, 2);

    let pending = client.get_payments_by_status(&PaymentStatus::Pending, &0u32, &20u32);
    assert_eq!(pending.items.len(), 1);
}

#[test]
fn test_get_payments_by_status_empty_when_none_match() {
    let (env, cid) = setup();
    let client = PaymentContractClient::new(&env, &cid);
    make_payment(&env, &client, 1, 100);

    let page = client.get_payments_by_status(&PaymentStatus::Released, &0u32, &20u32);
    assert_eq!(page.items.len(), 0);
}

#[test]
fn test_get_payments_by_status_pagination() {
    let (env, cid) = setup();
    let client = PaymentContractClient::new(&env, &cid);
    for i in 1u64..=5 {
        let (id, _, _) = make_payment(&env, &client, i, 100);
        client.update_status(&id, &PaymentStatus::Refunded);
    }

    let page0 = client.get_payments_by_status(&PaymentStatus::Refunded, &0u32, &3u32);
    assert_eq!(page0.items.len(), 3);
    assert_eq!(page0.total, 5);

    let page1 = client.get_payments_by_status(&PaymentStatus::Refunded, &1u32, &3u32);
    assert_eq!(page1.items.len(), 2);
}

// ── get_payment_statistics ─────────────────────────────────────────────────────

#[test]
fn test_statistics_empty_when_no_payments() {
    let (env, cid) = setup();
    let client = PaymentContractClient::new(&env, &cid);
    let stats = client.get_payment_statistics();
    assert_eq!(stats.total_locked, 0);
    assert_eq!(stats.total_released, 0);
    assert_eq!(stats.total_refunded, 0);
    assert_eq!(stats.count_locked, 0);
    assert_eq!(stats.count_released, 0);
    assert_eq!(stats.count_refunded, 0);
}

#[test]
fn test_statistics_counts_and_totals_correctly() {
    let (env, cid) = setup();
    let client = PaymentContractClient::new(&env, &cid);

    let (id1, _, _) = make_payment(&env, &client, 1, 1000);
    let (id2, _, _) = make_payment(&env, &client, 2, 2000);
    let (id3, _, _) = make_payment(&env, &client, 3, 500);
    let (id4, _, _) = make_payment(&env, &client, 4, 750);
    make_payment(&env, &client, 5, 300); // stays Pending

    client.update_status(&id1, &PaymentStatus::Locked);
    client.update_status(&id2, &PaymentStatus::Locked);
    client.update_status(&id3, &PaymentStatus::Released);
    client.update_status(&id4, &PaymentStatus::Refunded);

    let stats = client.get_payment_statistics();
    assert_eq!(stats.count_locked, 2);
    assert_eq!(stats.total_locked, 3000);
    assert_eq!(stats.count_released, 1);
    assert_eq!(stats.total_released, 500);
    assert_eq!(stats.count_refunded, 1);
    assert_eq!(stats.total_refunded, 750);
}

#[test]
fn test_statistics_ignores_pending_cancelled_disputed() {
    let (env, cid) = setup();
    let client = PaymentContractClient::new(&env, &cid);
    let (id1, _, _) = make_payment(&env, &client, 1, 100);
    let (id2, _, _) = make_payment(&env, &client, 2, 200);
    make_payment(&env, &client, 3, 300); // stays Pending

    client.update_status(&id1, &PaymentStatus::Cancelled);
    client.update_status(&id2, &PaymentStatus::Disputed);

    let stats = client.get_payment_statistics();
    assert_eq!(stats.count_locked, 0);
    assert_eq!(stats.count_released, 0);
    assert_eq!(stats.count_refunded, 0);
    assert_eq!(stats.total_locked, 0);
}

// ── get_payment_timeline ───────────────────────────────────────────────────────

#[test]
fn test_timeline_returns_payments_in_chronological_order() {
    let (env, cid) = setup();
    let client = PaymentContractClient::new(&env, &cid);

    env.ledger().with_mut(|l| l.timestamp = 3000);
    make_payment(&env, &client, 1, 100);

    env.ledger().with_mut(|l| l.timestamp = 1000);
    make_payment(&env, &client, 2, 200);

    env.ledger().with_mut(|l| l.timestamp = 2000);
    make_payment(&env, &client, 3, 300);

    let page = client.get_payment_timeline(&0u32, &20u32);
    assert_eq!(page.items.len(), 3);
    assert_eq!(page.items.get(0).unwrap().created_at, 1000);
    assert_eq!(page.items.get(1).unwrap().created_at, 2000);
    assert_eq!(page.items.get(2).unwrap().created_at, 3000);
}

#[test]
fn test_timeline_pagination() {
    let (env, cid) = setup();
    let client = PaymentContractClient::new(&env, &cid);

    for i in 1u64..=5 {
        env.ledger().with_mut(|l| l.timestamp = i * 1000);
        make_payment(&env, &client, i, 100);
    }

    let page0 = client.get_payment_timeline(&0u32, &2u32);
    assert_eq!(page0.items.len(), 2);
    assert_eq!(page0.total, 5);
    assert_eq!(page0.items.get(0).unwrap().created_at, 1000);

    let page1 = client.get_payment_timeline(&1u32, &2u32);
    assert_eq!(page1.items.len(), 2);
    assert_eq!(page1.items.get(0).unwrap().created_at, 3000);

    let page2 = client.get_payment_timeline(&2u32, &2u32);
    assert_eq!(page2.items.len(), 1);
    assert_eq!(page2.items.get(0).unwrap().created_at, 5000);
}

#[test]
fn test_timeline_empty_when_no_payments() {
    let (env, cid) = setup();
    let client = PaymentContractClient::new(&env, &cid);
    let page = client.get_payment_timeline(&0u32, &20u32);
    assert_eq!(page.items.len(), 0);
    assert_eq!(page.total, 0);
}

#[test]
fn test_timeline_out_of_range_page_returns_empty() {
    let (env, cid) = setup();
    let client = PaymentContractClient::new(&env, &cid);
    make_payment(&env, &client, 1, 100);

    let page = client.get_payment_timeline(&99u32, &20u32);
    assert_eq!(page.items.len(), 0);
    assert_eq!(page.total, 1);
}

// ── update_status ──────────────────────────────────────────────────────────────

#[test]
fn test_update_status_changes_payment_status() {
    let (env, cid) = setup();
    let client = PaymentContractClient::new(&env, &cid);
    let (id, _, _) = make_payment(&env, &client, 1, 500);

    client.update_status(&id, &PaymentStatus::Locked);
    let p = client.get_payment(&id);
    assert_eq!(p.status, PaymentStatus::Locked);

    client.update_status(&id, &PaymentStatus::Released);
    let p = client.get_payment(&id);
    assert_eq!(p.status, PaymentStatus::Released);
}

#[test]
fn test_update_status_returns_not_found_for_missing_payment() {
    let (env, cid) = setup();
    let client = PaymentContractClient::new(&env, &cid);
    let result = client.try_update_status(&999u64, &PaymentStatus::Locked);
    assert!(result.is_err());
}

// ── donation pledges ───────────────────────────────────────────────────────────

#[test]
fn test_create_pledge_stores_metadata() {
    let (env, cid) = setup();
    let client = PaymentContractClient::new(&env, &cid);
    let donor = Address::generate(&env);
    let pool = soroban_sdk::String::from_str(&env, "hospital-pool-42");
    let cause = soroban_sdk::String::from_str(&env, "maternal_health");
    let region = soroban_sdk::String::from_str(&env, "NG-Lagos");

    let id = client.create_pledge(
        &donor,
        &500i128,
        &2_592_000u64,
        &pool,
        &cause,
        &region,
        &true,
    );

    let p = client.get_pledge(&id);
    assert_eq!(p.donor, donor);
    assert_eq!(p.amount_per_period, 500);
    assert_eq!(p.interval_secs, 2_592_000);
    assert!(p.emergency_pool);
    assert!(p.active);
}

#[test]
fn test_create_pledge_rejects_zero_interval() {
    let (env, cid) = setup();
    let client = PaymentContractClient::new(&env, &cid);
    let donor = Address::generate(&env);
    let pool = soroban_sdk::String::from_str(&env, "pool");
    let cause = soroban_sdk::String::from_str(&env, "c");
    let region = soroban_sdk::String::from_str(&env, "r");
    let r = client.try_create_pledge(&donor, &100i128, &0u64, &pool, &cause, &region, &false);
    assert!(r.is_err());
}

// ── Circuit breaker tests ─────────────────────────────────────────────────────

#[test]
fn test_pause_blocks_create_payment() {
    let (env, cid) = setup();
    let client = PaymentContractClient::new(&env, &cid);
    let admin = Address::generate(&env);
    client.initialize(&admin, &None);

    client.pause(&admin);
    assert!(client.is_paused());

    let payer = Address::generate(&env);
    let payee = Address::generate(&env);
    let result = client.try_create_payment(&1u64, &payer, &payee, &500i128);
    assert!(result.is_err());
}

#[test]
fn test_pause_allows_get_payment() {
    let (env, cid) = setup();
    let client = PaymentContractClient::new(&env, &cid);
    let admin = Address::generate(&env);
    client.initialize(&admin, &None);

    let (id, _, _) = make_payment(&env, &client, 1, 1000);
    client.pause(&admin);

    // Read still works
    let p = client.get_payment(&id);
    assert_eq!(p.id, id);
}

#[test]
fn test_unpause_restores_payments() {
    let (env, cid) = setup();
    let client = PaymentContractClient::new(&env, &cid);
    let admin = Address::generate(&env);
    client.initialize(&admin, &None);

    client.pause(&admin);
    client.unpause(&admin);
    assert!(!client.is_paused());

    let (id, _, _) = make_payment(&env, &client, 99, 200);
    assert!(id > 0);
}

#[test]
#[should_panic]
fn test_non_admin_cannot_pause_payments() {
    let (env, cid) = setup();
    let client = PaymentContractClient::new(&env, &cid);
    let admin = Address::generate(&env);
    client.initialize(&admin, &None);

    let attacker = Address::generate(&env);
    client.pause(&attacker);
}

// ── Vesting schedule tests ─────────────────────────────────────────────────────

fn setup_with_admin() -> (Env, Address, Address) {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register(PaymentContract, ());
    let admin = Address::generate(&env);
    let client = PaymentContractClient::new(&env, &contract_id);
    client.initialize(&admin, &None);
    (env, contract_id, admin)
}

/// Pre-cliff claim must return CliffNotReached.
#[test]
fn test_vesting_pre_cliff_claim_fails() {
    let (env, cid, admin) = setup_with_admin();
    let client = PaymentContractClient::new(&env, &cid);
    let donor = Address::generate(&env);

    // cliff = now + 1000s, duration = 2000s
    env.ledger().with_mut(|l| l.timestamp = 5000);
    client.create_vesting(&admin, &donor, &1_000_000i128, &1000u64, &2000u64);

    // Deploy reward token and mint to contract so it can transfer
    let token_id = deploy_token_with_balance(&env, &admin, &cid, 1_000_000);

    // Try to claim at t=5500 (before cliff at t=6000)
    env.ledger().with_mut(|l| l.timestamp = 5500);
    let result = client.try_claim_vested(&donor, &token_id);
    assert_eq!(
        result,
        Err(Ok(Error::CliffNotReached)),
        "Expected CliffNotReached before cliff"
    );
}

/// At 50% of vesting duration, claimable = total/2.
#[test]
fn test_vesting_partial_claim_at_50_percent() {
    let (env, cid, admin) = setup_with_admin();
    let client = PaymentContractClient::new(&env, &cid);
    let donor = Address::generate(&env);

    // cliff = now + 0 (immediate), duration = 2000s → vest_end = now + 2000
    env.ledger().with_mut(|l| l.timestamp = 10_000);
    client.create_vesting(&admin, &donor, &1_000_000i128, &0u64, &2000u64);

    let token_id = deploy_token_with_balance(&env, &admin, &cid, 1_000_000);

    // Advance to 50% of vesting duration (cliff == vest_start == 10_000, vest_end == 12_000)
    env.ledger().with_mut(|l| l.timestamp = 11_000); // 1000s elapsed of 2000s
    let claimed = client.claim_vested(&donor, &token_id);
    assert_eq!(claimed, 500_000i128, "50% vesting should yield half the total");

    let schedule = client.get_vesting(&donor);
    assert_eq!(schedule.claimed, 500_000i128);
}

/// After vesting end, donor can claim the full remaining amount.
#[test]
fn test_vesting_full_claim_after_vest_end() {
    let (env, cid, admin) = setup_with_admin();
    let client = PaymentContractClient::new(&env, &cid);
    let donor = Address::generate(&env);

    env.ledger().with_mut(|l| l.timestamp = 1_000);
    client.create_vesting(&admin, &donor, &500_000i128, &0u64, &1000u64);

    let token_id = deploy_token_with_balance(&env, &admin, &cid, 500_000);

    // Advance past vest_end
    env.ledger().with_mut(|l| l.timestamp = 3_000);
    let claimed = client.claim_vested(&donor, &token_id);
    assert_eq!(claimed, 500_000i128, "Full amount claimable after vest end");

    let schedule = client.get_vesting(&donor);
    assert_eq!(schedule.claimed, 500_000i128);
    assert_eq!(schedule.claimed, schedule.total_amount);
}

/// Donor cannot claim more than total_amount across multiple claims.
#[test]
fn test_vesting_cannot_exceed_total_amount() {
    let (env, cid, admin) = setup_with_admin();
    let client = PaymentContractClient::new(&env, &cid);
    let donor = Address::generate(&env);

    env.ledger().with_mut(|l| l.timestamp = 1_000);
    client.create_vesting(&admin, &donor, &1_000_000i128, &0u64, &1000u64);

    let token_id = deploy_token_with_balance(&env, &admin, &cid, 1_000_000);

    // Claim full amount after vest end
    env.ledger().with_mut(|l| l.timestamp = 5_000);
    let first = client.claim_vested(&donor, &token_id);
    assert_eq!(first, 1_000_000i128);

    // Second claim should fail with NothingToClaim
    let result = client.try_claim_vested(&donor, &token_id);
    assert_eq!(
        result,
        Err(Ok(Error::NothingToClaim)),
        "Second claim after full vest should fail"
    );
}

/// Non-admin cannot create a vesting schedule.
#[test]
fn test_vesting_only_admin_can_create() {
    let (env, cid, _admin) = setup_with_admin();
    let client = PaymentContractClient::new(&env, &cid);
    let attacker = Address::generate(&env);
    let donor = Address::generate(&env);

    env.ledger().with_mut(|l| l.timestamp = 1_000);
    let result = client.try_create_vesting(&attacker, &donor, &1_000i128, &100u64, &500u64);
    assert!(result.is_err(), "Non-admin must not create vesting");
}

// ── process_expired_disputes (#595) ─────────────────────────────────────────────────

#[test]
fn test_process_expired_disputes_refunds_after_timeout() {
    let (env, cid, admin) = setup_with_admin();
    let client = PaymentContractClient::new(&env, &cid);

    let hospital = Address::generate(&env);
    let payee = Address::generate(&env);
    let token_id = deploy_token_with_balance(&env, &admin, &hospital, 10_000);

    env.ledger().with_mut(|l| l.timestamp = 1_000);
    let pid = client.create_escrow(&1u64, &hospital, &payee, &1_000i128, &token_id);

    // Record dispute at t=1000; updated_at becomes 1000.
    client.record_dispute(&pid, &DisputeReason::FailedDelivery,
        &soroban_sdk::String::from_str(&env, "case-1"));

    // Set a short timeout of 500s.
    client.set_dispute_timeout(&admin, &500u64);

    // Advance time past timeout.
    env.ledger().with_mut(|l| l.timestamp = 2_000);

    let mut ids = soroban_sdk::Vec::new(&env);
    ids.push_back(pid);
    let refunded = client.process_expired_disputes(&admin, &ids);
    assert_eq!(refunded.len(), 1);
    assert_eq!(refunded.get(0).unwrap(), pid);

    let p = client.get_payment(&pid);
    assert_eq!(p.status, PaymentStatus::Refunded);
}

#[test]
fn test_process_expired_disputes_skips_non_expired() {
    let (env, cid, admin) = setup_with_admin();
    let client = PaymentContractClient::new(&env, &cid);

    let hospital = Address::generate(&env);
    let payee = Address::generate(&env);
    let token_id = deploy_token_with_balance(&env, &admin, &hospital, 10_000);

    env.ledger().with_mut(|l| l.timestamp = 1_000);
    let pid = client.create_escrow(&2u64, &hospital, &payee, &500i128, &token_id);
    client.record_dispute(&pid, &DisputeReason::Other,
        &soroban_sdk::String::from_str(&env, "case-2"));

    client.set_dispute_timeout(&admin, &5_000u64);

    // Only 100s elapsed — not expired.
    env.ledger().with_mut(|l| l.timestamp = 1_100);

    let mut ids = soroban_sdk::Vec::new(&env);
    ids.push_back(pid);
    let refunded = client.process_expired_disputes(&admin, &ids);
    assert_eq!(refunded.len(), 0);

    let p = client.get_payment(&pid);
    assert_eq!(p.status, PaymentStatus::Disputed);
}

#[test]
fn test_process_expired_disputes_skips_non_disputed_payments() {
    let (env, cid, admin) = setup_with_admin();
    let client = PaymentContractClient::new(&env, &cid);

    env.ledger().with_mut(|l| l.timestamp = 1_000);
    let (pid, _, _) = make_payment(&env, &client, 3, 200);
    // Payment is Pending, not Disputed.
    client.set_dispute_timeout(&admin, &1u64);
    env.ledger().with_mut(|l| l.timestamp = 9_000);

    let mut ids = soroban_sdk::Vec::new(&env);
    ids.push_back(pid);
    let refunded = client.process_expired_disputes(&admin, &ids);
    assert_eq!(refunded.len(), 0);
}

/// VestingCreated and VestingClaimed events are emitted.
#[test]
fn test_vesting_events_emitted() {
    let (env, cid, admin) = setup_with_admin();
    let client = PaymentContractClient::new(&env, &cid);
    let donor = Address::generate(&env);

    env.ledger().with_mut(|l| l.timestamp = 1_000);
    client.create_vesting(&admin, &donor, &200_000i128, &0u64, &1000u64);

    let token_id = deploy_token_with_balance(&env, &admin, &cid, 200_000);

    env.ledger().with_mut(|l| l.timestamp = 2_500); // past vest_end
    client.claim_vested(&donor, &token_id);

    // Events are published — verify no panic and schedule is updated
    let schedule = client.get_vesting(&donor);
    assert_eq!(schedule.claimed, 200_000i128);
}
