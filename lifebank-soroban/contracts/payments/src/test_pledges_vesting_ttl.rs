#![cfg(test)]

//! Regression tests for:
//! - #1802: per-donor pledge index, bounded pledge strings, pledge status event.
//! - #1803: cliff vesting accrues from the start, no silent overflow, admin
//!   revoke, several concurrent schedules per donor, reward-token allowlist.
//! - #1804: payment records and index entries are TTL-bumped on read.

use super::*;
use request_contract::{
    BloodComponent, BloodType, RequestContract, RequestContractClient, Urgency,
};
use soroban_sdk::{
    testutils::Address as _, testutils::Events as _, testutils::Ledger as _, Address, Env, Symbol,
    TryFromVal, Val,
};

extern crate std;
use std::string::String as StdString;

// ── helpers ──────────────────────────────────────────────────────────────────

fn setup_admin<'a>() -> (Env, PaymentContractClient<'a>, Address) {
    let env = Env::default();
    env.mock_all_auths();
    let cid = env.register(PaymentContract, ());
    let client = PaymentContractClient::new(&env, &cid);
    let admin = Address::generate(&env);
    client.initialize(&admin, &None);
    (env, client, admin)
}

/// A reward token minted to `admin` and added to the allowlist.
fn reward_token(
    env: &Env,
    client: &PaymentContractClient,
    admin: &Address,
    amount: i128,
) -> Address {
    let token_id = env
        .register_stellar_asset_contract_v2(admin.clone())
        .address();
    soroban_sdk::token::StellarAssetClient::new(env, &token_id).mint(admin, &amount);
    client.add_allowed_token(admin, &token_id);
    token_id
}

fn balance(env: &Env, token: &Address, who: &Address) -> i128 {
    soroban_sdk::token::Client::new(env, token).balance(who)
}

fn set_time(env: &Env, t: u64) {
    env.ledger().with_mut(|l| l.timestamp = t);
}

fn s(env: &Env, v: &str) -> String {
    String::from_str(env, v)
}

// ── #1803: vesting model ─────────────────────────────────────────────────────

/// 12 "months" of 100s with a 3-month cliff.
const DURATION: u64 = 1_200;
const CLIFF: u64 = 300;
const TOTAL: i128 = 1_200_000;
const START: u64 = 10_000;

#[test]
fn test_vesting_releases_accrued_share_at_cliff() {
    let (env, client, admin) = setup_admin();
    let donor = Address::generate(&env);
    let token = reward_token(&env, &client, &admin, TOTAL);
    set_time(&env, START);
    let sid = client.create_vesting(&admin, &donor, &token, &TOTAL, &CLIFF, &DURATION);

    let schedule = client.get_vesting(&donor, &sid);
    assert_eq!(schedule.start_timestamp, START);
    assert_eq!(schedule.cliff_timestamp, START + CLIFF);
    assert_eq!(schedule.vest_end_timestamp, START + DURATION);

    // One second before the cliff nothing is claimable.
    set_time(&env, START + CLIFF - 1);
    assert_eq!(client.get_claimable_vested(&donor, &sid), 0);
    assert_eq!(
        client.try_claim_vested(&donor, &sid),
        Err(Ok(Error::CliffNotReached))
    );

    // At the cliff 3/12 of the total is released at once.
    set_time(&env, START + CLIFF);
    assert_eq!(client.get_claimable_vested(&donor, &sid), TOTAL / 4);
    assert_eq!(client.claim_vested(&donor, &sid), TOTAL / 4);
    assert_eq!(balance(&env, &token, &donor), TOTAL / 4);
}

