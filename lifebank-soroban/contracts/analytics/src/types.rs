use soroban_sdk::{contracttype, Address};

/// Reporting period granularity.
#[contracttype]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum PeriodType {
    Daily,
    Weekly,
    /// A fixed 30-day rolling window, NOT a calendar month. Calendar months
    /// are 28-31 days, so periods will not align with month boundaries and
    /// will drift by up to ~5 days per year.
    Monthly,
}

/// A single reporting period window.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ReportingPeriod {
    pub period_type: PeriodType,
    /// Duration in seconds (e.g. 86400 for daily).
    pub duration_secs: u64,
    /// Ledger timestamp when this period configuration was set.
    pub configured_at: u64,
}

/// Aggregate metrics snapshot for a given period bucket.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct MetricsSnapshot {
    /// Period bucket index (floor(timestamp / duration_secs)).
    pub period_index: u64,
    pub total_donations: u64,
    pub total_requests: u64,
    pub total_deliveries: u64,
    pub total_payments_released: u64,
    /// Sum of payment amounts released (smallest units).
    pub total_volume: i128,
    pub last_updated: u64,
}

/// Contract-level configuration stored at initialization.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct AnalyticsConfig {
    pub admin: Address,
    pub inventory_contract: Address,
    pub requests_contract: Address,
    pub payments_contract: Address,
    pub reputation_contract: Address,
    pub reporting_period: ReportingPeriod,
    pub initialized_at: u64,
}

/// Storage keys.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum DataKey {
    /// AnalyticsConfig — instance storage.
    Config,
    /// MetricsSnapshot keyed by (period_type, period_index) — persistent
    /// storage. period_type is included so that switching the reporting
    /// period granularity can never collide two different-sized buckets
    /// that happen to share the same numeric period_index.
    Snapshot(PeriodType, u64),
    /// Global lifetime counters — instance storage.
    TotalDonations,
    TotalRequests,
    TotalDeliveries,
    TotalPaymentsReleased,
    TotalVolume,
}
