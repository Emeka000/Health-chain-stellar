# Analytics Contract

The Analytics Contract aggregates metrics from the Lifebank ecosystem (donations, requests, deliveries, payments, volume) and maintains both period-based snapshots and lifetime totals.

## Quick Start

Analytics tracks four primary metrics:
- **Donations** — Count of blood donations recorded
- **Requests** — Count of blood requests submitted
- **Deliveries** — Count of completed deliveries
- **Payments Released** — Count of payments and total volume released

Metrics are organized into **periods** (Daily/Weekly/Monthly) and can be queried by period or as lifetime totals.

## Entrypoints

### Lifecycle & Initialization

#### `initialize(env, admin, inventory_contract, requests_contract, payments_contract, reputation_contract) → Result<(), AnalyticsError>`
- **Description**: Initialize the analytics contract with all dependencies
- **Auth required**: Yes, signer must be `admin`
- **Parameters**:
  - `admin: Address` — Admin address
  - `inventory_contract: Address` — Inventory contract ID (for cross-contract calls)
  - `requests_contract: Address` — Requests contract ID
  - `payments_contract: Address` — Payments contract ID
  - `reputation_contract: Address` — Reputation contract ID
- **Returns**: `Ok(())` on success; `Err(AlreadyInitialized)` if already initialized
- **Side effects**: Sets admin, stores all contract IDs, initializes reporting period to Daily, zeroes all counters
- **Events**: Publishes `("anlytcs", "init", "v1")` with admin address
- **Access Control**: Any address (must sign as admin)

#### `is_initialized(env) → bool`
- **Description**: Check if contract has been initialized
- **Returns**: `true` if initialized; `false` otherwise

### Configuration

#### `set_reporting_period(env, period_type) → Result<(), AnalyticsError>`
- **Description**: Change the reporting period (Daily/Weekly/Monthly). Admin only.
- **Auth required**: Yes, signer must be admin (checked by require_admin helper)
- **Parameters**:
  - `period_type: PeriodType` — Daily, Weekly, or Monthly
- **Returns**: `Ok(())` on success
- **Side effects**: Updates config with new period type and duration in seconds
- **Access Control**: Admin only

### Metric Recording

All recording functions are **admin only**. They:
1. Calculate the current period index based on the configured period duration
2. Load the current period's snapshot (or create default if missing)
3. Increment the metric counter
4. Update `last_updated` timestamp
5. Save the snapshot back
6. Increment the corresponding lifetime counter

#### `record_donation(env) → Result<(), AnalyticsError>`
- **Description**: Record a new blood donation
- **Auth required**: Yes, admin only
- **Side effects**: Increments period's `total_donations` and lifetime `TotalDonations`

#### `record_request(env) → Result<(), AnalyticsError>`
- **Description**: Record a new blood request
- **Auth required**: Yes, admin only
- **Side effects**: Increments period's `total_requests` and lifetime `TotalRequests`

#### `record_delivery(env) → Result<(), AnalyticsError>`
- **Description**: Record a completed delivery
- **Auth required**: Yes, admin only
- **Side effects**: Increments period's `total_deliveries` and lifetime `TotalDeliveries`

#### `record_payment_released(env, amount) → Result<(), AnalyticsError>`
- **Description**: Record a released payment with its volume
- **Auth required**: Yes, admin only
- **Parameters**:
  - `amount: i128` — Payment amount in stroops or units (no validation; negative amounts allowed)
- **Side effects**: 
  - Increments period's `total_payments_released`
  - Adds `amount` to period's `total_volume`
  - Increments lifetime `TotalPaymentsReleased`
  - Adds `amount` to lifetime `TotalVolume`

### Query Functions

#### `get_current_snapshot(env) → Result<MetricsSnapshot, AnalyticsError>`
- **Description**: Get the metrics snapshot for the **current** period
- **Auth required**: No
- **Returns**: `Ok(MetricsSnapshot)` for the current period index
- **Side effects**: None

#### `get_snapshot(env, period_index) → Result<MetricsSnapshot, AnalyticsError>`
- **Description**: Get the metrics snapshot for a specific period
- **Auth required**: No
- **Parameters**:
  - `period_index: u64` — Period index to retrieve
- **Returns**: `Ok(MetricsSnapshot)` if found; `Err(PeriodNotFound)` if no snapshot was ever recorded for that period
- **Side effects**: None

#### `get_lifetime_totals(env) → Result<MetricsSnapshot, AnalyticsError>`
- **Description**: Get lifetime totals aggregated across all periods
- **Auth required**: No
- **Returns**: `Ok(MetricsSnapshot)` with period_index set to u64::MAX and all fields containing lifetime sums
- **Side effects**: None

