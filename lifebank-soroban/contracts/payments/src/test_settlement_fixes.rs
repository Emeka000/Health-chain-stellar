#![cfg(test)]

//! Regression tests for request cancellation after auto-refund, stale
//! two-party confirmations, mandatory request validation and batch caps.

use super::*;
use request_contract::{
    BloodComponent, BloodType, RequestContract, RequestContractClient, RequestStatus, Urgency,
};
use soroban_sdk::{
    testutils::Address as _, testutils::Ledger as _, Address, Env, Symbol, TryFromVal,
};

struct Setup<'a> {
    env: Env,
    admin: Address,
    hospital: Address,
    payee: Address,
    token: Address,
    payment_id: Address,
    client: PaymentContractClient<'a>,
    requests: RequestContractClient<'a>,
}

/// Payments + requests contracts wired together, with an allowlisted token
/// funded for `hospital`. `trust_payments` controls whether the requests
/// contract is told to trust the payments contract for cancellations.
fn setup<'a>(trust_payments: bool) -> Setup<'a> {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let hospital = Address::generate(&env);
    let payee = Address::generate(&env);

    let requests_id = env.register(RequestContract, ());
    let requests = RequestContractClient::new(&env, &requests_id);
    requests.initialize(&admin, &Address::generate(&env));
    requests.authorize_hospital(&hospital);

    let payment_id = env.register(PaymentContract, ());
    let client = PaymentContractClient::new(&env, &payment_id);
    client.initialize(&admin, &Some(requests_id.clone()));

    if trust_payments {
        requests.set_payments_contract(&payment_id);
    }

    let token = env.register_stellar_asset_contract_v2(admin.clone()).address();
    soroban_sdk::token::StellarAssetClient::new(&env, &token).mint(&hospital, &100_000);
    client.add_allowed_token(&admin, &token);

    Setup {
        env,
        admin,
        hospital,
        payee,
        token,
        payment_id,
        client,
        requests,
    }
}

fn new_request(s: &Setup) -> u64 {
    s.requests.create_request(
        &s.hospital,
        &BloodType::OPositive,
        &BloodComponent::WholeBlood,
        &250u32,
        &Urgency::Routine,
        &(s.env.ledger().timestamp() + 3_600),
    )
}

fn count_request_cancelled_events(env: &Env, contract: &Address) -> u32 {
    let request = Symbol::new(env, "request");
    let cancelled = Symbol::new(env, "cancelled");
    let mut n = 0;
    for (addr, topics, _) in env.events().all().iter() {
        if addr != *contract || topics.len() != 2 {
            continue;
        }
        let t0 = Symbol::try_from_val(env, &topics.get(0).unwrap());
        let t1 = Symbol::try_from_val(env, &topics.get(1).unwrap());
        if t0 == Ok(request.clone()) && t1 == Ok(cancelled.clone()) {
            n += 1;
        }
    }
    n
}

fn dispute_and_expire(s: &Setup, pid: u64) {
    s.client.record_dispute(
        &pid,
        &DisputeReason::FailedDelivery,
        &String::from_str(&s.env, "case-1"),
        &s.hospital,
    );
    s.client.set_dispute_timeout(&s.admin, &500u64);
    s.env.ledger().with_mut(|l| l.timestamp += 1_000);
}

// ── process_expired_disputes cancels the linked request ────────────────────────

#[test]
fn test_process_expired_disputes_cancels_linked_request() {
    let s = setup(true);
    s.env.ledger().with_mut(|l| l.timestamp = 1_000);
    let request_id = new_request(&s);
    let pid = s
        .client
        .create_escrow(&request_id, &s.hospital, &s.payee, &1_000i128, &s.token);
    dispute_and_expire(&s, pid);

    let refunded = s
        .client
        .process_expired_disputes(&s.admin, &soroban_sdk::vec![&s.env, pid]);
    assert_eq!(refunded.len(), 1);
    assert_eq!(count_request_cancelled_events(&s.env, &s.payment_id), 1);

    assert_eq!(s.client.get_payment(&pid).status, PaymentStatus::Refunded);
    assert_eq!(
        s.requests.get_request(&request_id).status,
        RequestStatus::Cancelled
    );
}

#[test]
fn test_process_expired_disputes_no_cancel_event_when_cancellation_fails() {
    // Requests contract does not trust the payments contract, so the
    // cross-contract cancellation is rejected.
    let s = setup(false);
    s.env.ledger().with_mut(|l| l.timestamp = 1_000);
    let request_id = new_request(&s);
    let pid = s
        .client
        .create_escrow(&request_id, &s.hospital, &s.payee, &1_000i128, &s.token);
    dispute_and_expire(&s, pid);

    let refunded = s
        .client
        .process_expired_disputes(&s.admin, &soroban_sdk::vec![&s.env, pid]);
    assert_eq!(refunded.len(), 1);
    assert_eq!(count_request_cancelled_events(&s.env, &s.payment_id), 0);

    // Refund still goes through; the request is untouched.
    assert_eq!(s.client.get_payment(&pid).status, PaymentStatus::Refunded);
    assert_eq!(
        s.requests.get_request(&request_id).status,
        RequestStatus::Pending
    );
}

