# Requests Contract

Manages hospital blood requests from creation through fulfillment or cancellation. Maintains a full history of every status transition with actor, reason, and accounting details. Integrates with the inventory contract to release reservations on cancellation or rejection.

## Request lifecycle

```
create_request()
      │
      ▼
  Pending ──► Approved ──► InProgress ──► Fulfilled  (terminal)
      │           │
      │           │ partial_fulfill_request()
      │           ▼
      │       InProgress ──► Fulfilled  (terminal)
      │
      ├──► Rejected  (terminal, from Pending or Approved)
      │
      └──► Cancelled (terminal, from Pending or Approved — manual cancel or expire_request)
```

Only authorized hospitals can create requests. Only the admin can approve, reject, or fulfill. Either the owning hospital or the admin can cancel. Anyone can expire a Pending or Approved request once its `required_by_timestamp` has passed.

## Public functions

### initialize

```rust
pub fn initialize(
    env: Env,
    admin: Address,
    inventory_contract: Address,
) -> Result<(), ContractError>
```

One-time setup. Sets the admin, links the inventory contract and initializes the request counter. Returns `AlreadyInitialized` if called again.

The admin is **not** granted any tenant role: it is not a hospital, blood bank or rider. Grant one explicitly with `authorize_hospital` etc., which emits the matching event.

---

### authorize_hospital / revoke_hospital

```rust
pub fn authorize_hospital(env: Env, hospital: Address) -> Result<(), ContractError>
pub fn revoke_hospital(env: Env, hospital: Address) -> Result<(), ContractError>
```

Admin-only. Grants or revokes hospital authorization. Only authorized hospitals can create requests.

---

### create_request

```rust
pub fn create_request(
    env: Env,
    hospital: Address,
    blood_type: BloodType,
    component: BloodComponent,
    quantity_ml: u32,
    urgency: Urgency,
    required_by_timestamp: u64,
) -> Result<u64, ContractError>
```

Creates a new blood request in `Pending` status. `hospital` must be authorized.

- `required_by_timestamp` must be in the future.
- `quantity_ml` must be positive.
- Records an initial history entry.
- Returns the new request ID.
- Emits `request_created` event.

---

### batch_create_requests

```rust
pub fn batch_create_requests(
    env: Env,
    hospital: Address,
    entries: Vec<(BloodType, BloodComponent, u32, Urgency, u64)>,
) -> Result<Vec<u64>, ContractError>
```

Creates multiple requests in a single transaction. Each tuple is `(blood_type, component, quantity_ml, urgency, required_by_timestamp)`. Returns IDs in input order.

---

### cancel_request

```rust
pub fn cancel_request(
    env: Env,
    caller: Address,
    request_id: u64,
    reason: String,
) -> Result<(), ContractError>
```

Cancels a request. `caller` must be the owning hospital or the admin. Request must be in `Pending` or `Approved` state. `reason` must be non-empty.

- If a reservation exists on the inventory contract, it is released automatically. If inventory refuses the release (for example while it is paused), the call fails with `InventoryReleaseFailed` and nothing changes. Retry once inventory accepts releases.
- Records a history entry.
- Emits `request_cancelled` event.

---

### update_request_status

```rust
pub fn update_request_status(
    env: Env,
    caller: Address,
    request_id: u64,
    new_status: RequestStatus,
    reason: String,
) -> Result<(), ContractError>
```

Admin-only. Transitions a request to `Approved`, `Rejected`, or `Fulfilled`.

- `Approved`: only from `Pending`.
- `Rejected`: from `Pending` or `Approved`; requires non-empty reason; releases any reservation (fails with `InventoryReleaseFailed` if inventory refuses).
- `Fulfilled`: from `Approved` or `InProgress`; sets `fulfilled_quantity_ml = quantity_ml`.
- `InProgress`, `Pending`, `Cancelled` are not valid targets for this function.

Records a history entry and emits `request_status_updated` event.

---

### set_coordinator_contract / update_status_by_contract

```rust
pub fn set_coordinator_contract(env: Env, coordinator_contract: Address) -> Result<(), ContractError>
pub fn update_status_by_contract(
    env: Env,
    caller_contract: Address,
    request_id: u64,
    new_status: RequestStatus,
    reason: String,
) -> Result<(), ContractError>
```

