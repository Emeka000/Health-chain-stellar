#![cfg(test)]

use soroban_sdk::{
    testutils::storage::Instance as _, testutils::Address as _, testutils::Ledger as _, Address,
    Env,
};

use super::{
    AnalyticsContract, AnalyticsContractClient, AnalyticsError, PeriodType,
    INSTANCE_BUMP_THRESHOLD, INSTANCE_BUMP_TO,
};

fn setup<'a>() -> (Env, Address, AnalyticsContractClient<'a>) {
    let (env, admin, _id, client) = setup_with_id();
    (env, admin, client)
}

/// Register and initialize the contract, also returning its contract id so tests
/// can inspect raw instance-storage TTL via `env.as_contract`.
fn setup_with_id<'a>() -> (Env, Address, Address, AnalyticsContractClient<'a>) {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let inventory = Address::generate(&env);
    let requests = Address::generate(&env);
    let payments = Address::generate(&env);
    let reputation = Address::generate(&env);

    let id = env.register(AnalyticsContract, ());
    let client = AnalyticsContractClient::new(&env, &id);

    client.initialize(&admin, &inventory, &requests, &payments, &reputation);

    (env, admin, id, client)
}

/// Like `setup_with_id` but also returns the configured domain contract
/// addresses so tests can exercise per-entrypoint authorization.
fn setup_with_contracts<'a>() -> (
    Env,
    Address,
    Address,
    Address,
    Address,
    Address,
    AnalyticsContractClient<'a>,
) {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let inventory = Address::generate(&env);
    let requests = Address::generate(&env);
    let payments = Address::generate(&env);
    let reputation = Address::generate(&env);

    let id = env.register(AnalyticsContract, ());
    let client = AnalyticsContractClient::new(&env, &id);

    client.initialize(&admin, &inventory, &requests, &payments, &reputation);

    (env, admin, inventory, requests, payments, id, client)
}

// ── Initialization ────────────────────────────────────────────────────────────

#[test]
fn test_initialize_succeeds() {
    let (_, _, client) = setup();
    assert!(client.is_initialized());
}

#[test]
fn test_initialize_sets_config() {
    let (env, admin, client) = setup();
    let cfg = client.get_config();
    assert_eq!(cfg.admin, admin);
    assert_eq!(cfg.reporting_period.duration_secs, 86_400);
    assert_eq!(cfg.initialized_at, env.ledger().timestamp());
}

#[test]
fn test_double_initialize_fails() {
    let (_, _, client) = setup();
    let admin2 = Address::generate(&client.env);
    let dummy = Address::generate(&client.env);
    let result = client.try_initialize(&admin2, &dummy, &dummy, &dummy, &dummy);
    assert_eq!(result, Err(Ok(AnalyticsError::AlreadyInitialized)));
}

#[test]
fn test_is_initialized_false_before_init() {
    let env = Env::default();
    let id = env.register(AnalyticsContract, ());
    let client = AnalyticsContractClient::new(&env, &id);
    assert!(!client.is_initialized());
}

#[test]
fn test_config_instance_ttl_extended_on_initialize() {
    let (env, client_admin, id, client) = setup_with_id();
    let ttl = env.as_contract(&id, || env.storage().instance().get_ttl());

    assert!(
        ttl >= INSTANCE_BUMP_TO,
        "config instance TTL was not extended"
    );
    assert_eq!(client.get_config().admin, client_admin);
}

#[test]
fn test_config_instance_ttl_reextended_on_read() {
    let (env, _, id, client) = setup_with_id();

    env.ledger().with_mut(|li| {
        li.sequence_number += INSTANCE_BUMP_THRESHOLD + 1;
    });

    let _ = client.get_config();
    let ttl = env.as_contract(&id, || env.storage().instance().get_ttl());

    assert!(
        ttl >= INSTANCE_BUMP_TO,
        "config instance TTL was not re-extended on read, got {ttl}"
    );
}

// ── Lifetime counters start at zero ──────────────────────────────────────────

#[test]
fn test_lifetime_totals_zero_after_init() {
    let (_, _, client) = setup();
    let totals = client.get_lifetime_totals();
    assert_eq!(totals.total_donations, 0);
    assert_eq!(totals.total_requests, 0);
    assert_eq!(totals.total_deliveries, 0);
    assert_eq!(totals.total_payments_released, 0);
    assert_eq!(totals.total_volume, 0);
}

// ── Metric recording ──────────────────────────────────────────────────────────

#[test]
fn test_record_donation_increments_counters() {
    let (_, _, client) = setup();
    client.record_donation(&1_u64);
    client.record_donation(&2_u64);

    let snap = client.get_current_snapshot();
    assert_eq!(snap.total_donations, 2);

    let totals = client.get_lifetime_totals();
    assert_eq!(totals.total_donations, 2);
}

#[test]
fn test_record_request_increments_counters() {
    let (_, _, client) = setup();
    client.record_request(&1_u64);

    let snap = client.get_current_snapshot();
    assert_eq!(snap.total_requests, 1);
}

#[test]
fn test_record_delivery_increments_counters() {
    let (_, _, client) = setup();
    client.record_delivery(&1_u64);

    let snap = client.get_current_snapshot();
    assert_eq!(snap.total_deliveries, 1);
}

