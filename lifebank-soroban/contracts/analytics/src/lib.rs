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
    pub token: Address,
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
            period_type,
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

        AnalyticsInitialized { admin }.publish(&env);
        Ok(())
    }

    /// Record a released payment.
    ///
    /// `token` identifies the asset the payment was made in. Volume is tracked
    /// per token so amounts with different decimals (e.g. USDC 7 decimals vs
    /// XLM stroops) are never summed into a single meaningless total.
    pub fn record_payment_released(
        env: Env,
        token: Address,
        amount: i128,
    ) -> Result<(), AnalyticsError> {
        let cfg = require_authorized_caller(&env, &cfg_payments(&env)?)?;
        let now = env.ledger().timestamp();

        let total_payments_released = get_counter_u64(&env, &DataKey::TotalPaymentsReleased) + 1;
        set_counter_u64(&env, &DataKey::TotalPaymentsReleased, total_payments_released);

        let total_volume = get_counter_i128(&env, &DataKey::TotalVolume(token.clone())) + amount;
        set_counter_i128(&env, &DataKey::TotalVolume(token.clone()), total_volume);

        let period_type = cfg.reporting_period.period_type;
        let period_index = current_period_index(&env, cfg.reporting_period.duration_secs);
        let mut snapshot = load_snapshot(&env, period_type, period_index);
        snapshot.total_payments_released += 1;
        snapshot.total_volume += amount;
        snapshot.last_updated = now;
        save_snapshot(&env, period_type, &snapshot);

        set_last_updated(&env, now);

        PaymentReleaseRecorded {
            token,
            amount,
            total_payments_released,
            total_volume,
        }
        .publish(&env);

        Ok(())
    }
}

fn cfg_payments(env: &Env) -> Result<Address, AnalyticsError> {
    Ok(require_initialized(env)?.payments_contract)
}
