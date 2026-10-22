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
    let ttl = instance_ttl(&env, &id);
    assert!(
        ttl >= INSTANCE_BUMP_TO,
        "instance TTL should be extended to INSTANCE_BUMP_TO on initialize, got {}",
        ttl
    );
}

#[test]
fn test_instance_ttl_rebumped_on_get_config() {
    let (env, _, id, client) = setup_with_id();
    age_past_bump_threshold(&env);

    let cfg = client.get_config();
    assert!(cfg.admin == Address::generate(&env) || !cfg.admin.to_string().is_empty());

    let ttl = instance_ttl(&env, &id);
    assert!(
        ttl >= INSTANCE_BUMP_TO,
        "instance TTL should be re-extended when get_config reads Config, got {}",
        ttl
    );
}

#[test]
fn test_instance_ttl_rebumped_on_metric_ingestion() {
    // Each ingestion path goes through require_authorized_caller -> require_admin
    // -> require_initialized, so a single bump on the config read covers them.
    for record in 0..4u32 {
        let (env, _, id, client) = setup_with_id();
        age_past_bump_threshold(&env);

        match record {
            0 => client.record_donation(),
            1 => client.record_request(),
            2 => client.record_delivery(),
            _ => client.record_payment_released(&250_i128),
        }

        let ttl = instance_ttl(&env, &id);
        assert!(
            ttl >= INSTANCE_BUMP_TO,
            "ingestion path {} should re-extend the instance TTL, got {}",
            record,
            ttl
        );
    }
}

#[test]
fn test_instance_ttl_rebumped_on_every_config_read_path() {
    // get_snapshot is included last because it needs a populated period bucket;
    // a bare index would return PeriodNotFound before reaching the assertion.
    let paths: [fn(&AnalyticsContractClient, &Env); 4] = [
        |c, _| {
            c.get_current_snapshot();
        },
        |c, _| {
            c.get_lifetime_totals();
        },
        |c, _| {
            c.get_config();
        },
        |c, env| {
            let idx = env.ledger().timestamp() / 86_400;
            let _ = c.get_snapshot(&PeriodType::Daily, &idx);
        },
    ];

    for (idx, path) in paths.iter().enumerate() {
        let (env, _, id, client) = setup_with_id();
        client.record_donation();
        age_past_bump_threshold(&env);

        path(&client, &env);

        let ttl = instance_ttl(&env, &id);
        assert!(
            ttl >= INSTANCE_BUMP_TO,
            "read path {} should re-extend the instance TTL, got {}",
            idx,
            ttl
        );
    }
}

#[test]
fn test_instance_ttl_rebumped_on_set_reporting_period() {
    let (env, _, id, client) = setup_with_id();
    age_past_bump_threshold(&env);

    client.set_reporting_period(&PeriodType::Weekly);

    let ttl = instance_ttl(&env, &id);
    assert!(
        ttl >= INSTANCE_BUMP_TO,
        "instance TTL should be re-extended when set_reporting_period writes Config, got {}",
        ttl
    );
}

#[test]
fn test_instance_ttl_rebumped_on_is_initialized() {
    // is_initialized reads the instance entry directly instead of going through
    // require_initialized, so it needs its own bump.
    let (env, _, id, client) = setup_with_id();
    age_past_bump_threshold(&env);

    assert!(client.is_initialized());

    let ttl = instance_ttl(&env, &id);
    assert!(
        ttl >= INSTANCE_BUMP_TO,
        "is_initialized should re-extend the instance TTL, got {}",
        ttl
    );
}

#[test]
fn test_config_reads_still_succeed_after_extended_idle_period() {
    // End-to-end shape of the reported bug: a long idle stretch followed by a
    // read. The contract stays available instead of erroring as uninitialized.
    let (env, admin, client) = setup();

    for _ in 0..3 {
        age_past_bump_threshold(&env);
        let cfg = client.get_config();
        assert_eq!(cfg.admin, admin);
        assert_eq!(cfg.reporting_period.duration_secs, 86_400);
    }

    // A write path after the same idle stretch must also stay live.
    age_past_bump_threshold(&env);
    client.record_donation();
    assert_eq!(client.get_lifetime_totals().total_donations, 1);
}

#[test]
fn test_ttl_bump_does_not_mask_not_initialized() {
    // Negative path: the bump must not create the instance entry or make the
    // initialization guard pass. Every config-dependent entry point must still
    // return NotInitialized on a fresh, uninitialized contract.
    let env = Env::default();
    env.mock_all_auths();
    let id = env.register(AnalyticsContract, ());
    let client = AnalyticsContractClient::new(&env, &id);

    assert_eq!(
        client.try_record_donation(),
        Err(Ok(AnalyticsError::NotInitialized))
    );
    assert_eq!(
        client.try_record_request(),
        Err(Ok(AnalyticsError::NotInitialized))
    );
    assert_eq!(
        client.try_record_delivery(),
        Err(Ok(AnalyticsError::NotInitialized))
    );
    assert_eq!(
        client.try_record_payment_released(&10_i128),
        Err(Ok(AnalyticsError::NotInitialized))
    );
    assert_eq!(
        client.try_get_current_snapshot(),
        Err(Ok(AnalyticsError::NotInitialized))
    );
    assert_eq!(
        client.try_get_snapshot(&PeriodType::Daily, &0u64),
        Err(Ok(AnalyticsError::NotInitialized))
    );
    assert_eq!(
        client.try_get_lifetime_totals(),
        Err(Ok(AnalyticsError::NotInitialized))
    );
    assert_eq!(
        client.try_get_config(),
        Err(Ok(AnalyticsError::NotInitialized))
    );
}

#[test]
fn test_ttl_bump_does_not_bypass_admin_auth() {
    // require_admin reads Config (and now bumps TTL) before checking auth, so
    // confirm the bump did not weaken the authorization check.
    let env = Env::default();
    env.mock_all_auths();
    let id = env.register(AnalyticsContract, ());

    let admin = Address::generate(&env);
    let dummy = Address::generate(&env);
    let init_client = AnalyticsContractClient::new(&env, &id);
    init_client.initialize(&admin, &dummy, &dummy, &dummy, &dummy);

    // Drop every mocked authorization, so the admin check inside
    // require_admin has nothing to satisfy.
    env.set_auths(&[]);

    let client = AnalyticsContractClient::new(&env, &id);
    let result = client.try_set_reporting_period(&PeriodType::Weekly);
    assert!(
        result.is_err(),
        "set_reporting_period must still require admin auth, got {:?}",
        result
    );
    // The config must be untouched by the rejected call.
    assert_eq!(client.get_config().reporting_period.duration_secs, 86_400);
}
