# Temperature Contract

**Location:** `lifebank-soroban/contracts/temperature/src/lib.rs`  
**Purpose:** Records cold-chain temperature readings for blood units in transit, detects excursions against configurable thresholds, and notifies the Coordinator contract when a breach is confirmed. Threshold changes are governed by a 7-day time-lock.

---

## Public Interface

### Initialization & Oracles

| Function | Parameters | Returns | Auth |
|---|---|---|---|
| `initialize` | `env, admin: Address` | `Result<(), ContractError>` | `admin` |
| `add_oracle` | `env, admin, oracle: Address` | `Result<(), ContractError>` | Admin |
| `remove_oracle` | `env, admin, oracle: Address` | `Result<(), ContractError>` | Admin |
| `is_oracle` | `env, address` | `bool` | Public |

### Threshold Governance (time-lock)

| Function | Parameters | Returns | Auth |
|---|---|---|---|
| `propose_threshold` | `env, admin, unit_id: u64, min_celsius_x100: i32, max_celsius_x100: i32` | `Result<(), ContractError>` | Admin |
| `apply_threshold` | `env, admin, unit_id: u64` | `Result<(), ContractError>` | Admin (after 7-day delay) |
| `get_threshold` | `env, unit_id: u64` | `TemperatureThreshold` | Public |

### Temperature Recording

| Function | Parameters | Returns | Auth |
|---|---|---|---|
| `record_reading` | `env, oracle, unit_id: u64, celsius_x100: i32, payment_id: u64` | `Result<(), ContractError>` | Registered oracle |
| `get_readings` | `env, unit_id: u64, page: u32` | `Vec<TemperatureReading>` | Public |
| `get_summary` | `env, unit_id: u64` | `TemperatureSummary` | Public |
| `get_excursion_summary` | `env, unit_id: u64` | `ExcursionSummary` | Public |

---

## Storage Layout

| Key | Storage Tier | TTL (ledgers) | Description |
|---|---|---|---|
| `DataKey::Admin` | Instance | Instance lifetime | Admin address |
| `DataKey::Oracle(Address)` | Persistent | Bumped on access | Oracle approval flag |
| `DataKey::Threshold(u64)` | Persistent | Persistent | `TemperatureThreshold` per unit |
| `DataKey::PendingThreshold(u64)` | Persistent | Persistent | `PendingThresholdChange` awaiting time-lock |
| `DataKey::Readings(u64)` | Persistent | Persistent | `Vec<TemperatureReading>` per unit (paginated) |
| `DataKey::Summary(u64)` | Persistent | Persistent | `TemperatureSummary` per unit |

### Oracle TTL Constants

| Name | Ledgers | Wall-clock |
|---|---|---|
| `ORACLE_BUMP_THRESHOLD` | 518 400 | ~30 days |
| `ORACLE_BUMP_TO` | 1 036 800 | ~60 days |

---

## Types

### `TemperatureThreshold`
```rust
pub struct TemperatureThreshold {
    pub min_celsius_x100: i32,  // e.g. 200 = 2.00 °C
    pub max_celsius_x100: i32,  // e.g. 600 = 6.00 °C
}
```

All temperature values are stored as integers scaled ×100 to avoid floating-point on-chain.

### `TemperatureReading`
```rust
pub struct TemperatureReading {
    pub celsius_x100: i32,
    pub timestamp: u64,
    pub oracle: Address,
    pub is_excursion: bool,
}
```

### `TemperatureSummary`
```rust
pub struct TemperatureSummary {
    pub unit_id: u64,
    pub total_readings: u32,
    pub excursion_count: u32,
    pub min_celsius_x100: i32,
    pub max_celsius_x100: i32,
}
```

### `ExcursionSummary` (shared with Coordinator)
```rust
pub struct ExcursionSummary {
    pub unit_id: u64,
    pub violation_count: u32,
    pub max_deviation_x100: i32,
}
```

### `PendingThresholdChange`
```rust
pub struct PendingThresholdChange {
    pub min_celsius_x100: i32,
    pub max_celsius_x100: i32,
    pub effective_at: u64,  // Unix timestamp after 7-day delay
}
```

---

## Events

| Topics | Data Format | When |
|---|---|---|
| `["threshold", "proposed"]` | `[unit_id, min, max, effective_at]` | Threshold change proposed |
| `["threshold", "applied"]` | `[unit_id, min, max]` | Threshold change applied |
| `["oracle", "added"]` | `oracle: Address` | Oracle registered |
| `["oracle", "removed"]` | `oracle: Address` | Oracle deregistered |
| `["tmp_excur"]` | `[unit_id, payment_id, violation_count]` | Temperature excursion detected |

---

## Constants

| Name | Value | Meaning |
|---|---|---|
| `PAGE_SIZE` | 20 | Readings returned per page in `get_readings` |
| Threshold time-lock | 7 days | Minimum delay before `apply_threshold` succeeds |

---

## Error Codes

See `lifebank-soroban/contracts/temperature/src/error.rs`. Key codes:

| Name | Meaning |
|---|---|
| `NotInitialized` | Contract not initialized |
| `AlreadyInitialized` | `initialize` called twice |
| `Unauthorized` | Caller is not admin |
| `NotAnOracle` | Caller not in the oracle registry |
| `ThresholdNotFound` | No threshold set for this unit |
| `NoPendingThreshold` | `apply_threshold` called with no pending change |
| `TimeLockNotExpired` | 7-day delay has not yet elapsed |

---

## Cross-Contract Integration

When an excursion is detected during `record_reading`, the contract calls:

```rust
CoordinatorContractClient::flag_temperature_breach(
    env, caller, payment_id, excursion_summary
)
```

This notifies the Coordinator to update the workflow status to `TemperatureBreach`, which blocks automatic payment settlement.
