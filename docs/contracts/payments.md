# Payments Contract

**Location:** `lifebank-soroban/contracts/payments/src/lib.rs`  
**Canonical doc:** `lifebank-soroban/docs/contracts/payments.md`  
**Purpose:** Manages the full payment lifecycle for blood-unit transactions: escrow lock, two-party conditional release, refund, vesting, pledges, token allowlist, and dispute resolution. Supports both native XLM and allowlisted SEP-41 tokens.

---

## Public Interface

### Initialization

| Function | Parameters | Returns | Auth |
|---|---|---|---|
| `initialize` | `env, admin: Address, requests_contract: Option<Address>` | `Result<(), PaymentsError>` | `admin` |

### Payment Lifecycle

| Function | Parameters | Returns | Auth |
|---|---|---|---|
| `create_payment` | `env, payer, payee, request_id, amount: i128, token: Option<Address>` | `Result<u64, PaymentsError>` (payment_id) | `payer` |
| `create_escrow` | `env, request_id, hospital, payee, amount: i128, token: Option<Address>` | `Result<u64, PaymentsError>` (payment_id) | `hospital` |
| `release_escrow` | `env, caller, payment_id` | `Result<(), PaymentsError>` | Admin or Coordinator |
| `confirm_receipt` | `env, payment_id, hospital` | `Result<(), PaymentsError>` | `hospital` |
| `refund_escrow` | `env, caller, payment_id` | `Result<(), PaymentsError>` | Admin |
| `update_status` | `env, caller, payment_id, status: PaymentStatus` | `Result<(), PaymentsError>` | Admin (bookkeeping payments only) |

### Disputes

| Function | Parameters | Returns | Auth |
|---|---|---|---|
| `record_dispute` | `env, payment_id, reason: DisputeReason, case_id: String, caller` | `Result<(), PaymentsError>` | `payer` or `payee` |
| `resolve_dispute` | `env, admin, payment_id, release_to_payee: bool, case_id: String` | `Result<(), PaymentsError>` | Admin |
| `process_expired_disputes` | `env, caller` | `Result<u32, PaymentsError>` (count processed) | Admin |

### Vesting & Pledges

| Function | Parameters | Returns | Auth |
|---|---|---|---|
| `create_vesting` | `env, payer, payee, amount: i128, start: u64, cliff: u64, duration: u64, token: Option<Address>` | `Result<u64, PaymentsError>` | `payer` |
| `claim_vested` | `env, caller, vesting_id` | `Result<i128, PaymentsError>` | `payee` |
| `create_pledge` | `env, donor, request_id, amount: i128, token: Option<Address>` | `Result<u64, PaymentsError>` | `donor` |
| `fulfill_pledge` | `env, caller, pledge_id` | `Result<(), PaymentsError>` | `donor` |

### Token Allowlist

| Function | Parameters | Returns | Auth |
|---|---|---|---|
| `add_allowed_token` | `env, admin, token: Address` | `Result<(), PaymentsError>` | Admin |
| `remove_allowed_token` | `env, admin, token: Address` | `Result<(), PaymentsError>` | Admin |
| `is_token_allowed` | `env, token: Address` | `bool` | Public |

### Query

| Function | Parameters | Returns | Auth |
|---|---|---|---|
| `get_payment` | `env, payment_id` | `Result<Payment, PaymentsError>` | Public |
| `get_payment_by_request` | `env, request_id` | `Option<Payment>` | Public |
| `get_payment_timeline` | `env, payment_id` | `Vec<PaymentEvent>` | Public |
| `get_payments_by_payer` | `env, payer` | `Vec<Payment>` | Public |
| `get_payments_by_payee` | `env, payee` | `Vec<Payment>` | Public |
| `get_payments_by_status` | `env, status: PaymentStatus` | `Vec<Payment>` | Public |
| `get_payment_statistics` | `env` | `PaymentStats` | Public |

> The tables above mirror the public surface of `lib.rs`. For the authoritative, always-current interface run `stellar contract info interface --wasm <payments.wasm>` or see `lifebank-soroban/docs/contracts/payments.md`.

---

## Storage Layout

| Key | Storage Tier | Description |
|---|---|---|
| `DataKey::Admin` | Instance | Admin address |
| `DataKey::RequestsContract` | Instance | Optional requests-contract address |
| `DataKey::PaymentCounter` | Instance | Auto-increment payment ID |
| `DataKey::Payment(u64)` | Persistent | `Payment` record by ID |
| `DataKey::PaymentByRequest(u64)` | Persistent | Payment ID indexed by request |
| `DataKey::AllowedToken(Address)` | Persistent | Token allowlist entry |
| `DataKey::Vesting(u64)` | Persistent | Vesting schedule by ID |
| `DataKey::Pledge(u64)` | Persistent | Pledge record by ID |

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
    Cancelled,  // Cancelled before lock (bookkeeping only)
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
| `["payment", "disputed"]` | `{payment_id, reason_code}` | Dispute recorded |
| `["payment", "resolved"]` | `{payment_id, case_id, released_to_payee}` | Dispute resolved |

---

## Status Transition Rules

```
Pending → Locked  (create_escrow / create_payment)
Pending → Cancelled  (update_status, bookkeeping payments only)
Locked  → Released  (release_escrow + confirm_receipt, two-party)
Locked  → Refunded  (refund_escrow)
Locked  → Disputed  (record_dispute)
Disputed → Released  (resolve_dispute, release_to_payee=true)
Disputed → Refunded  (resolve_dispute, release_to_payee=false)
Disputed → Refunded  (process_expired_disputes, timeout)
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
| `TokenNotAllowed` | Token is not on the allowlist |