#[test]
fn test_vesting_mid_schedule_and_end() {
    let (env, client, admin) = setup_admin();
    let donor = Address::generate(&env);
    let token = reward_token(&env, &client, &admin, TOTAL);
    set_time(&env, START);
    let sid = client.create_vesting(&admin, &donor, &token, &TOTAL, &CLIFF, &DURATION);

    set_time(&env, START + CLIFF);
    assert_eq!(client.claim_vested(&donor, &sid), 300_000);

    // Half-way: 6/12 vested in total, 3/12 already claimed.
    set_time(&env, START + DURATION / 2);
    assert_eq!(client.claim_vested(&donor, &sid), 300_000);
    assert_eq!(client.get_vesting(&donor, &sid).claimed, 600_000);

    // End: the remainder, and the schedule is closed.
    set_time(&env, START + DURATION);
    assert_eq!(client.claim_vested(&donor, &sid), 600_000);
    assert_eq!(balance(&env, &token, &donor), TOTAL);
    assert_eq!(client.get_vesting_reserve(&token), 0);
    assert_eq!(
        client.try_get_vesting(&donor, &sid),
        Err(Ok(Error::VestingNotFound))
    );
}

#[test]
fn test_vesting_large_total_does_not_silently_vest_zero() {
    // `total * elapsed` overflows i128 here; the old code turned that into 0
    // and the donor got NothingToClaim until vest_end.
    let total: i128 = i128::MAX / 2;
    let (env, client, admin) = setup_admin();
    let donor = Address::generate(&env);
    let token = reward_token(&env, &client, &admin, total);
    set_time(&env, START);
    let sid = client.create_vesting(&admin, &donor, &token, &total, &0u64, &1_000u64);

    set_time(&env, START + 500);
    assert_eq!(client.claim_vested(&donor, &sid), total / 2);

    set_time(&env, START + 1_000);
    assert_eq!(client.claim_vested(&donor, &sid), total - total / 2);
}

#[test]
fn test_vested_amount_is_exact() {
    let schedule = |total: i128| VestingSchedule {
        id: 1,
        donor: Address::generate(&Env::default()),
        reward_token: Address::generate(&Env::default()),
        total_amount: total,
        start_timestamp: 0,
        cliff_timestamp: 0,
        vest_end_timestamp: 7,
        claimed: 0,
        revoked: false,
    };
    // Matches the naive `total * now / duration` wherever that doesn't overflow.
    for total in [1i128, 6, 7, 13, 1_000, 1_000_003, i128::MAX / 7] {
        for now in 0..=7u64 {
            assert_eq!(
                vested_amount(&schedule(total), now),
                Ok(total * now as i128 / 7),
                "total={total} now={now}"
            );
        }
    }
    // Where the naive product overflows, the result is still in range and
    // the full amount vests at the end.
    let max = schedule(i128::MAX);
    assert_eq!(vested_amount(&max, 7), Ok(i128::MAX));
    let mid = vested_amount(&max, 3).unwrap();
    let floor = (i128::MAX / 7) * 3;
    assert!(mid >= floor && mid <= floor + 3, "mid={mid}");
}

#[test]
fn test_vesting_rejects_token_not_on_allowlist() {
    let (env, client, admin) = setup_admin();
    let donor = Address::generate(&env);
    let token = env
        .register_stellar_asset_contract_v2(admin.clone())
        .address();
    soroban_sdk::token::StellarAssetClient::new(&env, &token).mint(&admin, &1_000);

    assert_eq!(
        client.try_create_vesting(&admin, &donor, &token, &1_000i128, &0u64, &100u64),
        Err(Ok(Error::TokenNotAllowed))
    );
    assert_eq!(balance(&env, &token, &admin), 1_000);
}

// ── #1803: concurrent schedules ──────────────────────────────────────────────

#[test]
fn test_two_concurrent_vesting_schedules_for_one_donor() {
    let (env, client, admin) = setup_admin();
    let donor = Address::generate(&env);
    let token = reward_token(&env, &client, &admin, 3_000);
    set_time(&env, START);

    let first = client.create_vesting(&admin, &donor, &token, &1_000i128, &0u64, &100u64);
    // A second reward round while the first is still unclaimed.
    let second = client.create_vesting(&admin, &donor, &token, &2_000i128, &50u64, &200u64);
    assert_ne!(first, second);
    assert_eq!(client.get_vesting_reserve(&token), 3_000);

    set_time(&env, START + 50);
    // first: 50/100 of 1_000; second: at its cliff, 50/200 of 2_000.
    assert_eq!(client.claim_vested(&donor, &first), 500);
    assert_eq!(client.claim_vested(&donor, &second), 500);

    set_time(&env, START + 100);
    assert_eq!(client.claim_vested(&donor, &first), 500);
    assert_eq!(
        client.try_get_vesting(&donor, &first),
        Err(Ok(Error::VestingNotFound))
    );
    // Closing the first schedule leaves the second untouched.
    let other = client.get_vesting(&donor, &second);
    assert_eq!(other.claimed, 500);
    assert_eq!(other.total_amount, 2_000);

    set_time(&env, START + 200);
    assert_eq!(client.claim_vested(&donor, &second), 1_500);
    assert_eq!(balance(&env, &token, &donor), 3_000);
    assert_eq!(client.get_vesting_reserve(&token), 0);
}

