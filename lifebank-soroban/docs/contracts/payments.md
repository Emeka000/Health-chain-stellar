# Payments Contract

Handles escrow-backed payments, donation pledges, vesting schedules, and dispute management. Integrates with the requests contract to validate request state before accepting payments.

## Payment lifecycle

```
create_payment()          create_escrow()
      │                         │
      ▼                         ▼
  Pending                    Locked  ◄── funds held in contract
      │                         │
      │ update_status()         │ settle_payment() via coordinator
      ▼                         ▼
  Locked                    Released  ──► funds transferred to payee
      │
      │ record_dispute()
      ▼
  Disputed
      │
      │ resolve_dispute()
      ▼
  (stays Disputed, dispute_resolved = true)

  Locked ──► Refunded  (via rollback or refund_escrow)
  Any    ──► Cancelled
```

## Public functions

### initialize

```rust
pub fn initialize(
    env: Env,
    admin: Address,
    requests_contract: Option<Address>,
) -> Result<(), Error>
```

One-time setup. Optionally links the requests contract for payment creation validation. If `requests_contract` is provided, `create_payment` and `create_escrow` will verify the request is in `Pending` or `Approved` state before accepting.

---

### create_payment

```rust
pub fn create_payment(
    env: Env,
    request_id: u64,
    payer: Address,
    payee: Address,
    amount: i128,
) -> Result<u64, Error>
```

Creates a non-escrow payment record in `Pending` status. `payer` must sign. `amount` must be positive and `payer != payee`. Only one payment per `request_id` is allowed (`DuplicatePayment` otherwise). Returns the new payment ID.

---

### batch_create_payments

```rust
pub fn batch_create_payments(
    env: Env,
    payments: Vec<(u64, Address, Address, i128)>,
) -> Result<Vec<u64>, Error>
```

Creates multiple payments in a single transaction. Each tuple is `(request_id, payer, payee, amount)`. Returns IDs in input order.

---

### create_escrow

```rust
pub fn create_escrow(
    env: Env,
    request_id: u64,
    hospital: Address,
    payee: Address,
    amount: i128,
    token: Address,
) -> Result<u64, Error>
```

Creates an escrow-backed payment. Transfers `amount` of `token` from `hospital` into the contract immediately. The payment starts in `Locked` status. If the token transfer fails, no payment record is written. Returns the new payment ID.

---

### release_escrow

```rust
pub fn release_escrow(env: Env, caller: Address, payment_id: u64) -> Result<(), Error>
```

Admin-only. Transfers the locked amount from the contract to the payee and marks the payment `Released`. Payment must be `Locked` and must have a token address (`NotEscrowPayment` otherwise).

---

### refund_escrow

```rust
pub fn refund_escrow(env: Env, caller: Address, payment_id: u64) -> Result<(), Error>
```

Admin-only. Transfers the locked amount back to the payer and marks the payment `Refunded`. Same preconditions as `release_escrow`.

---

### update_status

```rust
pub fn update_status(env: Env, payment_id: u64, status: PaymentStatus) -> Result<(), Error>
```

Transitions a payment to any status. Called by the coordinator during `settle_payment` (→ `Released`) and `rollback` (→ `Refunded`). Updates status indexes and aggregate stats. Emits `(payment, status)` event with `(payment_id, old_status, new_status)`.

---

### record_dispute

```rust
pub fn record_dispute(
    env: Env,
    payment_id: u64,
    reason: DisputeReason,
    case_id: String,
) -> Result<(), Error>
```

Transitions the payment to `Disputed` and records the reason code and case ID. Called by the coordinator when a temperature excursion is detected. Emits `(payment, disputed, v1)` event.

---

### resolve_dispute

```rust
pub fn resolve_dispute(env: Env, payment_id: u64) -> Result<(), Error>
```

Marks `dispute_resolved = true` on the payment. Does not change the payment status — the payment remains `Disputed` until explicitly transitioned.

---

### get_payment

```rust
pub fn get_payment(env: Env, payment_id: u64) -> Result<Payment, Error>
```

Returns the full `Payment` record.

---

### get_payment_by_request

```rust
pub fn get_payment_by_request(env: Env, request_id: u64) -> Result<Payment, Error>
```

Looks up the active payment for a request via the request index. Returns `PaymentNotFound` if no active payment exists (index is removed when payment reaches a terminal state).

---

### get_payments_by_payer / get_payments_by_payee / get_payments_by_status

