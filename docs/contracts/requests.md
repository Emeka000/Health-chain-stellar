# Requests Contract

**Location:** `lifebank-soroban/contracts/requests/src/lib.rs`  
**Purpose:** Manages blood request records on-chain. Hospitals create requests; the contract enforces valid status transitions, appends an immutable history trail to each request, and integrates with the Inventory contract to release reservations on cancellation.

---

## Public Interface

### Initialization

| Function | Parameters | Returns | Auth |
|---|---|---|---|
| `initialize` | `env, admin, inventory_contract` | `Result<(), ContractError>` | `admin` |

### Request Lifecycle

| Function | Parameters | Returns | Auth |
|---|---|---|---|
| `create_request` | `env, hospital, blood_type, component, quantity_ml, urgency, required_by, notes` | `Result<u64, ContractError>` (request_id) | Hospital |
| `approve_request` | `env, caller, request_id, reason: String` | `Result<(), ContractError>` | Admin / Blood Bank |
| `reject_request` | `env, caller, request_id, reason: String` | `Result<(), ContractError>` | Admin / Blood Bank |
| `start_fulfillment` | `env, caller, request_id, reason: String` | `Result<(), ContractError>` | Authorized caller |
| `fulfill_request` | `env, caller, request_id, fulfilled_ml: u32, reason, reservation_id?: u64` | `Result<(), ContractError>` | Authorized caller |

### Query

| Function | Parameters | Returns | Auth |
|---|---|---|---|
| `get_request` | `env, request_id: u64` | `BloodRequest` | Public |
| `get_request_history` | `env, request_id` | `Vec<RequestHistoryEntry>` | Public |
| `get_metadata` | `env` | `ContractMetadata` | Public |

---

## Storage Layout

| Key | Storage Tier | Description |
|---|---|---|
| `DataKey::Admin` | Instance | Admin address |
| `DataKey::InventoryContract` | Instance | Inventory contract address |
| `DataKey::RequestCounter` | Instance | Auto-increment request ID |
| `DataKey::Request(u64)` | Persistent | Full `BloodRequest` record |

---

## Types

### `RequestStatus`
```rust
pub enum RequestStatus {
    Pending,
    Approved,
    Rejected,
    InProgress,
    Fulfilled,
}
```

### `BloodRequest`
```rust
pub struct BloodRequest {
    pub id: u64,
    pub hospital: Address,
    pub blood_type: BloodType,
    pub component: BloodComponent,
    pub quantity_ml: u32,
    pub urgency: Urgency,
    pub required_by: u64,        // Unix timestamp
    pub notes: String,
    pub status: RequestStatus,
    pub fulfilled_ml: u32,
    pub history: Vec<RequestHistoryEntry>,
    pub created_at: u64,
    pub updated_at: u64,
}
```

### `RequestHistoryEntry`
```rust
pub struct RequestHistoryEntry {
    pub previous_status: RequestStatus,
    pub is_initial_transition: bool,
    pub new_status: RequestStatus,
    pub actor: Address,
    pub reason: String,
    pub fulfilled_delta_ml: u32,
    pub released_reservation: bool,
    pub timestamp: u64,
}
```

### `Urgency`
```rust
pub enum Urgency { Routine, Urgent, Critical }
```

### `BloodComponent`
```rust
pub enum BloodComponent {
    WholeBlood, RedBloodCells, Platelets, Plasma, Cryoprecipitate,
}
```

---

## Status Transition Rules

```
Pending    → Approved
Pending    → Rejected
Approved   → Rejected
Approved   → InProgress
Approved   → Fulfilled
InProgress → Fulfilled
```

Any other transition returns `ContractError::InvalidTransition`.

---

## Events

Emitted via `RequestCreatedEvent`:
```rust
pub struct RequestCreatedEvent {
    pub request_id: u64,
    pub hospital: Address,
    pub blood_type: BloodType,
    pub urgency: Urgency,
}
```

---

## Error Codes

See `lifebank-soroban/contracts/requests/src/error.rs`. Key codes:

| Name | Meaning |
|---|---|
| `NotInitialized` | Contract not initialized |
| `AlreadyInitialized` | `initialize` called twice |
| `Unauthorized` | Caller not permitted |
| `RequestNotFound` | Request ID does not exist |
| `InvalidTransition` | Status transition not allowed |
| `InvalidReason` | Reason string is empty |
| `InvalidRequiredBy` | `required_by` timestamp is in the past |
| `FulfillmentExceedsRequest` | `fulfilled_ml` exceeds `quantity_ml` |