#[test]
fn test_vesting_schedule_is_bound_to_its_donor() {
    let (env, client, admin) = setup_admin();
    let donor = Address::generate(&env);
    let other = Address::generate(&env);
    let token = reward_token(&env, &client, &admin, 1_000);
    set_time(&env, START);
    let sid = client.create_vesting(&admin, &donor, &token, &1_000i128, &0u64, &100u64);

    set_time(&env, START + 100);
    assert_eq!(
        client.try_claim_vested(&other, &sid),
        Err(Ok(Error::VestingNotFound))
    );
}

// ── #1803: revoke ────────────────────────────────────────────────────────────

#[test]
fn test_revoke_vesting_returns_unvested_and_keeps_vested_claimable() {
    let (env, client, admin) = setup_admin();
    let donor = Address::generate(&env);
    let token = reward_token(&env, &client, &admin, TOTAL);
    set_time(&env, START);
    let sid = client.create_vesting(&admin, &donor, &token, &TOTAL, &CLIFF, &DURATION);
    assert_eq!(balance(&env, &token, &admin), 0);

    set_time(&env, START + CLIFF);
    assert_eq!(client.claim_vested(&donor, &sid), 300_000);

    // Revoke half-way: 600_000 vested (300_000 of it unclaimed), 600_000 unvested.
    set_time(&env, START + DURATION / 2);
    assert_eq!(client.revoke_vesting(&admin, &donor, &sid), 600_000);
    assert_eq!(balance(&env, &token, &admin), 600_000);
    assert_eq!(client.get_vesting_reserve(&token), 300_000);

    let schedule = client.get_vesting(&donor, &sid);
    assert!(schedule.revoked);
    assert_eq!(schedule.total_amount, 600_000);

    // Nothing more accrues after revocation…
    set_time(&env, START + DURATION);
    assert_eq!(client.get_claimable_vested(&donor, &sid), 300_000);
    // …but what had vested is still the donor's.
    assert_eq!(client.claim_vested(&donor, &sid), 300_000);
    assert_eq!(balance(&env, &token, &donor), 600_000);
    assert_eq!(client.get_vesting_reserve(&token), 0);
    assert_eq!(
        client.try_get_vesting(&donor, &sid),
        Err(Ok(Error::VestingNotFound))
    );
}

#[test]
fn test_revoke_vesting_before_cliff_returns_everything() {
    let (env, client, admin) = setup_admin();
    let donor = Address::generate(&env);
    let token = reward_token(&env, &client, &admin, TOTAL);
    set_time(&env, START);
    let sid = client.create_vesting(&admin, &donor, &token, &TOTAL, &CLIFF, &DURATION);

    set_time(&env, START + CLIFF - 1);
    assert_eq!(client.revoke_vesting(&admin, &donor, &sid), TOTAL);
    assert_eq!(balance(&env, &token, &admin), TOTAL);
    assert_eq!(client.get_vesting_reserve(&token), 0);
    assert_eq!(
        client.try_claim_vested(&donor, &sid),
        Err(Ok(Error::VestingNotFound))
    );
}

