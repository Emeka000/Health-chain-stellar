#![no_std]
#![deny(deprecated)]

mod error;
mod types;

#[cfg(test)]
mod test;

pub use error::AnalyticsError;
pub use types::{AnalyticsConfig, DataKey, MetricsSnapshot, PeriodType, ReportingPeriod};

use soroban_sdk::{contract, contractevent, contractimpl, Address, BytesN, Env};

#[contractevent(topics = ["anlytcs", "init"], data_format = "single-value")]
pub struct AnalyticsInitialized {
    pub admin: Address,
}

#[contractevent(topics = ["anlytcs", "donation"], data_format = "single-value")]
pub struct DonationRecorded {
    pub total_donations: u64,
}

#[contractevent(topics = ["anlytcs", "request"], data_format = "single-value")]
pub struct RequestRecorded {
    pub total_requests: u64,
}

#[contractevent(topics = ["anlytcs", "delivery"], data_format = "single-value")]
pub struct DeliveryRecorded {
    pub total_deliveries: u64,
}

#[contractevent(topics = ["anlytcs", "payment"], data_format = "vec")]
pub struct PaymentReleaseRecorded {
    pub amount: i128,
    pub total_payments_released: u64,
    pub total_volume: i128,
}

#[contractevent(topics = ["anlytcs", "period"], data_format = "vec")]
pub struct ReportingPeriodUpdated {
    pub period_type: PeriodType,
    pub duration_secs: u64,
}

#[contractevent(topics = ["anlytcs", "upgraded"], data_format = "single-value")]
pub struct ContractUpgraded {
    pub new_wasm_hash: BytesN<32>,
}

#[contractevent(topics = ["anlytcs", "admprop"], data_format = "single-value")]
pub struct AdminProposed {
    pub new_admin: Address,
}

#[contractevent(topics = ["anlytcs", "admacc"], data_format = "single-value")]
pub struct AdminChanged {
    pub new_admin: Address,
}

// ── Constants ─────────────────────────────────────────────────────────────────

const CONTRACT_VERSION: u32 = 1;
const DAILY_SECS: u64 = 86_400;
const WEEKLY_SECS: u64 = 604_800;
// Calendar months are 28-31 days, so this is a fixed 30-day rolling window,
// not a calendar month. It does not align with month boundaries and drifts
// by up to ~5 days per year. See PeriodType::Monthly.
const THIRTY_DAY_WINDOW_SECS: u64 = 2_592_000; // 30 days

// TTL bounds for snapshot persistent entries (~17 days min, ~365 days max in ledgers at ~5s/ledger)
const SNAPSHOT_TTL_MIN: u32 = 290_000;
const SNAPSHOT_TTL_MAX: u32 = 6_307_200;

// TTL constants for the instance-storage entry that holds AnalyticsConfig
// (in ledgers; ~5 s each). Mirrors the PERSISTENT_BUMP_THRESHOLD /
// PERSISTENT_BUMP_TO pair used by the payments contract so both contracts
// share one bump policy.
const INSTANCE_BUMP_THRESHOLD: u32 = 518_400; // ~30 days
const INSTANCE_BUMP_TO: u32 = 1_036_800; // ~60 days

// ── Storage helpers ───────────────────────────────────────────────────────────

/// Extend instance-storage TTL using the same threshold/extend-to as persistent
/// writes. Instance storage holds the config key; without an explicit bump the
/// entire contract instance can be archived, which makes every function that
/// reads config fail even though the contract was correctly initialized.
fn extend_instance_ttl(env: &Env) {
    env.storage()
        .instance()
        .extend_ttl(INSTANCE_BUMP_THRESHOLD, INSTANCE_BUMP_TO);
}

fn require_initialized(env: &Env) -> Result<AnalyticsConfig, AnalyticsError> {
    let config = env
        .storage()
        .instance()
        .get(&DataKey::Config)
        .ok_or(AnalyticsError::NotInitialized)?;
    extend_instance_ttl(env);
    Ok(config)
}

fn require_admin(env: &Env) -> Result<AnalyticsConfig, AnalyticsError> {
    let cfg = require_initialized(env)?;
    cfg.admin.require_auth();
    Ok(cfg)
}

