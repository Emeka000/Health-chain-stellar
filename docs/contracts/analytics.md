# Analytics Contract

**Location:** `lifebank-soroban/contracts/analytics/src/lib.rs`  
**Purpose:** Aggregates protocol-wide metrics into rolling time-window snapshots (daily, weekly, monthly). Domain contracts call `record_*` functions to log donations, requests, deliveries, and payments. External callers query snapshots for dashboards and reporting.

---

## Public Interface

### Initialization & Admin

| Function | Parameters | Returns | Auth |
|---|---|---|---|
| `initialize` | `env, admin: Address, inventory_contract: Address, requests_contract: Address, payments_contract: Address, reputation_contract: Address` | `Result<(), AnalyticsError>` | Signed by `admin` |
| `version` | `env` | `u32` | Public |
| `is_initialized` | `env` | `bool` | Public |
| `get_admin` | `env` | `Result<Address, AnalyticsError>` | Public (returns `NotInitialized` if not initialized) |
| `propose_admin` | `env, new_admin: Address` | `Result<(), AnalyticsError>` | Signed by current Admin |
| `accept_admin` | `env` | `Result<(), AnalyticsError>` | Signed by proposed admin |
| `get_pending_admin` | `env` | `Option<Address>` | Public |
| `upgrade` | `env, admin: Address, new_wasm_hash: BytesN<32>` | `Result<(), AnalyticsError>` | Signed by Admin |

### Metrics Recording

Called by domain contracts to record events. All `record_*` functions require the caller to be the admin (via `require_admin`). Authorization check: stored domain contract addresses are **not** consulted; only the admin is authorized.

| Function | Parameters | Returns | Auth |
|---|---|---|---|
| `record_donation` | `env` | `Result<(), AnalyticsError>` | Signed by Admin |
| `record_request` | `env` | `Result<(), AnalyticsError>` | Signed by Admin |
| `record_delivery` | `env` | `Result<(), AnalyticsError>` | Signed by Admin |
| `record_payment_released` | `env, amount: i128` | `Result<(), AnalyticsError>` | Signed by Admin. Amount must be > 0. Scaled to smallest currency unit. |

### Configuration

| Function | Parameters | Returns | Auth |
|---|---|---|---|
| `set_reporting_period` | `env, period_type: PeriodType` | `Result<(), AnalyticsError>` | Public (no signature required). Reconfigures metric bucketing granularity. |
| `get_config` | `env` | `Result<AnalyticsConfig, AnalyticsError>` | Public |

### Query

| Function | Parameters | Returns | Auth |
|---|---|---|---|
| `get_current_snapshot` | `env` | `Result<MetricsSnapshot, AnalyticsError>` | Public (returns metrics for current period bucket) |
| `get_snapshot` | `env, period_type: PeriodType, period_index: u64` | `Result<MetricsSnapshot, AnalyticsError>` | Public (returns metrics for specific period bucket) |
| `get_lifetime_totals` | `env` | `Result<MetricsSnapshot, AnalyticsError>` | Public (returns aggregate counts since contract inception) |

---

## Storage Layout

| Key | Storage Tier | Description |
|---|---|---|
| `DataKey::Config` | Instance | `AnalyticsConfig` (admin + contract addresses + reporting period) |
| `DataKey::Snapshot(PeriodType, u64)` | Persistent | `MetricsSnapshot` for given period type and index |
| `DataKey::TotalDonations` | Instance | Lifetime donation count |
| `DataKey::TotalRequests` | Instance | Lifetime request count |
| `DataKey::TotalDeliveries` | Instance | Lifetime delivery count |
| `DataKey::TotalPaymentsReleased` | Instance | Lifetime payment count |
| `DataKey::TotalVolume` | Instance | Lifetime volume sum (smallest currency unit) |
| `DataKey::LastUpdated` | Persistent | Timestamp of most recent metric write |

### TTL Constants (in ledgers at ~5 s/ledger)

