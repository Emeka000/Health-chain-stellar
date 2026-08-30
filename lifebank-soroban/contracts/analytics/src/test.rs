#![cfg(test)]

use soroban_sdk::{testutils::Address as _, Address, Env};

use super::{AnalyticsContract, AnalyticsContractClient, AnalyticsError, PeriodType};

fn setup<'a>() -> (Env, Address, AnalyticsContractClient<'a>) {
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

    (env, admin, client)
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
    client.record_donation();
    client.record_donation();

    let snap = client.get_current_snapshot();
    assert_eq!(snap.total_donations, 2);

    let totals = client.get_lifetime_totals();
    assert_eq!(totals.total_donations, 2);
}

#[test]
fn test_record_request_increments_counters() {
    let (_, _, client) = setup();
    client.record_request();

    let snap = client.get_current_snapshot();
    assert_eq!(snap.total_requests, 1);
}

#[test]
fn test_record_delivery_increments_counters() {
    let (_, _, client) = setup();
    client.record_delivery();

    let snap = client.get_current_snapshot();
    assert_eq!(snap.total_deliveries, 1);
}

#[test]
fn test_record_payment_released_increments_counters() {
    let (_, _, client) = setup();
    client.record_payment_released(&500_i128);
    client.record_payment_released(&300_i128);

    let snap = client.get_current_snapshot();
    assert_eq!(snap.total_payments_released, 2);
    assert_eq!(snap.total_volume, 800);

    let totals = client.get_lifetime_totals();
    assert_eq!(totals.total_volume, 800);
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

    client.record_donation();
    let daily_snapshot = client.get_current_snapshot();
    assert_eq!(daily_snapshot.total_donations, 1);

    client.set_reporting_period(&PeriodType::Weekly);
    client.record_donation();
    let weekly_snapshot = client.get_current_snapshot();
    assert_eq!(
        weekly_snapshot.total_donations, 1,
        "Weekly snapshot should be isolated from the Daily snapshot bucket, not blended with it"
    );
}

#[test]
fn test_get_snapshot_returns_correct_period() {
    let (env, _, client) = setup();
    client.record_donation();

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
    let result = client.try_record_donation();
    assert_eq!(result, Err(Ok(AnalyticsError::NotInitialized)));
}
