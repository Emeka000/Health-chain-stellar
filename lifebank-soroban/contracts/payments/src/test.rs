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
