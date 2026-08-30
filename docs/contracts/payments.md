# Payments Contract

**Location:** `lifebank-soroban/contracts/payments/src/lib.rs`  
**Purpose:** Manages the full payment lifecycle for blood-unit transactions: escrow lock, conditional release, refund, and dispute resolution. Supports both native XLM and arbitrary SEP-41 tokens.

---

## Public Interface

### Initialization

| Function | Parameters | Returns | Auth |
|---|---|---|---|
| `initialize` | `env, admin: Address` | `Result<(), PaymentsError>` | `admin` |

### Payment Lifecycle

| Function | Parameters | Returns | Auth |
|---|---|---|---|
| `lock_payment` | `env, payer, payee, request_id, amount: i128, token?: Address` | `Result<u64, PaymentsError>` (payment_id) | `payer` |
| `release_payment` | `env, caller, payment_id` | `Result<(), PaymentsError>` | Admin or Coordinator |
| `refund_payment` | `env, caller, payment_id` | `Result<(), PaymentsError>` | Admin |
| `cancel_payment` | `env, caller, payment_id` | `Result<(), PaymentsError>` | `payer` while Pending |

### Disputes

| Function | Parameters | Returns | Auth |
|---|---|---|---|
| `open_dispute` | `env, caller, payment_id, reason: DisputeReason` | `Result<(), PaymentsError>` | `payer` or `payee` |
| `resolve_dispute` | `env, admin, payment_id, release_to_payee: bool, case_id: String` | `Result<(), PaymentsError>` | Admin |

### Query

| Function | Parameters | Returns | Auth |
|---|---|---|---|
| `get_payment` | `env, payment_id` | `Result<Payment, PaymentsError>` | Public |
| `get_payments_by_request` | `env, request_id` | `Vec<Payment>` | Public |
| `get_payments_paginated` | `env, page: u32, page_size: u32` | `PaymentPage` | Public |
| `get_stats` | `env` | `PaymentStats` | Public |

---

## Storage Layout

| Key | Storage Tier | Description |
|---|---|---|
| `DataKey::Admin` | Instance | Admin address |
| `DataKey::PaymentCounter` | Instance | Auto-increment payment ID |
| `DataKey::Payment(u64)` | Persistent | `Payment` record by ID |
| `DataKey::RequestPayments(u64)` | Persistent | `Vec<u64>` of payment IDs per request |
| `DataKey::Stats` | Instance | Aggregate `PaymentStats` |

---

## Types

### `PaymentStatus`
```rust
pub enum PaymentStatus {
    Pending,    // Created, awaiting lock
    Locked,     // Funds held in escrow
    Released,   // Funds transferred to payee
    Refunded,   // Funds returned to payer
    Disputed,   // Dispute open
    Cancelled,  // Cancelled before lock
}
```

### `Payment`
```rust
pub struct Payment {
    pub id: u64,
    pub request_id: u64,
    pub payer: Address,
    pub payee: Address,
    pub amount: i128,
    pub status: PaymentStatus,
    pub created_at: u64,
    pub updated_at: u64,
    pub dispute_reason_code: Option<u32>,
    pub dispute_case_id: Option<String>,
    pub dispute_resolved: bool,
    pub token: Option<Address>,   // None = native XLM
}
```

### `DisputeReason`
```rust
pub enum DisputeReason {
    FailedDelivery,           // code 1
    TemperatureExcursion,     // code 2
    PaymentContested,         // code 3
    WrongItem,                // code 4
    DamagedGoods,             // code 5
    LateDelivery,             // code 6
    Other,                    // code 7
}
```

### `PaymentStats`
```rust
pub struct PaymentStats {
    pub total_locked: i128,
    pub total_released: i128,
    pub total_refunded: i128,
    pub count_locked: u32,
    pub count_released: u32,
    pub count_refunded: u32,
}
```

---

## Events

| Topics | Data | When |
|---|---|---|
| `["payment", "locked"]` | `{payment_id, amount, payer, payee}` | Escrow locked |
| `["payment", "released"]` | `{payment_id, amount}` | Funds released to payee |
| `["payment", "refunded"]` | `{payment_id, amount}` | Funds returned to payer |
| `["payment", "disputed"]` | `{payment_id, reason_code}` | Dispute opened |
| `["payment", "resolved"]` | `{payment_id, case_id, released_to_payee}` | Dispute resolved |

---

## Status Transition Rules

```
Pending → Locked  (lock_payment)
Pending → Cancelled  (cancel_payment)
Locked  → Released  (release_payment)
Locked  → Refunded  (refund_payment)
Locked  → Disputed  (open_dispute)
Disputed → Released  (resolve_dispute, release_to_payee=true)
Disputed → Refunded  (resolve_dispute, release_to_payee=false)
```

---

## Error Codes

| Name | Meaning |
|---|---|
| `NotInitialized` | Contract not initialized |
| `AlreadyInitialized` | `initialize` called twice |
| `Unauthorized` | Caller not permitted |
| `PaymentNotFound` | Payment ID does not exist |
| `InvalidStatus` | Transition not valid in current status |
| `DisputeAlreadyOpen` | A dispute is already open for this payment |
| `InsufficientFunds` | Payer balance too low to lock |