#[test]
fn test_revoke_vesting_guards() {
    let (env, client, admin) = setup_admin();
    let donor = Address::generate(&env);
    let token = reward_token(&env, &client, &admin, 2_000);
    set_time(&env, START);
    let sid = client.create_vesting(&admin, &donor, &token, &1_000i128, &0u64, &100u64);

    // Only the admin may revoke.
    assert_eq!(
        client.try_revoke_vesting(&Address::generate(&env), &donor, &sid),
        Err(Ok(Error::Unauthorized))
    );
    // Unknown schedule.
    assert_eq!(
        client.try_revoke_vesting(&admin, &donor, &99u64),
        Err(Ok(Error::VestingNotFound))
    );

    set_time(&env, START + 50);
    client.revoke_vesting(&admin, &donor, &sid);
    assert_eq!(
        client.try_revoke_vesting(&admin, &donor, &sid),
        Err(Ok(Error::VestingRevoked))
    );

    // A fully vested schedule has nothing left to revoke.
    let sid2 = client.create_vesting(&admin, &donor, &token, &1_000i128, &0u64, &100u64);
    set_time(&env, START + 50 + 100);
    assert_eq!(
        client.try_revoke_vesting(&admin, &donor, &sid2),
        Err(Ok(Error::NothingToRevoke))
    );
}

// ── #1802: pledges ───────────────────────────────────────────────────────────

fn pledge(env: &Env, client: &PaymentContractClient, donor: &Address) -> u64 {
    client.create_pledge(
        donor,
        &100i128,
        &86_400u64,
        &s(env, "pool-a"),
        &s(env, "trauma"),
        &s(env, "lagos"),
        &false,
    )
}

#[test]
fn test_get_pledges_by_donor_paginates_own_pledges() {
    let (env, client, _) = setup_admin();
    let alice = Address::generate(&env);
    let bob = Address::generate(&env);

    let a1 = pledge(&env, &client, &alice);
    let b1 = pledge(&env, &client, &bob);
    let a2 = pledge(&env, &client, &alice);
    let a3 = pledge(&env, &client, &alice);

    let page0 = client.get_pledges_by_donor(&alice, &0, &2);
    assert_eq!(page0.total, 3);
    assert_eq!(page0.page_size, 2);
    assert_eq!(page0.items.len(), 2);
    assert_eq!(page0.items.get(0).unwrap().id, a1);
    assert_eq!(page0.items.get(1).unwrap().id, a2);

    let page1 = client.get_pledges_by_donor(&alice, &1, &2);
    assert_eq!(page1.items.len(), 1);
    assert_eq!(page1.items.get(0).unwrap().id, a3);

    assert_eq!(client.get_pledges_by_donor(&alice, &2, &2).items.len(), 0);

    let bobs = client.get_pledges_by_donor(&bob, &0, &0);
    assert_eq!(bobs.total, 1);
    assert_eq!(bobs.page_size, 20);
    assert_eq!(bobs.items.get(0).unwrap().id, b1);

    let none = client.get_pledges_by_donor(&Address::generate(&env), &0, &10);
    assert_eq!(none.total, 0);
    assert_eq!(none.items.len(), 0);
}

#[test]
fn test_create_pledge_rejects_over_length_strings() {
    let (env, client, _) = setup_admin();
    let donor = Address::generate(&env);
    let max: StdString = "x".repeat(MAX_PLEDGE_STRING_LEN as usize);
    let long: StdString = "x".repeat(MAX_PLEDGE_STRING_LEN as usize + 1);
    let ok = s(&env, &max);
    let too_long = s(&env, &long);

    for (pool, cause, region) in [
        (&too_long, &ok, &ok),
        (&ok, &too_long, &ok),
        (&ok, &ok, &too_long),
    ] {
        assert_eq!(
            client.try_create_pledge(&donor, &100i128, &86_400u64, pool, cause, region, &false),
            Err(Ok(Error::StringTooLong))
        );
    }
    assert_eq!(client.get_pledges_by_donor(&donor, &0, &10).total, 0);

    // Exactly at the limit is accepted.
    let id = client.create_pledge(&donor, &100i128, &86_400u64, &ok, &ok, &ok, &false);
    assert_eq!(client.get_pledge(&id).cause.len(), MAX_PLEDGE_STRING_LEN);
}