/// Authorize a `record_*` caller.
///
/// Accepts either the admin or the configured domain contract that is allowed
/// to report the given metric. The caller must present its own signature; the
/// configured contract addresses are the only non-admin callers permitted.
fn require_authorized_caller(
    env: &Env,
    allowed_contract: &Address,
) -> Result<AnalyticsConfig, AnalyticsError> {
    let cfg = require_initialized(env)?;
    allowed_contract.require_auth();
    Ok(cfg)
}

/// Returns true if `id` has already been recorded for the given metric key.
fn is_recorded(env: &Env, key: &DataKey) -> bool {
    env.storage().persistent().has(key)
}

/// Mark `id` as recorded for the given metric key and bump its TTL.
fn mark_recorded(env: &Env, key: &DataKey) {
    env.storage().persistent().set(key, &true);
    env.storage()
        .persistent()
        .extend_ttl(key, SNAPSHOT_TTL_MIN, SNAPSHOT_TTL_MAX);
}

fn current_period_index(env: &Env, duration_secs: u64) -> u64 {
    env.ledger().timestamp() / duration_secs
}

fn load_snapshot(env: &Env, period_type: PeriodType, period_index: u64) -> MetricsSnapshot {
    env.storage()
        .persistent()
        .get(&DataKey::Snapshot(period_type, period_index))
        .unwrap_or(MetricsSnapshot {
            period_index,
            total_donations: 0,
            total_requests: 0,
            total_deliveries: 0,
            total_payments_released: 0,
            total_volume: 0,
            last_updated: 0,
        })
}

fn save_snapshot(env: &Env, period_type: PeriodType, snapshot: &MetricsSnapshot) {
    let key = DataKey::Snapshot(period_type, snapshot.period_index);
    env.storage().persistent().set(&key, snapshot);
    env.storage()
        .persistent()
        .extend_ttl(&key, SNAPSHOT_TTL_MIN, SNAPSHOT_TTL_MAX);
}

fn get_counter_u64(env: &Env, key: &DataKey) -> u64 {
    env.storage().persistent().get(key).unwrap_or(0u64)
}

fn get_counter_i128(env: &Env, key: &DataKey) -> i128 {
    env.storage().persistent().get(key).unwrap_or(0i128)
}

fn set_counter_u64(env: &Env, key: &DataKey, value: u64) {
    env.storage().persistent().set(key, &value);
    env.storage()
        .persistent()
        .extend_ttl(key, SNAPSHOT_TTL_MIN, SNAPSHOT_TTL_MAX);
}

fn set_counter_i128(env: &Env, key: &DataKey, value: i128) {
    env.storage().persistent().set(key, &value);
    env.storage()
        .persistent()
        .extend_ttl(key, SNAPSHOT_TTL_MIN, SNAPSHOT_TTL_MAX);
}

/// Read the timestamp of the last actual metric write.
///
/// Returns 0 when no metric has ever been recorded, so callers can
/// distinguish "never updated" from a genuine ingestion timestamp.
fn get_last_updated(env: &Env) -> u64 {
    env.storage()
        .persistent()
        .get(&DataKey::LastUpdated)
        .unwrap_or(0u64)
}

/// Persist the timestamp of the last actual metric write.
fn set_last_updated(env: &Env, timestamp: u64) {
    env.storage()
        .persistent()
        .set(&DataKey::LastUpdated, &timestamp);
    env.storage().persistent().extend_ttl(
        &DataKey::LastUpdated,
        SNAPSHOT_TTL_MIN,
        SNAPSHOT_TTL_MAX,
    );
}

// ── Contract ──────────────────────────────────────────────────────────────────

#[contract]
pub struct AnalyticsContract;

