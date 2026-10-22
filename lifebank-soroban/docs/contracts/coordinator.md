# Coordinator Contract

The coordinator is the integration hub. It holds references to the requests, inventory, and payments contracts and enforces the canonical three-step delivery workflow. No blood unit can be delivered and no payment can be released without passing through this contract.

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
    blood_type: BloodType,
) -> Result<(), CoordinatorError>
```

Step 1 of the workflow.

- Requires `caller` auth (must be the admin).
- Verifies the request exists, is `Pending`, and that `blood_type` matches the
  request's blood type.
- Verifies the payment exists and is bound to `request_id`.
- Verifies each blood unit exists and is `Available` and compatible with
  `blood_type`, then marks it `Reserved`.
- Creates a `WorkflowRecord` with status `Allocated`.
- Emits `(coord, alloc, v1)` with `(request_id, unit_ids, unit_count)`.

Fails if the contract is paused or halted, or a workflow for this `request_id`
already exists in a non-terminal state.

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
- Payment must be `Locked`; transitions it to `Released`.
- Emits `(coord, settld, v1)` with `(request_id, payment_id)`.

Blocked by both `pause()` and `emergency_halt()`.

---

### rollback

```rust
pub fn rollback(env: Env, request_id: u64) -> Result<(), CoordinatorError>
```

Admin-only. Reverses an in-flight workflow.

- Returns all allocated units to `Available`.
- If the payment is `Locked`, transitions it to `Refunded`. Other payment states are left unchanged.
- Sets workflow status to `RolledBack`.
- Emits `(coord, rollbk, v1)` with `request_id`.

Returns `CannotRollbackSettled` if the workflow has already settled.

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
| `WorkflowAlreadyStarted` | 811 | Workflow exists and is not Pending |
| `InvalidWorkflowState` | 812 | Wrong workflow state for this step |
| `CannotRollbackSettled` | 813 | Workflow already settled |
| `RequestNotFound` | 820 | Cross-contract: request not found |
| `InvalidRequestState` | 821 | Request is not Pending |
| `UnitNotFound` | 822 | Cross-contract: blood unit not found |
| `UnitNotAvailable` | 823 | Blood unit is not Available |
| `PaymentNotFound` | 824 | Cross-contract: payment not found |
| `InvalidPaymentState` | 825 | Payment is not in expected state |
| `DeliveryNotConfirmed` | 826 | settle_payment called before confirm_delivery |
| `InventoryUpdateFailed` | 830 | Cross-contract call to inventory failed |
| `PaymentUpdateFailed` | 831 | Cross-contract call to payments failed |
| `PaymentFlagFailed` | 832 | Cross-contract dispute recording failed |
| `ContractPaused` | 840 | Contract is paused |
| `EmergencyHalted` | 841 | Emergency halt is active |