`set_coordinator_contract` (admin only) configures the coordinator contract
trusted to drive the request lifecycle. `update_status_by_contract` is how the
coordinator does it: `caller_contract` must authorize (automatic for the direct
invoking contract) and equal the configured coordinator.

- `Approved` (on allocation), `InProgress` (on delivery) and `Fulfilled` (on
  settlement) follow the same rules as `update_request_status`.
- `Cancelled` (on rollback/expiry) follows `cancel_request`: only from
  `Pending` or `Approved`, non-empty reason.
- `Pending` and `Rejected` are not valid targets.

Errors: `Unauthorized` (another address), `CoordinatorContractNotSet`,
`RequestNotFound`, `InvalidRequestStatus`, `InvalidReason`, `ContractPaused`.

---

### expire_request

```rust
pub fn expire_request(env: Env, request_id: u64) -> Result<(), ContractError>
```

Permissionless: anyone can call it, and no authorization is required. Closes a `Pending` or `Approved` request whose `required_by_timestamp` is strictly earlier than the current ledger time.

- Moves the request to `Cancelled` and records a history entry with reason `"Request expired"`. The actor is the requests contract's own address.
- Releases any inventory reservation and removes the request from the hospital's open-request index.
- Emits `request_expired` with `(request_id, required_by_timestamp, released_reservation, timestamp)`.
- `InProgress` requests are never expired, because their units are already in transit.

Errors: `RequestNotFound`, `InvalidRequestStatus` (not `Pending`/`Approved`), `RequestNotExpired` (deadline not yet passed), `InventoryReleaseFailed`.

The matching contract also skips overdue `Pending` requests, and the payments contract refuses to take payment for them, even before `expire_request` has been called.

---

### partial_fulfill_request

```rust
pub fn partial_fulfill_request(
    env: Env,
    caller: Address,
    request_id: u64,
    fulfilled_delta_ml: u32,
    reason: String,
) -> Result<(), ContractError>
```

Admin-only. Records partial fulfillment. Request must be `Approved` or `InProgress`. `fulfilled_delta_ml` cannot exceed the remaining unfulfilled quantity.

- Transitions to `InProgress` if still partially fulfilled, or `Fulfilled` if complete.
- Records a history entry.

---

### get_request

```rust
pub fn get_request(env: Env, request_id: u64) -> Result<BloodRequest, ContractError>
```

Returns the full `BloodRequest` record including history.

---

### get_request_history

```rust
pub fn get_request_history(env: Env, request_id: u64) -> Result<Vec<RequestHistoryEntry>, ContractError>
```

Returns the history entries for a request.

---

### get_requests_by_hospital

```rust
pub fn get_requests_by_hospital(
    env: Env,
    hospital_id: Address,
    page: u32,
    page_size: u32,
) -> Result<Vec<BloodRequest>, ContractError>
```

Returns a paginated slice of the hospital's **open** requests (`Pending`, `Approved`, `InProgress`). A request is removed from this index when it reaches a terminal status. `page` is zero-indexed. `page_size` is capped at 50.

---

### get_hospital_request_history / get_hospital_request_count

```rust
pub fn get_hospital_request_history(
    env: Env,
    hospital_id: Address,
    page: u32,
    page_size: u32,
) -> Result<Vec<BloodRequest>, ContractError>
pub fn get_hospital_request_count(env: Env, hospital_id: Address) -> Result<u32, ContractError>
```

Every request the hospital has created, in creation order and with its current status: open, fulfilled, cancelled, expired or rejected. It is backed by an append-only index with one storage entry per request, so a page reads only `page_size` entries. `page` is zero-indexed and `page_size` is capped at 50. `get_hospital_request_count` returns the total, for pagination.

Requests created before this index was introduced are not included.

---

### assign_rider

```rust
pub fn assign_rider(
    env: Env,
    caller: Address,
    request_id: u64,
    rider: Address,
) -> Result<(), ContractError>
```

Admin-only (`caller` must be the admin). Assigns an authorized rider to an `Approved` request. Only that rider can then move it to `InProgress`.

---

### get_request_rider

```rust
pub fn get_request_rider(env: Env, request_id: u64) -> Option<Address>
```