#[test]
fn test_cancel_request_by_contract_rejects_untrusted_caller() {
    let s = setup(true);
    let request_id = new_request(&s);
    let result = s.requests.try_cancel_request_by_contract(
        &Address::generate(&s.env),
        &request_id,
        &String::from_str(&s.env, "nope"),
    );
    assert!(result.is_err());
    assert_eq!(
        s.requests.get_request(&request_id).status,
        RequestStatus::Pending
    );
}

// ── Stale two-party confirmations ──────────────────────────────────────────────

#[test]
fn test_dispute_clears_confirmations_and_pre_dispute_receipt_cannot_be_reused() {
    let s = setup(true);
    let request_id = new_request(&s);
    let pid = s
        .client
        .create_escrow(&request_id, &s.hospital, &s.payee, &1_000i128, &s.token);

    // 1. Hospital confirms receipt.
    s.client.confirm_receipt(&pid, &s.hospital);

    // 2. Hospital then disputes.
    s.client.record_dispute(
        &pid,
        &DisputeReason::DamagedGoods,
        &String::from_str(&s.env, "case-2"),
        &s.hospital,
    );
    s.env.as_contract(&s.payment_id, || {
        assert!(!s.env.storage().persistent().has(&hosp_ok_key(pid)));
        assert!(!s.env.storage().persistent().has(&coord_ok_key(pid)));
    });

    // 3. Admin re-opens the payment, 4. then confirms as coordinator.
    s.client.update_status(&pid, &PaymentStatus::Locked, &s.admin);
    s.client.release_escrow(&s.admin, &pid);

    // The pre-dispute hospital confirmation must not release funds.
    assert_eq!(s.client.get_payment(&pid).status, PaymentStatus::Locked);
    let token = soroban_sdk::token::Client::new(&s.env, &s.token);
    assert_eq!(token.balance(&s.payee), 0);

    // A fresh hospital confirmation completes the release.
    s.client.confirm_receipt(&pid, &s.hospital);
    assert_eq!(s.client.get_payment(&pid).status, PaymentStatus::Released);
    assert_eq!(token.balance(&s.payee), 1_000);
}

#[test]
fn test_refund_escrow_clears_confirmations() {
    let s = setup(true);
    let request_id = new_request(&s);
    let pid = s
        .client
        .create_escrow(&request_id, &s.hospital, &s.payee, &1_000i128, &s.token);
    s.client.confirm_receipt(&pid, &s.hospital);
    s.client.refund_escrow(&s.admin, &pid);
    s.env.as_contract(&s.payment_id, || {
        assert!(!s.env.storage().persistent().has(&hosp_ok_key(pid)));
    });
}

// ── Mandatory requests contract ────────────────────────────────────────────────

#[test]
fn test_constructors_require_requests_contract_and_admin_can_set_it() {
    let s = setup(true);
    let request_id = new_request(&s);
    let requests_id = s.client.get_requests_contract().unwrap();

    // Fresh payments contract initialised without a requests contract.
    let cid = s.env.register(PaymentContract, ());
    let client = PaymentContractClient::new(&s.env, &cid);
    client.initialize(&s.admin, &None);
    client.add_allowed_token(&s.admin, &s.token);
    assert_eq!(client.get_requests_contract(), None);

    let payer = Address::generate(&s.env);
    assert_eq!(
        client.try_create_payment(&request_id, &payer, &s.payee, &100i128),
        Err(Ok(Error::RequestsContractNotSet))
    );
    assert_eq!(
        client.try_create_escrow(&request_id, &s.hospital, &s.payee, &100i128, &s.token),
        Err(Ok(Error::RequestsContractNotSet))
    );

    // Non-admin cannot set it.
    let attacker = Address::generate(&s.env);
    assert_eq!(
        client.try_set_requests_contract(&attacker, &requests_id),
        Err(Ok(Error::Unauthorized))
    );

    client.set_requests_contract(&s.admin, &requests_id);
    assert_eq!(client.get_requests_contract(), Some(requests_id));

    // Escrow against a nonexistent request is now rejected...
    assert_eq!(
        client.try_create_escrow(&9_999u64, &s.hospital, &s.payee, &100i128, &s.token),
        Err(Ok(Error::RequestNotFound))
    );
    // ...and a real one succeeds.
    client.create_escrow(&request_id, &s.hospital, &s.payee, &100i128, &s.token);
}

// ── Batch-size caps ────────────────────────────────────────────────────────────

#[test]
fn test_batch_create_payments_rejects_oversized_batch() {
    let s = setup(true);
    let payer = Address::generate(&s.env);
    let mut batch = Vec::new(&s.env);
    for i in 0..(MAX_BATCH_SIZE as u64 + 1) {
        batch.push_back((i + 1, payer.clone(), s.payee.clone(), 100i128));
    }
    assert_eq!(
        s.client.try_batch_create_payments(&batch),
        Err(Ok(Error::BatchTooLarge))
    );
}

#[test]
fn test_process_expired_disputes_rejects_oversized_batch() {
    let s = setup(true);
    let mut ids = Vec::new(&s.env);
    for i in 0..(MAX_BATCH_SIZE as u64 + 1) {
        ids.push_back(i + 1);
    }
    assert_eq!(
        s.client.try_process_expired_disputes(&s.admin, &ids),
        Err(Ok(Error::BatchTooLarge))
    );
}