#[contractimpl]
impl AnalyticsContract {
    /// Initialize the analytics contract.
    ///
    /// Links all domain contracts, sets the default reporting period (daily),
    /// and zeroes all lifetime counters. Can only be called once.
    pub fn initialize(
        env: Env,
        admin: Address,
        inventory_contract: Address,
        requests_contract: Address,
        payments_contract: Address,
        reputation_contract: Address,
    ) -> Result<(), AnalyticsError> {
        admin.require_auth();

        if env.storage().instance().has(&DataKey::Config) {
            return Err(AnalyticsError::AlreadyInitialized);
        }

        let now = env.ledger().timestamp();

        let config = AnalyticsConfig {
            admin: admin.clone(),
            inventory_contract,
            requests_contract,
            payments_contract,
            reputation_contract,
            reporting_period: ReportingPeriod {
                period_type: PeriodType::Daily,
                duration_secs: DAILY_SECS,
                configured_at: now,
            },
            initialized_at: now,
        };

        env.storage().instance().set(&DataKey::Config, &config);
        extend_instance_ttl(&env);

        // Initialize lifetime counters to zero in persistent storage.
        set_counter_u64(&env, &DataKey::TotalDonations, 0u64);
        set_counter_u64(&env, &DataKey::TotalRequests, 0u64);
        set_counter_u64(&env, &DataKey::TotalDeliveries, 0u64);
        set_counter_u64(&env, &DataKey::TotalPaymentsReleased, 0u64);
        set_counter_i128(&env, &DataKey::TotalVolume, 0i128);
        set_last_updated(&env, 0u64);

        // No metric has been recorded yet; last_updated starts at 0.

        AnalyticsInitialized { admin }.publish(&env);

        Ok(())
    }

    /// Record a donation. Callable by the admin or the configured inventory
    /// contract. A second record for the same `donation_id` is ignored.
    pub fn record_donation(env: Env, donation_id: u64) -> Result<(), AnalyticsError> {
        let cfg = require_initialized(&env)?;
        require_authorized_caller(&env, &cfg.inventory_contract)?;

        let dedupe_key = DataKey::RecordedDonation(donation_id);
        if is_recorded(&env, &dedupe_key) {
            return Ok(());
        }
        mark_recorded(&env, &dedupe_key);

        let total = get_counter_u64(&env, &DataKey::TotalDonations) + 1;
        set_counter_u64(&env, &DataKey::TotalDonations, total);
        set_last_updated(&env, env.ledger().timestamp());

        DonationRecorded {
            total_donations: total,
        }
        .publish(&env);
        Ok(())
    }

    /// Record a request. Callable by the admin or the configured requests
    /// contract. A second record for the same `request_id` is ignored.
    pub fn record_request(env: Env, request_id: u64) -> Result<(), AnalyticsError> {
        let cfg = require_initialized(&env)?;
        require_authorized_caller(&env, &cfg.requests_contract)?;

        let dedupe_key = DataKey::RecordedRequest(request_id);
        if is_recorded(&env, &dedupe_key) {
            return Ok(());
        }
        mark_recorded(&env, &dedupe_key);

        let total = get_counter_u64(&env, &DataKey::TotalRequests) + 1;
        set_counter_u64(&env, &DataKey::TotalRequests, total);
        set_last_updated(&env, env.ledger().timestamp());

        RequestRecorded {
            total_requests: total,
        }
        .publish(&env);
        Ok(())
    }

    /// Record a delivery. Callable by the admin or the configured inventory
    /// contract. A second record for the same `delivery_id` is ignored.
    pub fn record_delivery(env: Env, delivery_id: u64) -> Result<(), AnalyticsError> {
        let cfg = require_initialized(&env)?;
        require_authorized_caller(&env, &cfg.inventory_contract)?;

        let dedupe_key = DataKey::RecordedDelivery(delivery_id);
        if is_recorded(&env, &dedupe_key) {
            return Ok(());
        }
        mark_recorded(&env, &dedupe_key);

        let total = get_counter_u64(&env, &DataKey::TotalDeliveries) + 1;
        set_counter_u64(&env, &DataKey::TotalDeliveries, total);
        set_last_updated(&env, env.ledger().timestamp());

        DeliveryRecorded {
            total_deliveries: total,
        }
        .publish(&env);
        Ok(())
    }

