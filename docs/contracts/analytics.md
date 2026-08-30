# Analytics Contract

**Location:** `lifebank-soroban/contracts/analytics/src/lib.rs`  
**Purpose:** Aggregates protocol-wide metrics into rolling time-window snapshots (daily, weekly, monthly). Domain contracts call this contract to record donation, request, delivery, and payment events; external callers query the snapshots for dashboards and reporting.

---

## Public Interface

### Initialization

| Function | Parameters | Returns | Auth |
|---|---|---|---|
| `initialize` | `env, admin, inventory_contract, requests_contract, payments_contract, reputation_contract` | `Result<(), AnalyticsError>` | `admin` |

### Metrics Recording (called by domain contracts)

| Function | Parameters | Returns | Auth |
|---|---|---|---|
| `record_donation` | `env, amount: u64` | `Result<(), AnalyticsError>` | Authorized caller |
| `record_request` | `env` | `Result<(), AnalyticsError>` | Authorized caller |
| `record_delivery` | `env` | `Result<(), AnalyticsError>` | Authorized caller |
| `record_payment_released` | `env, volume: u64` | `Result<(), AnalyticsError>` | Authorized caller |

### Query

| Function | Parameters | Returns | Auth |
|---|---|---|---|
| `get_snapshot` | `env, period: PeriodType` | `Result<MetricsSnapshot, AnalyticsError>` | Public |
| `get_reporting_period` | `env, period: PeriodType` | `ReportingPeriod` | Public |

---

## Storage Layout

| Key | Storage Tier | TTL | Description |
|---|---|---|---|
| `DataKey::Config` | Instance | Instance lifetime | `AnalyticsConfig` (admin + contract addresses) |
| `DataKey::Snapshot(period_index)` | Persistent | Min ~17 days, max ~365 days | `MetricsSnapshot` for the given period index |

### TTL Constants (in ledgers, at ~5 s/ledger)

| Constant | Ledgers | Wall-clock |
|---|---|---|
| `SNAPSHOT_TTL_MIN` | 290 000 | ~17 days |
| `SNAPSHOT_TTL_MAX` | 6 307 200 | ~365 days |

---

## Types

### `PeriodType`
```rust
pub enum PeriodType { Daily, Weekly, Monthly }
```

`Monthly` uses a fixed 30-day rolling window, not a calendar month.

### `MetricsSnapshot`
```rust
pub struct MetricsSnapshot {
    pub period_index: u64,
    pub total_donations: u64,
    pub total_requests: u64,
    pub total_deliveries: u64,
    pub total_payments_released: u64,
    pub total_volume: u64,
    pub last_updated: u64,  // Unix timestamp
}
```

---

## Events

| Topics | Data Format | When |
|---|---|---|
| `["anlytcs", "init"]` | `admin: Address` | Contract initialized |

---

## Error Codes

| Code | Name | Meaning |
|---|---|---|
| — | `NotInitialized` | `initialize` has not been called |
| — | `AlreadyInitialized` | `initialize` called more than once |
| — | `Unauthorized` | Caller is not admin or an authorized domain contract |

---

## Access Control

Metric-recording functions accept calls from:
- `cfg.admin`
- `cfg.inventory_contract`
- `cfg.requests_contract`
- `cfg.payments_contract`
- `cfg.reputation_contract`

All other callers receive `AnalyticsError::Unauthorized`.