/// The `("pledge", "status")` events published by the last invocation.
fn pledge_status_events(env: &Env, contract: &Address) -> std::vec::Vec<(u64, Address, bool)> {
    let pledge = Symbol::new(env, "pledge");
    let status = Symbol::new(env, "status");
    let mut out = std::vec::Vec::new();
    for (addr, topics, data) in env.events().all().iter() {
        if addr != *contract || topics.len() != 2 {
            continue;
        }
        let t0 = Symbol::try_from_val(env, &topics.get(0).unwrap());
        let t1 = Symbol::try_from_val(env, &topics.get(1).unwrap());
        if t0 == Ok(pledge.clone()) && t1 == Ok(status.clone()) {
            let fields = Vec::<Val>::try_from_val(env, &data).unwrap();
            out.push((
                u64::try_from_val(env, &fields.get(0).unwrap()).unwrap(),
                Address::try_from_val(env, &fields.get(1).unwrap()).unwrap(),
                bool::try_from_val(env, &fields.get(2).unwrap()).unwrap(),
            ));
        }
    }
    out
}

#[test]
fn test_set_pledge_active_emits_status_event() {
    let (env, client, _) = setup_admin();
    let donor = Address::generate(&env);
    let id = pledge(&env, &client, &donor);

    client.set_pledge_active(&id, &donor, &false);
    assert_eq!(
        pledge_status_events(&env, &client.address),
        std::vec![(id, donor.clone(), false)]
    );
    assert!(!client.get_pledge(&id).active);

    client.set_pledge_active(&id, &donor, &true);
    assert_eq!(
        pledge_status_events(&env, &client.address),
        std::vec![(id, donor.clone(), true)]
    );

    // Setting the same value again changes nothing and emits nothing.
    client.set_pledge_active(&id, &donor, &true);
    assert!(pledge_status_events(&env, &client.address).is_empty());
}

// ── #1804: TTL bumped on read ────────────────────────────────────────────────
//
// The test host transparently restores an expired persistent entry on access
// (with the minimum TTL) instead of failing as the network does, so these
// tests assert on each entry's remaining TTL rather than on a failed read.

/// Further than the bump threshold, but within one bump of the last access.
const LEDGER_STEP: u32 = PERSISTENT_BUMP_TO - 100_000;

fn advance_ledgers(env: &Env, n: u32) {
    env.ledger().with_mut(|l| l.sequence_number += n);
}

fn ttl<K>(env: &Env, contract: &Address, key: &K) -> u32
where
    K: soroban_sdk::IntoVal<Env, Val>,
{
    use soroban_sdk::testutils::storage::Persistent as _;
    env.as_contract(contract, || env.storage().persistent().get_ttl(key))
}