| Constant | Ledgers | Wall-clock |
|---|---|---|
| `SNAPSHOT_TTL_MIN` | 290 000 | ~17 days |
| `SNAPSHOT_TTL_MAX` | 6 307 200 | ~365 days |
| `INSTANCE_BUMP_THRESHOLD` | 518 400 | ~30 days |
| `INSTANCE_BUMP_TO` | 1 036 800 | ~60 days |

---

## Types

### `PeriodType`
```rust
pub enum PeriodType { Daily, Weekly, Monthly }
```

- `Daily`: 24-hour rolling window (86 400 seconds)
- `Weekly`: 7-day rolling window (604 800 seconds)
- `Monthly`: Fixed 30-day rolling window (2 592 000 seconds). **Not** a calendar month; drifts by ~5 days/year and does not align with month boundaries.

### `ReportingPeriod`
```rust
pub struct ReportingPeriod {
    pub period_type: PeriodType,
    pub duration_secs: u64,        // E.g., 86400 for daily
    pub configured_at: u64,        // Ledger timestamp when set
}
```

### `MetricsSnapshot`
```rust
pub struct MetricsSnapshot {
    pub period_index: u64,
    pub total_donations: u64,
    pub total_requests: u64,
    pub total_deliveries: u64,
    pub total_payments_released: u64,
    pub total_volume: i128,        // Sum of payment amounts (smallest unit)
    pub last_updated: u64,         // Unix timestamp
}
```

### `AnalyticsConfig`
```rust
pub struct AnalyticsConfig {
    pub admin: Address,
    pub inventory_contract: Address,
    pub requests_contract: Address,
    pub payments_contract: Address,
    pub reputation_contract: Address,
    pub reporting_period: ReportingPeriod,
    pub initialized_at: u64,       // Ledger timestamp when initialized
}
```

---

## Period Index Calculation

Period index is calculated as:

```
period_index = floor(current_ledger_timestamp / reporting_period.duration_secs)
```

When `set_reporting_period` is called with a new granularity (e.g., from Daily to Weekly), the system does not retroactively bucket old data. Snapshots keyed by different `PeriodType` values never collide.

---

## Events

| Topics | Data Format | When |
|---|---|---|
| `["anlytcs", "init"]` | `admin: Address` | Contract initialized |
| `["anlytcs", "donation"]` | `total_donations: u64` | Donation recorded |
| `["anlytcs", "request"]` | `total_requests: u64` | Request recorded |
| `["anlytcs", "delivery"]` | `total_deliveries: u64` | Delivery recorded |
| `["anlytcs", "payment"]` | `[amount: i128, total_payments_released: u64, total_volume: i128]` | Payment released |
| `["anlytcs", "period"]` | `[period_type: PeriodType, duration_secs: u64]` | Reporting period updated |
| `["anlytcs", "upgraded"]` | `new_wasm_hash: BytesN<32>` | Contract upgraded |
| `["admin", "proposed"]` | `[current_admin: Address, new_admin: Address]` | Admin transfer proposed |
| `["admin", "changed"]` | `[old_admin: Address, new_admin: Address]` | Admin transfer accepted |

---

## Error Codes

| Name | Meaning |
|---|---|
| `NotInitialized` | `initialize` not called or instance storage expired |
| `AlreadyInitialized` | `initialize` called more than once |
| `Unauthorized` | Caller is not admin |
| `InvalidAmount` | Payment amount is not > 0 |

---

## Authorization Model

The `record_*` functions check `require_admin`, which verifies:
1. Caller has signed the invocation
2. Caller matches the stored admin address

The stored `inventory_contract`, `requests_contract`, `payments_contract`, and `reputation_contract` addresses are **not** used for authorization; they are stored only for reference. Domain contracts must explicitly call the analytics contract to record metrics; they cannot authorize themselves indirectly.

---

## Lifetime vs. Period Totals

- **Period snapshots** (`get_snapshot`, `get_current_snapshot`) reflect metrics for a specific period bucket (hour, day, week, etc.).
- **Lifetime totals** (`get_lifetime_totals`) reflect cumulative metrics since contract initialization, regardless of the current reporting period setting.

Lifetime counters are initialized to zero on `initialize` and never reset.
