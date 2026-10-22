# Coordinator Contract

**Location:** `lifebank-soroban/contracts/coordinator/src/lib.rs`  
**Purpose:** Orchestrates the three-step HealthDonor workflow across the Inventory, Requests, and Payments contracts in a single atomic sequence. Any step that finds a prerequisite state missing returns an error without making state changes.

---

## Canonical Workflow Sequence

```
1. allocate_units   — Request must be Pending; reserves inventory units.
2. confirm_delivery — Workflow must be Allocated; marks units Delivered.
3. settle_payment   — Workflow must be Delivered; releases escrowed payment.
```

A workflow expires if `confirm_delivery` is not called within 6 hours of `allocate_units`. Anyone may call `expire_workflow` after expiry to roll back.

---

## Workflow Identity

A workflow is keyed by its `request_id` (a `u64`). There is no separate
`workflow_id`: every coordinator entry point that operates on an existing
workflow takes the `request_id` and looks up the corresponding
`WorkflowRecord` from persistent storage. `allocate_units` creates the record
for a request; `confirm_delivery`, `settle_payment`, `rollback`, and
`expire_workflow` all address it by `request_id`.

---

## Public Interface

| Function | Parameters | Returns | Auth |
|---|---|---|---|
| `initialize` | `env, admin, inventory_contract, requests_contract, payments_contract` | `Result<(), CoordinatorError>` | `admin` |
| `allocate_units` | `env, request_id, unit_ids: Vec<u64>, payment_id, caller` | `Result<(), CoordinatorError>` | Authorized |
| `confirm_delivery` | `env, request_id, caller, excursion_summary?: ExcursionSummary` | `Result<(), CoordinatorError>` | Authorized |
| `settle_payment` | `env, request_id, caller` | `Result<(), CoordinatorError>` | Authorized |
| `rollback` | `env, request_id` | `Result<(), CoordinatorError>` | Anyone |
| `expire_workflow` | `env, request_id` | `Result<(), CoordinatorError>` | Anyone (after timeout) |
| `flag_temperature_breach` | `env, caller, payment_id, excursion_summary` | `Result<(), CoordinatorError>` | TemperatureContract |
| `get_workflow` | `env, request_id` | `Result<WorkflowRecord, CoordinatorError>` | Public |

> **Note:** End-to-end settlement is currently blocked by #1445 — the
> coordinator calls the payments contract with the wrong arity. The
> `settle_payment` flow above is documented as intended behaviour and should
> not be treated as working until that issue is resolved.

---

## Storage Layout

| Key | Storage Tier | Description |
|---|---|---|
| `DataKey::Admin` | Instance | Admin address |
| `DataKey::InventoryContract` | Instance | Inventory contract address |
| `DataKey::RequestsContract` | Instance | Requests contract address |
| `DataKey::PaymentsContract` | Instance | Payments contract address |
| `DataKey::Workflow(u64)` | Persistent | `WorkflowRecord` keyed by `request_id` |

---

## Types

### `WorkflowStatus`
```rust
pub enum WorkflowStatus {
    Allocated,
    Delivered,
    Settled,
    Expired,
    TemperatureBreach,
}
```

### `WorkflowRecord`
```rust
pub struct WorkflowRecord {
    pub request_id: u64,
    pub unit_ids: Vec<u64>,
    pub status: WorkflowStatus,
    pub allocated_at: u64,
    pub delivered_at: Option<u64>,
    pub settled_at: Option<u64>,
    pub expires_at: u64,
}
```

### `ExcursionSummary`
Passed by the Temperature contract to summarise cold-chain violations:
```rust
pub struct ExcursionSummary {
    pub unit_id: u64,
    pub violation_count: u32,
    pub max_deviation_x100: i32,
}
```

---

## Events

| Topics | When |
|---|---|
| `["workflow", "allocated"]` | `allocate_units` succeeds |
| `["workflow", "delivered"]` | `confirm_delivery` succeeds |
| `["workflow", "settled"]` | `settle_payment` succeeds |
| `["workflow", "rolled_back"]` | `rollback` succeeds |
| `["workflow", "expired"]` | `expire_workflow` succeeds |
| `["workflow", "breach"]` | Temperature breach flagged |

---

## Error Codes

| Name | Meaning |
|---|---|
| `NotInitialized` | Contract has not been initialized |
| `AlreadyInitialized` | `initialize` called more than once |
| `Unauthorized` | Caller not permitted for this action |
| `WorkflowNotFound` | No workflow with the given `request_id` |
| `InvalidWorkflowStatus` | Step called out of sequence |
| `WorkflowExpired` | Workflow timeout has elapsed |
| `WorkflowNotExpired` | `expire_workflow` called before timeout |

---

## Constants

| Name | Value | Meaning |
|---|---|---|
| `WORKFLOW_TIMEOUT_SECS` | `21600` (6 hours) | Window between allocate and confirm |

---

## Keeping This Table In Sync

The signatures above are generated from the coordinator's `#[contractimpl]`
block. To regenerate them from the contract spec instead of hand-editing,
run `stellar contract bindings` against the built coordinator WASM (or use the
`packages/*-sdk` output) and copy the resulting function signatures here, so
the table cannot drift from the contract again.
