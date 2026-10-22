# Inventory Contract

Manages the full lifecycle of blood units from donation registration through delivery or disposal. Maintains indexes for efficient querying by blood type, bank, status, and donor. Supports time-bounded reservations stored in temporary storage.

## Blood unit lifecycle

```
register_blood()
      │
      ▼
  Available ──► Reserved ──► InTransit ──► Delivered  (terminal)
      │             │             │
      ▼             ▼             ▼
  Expired       Expired       Expired ──► Disposed    (terminal)
      │
      ▼
  Disposed    (terminal)

  Available / Reserved / InTransit ──► Compromised ──► Disposed (terminal)

  Reserved ──► Available  (via release_reservation or rollback)
```

All other transitions are rejected. Backwards transitions (e.g. `Delivered → Available`) are explicitly forbidden to preserve the on-chain audit trail.

## Public functions

### initialize

```rust
pub fn initialize(env: Env, admin: Address) -> Result<(), ContractError>
```

One-time setup. Sets the admin and authorizes the admin address as the first blood bank. Returns `AlreadyInitialized` if called again.

---

### authorize_bank / is_authorized_bank

```rust
pub fn authorize_bank(env: Env, admin: Address, bank: Address, authorized: bool) -> Result<(), ContractError>
pub fn is_authorized_bank(env: Env, bank: Address) -> bool
```

Admin-only. Grants or revokes blood bank authorization. Only authorized banks can register blood units and create reservations.

---

### register_blood

```rust
pub fn register_blood(
    env: Env,
    bank_id: Address,
    serial_number: String,
    blood_type: BloodType,
    quantity_ml: u32,
    donor_id: Option<Address>,
) -> Result<u64, ContractError>
```

Registers a new blood unit. `bank_id` must be authorized.

- `serial_number` must be unique (physical bag ID); duplicate serials are rejected.
- `quantity_ml` must be 100–600 ml.
- Timestamps are derived from ledger time: `donation_timestamp = now`, `expiration_timestamp = now + 35 days`.
- Returns the new blood unit ID.
- Emits `blood_registered` event.

---

### batch_register_blood

```rust
pub fn batch_register_blood(
    env: Env,
    bank_id: Address,
    entries: Vec<(String, BloodType, u32, Option<Address>)>,
) -> Result<Vec<u64>, ContractError>
```

Registers multiple units in a single transaction. Each tuple is `(serial_number, blood_type, quantity_ml, donor_id)`. Returns IDs in input order. All-or-nothing: if any entry fails validation, the entire batch is rejected.

---

### get_blood_unit

```rust
pub fn get_blood_unit(env: Env, blood_unit_id: u64) -> Result<BloodUnit, ContractError>
```

Returns the full `BloodUnit` record. Returns `NotFound` if the ID does not exist.

---

### update_status

```rust
pub fn update_status(
    env: Env,
    unit_id: u64,
    new_status: BloodStatus,
    authorized_by: Address,
    reason: Option<String>,
) -> Result<BloodUnit, ContractError>
```

Transitions a blood unit to a new status. `authorized_by` must be the admin or the unit's owning bank.

- Validates the transition against the allowed transition matrix.
- Blocks supply-chain transitions on expired units (only `→ Expired` and `→ Disposed` are allowed past shelf life).
- Records a `StatusChangeHistory` entry and emits `status_changed` and `bld_unit_chg` events.

---

### mark_delivered

```rust
pub fn mark_delivered(
    env: Env,
    unit_id: u64,
    authorized_by: Address,
    delivery_location: String,
) -> Result<BloodUnit, ContractError>
```

Convenience wrapper for `update_status(InTransit → Delivered)`. The `delivery_location` is stored as the reason. Called by the coordinator during `confirm_delivery`.

---

### mark_expired / dispose

```rust
pub fn mark_expired(env: Env, unit_id: u64, authorized_by: Address) -> Result<BloodUnit, ContractError>
pub fn dispose(env: Env, unit_id: u64, authorized_by: Address, reason: Option<String>) -> Result<BloodUnit, ContractError>
```

Explicit expiry and disposal transitions. `dispose` requires the unit to be in `Expired` or `Compromised` state.

---

### batch_update_status

```rust
pub fn batch_update_status(
    env: Env,
    unit_ids: Vec<u64>,
    new_status: BloodStatus,
    authorized_by: Address,
    reason: Option<String>,
) -> Result<u64, ContractError>
```

Updates multiple units to the same status atomically. Validates all units first; if any validation fails, no updates are applied. Returns the count of updated units.

---

### reserve_blood

```rust
pub fn reserve_blood(
    env: Env,
    requester: Address,
    hospital_id: Address,
    unit_ids: Vec<u64>,
    request_id: u64,
    duration_seconds: u64,
) -> Result<u64, ContractError>
```

Creates a time-bounded reservation for a set of blood units. `requester` must be an authorized bank and must own all specified units. `hospital_id` is the recipient hospital recorded in the registry when a registry is configured.

- All units must be `Available` and not expired.
- Transitions all units to `Reserved`.
- Stores a `Reservation` record in **temporary storage** (auto-expires after `duration_seconds`).
- Returns the reservation ID.
- Emits `blood_reserved` event.

---

### release_reservation

```rust
pub fn release_reservation(env: Env, reservation_id: u64) -> Result<(), ContractError>
```

Releases a reservation, returning all `Reserved` units to `Available`. Can be called by anyone — the reservation record is the authority. Succeeds even if the reservation has already expired (allows cleanup of stale entries). Emits `reservation_released` event.

---

### batch_reserve_blood

