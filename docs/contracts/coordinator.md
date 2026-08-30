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

## Public Interface

| Function | Parameters | Returns | Auth |
|---|---|---|---|
| `initialize` | `env, admin, inventory_contract, requests_contract, payments_contract` | `Result<(), CoordinatorError>` | `admin` |
| `allocate_units` | `env, caller, request_id, unit_ids: Vec<u64>` | `Result<u64, CoordinatorError>` (workflow_id) | Authorized |
| `confirm_delivery` | `env, caller, workflow_id, excursion_summary?: ExcursionSummary` | `Result<(), CoordinatorError>` | Authorized |
| `settle_payment` | `env, caller, workflow_id` | `Result<(), CoordinatorError>` | Authorized |
| `expire_workflow` | `env, caller, workflow_id` | `Result<(), CoordinatorError>` | Anyone (after timeout) |
| `flag_temperature_breach` | `env, caller, payment_id, excursion_summary` | `Result<(), CoordinatorError>` | TemperatureContract |
| `get_workflow` | `env, workflow_id` | `Result<WorkflowRecord, CoordinatorError>` | Public |

---

## Storage Layout

| Key | Storage Tier | Description |
|---|---|---|
| `DataKey::Admin` | Instance | Admin address |
| `DataKey::InventoryContract` | Instance | Inventory contract address |
| `DataKey::RequestsContract` | Instance | Requests contract address |
| `DataKey::PaymentsContract` | Instance | Payments contract address |
| `DataKey::WorkflowCounter` | Instance | Auto-increment workflow ID |
| `DataKey::Workflow(u64)` | Persistent | `WorkflowRecord` by workflow ID |

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
    pub id: u64,
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
| `["workflow", "expired"]` | `expire_workflow` succeeds |
| `["workflow", "breach"]` | Temperature breach flagged |

---

## Error Codes

| Name | Meaning |
|---|---|
| `NotInitialized` | Contract has not been initialized |
| `AlreadyInitialized` | `initialize` called more than once |
| `Unauthorized` | Caller not permitted for this action |
| `WorkflowNotFound` | No workflow with the given ID |
| `InvalidWorkflowStatus` | Step called out of sequence |
| `WorkflowExpired` | Workflow timeout has elapsed |
| `WorkflowNotExpired` | `expire_workflow` called before timeout |

---

## Constants

| Name | Value | Meaning |
|---|---|---|
| `WORKFLOW_TIMEOUT_SECS` | `21600` (6 hours) | Window between allocate and confirm |