#### `get_config(env) → Result<AnalyticsConfig, AnalyticsError>`
- **Description**: Get the current contract configuration
- **Auth required**: No
- **Returns**: `Ok(AnalyticsConfig)` containing admin, all contract IDs, reporting period, and initialization timestamp

---

## Data Structures

### MetricsSnapshot
```rust
pub struct MetricsSnapshot {
    pub period_index: u64,              // Period number (or u64::MAX for lifetime totals)
    pub total_donations: u64,           // Count of donations in period
    pub total_requests: u64,            // Count of requests in period
    pub total_deliveries: u64,          // Count of deliveries in period
    pub total_payments_released: u64,   // Count of payments released in period
    pub total_volume: i128,             // Sum of payment amounts in period
    pub last_updated: u64,              // Unix timestamp of last update
}
```

### AnalyticsConfig
```rust
pub struct AnalyticsConfig {
    pub admin: Address,                 // Admin address
    pub inventory_contract: Address,    // Inventory contract ID
    pub requests_contract: Address,     // Requests contract ID
    pub payments_contract: Address,     // Payments contract ID
    pub reputation_contract: Address,   // Reputation contract ID
    pub reporting_period: ReportingPeriod,
    pub initialized_at: u64,            // Initialization timestamp
}
```

### ReportingPeriod
```rust
pub struct ReportingPeriod {
    pub period_type: PeriodType,        // Daily, Weekly, or Monthly
    pub duration_secs: u64,             // Seconds per period (86400, 604800, 2592000)
    pub configured_at: u64,             // When this period was configured
}
```

### PeriodType
- `Daily` — 86,400 seconds per period
- `Weekly` — 604,800 seconds per period
- `Monthly` — 2,592,000 seconds per period (30 days)

### DataKey (Storage Keys)
- `Config` — Current AnalyticsConfig
- `TotalDonations` — u64 lifetime total
- `TotalRequests` — u64 lifetime total
- `TotalDeliveries` — u64 lifetime total
- `TotalPaymentsReleased` — u64 lifetime total
- `TotalVolume` — i128 lifetime total
- `Snapshot(period_index)` — MetricsSnapshot for a specific period index

---

## Error Codes

| Code | Name | Cause |
|------|------|-------|
| 500 | `AlreadyInitialized` | Contract already initialized |
| 501 | `NotInitialized` | Contract not yet initialized |
| 502 | `PeriodNotFound` | Snapshot for requested period_index doesn't exist |

---

## Event Types

- `("anlytcs", "init", "v1")` → `(admin_address: Address)`
- When metrics are recorded, no events are currently published (future enhancement)

---

## Period Calculation

**Current period index** = `ledger_timestamp / duration_secs`

Examples (assuming current timestamp = 1704067200, Unix epoch Jan 1, 2024):
- Daily (86,400 s): period_index = 1704067200 / 86400 = 19724
- Weekly (604,800 s): period_index = 1704067200 / 604800 = 2817
- Monthly (2,592,000 s): period_index = 1704067200 / 2592000 = 657

Each time the period boundary is crossed (e.g., at the start of a new day), a new period index becomes "current" and a new snapshot is created.

---

## Usage Patterns

### Initialize Analytics

```
initialize(admin, inventory, requests, payments, reputation)
→ Config stored, all counters zeroed, period set to Daily
```

### Record Metrics

```
record_donation()           → Donation count +1 (period and lifetime)
record_request()            → Request count +1 (period and lifetime)
record_delivery()           → Delivery count +1 (period and lifetime)
record_payment_released(1000) → Payment count +1, volume += 1000 (period and lifetime)
```

### Query Metrics

```
get_current_snapshot()   → Get metrics for "right now" period
get_snapshot(period_idx) → Get metrics for past period (e.g., yesterday)
get_lifetime_totals()    → All-time metrics
get_config()             → Admin, contract IDs, period settings
```

### Change Period

```
set_reporting_period(Weekly)
→ Reporting period now Weekly; next period boundary is 604,800 seconds from last boundary
```

---

## Key Design Notes

- **Admin-only recording**: Only admin can call `record_*` functions. Non-admin calls must go through a trusted relay or batch operation.
- **Period auto-rollover**: Snapshots are created lazily when a metric is recorded for a new period index. No explicit "end period" call needed.
- **Lifetime tracking**: Separate lifetime counters are maintained independently of period snapshots for fast all-time totals.
- **Snapshot immutability**: Once a period ends, its snapshot is not updated (all updates go to the current period snapshot).
- **Cross-contract references**: Contract IDs for inventory, requests, payments, reputation are stored but not actively used by analytics itself (for future expansion).