```rust
pub fn get_payments_by_payer(env: Env, payer: Address, page: u32, page_size: u32) -> PaymentPage
pub fn get_payments_by_payee(env: Env, payee: Address, page: u32, page_size: u32) -> PaymentPage
pub fn get_payments_by_status(env: Env, status: PaymentStatus, page: u32, page_size: u32) -> PaymentPage
```

Paginated queries. `page` is zero-indexed. `page_size` defaults to 20 if 0 is passed and is capped at 100.

Every index entry and payment record read by a query has its TTL extended (#1804), as do `get_payment`, `get_payment_by_request` and `get_payment_timeline`. A long-lived escrow or an old index page therefore stays live as long as it is being read. Note that a read only persists a TTL bump when it runs inside a submitted transaction; RPC simulation alone does not. `total` is always the index length; an entry is skipped only if its payment record is genuinely missing.

---

### Donation pledges

```rust
pub fn create_pledge(env, donor, amount_per_period: i128, interval_secs: u64,
    payee_pool: String, cause: String, region: String, emergency_pool: bool) -> Result<u64, Error>
pub fn get_pledge(env, pledge_id: u64) -> Result<DonationPledge, Error>
pub fn get_pledges_by_donor(env, donor: Address, page: u32, page_size: u32) -> PledgePage
pub fn set_pledge_active(env, pledge_id: u64, donor: Address, active: bool) -> Result<(), Error>
```

**Pledges are off-chain commitments.** A pledge records intent only: no token is transferred or escrowed, and nothing on-chain executes it every `interval_secs`. The backend (or the donor's wallet) makes each periodic donation as an ordinary payment and uses the pledge record and its events to schedule and reconcile them.

- `payee_pool`, `cause` and `region` are limited to `MAX_PLEDGE_STRING_LEN` (64) bytes each; longer values fail with `StringTooLong`.
- `get_pledges_by_donor` pages through a per-donor, append-only index, oldest first (`page_size` 0 → 20, capped at 100).
- `set_pledge_active` (donor only) emits `("pledge", "status")` with `(pledge_id, donor, active)` when the flag changes; setting the current value is a no-op.

---

### Vesting

```rust
pub fn create_vesting(env, admin, donor, reward_token: Address, total_amount: i128,
    cliff_secs: u64, duration_secs: u64) -> Result<u64, Error>          // returns schedule_id
pub fn claim_vested(env, donor: Address, schedule_id: u64) -> Result<i128, Error>
pub fn revoke_vesting(env, admin, donor: Address, schedule_id: u64) -> Result<i128, Error>
pub fn get_vesting(env, donor: Address, schedule_id: u64) -> Result<VestingSchedule, Error>
pub fn get_claimable_vested(env, donor: Address, schedule_id: u64) -> Result<i128, Error>
```

**Model: standard cliff vesting (#1803).** Tokens accrue linearly from `start_timestamp` (creation time) to `vest_end_timestamp`. The cliff only gates claims: before `cliff_timestamp` nothing can be claimed, and at the cliff everything accrued since the start becomes claimable at once. A 12-month schedule with a 3-month cliff releases 3/12 at the cliff and the rest linearly over the remaining 9 months.

- A donor may hold several concurrent schedules, each addressed by `(donor, schedule_id)`. A schedule is removed once fully claimed.
- `reward_token` must be on the token allowlist (`TokenNotAllowed` otherwise).
- Vested amounts are computed exactly without intermediate overflow; any arithmetic failure is `Overflow`, never a silent 0.
- `revoke_vesting` (admin only) stops accrual, transfers the unvested remainder back to the admin and releases it from the vesting reserve. Anything vested but unclaimed stays claimable by the donor. Revoking before the cliff returns everything. Fails with `VestingRevoked` if already revoked and `NothingToRevoke` if the schedule is fully vested.
- Events: `("vest", "created")` `(schedule_id, donor, total_amount, start_timestamp, cliff_timestamp, vest_end_timestamp)`, `("vest", "claimed")` `(schedule_id, donor, claimable, new_claimed)`, `("vest", "revoked")` `(schedule_id, donor, unvested_returned, vested_remaining)`.

---

### get_stats

```rust
pub fn get_stats(env: Env) -> PaymentStats
```

Returns aggregate stats: total locked/released/refunded amounts and counts.

---

### pause / unpause / is_paused

```rust
pub fn pause(env: Env, admin: Address) -> Result<(), Error>
pub fn unpause(env: Env, admin: Address) -> Result<(), Error>
pub fn is_paused(env: Env) -> bool
```

Admin-only circuit breaker.

## Types

### Payment

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
    pub token: Option<Address>,  // set only for escrow payments
}
```

### PaymentStatus

`Pending | Locked | Released | Refunded | Disputed | Cancelled`

### DisputeReason

| Variant | Code |
|---|---|
| `FailedDelivery` | 1 |
| `TemperatureExcursion` | 2 |
| `PaymentContested` | 3 |
| `WrongItem` | 4 |
| `DamagedGoods` | 5 |
| `LateDelivery` | 6 |
| `Other` | 7 |

### PaymentStats

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

### PaymentPage

```rust
pub struct PaymentPage {
    pub items: Vec<Payment>,
    pub total: u64,
    pub page: u32,
    pub page_size: u32,
}
```

## Storage keys

| Key | Storage tier | Type | Description |
|---|---|---|---|
| `PAY_CTR` (symbol) | Instance | `u64` | Payment ID counter |
| `PLG_CTR` (symbol) | Instance | `u64` | Pledge ID counter |
| `ADMIN` (symbol) | Instance | `Address` | Admin address |
| `PAUSED` (symbol) | Instance | `bool` | Pause flag |
| `RWD_TOK` (symbol) | Instance | `Address` | Reward token address |
| `STATS` (symbol) | Instance | `PaymentStats` | Aggregate stats |
| `REQ_CTR` (symbol) | Instance | `Address` | Requests contract address |
| `DISP_TO` (symbol) | Instance | `u64` | Dispute timeout override (seconds) |
| `(id, "pay")` | Persistent | `Payment` | Payment record |
| `(id, "plg")` | Persistent | `DonationPledge` | Pledge record |
| `(payer, "pi")` | Persistent | `Vec<u64>` | Payment IDs by payer |
| `(payee, "pyi")` | Persistent | `Vec<u64>` | Payment IDs by payee |
| `(status_code, "si")` | Persistent | `Vec<u64>` | Payment IDs by status |
| `(request_id, "ri")` | Persistent | `u64` | Active payment ID for a request |
| `(request_id, "rt")` | Persistent | `Vec<u64>` | All payment IDs for a request (timeline) |
| `VEST_CTR` (symbol) | Instance | `u64` | Vesting schedule ID counter |
| `IndexKey::DonorPledgeLen(donor)` / `DonorPledgeAt(donor, i)` | Persistent | `u32` / `u64` | Per-donor pledge index |
| `(donor, schedule_id, "vest")` | Persistent | `VestingSchedule` | Vesting schedule |

TTL bump: persistent entries are extended to ~60 days whenever remaining TTL falls below ~30 days, both when written and when read.

## Error codes

| Code | Value | Meaning |
|---|---|---|
| `PaymentNotFound` | 500 | Payment not found |
| `InvalidAmount` | 501 | Amount ≤ 0 |
| `SamePayerPayee` | 502 | Payer and payee are the same address |
| `InvalidPage` | 503 | Invalid pagination parameters |
| `NotPledgeDonor` | 504 | Caller is not the pledge donor |
| `InsufficientEscrowFunds` | 505 | Contract balance too low |
| `Unauthorized` | 506 | Caller not authorized |
| `ContractPaused` | 507 | Contract is paused |
| `CliffNotReached` | 508 | Vesting cliff not yet reached |
| `VestingNotFound` | 509 | No vesting schedule for this donor |
| `NothingToClaim` | 510 | No vested tokens available |
| `DuplicatePayment` | 511 | Payment already exists for this request |
| `RequestNotPayable` | 512 | Request is not in Pending or Approved state |
| `RequestNotFound` | 513 | Request not found in requests contract |
| `NotEscrowPayment` | 514 | Payment has no token — not an escrow payment |
| `PaymentNotLocked` | 515 | Payment is not Locked |
| `DisputeNotExpired` | 516 | Dispute timeout has not elapsed |
| `ActiveVestingExists` | 517 | No longer returned (concurrent schedules are allowed); kept for ABI stability |
| `TokenNotAllowed` | 525 | Token is not on the allowlist (escrow and vesting) |
| `StringTooLong` | 529 | Pledge string exceeds 64 bytes |
| `VestingRevoked` | 530 | Vesting schedule already revoked |
| `NothingToRevoke` | 531 | Vesting schedule is fully vested |

## Constants

- Default dispute auto-refund timeout: **7 days**
- Persistent TTL bump threshold: **518,400 ledgers** (~30 days)
- Persistent TTL bump target: **1,036,800 ledgers** (~60 days)