```rust
pub fn batch_reserve_blood(
    env: Env,
    requester: Address,
    hospital_id: Address,
    batch: Vec<(Vec<u64>, u64, u64)>,
) -> Result<Vec<u64>, ContractError>
```

Creates multiple reservations in a single transaction. Each tuple is `(unit_ids, request_id, duration_seconds)`. Returns reservation IDs in input order.

---

### get_reservation

```rust
pub fn get_reservation(env: Env, reservation_id: u64) -> Result<Reservation, ContractError>
```

Returns the `Reservation` record. Returns `ReservationNotFound` if expired or not found.

---

### get_status_history / get_status_history_page

```rust
pub fn get_status_history(env: Env, unit_id: u64) -> Vec<StatusChangeHistory>
pub fn get_status_history_page(env: Env, unit_id: u64, page: u32) -> Vec<StatusChangeHistory>
pub fn get_history_page_count(env: Env, unit_id: u64) -> u32
pub fn get_status_change_count(env: Env, unit_id: u64) -> u64
```

History is stored in pages of 50 entries. Use `get_status_history_page` for O(1) reads; `get_status_history` iterates all pages.

---

### pause / unpause / is_paused

```rust
pub fn pause(env: Env, admin: Address) -> Result<(), ContractError>
pub fn unpause(env: Env, admin: Address) -> Result<(), ContractError>
pub fn is_paused(env: Env) -> bool
```

Admin-only circuit breaker.

## Types

### BloodUnit

```rust
pub struct BloodUnit {
    pub id: u64,
    pub blood_type: BloodType,
    pub quantity_ml: u32,
    pub bank_id: Address,
    pub donor_id: Option<Address>,
    pub donation_timestamp: u64,
    pub expiration_timestamp: u64,
    pub status: BloodStatus,
    pub metadata: Map<Symbol, String>,
}
```

### BloodType

`APositive | ANegative | BPositive | BNegative | ABPositive | ABNegative | OPositive | ONegative`

### BloodStatus

`Available | Reserved | InTransit | Delivered | Expired | Compromised | Disposed`

### Reservation

```rust
pub struct Reservation {
    pub unit_ids: Vec<u64>,
    pub requester: Address,
    pub created_timestamp: u64,
    pub expiration_timestamp: u64,
    pub request_id: u64,
}
```

### StatusChangeHistory

```rust
pub struct StatusChangeHistory {
    pub id: u64,
    pub blood_unit_id: u64,
    pub from_status: BloodStatus,
    pub to_status: BloodStatus,
    pub authorized_by: Address,
    pub changed_at: u64,
    pub reason: Option<String>,
}
```

## Storage keys

| Key | Storage tier | Type | Description |
|---|---|---|---|
| `DataKey::Admin` | Instance | `Address` | Admin address |
| `DataKey::BloodUnitCounter` | Instance | `u64` | Auto-increment ID counter |
| `DataKey::StatusHistoryCounter` | Instance | `u64` | Global history entry counter |
| `DataKey::ReservationCounter` | Instance | `u64` | Auto-increment reservation ID |
| `DataKey::Paused` | Instance | `bool` | Pause flag |
| `DataKey::BloodUnit(id)` | Persistent | `BloodUnit` | Blood unit record |
| `DataKey::BloodTypeIndex(BloodType)` | Persistent | `Vec<u64>` | Unit IDs by blood type |
| `DataKey::BankIndex(Address)` | Persistent | `Vec<u64>` | Unit IDs by bank |
| `DataKey::StatusIndex(BloodStatus)` | Persistent | `Vec<u64>` | Unit IDs by status |
| `DataKey::DonorIndex(Address)` | Persistent | `Vec<u64>` | Unit IDs by donor |
| `DataKey::AuthorizedBank(Address)` | Persistent | `bool` | Bank authorization flag |
| `DataKey::Serial(String)` | Persistent | `u64` | Serial number → unit ID dedup index |
| `DataKey::StatusHistory(unit_id)` | Persistent | `u32` | Current history page number |
| `DataKey::StatusHistoryPage(unit_id, page)` | Persistent | `Vec<StatusChangeHistory>` | History page (50 entries max) |
| `DataKey::BloodUnitStatusChangeCount(unit_id)` | Persistent | `u64` | Total status changes for a unit |
| `DataKey::Reservation(id)` | **Temporary** | `Reservation` | Time-bounded reservation record |

## Error codes

| Code | Value | Meaning |
|---|---|---|
| `AlreadyInitialized` | 100 | Contract already initialized |
| `NotInitialized` | 101 | Contract not initialized |
| `Unauthorized` | 102 | Caller not authorized |
| `InvalidQuantity` | 116 | quantity_ml outside 100–600 range |
| `InvalidTimestamp` | 115 | Timestamp validation failed |
| `NotFound` | 121 | Blood unit not found |
| `BloodUnitExpired` | 123 | Unit is past shelf life |
| `DuplicateBloodUnit` | 124 | Serial number already registered |
| `NotAuthorizedBloodBank` | 132 | Bank not authorized |
| `NotUnitOwner` | 133 | Requester does not own the unit |
| `BloodUnitNotAvailable` | 140 | Unit is not in Available status |
| `InvalidStatusTransition` | 141 | Transition not in allowed matrix |
| `ReservationNotFound` | 150 | Reservation not found or expired |
| `ContractPaused` | 160 | Contract is paused |

## Constants

- Shelf life: **35 days** (`BLOOD_SHELF_LIFE_DAYS`)
- History page size: **50 entries** per page
- Valid quantity range: **100–600 ml**
