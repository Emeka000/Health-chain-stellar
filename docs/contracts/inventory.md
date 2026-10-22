# Inventory Contract

**Location:** `lifebank-soroban/contracts/inventory/src/lib.rs`  
**Purpose:** Manages blood unit inventory on-chain. Blood banks register, update, and transfer units; reservations lock inventory for pending requests and are automatically released after the reservation window expires.

---

## Public Interface

### Initialization & Admin

| Function | Parameters | Returns | Auth |
|---|---|---|---|
| `initialize` | `env, admin: Address` | `Result<(), ContractError>` | `admin` |
| `pause` | `env, admin` | `Result<(), ContractError>` | Admin |
| `unpause` | `env, admin` | `Result<(), ContractError>` | Admin |
| `is_paused` | `env` | `bool` | Public |
| `authorize_bank` | `env, admin, bank: Address, authorized: bool` | `Result<(), ContractError>` | Admin |
| `is_authorized_bank` | `env, bank` | `bool` | Public |

### Blood Unit Operations

| Function | Parameters | Returns | Auth |
|---|---|---|---|
| `register_unit` | `env, caller, unit: BloodUnit` | `Result<u64, ContractError>` | Authorized bank |
| `update_unit_status` | `env, caller, unit_id, new_status: BloodStatus` | `Result<(), ContractError>` | Authorized bank |
| `get_blood_unit` | `env, blood_unit_id: u64` | `BloodUnit` | Public |
| `get_units_by_blood_type` | `env, blood_type: BloodType` | `Vec<u64>` | Public |
| `get_units_by_bank` | `env, bank: Address` | `Vec<u64>` | Public |

### Reservations

| Function | Parameters | Returns | Auth |
|---|---|---|---|
| `reserve_unit` | `env, caller, unit_id, requester: Address, duration_secs?: u64` | `Result<u64, ContractError>` (reservation_id) | Authorized bank |
| `release_reservation` | `env, caller, reservation_id: u64` | `Result<(), ContractError>` | Authorized bank or Requests contract |
| `get_reservation` | `env, reservation_id` | `Option<Reservation>` | Public |

---

## Storage Layout

| Key | Storage Tier | Description |
|---|---|---|
| `DataKey::Admin` | Instance | Admin address |
| `DataKey::Paused` | Instance | Pause flag |
| `DataKey::AuthorizedBank(Address)` | Persistent | Whether a blood bank is authorized |
| `DataKey::BloodUnit(u64)` | Persistent | `BloodUnit` record |
| `DataKey::UnitsByBloodType(BloodType)` | Persistent | `Vec<u64>` of unit IDs per blood type |
| `DataKey::UnitsByBank(Address)` | Persistent | `Vec<u64>` of unit IDs per bank |
| `DataKey::Reservation(u64)` | Persistent | Reservation record |
| `DataKey::UnitCounter` | Instance | Auto-increment unit ID |
| `DataKey::ReservationCounter` | Instance | Auto-increment reservation ID |

---

## Types

### `BloodType`
```rust
pub enum BloodType {
    APositive, ANegative, BPositive, BNegative,
    ABPositive, ABNegative, OPositive, ONegative,
}
```

### `BloodStatus`
```rust
pub enum BloodStatus {
    Available, Reserved, Allocated, InTransit,
    Delivered, Quarantined, Expired, Withdrawn,
}
```

### `BloodUnit`
```rust
pub struct BloodUnit {
    pub id: u64,
    pub blood_type: BloodType,
    pub quantity_ml: u32,
    pub expiration_date: u64,  // Unix timestamp
    pub registered_at: u64,
    pub blood_bank: Address,
    pub status: BloodStatus,
    pub component: BloodComponent,
    pub donor_id: Option<String>,
}
```

### `Reservation`
```rust
pub struct Reservation {
    pub id: u64,
    pub unit_id: u64,
    pub requester: Address,
    pub reserved_at: u64,
    pub expires_at: u64,
}
```

---

## Constants

| Name | Value | Meaning |
|---|---|---|
| `MAX_RESERVATION_DURATION_SECS` | `604 800` (7 days) | Maximum reservation window |

---

## Status Transition Rules

Valid transitions are defined in `types::is_valid_transition`:

| From | To |
|---|---|
| `Available` | `Reserved`, `Allocated`, `Quarantined`, `Withdrawn` |
| `Reserved` | `Allocated`, `Available` (released), `Expired` |
| `Allocated` | `InTransit`, `Available` (cancelled) |
| `InTransit` | `Delivered`, `Quarantined` |
| `Quarantined` | `Withdrawn` |

---

## Error Codes

See `lifebank-soroban/contracts/inventory/src/error.rs` for the full `ContractError` enum. Key codes:

| Name | Meaning |
|---|---|
| `AlreadyInitialized` | `initialize` called more than once |
| `Unauthorized` | Caller is not admin or authorized bank |
| `ContractPaused` | All mutations blocked |
| `UnitNotFound` | Blood unit does not exist |
| `InvalidTransition` | Status transition not permitted |
| `UnitAlreadyReserved` | Unit already has an active reservation |
| `ReservationNotFound` | Reservation ID does not exist |
| `ReservationExpired` | Reservation window has elapsed |