Returns the rider assigned to the request via `assign_rider`, or `None` if no rider has been assigned. Read-only accessor used by the identity contract to authorize delivery verification.

---

### get_admin / get_inventory_contract / get_request_counter

```rust
pub fn get_admin(env: Env) -> Result<Address, ContractError>
pub fn get_inventory_contract(env: Env) -> Result<Address, ContractError>
pub fn get_request_counter(env: Env) -> Result<u64, ContractError>
```

Read-only accessors.

---

### is_hospital_authorized / is_initialized

```rust
pub fn is_hospital_authorized(env: Env, hospital: Address) -> bool
pub fn is_initialized(env: Env) -> bool
```

Read-only status checks.

---

### get_metadata

```rust
pub fn get_metadata(env: Env) -> Result<ContractMetadata, ContractError>
```

Returns the contract name and version.

## Types

### BloodRequest

```rust
pub struct BloodRequest {
    pub id: u64,
    pub hospital_id: Address,
    pub blood_type: BloodType,
    pub component: BloodComponent,
    pub quantity_ml: u32,
    pub urgency: Urgency,
    pub created_timestamp: u64,
    pub required_by_timestamp: u64,
    pub status: RequestStatus,
    pub assigned_units: Vec<u64>,
    pub fulfilled_quantity_ml: u32,
    pub reservation_id: Option<u64>,
    pub history: Vec<RequestHistoryEntry>,
}
```

### RequestStatus

`Pending | Approved | InProgress | Fulfilled | Cancelled | Rejected`

### BloodType

`APositive | ANegative | BPositive | BNegative | ABPositive | ABNegative | OPositive | ONegative`

### BloodComponent

`WholeBlood | RedCells | Plasma | Platelets | Cryoprecipitate`

### Urgency

| Variant | Priority |
|---|---|
| `Critical` | 4 (highest) |
| `Urgent` | 3 |
| `Routine` | 2 |
| `Scheduled` | 1 (lowest) |

### RequestHistoryEntry

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

## Storage keys

| Key | Storage tier | Type | Description |
|---|---|---|---|
| `DataKey::Admin` | Instance | `Address` | Admin address |
| `DataKey::InventoryContract` | Instance | `Address` | Inventory contract address |
| `DataKey::RequestCounter` | Instance | `u64` | Auto-increment request ID |
| `DataKey::Initialized` | Instance | `bool` | Initialization flag |
| `DataKey::Metadata` | Instance | `ContractMetadata` | Contract name and version |
| `DataKey::AuthorizedHospital(Address)` | Persistent | `bool` | Hospital authorization flag |
| `DataKey::Request(id)` | Persistent | `BloodRequest` | Full request record including history |
| `DataKey::HospitalRequestIds(Address)` | Persistent | `Vec<u64>` | Hospital's open request IDs (pruned on terminal transitions) |
| `DataKey::HospitalRequestCount(Address)` | Persistent | `u32` | Number of requests the hospital has ever created |
| `DataKey::HospitalRequestAt(Address, u32)` | Persistent | `u64` | Request ID at a position in the hospital's append-only history |
| `DataKey::CoordinatorContract` | Instance | `Address` | Coordinator trusted to call `update_status_by_contract` |

## Error codes

| Code | Meaning |
|---|---|
| `AlreadyInitialized` | Contract already initialized |
| `NotInitialized` | Contract not initialized |
| `Unauthorized` | Caller is not admin |
| `NotAuthorizedHospital` | Hospital not authorized |
| `NotRequestOwner` | Caller is not the hospital or admin |
| `RequestNotFound` | Request not found |
| `InvalidRequestStatus` | Transition not allowed from current status |
| `InvalidQuantity` | quantity_ml is zero or exceeds remaining |
| `InvalidReason` | Reason string is empty |
| `InvalidTimestamp` | required_by_timestamp is in the past |
| `InventoryReleaseFailed` (323) | Inventory refused to release the request's reservation (e.g. inventory paused); the transition was not applied |
| `RequestNotExpired` (324) | `expire_request` called before `required_by_timestamp` passed |
| `CoordinatorContractNotSet` (325) | `update_status_by_contract` called before `set_coordinator_contract` |
