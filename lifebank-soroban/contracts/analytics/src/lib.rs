#![no_std]

mod error;
mod types;

#[cfg(test)]
mod test;

pub use error::AnalyticsError;
pub use types::{AnalyticsConfig, DataKey, MetricsSnapshot, PeriodType, ReportingPeriod};

use soroban_sdk::{contract, contractimpl, symbol_short, Address, Env};

// ── Constants ─────────────────────────────────────────────────────────────────

const DAILY_SECS: u64 = 86_400;
const WEEKLY_SECS: u64 = 604_800;
const MONTHLY_SECS: u64 = 2_592_000; // 30 days

// ── Storage helpers ───────────────────────────────────────────────────────────

fn require_initialized(env: &Env) -> Result<AnalyticsConfig, AnalyticsError> {
    env.storage()
        .instance()
        .get(&DataKey::Config)
        .ok_or(AnalyticsError::NotInitialized)
}

fn require_admin(env: &Env) -> Result<AnalyticsConfig, AnalyticsError> {
    let cfg = require_initialized(env)?;
    cfg.admin.require_auth();
    Ok(cfg)
}

fn current_period_index(env: &Env, duration_secs: u64) -> u64 {
    env.ledger().timestamp() / duration_secs
}

fn load_snapshot(env: &Env, period_index: u64) -> MetricsSnapshot {
    env.storage()
        .persistent()
        .get(&DataKey::Snapshot(period_index))
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

fn save_snapshot(env: &Env, snapshot: &MetricsSnapshot) {
    env.storage()
        .persistent()
        .set(&DataKey::Snapshot(snapshot.period_index), snapshot);
}

fn get_counter_u64(env: &Env, key: &DataKey) -> u64 {
    env.storage().instance().get(key).unwrap_or(0u64)
}

fn get_counter_i128(env: &Env, key: &DataKey) -> i128 {
    env.storage().instance().get(key).unwrap_or(0i128)
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

        // Initialize lifetime counters to zero.
        env.storage()
            .instance()
            .set(&DataKey::TotalDonations, &0u64);
        env.storage().instance().set(&DataKey::TotalRequests, &0u64);
        env.storage()
            .instance()
            .set(&DataKey::TotalDeliveries, &0u64);
        env.storage()
            .instance()
            .set(&DataKey::TotalPaymentsReleased, &0u64);
        env.storage().instance().set(&DataKey::TotalVolume, &0i128);

        env.events().publish(
            (
                symbol_short!("anlytcs"),
                symbol_short!("init"),
                symbol_short!("v1"),
            ),
            admin,
        );

        Ok(())
    }

    // ── Configuration ─────────────────────────────────────────────────────────

    /// Update the reporting period. Admin only.
    pub fn set_reporting_period(env: Env, period_type: PeriodType) -> Result<(), AnalyticsError> {
        let mut cfg = require_admin(&env)?;

        let duration_secs = match period_type {
            PeriodType::Daily => DAILY_SECS,
            PeriodType::Weekly => WEEKLY_SECS,
            PeriodType::Monthly => MONTHLY_SECS,
        };

        cfg.reporting_period = ReportingPeriod {
            period_type,
            duration_secs,
            configured_at: env.ledger().timestamp(),
        };

        env.storage().instance().set(&DataKey::Config, &cfg);
        Ok(())
    }

    // ── Metric ingestion ──────────────────────────────────────────────────────

    /// Record a new donation. Admin only.
    pub fn record_donation(env: Env) -> Result<(), AnalyticsError> {
        let cfg = require_admin(&env)?;
        let idx = current_period_index(&env, cfg.reporting_period.duration_secs);
        let mut snap = load_snapshot(&env, idx);
        snap.total_donations += 1;
        snap.last_updated = env.ledger().timestamp();
        save_snapshot(&env, &snap);

        let total = get_counter_u64(&env, &DataKey::TotalDonations) + 1;
        env.storage()
            .instance()
            .set(&DataKey::TotalDonations, &total);
        Ok(())
    }

    /// Record a new blood request. Admin only.
    pub fn record_request(env: Env) -> Result<(), AnalyticsError> {
        let cfg = require_admin(&env)?;
        let idx = current_period_index(&env, cfg.reporting_period.duration_secs);
        let mut snap = load_snapshot(&env, idx);
        snap.total_requests += 1;
        snap.last_updated = env.ledger().timestamp();
        save_snapshot(&env, &snap);

        let total = get_counter_u64(&env, &DataKey::TotalRequests) + 1;
        env.storage()
            .instance()
            .set(&DataKey::TotalRequests, &total);
        Ok(())
    }

    /// Record a completed delivery. Admin only.
    pub fn record_delivery(env: Env) -> Result<(), AnalyticsError> {
        let cfg = require_admin(&env)?;
        let idx = current_period_index(&env, cfg.reporting_period.duration_secs);
        let mut snap = load_snapshot(&env, idx);
        snap.total_deliveries += 1;
        snap.last_updated = env.ledger().timestamp();
        save_snapshot(&env, &snap);

        let total = get_counter_u64(&env, &DataKey::TotalDeliveries) + 1;
        env.storage()
            .instance()
            .set(&DataKey::TotalDeliveries, &total);
        Ok(())
    }

    /// Record a released payment with its amount. Admin only.
    pub fn record_payment_released(env: Env, amount: i128) -> Result<(), AnalyticsError> {
        let cfg = require_admin(&env)?;
        let idx = current_period_index(&env, cfg.reporting_period.duration_secs);
        let mut snap = load_snapshot(&env, idx);
        snap.total_payments_released += 1;
        snap.total_volume += amount;
        snap.last_updated = env.ledger().timestamp();
        save_snapshot(&env, &snap);

        let total_payments = get_counter_u64(&env, &DataKey::TotalPaymentsReleased) + 1;
        env.storage()
            .instance()
            .set(&DataKey::TotalPaymentsReleased, &total_payments);

        let total_volume = get_counter_i128(&env, &DataKey::TotalVolume) + amount;
        env.storage()
            .instance()
            .set(&DataKey::TotalVolume, &total_volume);
        Ok(())
    }

    // ── Queries ───────────────────────────────────────────────────────────────

    /// Get the metrics snapshot for the current period.
    pub fn get_current_snapshot(env: Env) -> Result<MetricsSnapshot, AnalyticsError> {
        let cfg = require_initialized(&env)?;
        let idx = current_period_index(&env, cfg.reporting_period.duration_secs);
        Ok(load_snapshot(&env, idx))
    }

    /// Get the metrics snapshot for a specific period index.
    pub fn get_snapshot(env: Env, period_index: u64) -> Result<MetricsSnapshot, AnalyticsError> {
        require_initialized(&env)?;
        env.storage()
            .persistent()
            .get(&DataKey::Snapshot(period_index))
            .ok_or(AnalyticsError::PeriodNotFound)
    }

    /// Get lifetime totals across all periods.
    pub fn get_lifetime_totals(env: Env) -> Result<MetricsSnapshot, AnalyticsError> {
        require_initialized(&env)?;
        Ok(MetricsSnapshot {
            period_index: u64::MAX,
            total_donations: get_counter_u64(&env, &DataKey::TotalDonations),
            total_requests: get_counter_u64(&env, &DataKey::TotalRequests),
            total_deliveries: get_counter_u64(&env, &DataKey::TotalDeliveries),
            total_payments_released: get_counter_u64(&env, &DataKey::TotalPaymentsReleased),
            total_volume: get_counter_i128(&env, &DataKey::TotalVolume),
            last_updated: env.ledger().timestamp(),
        })
    }

    /// Get the current contract configuration.
    pub fn get_config(env: Env) -> Result<AnalyticsConfig, AnalyticsError> {
        require_initialized(&env)
    }

    pub fn is_initialized(env: Env) -> bool {
        env.storage().instance().has(&DataKey::Config)
    }
}