#[test]
fn test_payment_records_and_index_pages_survive_past_ttl_when_read() {
    let env = Env::default();
    env.mock_all_auths();
    let cid = env.register(PaymentContract, ());
    let client = PaymentContractClient::new(&env, &cid);
    let req_id = env.register(RequestContract, ());
    let requests = RequestContractClient::new(&env, &req_id);
    let admin = Address::generate(&env);
    requests.initialize(&admin, &Address::generate(&env));
    client.initialize(&admin, &Some(req_id));
    let hospital = Address::generate(&env);
    requests.authorize_hospital(&hospital);

    let mut ids = std::vec::Vec::new();
    let mut request_ids = std::vec::Vec::new();
    let payee = Address::generate(&env);
    for _ in 0..3 {
        let request_id = requests.create_request(
            &hospital,
            &BloodType::OPositive,
            &BloodComponent::WholeBlood,
            &250u32,
            &Urgency::Routine,
            &(env.ledger().timestamp() + 3_600),
        );
        ids.push(client.create_payment(&request_id, &hospital, &payee, &100i128));
        request_ids.push(request_id);
    }

    let pending = status_code(PaymentStatus::Pending);
    // Every entry the read paths below depend on.
    let assert_all_ttl = |expected: u32| {
        for (i, id) in ids.iter().enumerate() {
            let pos = i as u32;
            assert_eq!(ttl(&env, &cid, &payment_key(*id)), expected, "payment {id}");
            assert_eq!(
                ttl(&env, &cid, &IndexKey::PayerAt(hospital.clone(), pos)),
                expected
            );
            assert_eq!(
                ttl(&env, &cid, &IndexKey::PayeeAt(payee.clone(), pos)),
                expected
            );
            assert_eq!(ttl(&env, &cid, &IndexKey::StatusAt(pending, pos)), expected);
            assert_eq!(
                ttl(&env, &cid, &IndexKey::StatusPos(pending, *id)),
                expected
            );
        }
        assert_eq!(
            ttl(&env, &cid, &IndexKey::PayerLen(hospital.clone())),
            expected
        );
        assert_eq!(
            ttl(&env, &cid, &IndexKey::PayeeLen(payee.clone())),
            expected
        );
        assert_eq!(ttl(&env, &cid, &IndexKey::StatusLen(pending)), expected);
        assert_eq!(ttl(&env, &cid, &req_idx_key(request_ids[0])), expected);
        assert_eq!(
            ttl(&env, &cid, &request_timeline_key(request_ids[1])),
            expected
        );
    };

    let read_everything = || {
        for id in ids.iter() {
            assert_eq!(client.get_payment(id).id, *id);
        }
        assert_eq!(client.get_payment_by_request(&request_ids[0]).id, ids[0]);
        let by_payer = client.get_payments_by_payer(&hospital, &0, &10);
        assert_eq!((by_payer.total, by_payer.items.len()), (3, 3));
        let by_payee = client.get_payments_by_payee(&payee, &0, &10);
        assert_eq!((by_payee.total, by_payee.items.len()), (3, 3));
        let by_status = client.get_payments_by_status(&PaymentStatus::Pending, &0, &10);
        assert_eq!((by_status.total, by_status.items.len()), (3, 3));
        assert_eq!(
            client.get_payment_timeline(&request_ids[1], &0, &10).len(),
            1
        );
    };

    assert_all_ttl(PERSISTENT_BUMP_TO);

    // Three times further than the TTL any entry got when it was written.
    // Without bump-on-read every entry would expire after the second step.
    for _ in 0..3 {
        advance_ledgers(&env, LEDGER_STEP);
        // Still live (not expired-and-restored with the minimum TTL)…
        assert_all_ttl(PERSISTENT_BUMP_TO - LEDGER_STEP);
        read_everything();
        // …and reading pushed every entry back out to the full TTL.
        assert_all_ttl(PERSISTENT_BUMP_TO);
    }

    // The status index stays consistent for a later transition.
    client.update_status(&ids[0], &PaymentStatus::Cancelled, &admin);
    let pending_page = client.get_payments_by_status(&PaymentStatus::Pending, &0, &10);
    assert_eq!((pending_page.total, pending_page.items.len()), (2, 2));
}

#[test]
fn test_pledge_and_vesting_records_bumped_on_read() {
    let (env, client, admin) = setup_admin();
    let donor = Address::generate(&env);
    let token = reward_token(&env, &client, &admin, 1_000);
    let pid = pledge(&env, &client, &donor);
    let sid = client.create_vesting(&admin, &donor, &token, &1_000i128, &0u64, &10u64);
    let cid = client.address.clone();

    advance_ledgers(&env, LEDGER_STEP);
    assert_eq!(client.get_pledges_by_donor(&donor, &0, &10).items.len(), 1);
    client.get_vesting(&donor, &sid);
    client.get_vesting_reserve(&token);

    assert_eq!(ttl(&env, &cid, &pledge_key(pid)), PERSISTENT_BUMP_TO);
    assert_eq!(
        ttl(&env, &cid, &IndexKey::DonorPledgeLen(donor.clone())),
        PERSISTENT_BUMP_TO
    );
    assert_eq!(
        ttl(&env, &cid, &IndexKey::DonorPledgeAt(donor.clone(), 0)),
        PERSISTENT_BUMP_TO
    );
    assert_eq!(
        ttl(&env, &cid, &vesting_key(&donor, sid)),
        PERSISTENT_BUMP_TO
    );
    assert_eq!(
        ttl(&env, &cid, &vesting_reserve_key(&token)),
        PERSISTENT_BUMP_TO
    );
}