    /// Record a payment release. Callable by the admin or the configured
    /// payments contract. A second record for the same `payment_id` is ignored.
    pub fn record_payment_released(
        env: Env,
        payment_id: u64,
        amount: i128,
    ) -> Result<(), AnalyticsError> {
        let cfg = require_initialized(&env)?;
        require_authorized_caller(&env, &cfg.payments_contract)?;

        let dedupe_key = DataKey::RecordedPayment(payment_id);
        if is_recorded(&env, &dedupe_key) {
            return Ok(());
        }
        mark_recorded(&env, &dedupe_key);

        let total = get_counter_u64(&env, &DataKey::TotalPaymentsReleased) + 1;
        set_counter_u64(&env, &DataKey::TotalPaymentsReleased, total);

        let volume = get_counter_i128(&env, &DataKey::TotalVolume) + amount;
        set_counter_i128(&env, &DataKey::TotalVolume, volume);
        set_last_updated(&env, env.ledger().timestamp());

        PaymentReleaseRecorded {
            amount,
            total_payments_released: total,
            total_volume: volume,
        }
        .publish(&env);
        Ok(())
    }

    // ── Admin / config ────────────────────────────────────────────────────────

    /// Update the reporting period. Admin only.
    pub fn set_reporting_period(
        env: Env,
        period_type: PeriodType,
        duration_secs: u64,
    ) -> Result<(), AnalyticsError> {
        let mut cfg = require_admin(&env)?;

        cfg.reporting_period = ReportingPeriod {
            period_type: period_type.clone(),
            duration_secs,
            configured_at: env.ledger().timestamp(),
        };
        env.storage().instance().set(&DataKey::Config, &cfg);
        extend_instance_ttl(&env);

        ReportingPeriodUpdated {
            period_type,
            duration_secs,
        }
        .publish(&env);
        Ok(())
    }

    /// Upgrade the contract wasm. Admin only.
    pub fn upgrade(env: Env, new_wasm_hash: BytesN<32>) -> Result<(), AnalyticsError> {
        require_admin(&env)?;
        env.deployer()
            .update_current_contract_wasm(new_wasm_hash.clone());
        ContractUpgraded { new_wasm_hash }.publish(&env);
        Ok(())
    }

    /// Propose a new admin. Admin only; the new admin must accept.
    pub fn propose_admin(env: Env, new_admin: Address) -> Result<(), AnalyticsError> {
        require_admin(&env)?;
        env.storage()
            .instance()
            .set(&DataKey::PendingAdmin, &new_admin);
        extend_instance_ttl(&env);
        AdminProposed {
            new_admin: new_admin.clone(),
        }
        .publish(&env);
        Ok(())
    }

    /// Accept the pending admin role. Callable only by the proposed admin.
    pub fn accept_admin(env: Env) -> Result<(), AnalyticsError> {
        let mut cfg = require_initialized(&env)?;
        let pending: Address = env
            .storage()
            .instance()
            .get(&DataKey::PendingAdmin)
            .ok_or(AnalyticsError::NotInitialized)?;
        pending.require_auth();

        cfg.admin = pending.clone();
        env.storage().instance().set(&DataKey::Config, &cfg);
        env.storage().instance().remove(&DataKey::PendingAdmin);
        extend_instance_ttl(&env);

        AdminChanged { new_admin: pending }.publish(&env);
        Ok(())
    }

    // ── Read-only ─────────────────────────────────────────────────────────────

    /// Return the current lifetime counters.
    pub fn get_metrics(env: Env) -> Result<MetricsSnapshot, AnalyticsError> {
        require_initialized(&env)?;
        Ok(MetricsSnapshot {
            period_index: current_period_index(&env, DAILY_SECS),
            total_donations: get_counter_u64(&env, &DataKey::TotalDonations),
            total_requests: get_counter_u64(&env, &DataKey::TotalRequests),
            total_deliveries: get_counter_u64(&env, &DataKey::TotalDeliveries),
            total_payments_released: get_counter_u64(&env, &DataKey::TotalPaymentsReleased),
            total_volume: get_counter_i128(&env, &DataKey::TotalVolume),
            last_updated: get_last_updated(&env),
        })
    }

    /// Return the stored config.
    pub fn get_config(env: Env) -> Result<AnalyticsConfig, AnalyticsError> {
        require_initialized(&env)
    }

    /// Return the contract version.
    pub fn version(_env: Env) -> u32 {
        CONTRACT_VERSION
    }
}
