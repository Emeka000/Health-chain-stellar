# Temperature Contract

Monitors cold-chain integrity for blood units in transit. Accepts IoT sensor readings, detects threshold violations, tracks consecutive violation streaks, and automatically escalates sustained excursions to the coordinator as payment disputes.

## How it works

1. Admin sets a per-unit temperature threshold (`set_threshold`).
2. IoT oracles or the backend call `log_reading` for each sensor reading.
3. The contract tracks a consecutive violation streak per unit. Three consecutive violations mark the unit as **compromised**.
4. When a sustained excursion is confirmed, an authorized oracle calls `report_excursion_to_coordinator`, which calls `coordinator.flag_temperature_breach()` to transition the linked payment to `Disputed`.

## Temperature encoding

All temperatures are stored as integers scaled ×100 to avoid floating point. For example, 4.5°C is stored as `450`.

## Public functions

### initialize

```rust
pub fn initialize(env: Env, admin: Address) -> Result<(), ContractError>
```

One-time setup. Returns `AlreadyInitialized` if called again.

---

### set_threshold

```rust
pub fn set_threshold(
    env: Env,
    admin: Address,
    unit_id: u64,
    min_celsius_x100: i32,
    max_celsius_x100: i32,
) -> Result<(), ContractError>
```

Admin-only. Sets the acceptable temperature range for a blood unit. `min` must be strictly less than `max`. A threshold must be set before `log_reading` can be called for a unit.

---

### log_reading

```rust
pub fn log_reading(
    env: Env,
    unit_id: u64,
    temperature_celsius_x100: i32,
    timestamp: u64,
) -> Result<(), ContractError>
```

Records a temperature reading. Requires a threshold to be set for the unit (`ThresholdNotFound` otherwise).

- Determines if the reading is a violation (outside min/max range).
- Updates the consecutive violation streak: increments on violation, resets to 0 on a clean reading.
- If the streak reaches 3, marks the unit as compromised (`IsCompromised = true`).
- Stores readings in pages of 20 entries each.

---

### get_readings

```rust
pub fn get_readings(env: Env, unit_id: u64) -> Result<Vec<TemperatureReading>, ContractError>
```

Returns all temperature readings for a unit across all pages.

---

### get_violations

```rust
pub fn get_violations(env: Env, unit_id: u64) -> Result<Vec<TemperatureReading>, ContractError>
```

Returns only the readings where `is_violation == true`.

---

### get_temperature_summary

```rust
pub fn get_temperature_summary(env: Env, unit_id: u64) -> Result<TemperatureSummary, ContractError>
```

Returns aggregate statistics: count, average, min, max, and violation count. Uses an `i64` accumulator to prevent overflow with large datasets. Returns `UnitNotFound` if no readings exist.

---

### get_consecutive_violation_streak

```rust
pub fn get_consecutive_violation_streak(env: Env, unit_id: u64) -> u32
```

Returns the current consecutive violation streak. Resets to 0 after any clean reading.

---

### is_compromised

```rust
pub fn is_compromised(env: Env, unit_id: u64) -> bool
```

Returns `true` if the unit has accumulated 3 or more consecutive violations. Once set, this flag persists until explicitly reset by an admin.

---

### reset_compromised_status

```rust
pub fn reset_compromised_status(env: Env, admin: Address, unit_id: u64) -> Result<(), ContractError>
```

Admin-only. Clears the compromised flag and resets the violation streak to 0.

---

### set_coordinator

```rust
pub fn set_coordinator(env: Env, admin: Address, coordinator: Address) -> Result<(), ContractError>
```

Admin-only. Configures the coordinator contract address for cross-contract excursion reporting.

---

### add_oracle

```rust
pub fn add_oracle(env: Env, admin: Address, oracle: Address) -> Result<(), ContractError>
```

Admin-only. Whitelists an IoT oracle address that may call `report_excursion_to_coordinator`.

---

### report_excursion_to_coordinator

```rust
pub fn report_excursion_to_coordinator(
    env: Env,
    caller: Address,
    unit_id: u64,
    payment_id: u64,
    excursion_summary: ExcursionSummary,
) -> Result<(), ContractError>
```

Calls `coordinator.flag_temperature_breach()` to transition the linked payment to `Disputed`. Only the admin or a whitelisted oracle may call this. Emits `(tmp_excur,)` event with `(unit_id, payment_id, violation_count)`.

---

### pause / unpause / is_paused

```rust
pub fn pause(env: Env, admin: Address) -> Result<(), ContractError>
pub fn unpause(env: Env, admin: Address) -> Result<(), ContractError>
pub fn is_paused(env: Env) -> bool
```

Admin-only circuit breaker.

## Types

### TemperatureReading

```rust
pub struct TemperatureReading {
    pub temperature_celsius_x100: i32,
    pub timestamp: u64,
    pub is_violation: bool,
}
```

### TemperatureThreshold

```rust
pub struct TemperatureThreshold {
    pub min_celsius_x100: i32,
    pub max_celsius_x100: i32,
}
```

### TemperatureSummary

```rust
pub struct TemperatureSummary {
    pub count: u32,
    pub avg_celsius_x100: i32,
    pub min_celsius_x100: i32,
    pub max_celsius_x100: i32,
    pub violation_count: u32,
}
```

### ExcursionSummary

```rust
pub struct ExcursionSummary {
    pub unit_id: u64,
    pub violation_count: u32,
    pub peak_celsius_x100: i32,
    pub detected_at: u64,
}
```

## Storage keys

| Key | Storage tier | Type | Description |
|---|---|---|---|
| `DataKey::Admin` | Instance | `Address` | Admin address |
| `DataKey::Paused` | Instance | `bool` | Pause flag |
| `DataKey::CoordinatorContract` | Instance | `Address` | Coordinator contract address |
| `DataKey::Threshold(unit_id)` | Persistent | `TemperatureThreshold` | Per-unit temperature range |
| `DataKey::TempPage(unit_id, page)` | Persistent | `Vec<TemperatureReading>` | Reading page (20 entries max) |
| `DataKey::TempPageLen(unit_id, page)` | Persistent | `u32` | Number of valid entries in a page |
| `DataKey::ConsecutiveViolationStreak(unit_id)` | Persistent | `u32` | Current consecutive violation count |
| `DataKey::IsCompromised(unit_id)` | Persistent | `bool` | Compromised flag |
| `DataKey::OracleWhitelist(Address)` | Persistent | `bool` | Whitelisted oracle flag |

## Error codes

| Code | Value | Meaning |
|---|---|---|
| `AlreadyInitialized` | 600 | Contract already initialized |
| `Unauthorized` | 601 | Caller not authorized |
| `ThresholdNotFound` | 602 | No threshold set for this unit |
| `InvalidThreshold` | 603 | min ≥ max |
| `UnitNotFound` | 604 | No readings found for this unit |
| `ContractPaused` | 605 | Contract is paused |
| `CoordinatorNotSet` | 606 | Coordinator address not configured |
| `CoordinatorCallFailed` | 607 | Cross-contract call to coordinator failed |

## Constants

- Page size: **20 readings** per page
- Compromise threshold: **3 consecutive violations**
