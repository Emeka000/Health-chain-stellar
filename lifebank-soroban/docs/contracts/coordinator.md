# Coordinator Contract

The coordinator is the integration hub. It holds references to the requests, inventory, and payments contracts and enforces the canonical three-step delivery workflow. No blood unit can be delivered and no payment can be released without passing through this contract.

## Deployment wiring

The coordinator authorizes every cross-contract call as itself (a direct
sub-call satisfies `require_auth` for the invoking contract), so a workflow
step only needs the coordinator admin's signature and `expire_workflow` needs
none. For that to work:

- the coordinator must be the payments contract's admin;
- inventory must trust it: `inventory.set_coordinator_contract(admin, coordinator)`;
- requests must trust it: `requests.set_coordinator_contract(coordinator)`.

The coordinator drives the request lifecycle through
`requests.update_status_by_contract`:

| Coordinator step | Request status |
|---|---|
| `allocate_units` | `Pending → Approved` |
| `confirm_delivery` | `Approved → InProgress` |
| `settle_payment` | `→ Fulfilled` |
| `rollback` / `expire_workflow` | `→ Cancelled` (skipped if already closed) |

## State machine

```
                    ┌─────────┐
                    │ Pending │  (implicit — no WorkflowRecord yet)
                    └────┬────┘
                         │ allocate_units()
                         ▼
                   ┌───────────┐
                   │ Allocated │
                   └─────┬─────┘
                         │ confirm_delivery()
                         ▼
                   ┌───────────┐
                   │ Delivered │
                   └─────┬─────┘
                         │ settle_payment()
                         ▼
                    ┌─────────┐
                    │ Settled │  (terminal)
                    └─────────┘

  Any non-Settled state ──► rollback() ──► RolledBack (terminal)
```

## Public functions

### initialize

```rust
pub fn initialize(
    env: Env,
    admin: Address,
    request_contract: Address,
    inventory_contract: Address,
    payment_contract: Address,
) -> Result<(), CoordinatorError>
```

One-time setup. Stores the admin address and the three domain contract addresses. Emits `(coord, init, v1)` event. Returns `AlreadyInitialized` if called again.

---

### allocate_units

```rust
pub fn allocate_units(
    env: Env,
    request_id: u64,
    unit_ids: Vec<u64>,
    payment_id: u64,
    caller: Address,
) -> Result<(), CoordinatorError>
```

Step 1 of the workflow.

- Requires `caller` auth (must be the admin).
- Fails with `WorkflowAlreadyStarted` if any workflow (terminal or not) exists
  for `request_id`.
- Verifies the request exists and is `Pending`.
- Verifies the payment is bound to `request_id`, is `Locked`
  (`PaymentNotLocked`), is token-backed escrow (`PaymentNotEscrowed`) and was
  paid by the request's hospital (`PaymentPayerMismatch`).
- Verifies each blood unit exists and is `Available` and ABO/Rh-compatible with
  the request's blood type, then marks it `Reserved`.
- Moves the request to `Approved`.
- Creates a `WorkflowRecord` with status `Allocated`.
- Emits `(coord, alloc, v1)` with `(request_id, unit_ids, unit_count)`.

Fails if the contract is paused.

---

### confirm_delivery

```rust
pub fn confirm_delivery(
    env: Env,
    request_id: u64,
    caller: Address,
    location: String,
) -> Result<(), CoordinatorError>
```

Step 2 of the workflow.

- Requires `caller` auth.
- Workflow must be `Allocated`.
- The request must still be `Approved` (moved to `InProgress`) or already
  `InProgress`; otherwise `InvalidRequestState`.
- Transitions each unit: `Reserved → InTransit`, then `InTransit → Delivered` (via `mark_delivered`).
- Sets `delivery_confirmed = true` and stores `delivery_location`.
- Emits `(coord, dlvrd, v1)` with `(request_id, location)`.

Blocked by both `pause()` and `emergency_halt()`.

---

### settle_payment

```rust
pub fn settle_payment(
    env: Env,
    request_id: u64,
    caller: Address,
) -> Result<(), CoordinatorError>
```

Step 3 of the workflow.

- Requires `caller` auth.
- Workflow must be `Delivered` with `delivery_confirmed == true`.
- Payment must be `Locked`; records the coordinator's half of the escrow
  release (tokens move once the hospital calls `confirm_receipt`).
- Marks the request `Fulfilled`.
- Emits `(coord, settld, v1)` with `(request_id, payment_id)`.

Blocked by both `pause()` and `emergency_halt()`.

---

### rollback

```rust
pub fn rollback(env: Env, request_id: u64) -> Result<(), CoordinatorError>
```

Admin-only. Reverses an `Allocated` workflow.

- Returns all allocated units to `Available`.
- If the payment is `Locked`, refunds it. Other payment states are left unchanged.
- Cancels the request unless it is already closed.
- Sets workflow status to `RolledBack`; the request cannot be allocated again.
- Emits `(coord, rollbk, v1)` with `request_id`.

Returns `CannotRollbackSettled` if the workflow has already settled.

---

### expire_workflow

```rust
pub fn expire_workflow(env: Env, request_id: u64) -> Result<(), CoordinatorError>
```

Permissionless: anyone may call it once `ledger.timestamp() >= expires_at` on
an `Allocated` workflow. Performs the same unwinding as `rollback` without any
signature. Emits `(coord, expired, v1)` with `request_id`.

---

### flag_temperature_breach