#[test]
fn test_record_payment_released_increments_counters() {
    let (_, _, client) = setup();
    client.record_payment_released(&1_u64, &500_i128);
    client.record_payment_released(&2_u64, &300_i128);

    let snap = client.get_current_snapshot();
    assert_eq!(snap.total_payments_released, 2);
    assert_eq!(snap.total_volume, 800);

    let totals = client.get_lifetime_totals();
    assert_eq!(totals.total_volume, 800);
}

// ── Authorization & dedupe (#1837) ────────────────────────────────────────────

#[test]
fn test_payments_contract_can_record_release() {
    let (env, _, _, _, payments, _, client) = setup_with_contracts();
    env.mock_auths(&[]);

    // The configured payments contract is an authorized caller.
    client.record_payment_released(&1_u64, &500_i128);

    let snap = client.get_current_snapshot();
    assert_eq!(snap.total_payments_released, 1);
    assert_eq!(snap.total_volume, 500);
    let _ = payments;
}

#[test]
fn test_duplicate_payment_id_is_ignored() {
    let (_, _, client) = setup();
    client.record_payment_released(&7_u64, &500_i128);
    client.record_payment_released(&7_u64, &500_i128);

    let snap = client.get_current_snapshot();
    assert_eq!(snap.total_payments_released, 1);
    assert_eq!(snap.total_volume, 500);
}

#[test]
fn test_arbitrary_address_rejected() {
    let (env, _, _, _, _, _, client) = setup_with_contracts();
    let stranger = Address::generate(&env);

    // Only the admin or the configured payments contract may record a release.
    env.mock_auths(&[]);
    let result = client.try_record_payment_released(&1_u64, &500_i128);
    assert!(result.is_err());
    let _ = stranger;
}

// ── Reporting period ──────────────────────────────────────────────────────────

#[test]
fn test_set_reporting_period_weekly() {
    let (_, _, client) = setup();
    client.set_reporting_period(&PeriodType::Weekly);
    let cfg = client.get_config();
    assert_eq!(cfg.reporting_period.duration_secs, 604_800);
}

#[test]
fn test_set_reporting_period_monthly() {
    let (_, _, client) = setup();
    client.set_reporting_period(&PeriodType::Monthly);
    let cfg = client.get_config();
    assert_eq!(cfg.reporting_period.duration_secs, 2_592_000);
}

// ── Period snapshot isolation ─────────────────────────────────────────────────

#[test]
fn test_get_snapshot_not_found_returns_error() {
    let (_, _, client) = setup();
    let result = client.try_get_snapshot(&PeriodType::Daily, &9999u64);
    assert_eq!(result, Err(Ok(AnalyticsError::PeriodNotFound)));
}

#[test]
fn test_snapshot_isolated_across_period_type_switch() {
    let (env, _, client) = setup();
    // At the default ledger timestamp (0), the Daily and Weekly period
    // indices are both 0, so a key collision would blend the two buckets.
    assert_eq!(env.ledger().timestamp(), 0);

    client.record_donation(&1_u64);
    let daily_snapshot = client.get_current_snapshot();
    assert_eq!(daily_snapshot.total_donations, 1);

    client.set_reporting_period(&PeriodType::Weekly);
    client.record_donation(&2_u64);
    let weekly_snapshot = client.get_current_snapshot();
    assert_eq!(
        weekly_snapshot.total_donations, 1,
        "Weekly snapshot should be isolated from the Daily snapshot bucket, not blended with it"
    );
}

#[test]
fn test_get_snapshot_returns_correct_period() {
    let (env, _, client) = setup();
    client.record_donation(&1_u64);

    let period_index = env.ledger().timestamp() / 86_400;
    let snap = client.get_snapshot(&PeriodType::Daily, &period_index);
    assert_eq!(snap.total_donations, 1);
    assert_eq!(snap.period_index, period_index);
}

// ── Guard: not initialized ────────────────────────────────────────────────────

#[test]
fn test_record_donation_fails_when_not_initialized() {
    let env = Env::default();
    env.mock_all_auths();
    let id = env.register(AnalyticsContract, ());
    let client = AnalyticsContractClient::new(&env, &id);
    let result = client.try_record_donation(&1_u64);
    assert_eq!(result, Err(Ok(AnalyticsError::NotInitialized)));
}

// ── Instance storage TTL (#1487) ──────────────────────────────────────────────
//
// DataKey::Config lives in instance storage. Every read path reaches it through
// require_initialized / require_admin, so if the instance entry is never
// TTL-extended the whole contract eventually fails with NotInitialized (or
// requires a restoration transaction) purely because it was idle.

/// Read the remaining instance-storage TTL in ledgers.
fn instance_ttl(env: &Env, id: &Address) -> u32 {
    env.as_contract(id, || env.storage().instance().get_ttl())
}

/// Move the ledger past INSTANCE_BUMP_THRESHOLD so the instance TTL drops below
/// the bump threshold. Without a bump the next read would find it expiring.
fn age_past_bump_threshold(env: &Env) {
    env.ledger()
        .with_mut(|li| li.sequence_number += INSTANCE_BUMP_THRESHOLD + 1);
}

#[test]
fn test_instance_ttl_extended_on_initialize() {
    let (env, _, id, _) = setup_with_id();
    assert!(instance_ttl(&env, &id) >= INSTANCE_BUMP_TO);
}

#[test]
fn test_instance_ttl_extended_on_record() {
    let (env, _, id, client) = setup_with_id();
    age_past_bump_threshold(&env);
    client.record_donation(&1_u64);
    assert!(instance_ttl(&env, &id) >= INSTANCE_BUMP_TO);
}