```rust
pub fn flag_temperature_breach(
    env: Env,
    caller: Address,
    payment_id: u64,
    excursion_summary: ExcursionSummary,
) -> Result<(), CoordinatorError>
```

Called by the temperature contract when a sustained excursion is detected.

- Requires `caller` auth (must be a whitelisted oracle or admin on the temperature contract side).
- Payment must be `Locked`; calls `payments.record_dispute(TemperatureExcursion)`.
- Emits `(coord, tmp_brch)` with `(payment_id, unit_id, timestamp)`.

---

### pause / unpause

```rust
pub fn pause(env: Env, admin: Address) -> Result<(), CoordinatorError>
pub fn unpause(env: Env, admin: Address) -> Result<(), CoordinatorError>
pub fn is_paused(env: Env) -> bool
```

Admin-only circuit breaker. Blocks `allocate_units`, `confirm_delivery`, `settle_payment`, and `rollback`.

---

### emergency_halt / clear_emergency_halt

```rust
pub fn emergency_halt(env: Env, admin: Address) -> Result<(), CoordinatorError>
pub fn clear_emergency_halt(env: Env, admin: Address) -> Result<(), CoordinatorError>
pub fn is_emergency_halted(env: Env) -> bool
```

Admin-only. Unlike `pause()`, the emergency halt is stored in its own
`DataKey::EmergencyHalt` flag and gates every workflow entry point
(`allocate_units`, `confirm_delivery`, `settle_payment`, `rollback`,
`expire_workflow` and the temperature-breach paths) with
`CoordinatorError::EmergencyHalted`. The two flags are cleared separately:
`unpause()` never clears the halt, and `clear_emergency_halt()` never clears the
pause — an incident therefore has to be acknowledged explicitly. Emits
`(coord, emrghlt, v1)` on activation.

---

### get_workflow

```rust
pub fn get_workflow(env: Env, request_id: u64) -> Result<WorkflowRecord, CoordinatorError>
```

Returns the `WorkflowRecord` for a request. Returns `WorkflowNotFound` if no workflow exists.

---

### is_initialized

```rust
pub fn is_initialized(env: Env) -> bool
```

Returns `true` if `initialize()` has been called.

## Types

### WorkflowRecord

```rust
pub struct WorkflowRecord {
    pub request_id: u64,
    pub payment_id: u64,
    pub unit_ids: Vec<u64>,
    pub status: WorkflowStatus,
    pub delivery_confirmed: bool,
    pub delivery_location: Option<String>,
    /// `ledger.timestamp() + 6h` at allocation time; `expire_workflow` may be
    /// called by anyone once this has elapsed.
    pub expires_at: u64,
}
```

### WorkflowStatus

```rust
pub enum WorkflowStatus {
    Pending,
    Allocated,
    Delivered,
    Settled,
    RolledBack,
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
| `DataKey::RequestContract` | Instance | `Address` | Requests contract address |
| `DataKey::InventoryContract` | Instance | `Address` | Inventory contract address |
| `DataKey::PaymentContract` | Instance | `Address` | Payments contract address |
| `DataKey::Paused` | Instance | `bool` | Pause flag |
| `DataKey::EmergencyHalt` | Instance | `bool` | Emergency halt flag |
| `DataKey::Workflow(request_id)` | Persistent | `WorkflowRecord` | Per-request workflow state |

## Error codes

| Code | Value | Meaning |
|---|---|---|
| `AlreadyInitialized` | 800 | `initialize()` called twice |
| `NotInitialized` | 801 | Contract not yet initialized |
| `Unauthorized` | 802 | Caller is not admin |
| `WorkflowNotFound` | 810 | No workflow for this request_id |
| `WorkflowAlreadyStarted` | 811 | A workflow (terminal or not) already exists for this request |
| `InvalidWorkflowState` | 812 | Wrong workflow state for this step |
| `CannotRollbackSettled` | 813 | Workflow already settled |
| `RequestNotFound` | 820 | Cross-contract: request not found |
| `InvalidRequestState` | 821 | Request is not Pending |
| `UnitNotFound` | 822 | Cross-contract: blood unit not found |
| `UnitNotAvailable` | 823 | Blood unit is not Available |
| `PaymentNotFound` | 824 | Cross-contract: payment not found |
| `InvalidPaymentState` | 825 | Payment is not in expected state |
| `DeliveryNotConfirmed` | 826 | settle_payment called before confirm_delivery |
| `IncompatibleBloodType` | 827 | Unit cannot donate to the request's blood type |
| `NoUnitsSpecified` | 828 | `unit_ids` is empty |
| `PaymentRequestMismatch` | 829 | Payment belongs to another request |
| `InventoryUpdateFailed` | 830 | Cross-contract call to inventory failed |
| `PaymentUpdateFailed` | 831 | Cross-contract call to payments failed |
| `PaymentFlagFailed` | 832 | Cross-contract dispute recording failed |
| `RequestUpdateFailed` | 833 | Requests contract refused a lifecycle transition |
| `ContractPaused` | 840 | Contract is paused |
| `EmergencyHalted` | 841 | Emergency halt is active |
| `WorkflowNotExpired` | 842 | `expire_workflow` called before `expires_at` |
| `PaymentNotLocked` | 850 | Bound payment is not `Locked` (e.g. `Pending`, `Disputed`) |
| `PaymentNotEscrowed` | 851 | Bound payment has no token behind it |
| `PaymentPayerMismatch` | 852 | Bound payment was not paid by the request's hospital |
