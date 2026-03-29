# Design Document: health-chain-feature-batch

## Overview

This document covers the technical design for four related features that harden the HealthDonor Protocol donation lifecycle:

- **#458** – Enforce donor eligibility cooldown window (NestJS backend)
- **#472** – Cross-contract authorization whitelist in coordinator contract (Soroban)
- **#474** – Batch payment settlement with fee deduction (Soroban payments contract)
- **#476** – On-chain donation pledge fulfillment verification (Soroban payments contract)

The backend changes extend the existing `DonorEligibilityService` and `DonationService` in `backend/src/`. The Soroban changes extend `lifebank-soroban/contracts/payments/src/lib.rs` and `lifebank-soroban/contracts/coordinator/src/`.

---

## Architecture

### Backend (NestJS) – Issues #458

The cooldown feature threads through three existing layers:

```
POST /donations
  └─ DonationController
       ├─ DonorEligibilityService.checkEligibility()   ← pre-flight guard
       │    └─ DonorDeferralEntity (TypeORM, donor_deferrals table)
       └─ DonationService.confirmDonation()
            └─ DonorEligibilityService.createDeferral() ← writes RECENT_DONATION record
```

Config values flow from environment variables → `EnvironmentVariables` schema → `ConfigService` → `DonationService`.

```
.env
  COOLDOWN_WHOLE_BLOOD_DAYS=56
  COOLDOWN_PLATELETS_DAYS=7
  COOLDOWN_PLASMA_DAYS=28
        │
        ▼
  EnvironmentVariables (env.schema.ts)
        │
        ▼
  ConfigService (injected into DonationService)
```

### Soroban Contracts – Issues #472, #474, #476

Both contracts are extended in-place; no new contract files are introduced.

```
lifebank-soroban/contracts/
  payments/src/lib.rs      ← add batch_release, mark_pledge_fulfilled,
  │                           release_pledge_incentive, expire_pledge
  │                           extend DonationPledge struct
  │
  coordinator/src/
    lib.rs                 ← add add_authorized_caller, remove_authorized_caller
    │                         add whitelist check to allocate_units,
    │                         confirm_delivery, settle_payment
    types.rs               ← add DataKey::CallerWhitelist
    error.rs               ← add CallerAlreadyWhitelisted, CallerNotFound,
                              UnauthorizedCaller
```

---

## Components and Interfaces

### 1. AppConfigModule – Cooldown Config (Req 5)

Add three optional integer fields to `EnvironmentVariables` in `backend/src/config/env.schema.ts`:

```typescript
@IsOptional()
@Type(() => Number)
@IsInt()
@Min(1)
COOLDOWN_WHOLE_BLOOD_DAYS: number = 56;

@IsOptional()
@Type(() => Number)
@IsInt()
@Min(1)
COOLDOWN_PLATELETS_DAYS: number = 7;

@IsOptional()
@Type(() => Number)
@IsInt()
@Min(1)
COOLDOWN_PLASMA_DAYS: number = 28;
```

### 2. DonationService – Cooldown Computation (Req 1)

`confirmDonation` gains a new responsibility: after saving the donation, it calls `DonorEligibilityService.createDeferral` with `reason = RECENT_DONATION` and `deferredUntil = confirmationTimestamp + cooldownDays`.

`DonationService` must inject `ConfigService` and `DonorEligibilityService`. The `DonationModule` must import `DonorEligibilityModule`.

```typescript
// Pseudocode – confirmDonation addition
const cooldownDays = this.getCooldownDays(donation.bloodComponent);
const nextEligibleAt = new Date(confirmedAt.getTime() + cooldownDays * 86_400_000);
await this.eligibilityService.createDeferral({
  donorId: donation.donorUserId,
  reason: DeferralReason.RECENT_DONATION,
  deferredUntil: nextEligibleAt.toISOString(),
});
```

`getCooldownDays(component: BloodComponent | null): number` reads from `ConfigService` and falls back to 56 when `component` is null or unrecognised.

### 3. DonorEligibilityService – COOLDOWN Status (Req 2)

The existing `checkEligibility` method currently returns `DEFERRED` for any future deferral. It must be updated to:

1. Distinguish `RECENT_DONATION` deferrals from other deferral types.
2. Return `{ eligible: false, reason: 'COOLDOWN', nextEligibleAt }` when the most-active deferral is `RECENT_DONATION`.
3. Apply priority ordering: `PERMANENTLY_EXCLUDED > DEFERRED > COOLDOWN`.

The return type changes from `EligibilityResult` to a discriminated union:

```typescript
export type EligibilityResult =
  | { eligible: true }
  | { eligible: false; reason: 'COOLDOWN'; nextEligibleAt: string }
  | { eligible: false; reason: 'DEFERRED'; nextEligibleAt: string }
  | { eligible: false; reason: 'PERMANENTLY_EXCLUDED' };
```

The `EligibilityStatus` enum gains a `COOLDOWN` value.

### 4. DonationController – Pre-flight Guard and Admin Override (Req 3, 4)

`POST /donations` (the existing `createIntent` endpoint) is extended:

```typescript
export class CreateDonationDto {
  // ... existing fields ...
  adminOverride?: AdminOverrideDto;
}

export class AdminOverrideDto {
  @IsString()
  @IsNotEmpty()
  justification: string;
}
```

Controller logic:

```
1. If adminOverride present:
   a. Verify caller has ADMIN role → 403 if not
   b. Verify justification is non-empty → 400 if empty (handled by class-validator)
   c. Skip eligibility check
   d. Proceed to DonationService.createIntent (which writes audit entry)
2. Else:
   a. Call DonorEligibilityService.checkEligibility(donorId)
   b. If eligible: false → return 403 with { error: reason, nextEligibleAt? }
   c. If eligible: true → proceed
```

### 5. AuditTrail – Admin Override Logging (Req 4)

`DonationService.createIntent` accepts an optional `adminOverride` parameter. When present, it calls `UserActivityService.logActivity` with:

```typescript
{
  userId: adminUserId,
  activityType: ActivityType.ADMIN_OVERRIDE,
  description: `Admin override for donor ${donorId}`,
  metadata: {
    donorId,
    adminUserId,
    justification,
    timestamp: new Date().toISOString(),
  },
}
```

A new `ActivityType.ADMIN_OVERRIDE` value is added to the `ActivityType` enum.

### 6. PaymentContract – batch_release (Req 6)

New types added to `payments/src/lib.rs`:

```rust
// New error variants
#[contracterror]
pub enum Error {
    // ... existing ...
    BatchTooLarge = 506,
    BatchPartialFailure = 507,
    // pledge errors
    PledgeNotFound = 508,
    PledgeExpired = 509,
    PledgeNotFulfilled = 510,
    PledgeNotExpired = 511,
    Unauthorized = 512,
}

// New event struct (emitted as tuple)
// BatchReleased { count: u32, total_released: i128, total_fees: i128 }
```

`batch_release` signature:

```rust
pub fn batch_release(
    env: Env,
    admin: Address,
    payment_ids: Vec<u64>,
    fee_bps: u32,
    fee_collector: Address,
    token: Address,
) -> Result<(), Error>
```

Algorithm:
1. `admin.require_auth()`
2. If `payment_ids.len() > 50` → `Err(Error::BatchTooLarge)`
3. Validate all payments are `Locked`; collect non-Locked IDs → `Err(Error::BatchPartialFailure)` if any
4. For each payment: `fee = amount * fee_bps / 10_000`; transfer `amount - fee` to payee; transfer `fee` to `fee_collector`
5. Update each payment status to `Released`
6. Emit `BatchReleased { count, total_released, total_fees }`

The `token` parameter is the SAC (Stellar Asset Contract) address held in escrow. Fee arithmetic uses integer division (truncation toward zero), satisfying `fee + (amount - fee) = amount` by construction.

### 7. PaymentContract – Pledge Fulfillment (Req 7)

`DonationPledge` struct gains new fields:

```rust
pub struct DonationPledge {
    // ... existing fields ...
    pub fulfilled: bool,
    pub donation_tx_hash: Option<BytesN<32>>,
    pub deadline: u64,           // ledger timestamp
    pub incentive_amount: i128,  // escrowed incentive
    pub platform_reserve: Address,
    pub expired: bool,
}
```

New functions:

```rust
pub fn mark_pledge_fulfilled(
    env: Env,
    admin: Address,
    pledge_id: u64,
    donation_tx_hash: BytesN<32>,
) -> Result<(), Error>

pub fn release_pledge_incentive(
    env: Env,
    admin: Address,
    pledge_id: u64,
    token: Address,
) -> Result<(), Error>

pub fn expire_pledge(
    env: Env,
    pledge_id: u64,
    token: Address,
) -> Result<(), Error>
```

State machine for a pledge:

```
Active ──mark_pledge_fulfilled──► Fulfilled ──release_pledge_incentive──► Released
  │
  └──expire_pledge (after deadline)──► Expired (funds returned to platform_reserve)
```

### 8. CoordinatorContract – Caller Whitelist (Req 8)

`DataKey` in `types.rs` gains:

```rust
pub enum DataKey {
    // ... existing ...
    CallerWhitelist,
}
```

`error.rs` gains:

```rust
pub enum CoordinatorError {
    // ... existing ...
    CallerAlreadyWhitelisted = 840,
    CallerNotFound = 841,
    UnauthorizedCaller = 842,
}
```

New functions in `lib.rs`:

```rust
pub fn add_authorized_caller(
    env: Env,
    admin: Address,
    caller_address: Address,
) -> Result<(), CoordinatorError>

pub fn remove_authorized_caller(
    env: Env,
    admin: Address,
    caller_address: Address,
) -> Result<(), CoordinatorError>
```

Helper added to `lib.rs`:

```rust
fn require_authorized_caller(
    env: &Env,
    caller: &Address,
) -> Result<(), CoordinatorError>
```

This helper is called at the top of `allocate_units`, `confirm_delivery`, and `settle_payment` (after `caller.require_auth()`). It checks whether `caller == admin || whitelist.contains(caller)`.

---

## Data Models

### Backend

#### DonorDeferralEntity (existing, no schema change)

The existing `donor_deferrals` table already has all required columns. The new `RECENT_DONATION` deferral reason is already in the `DeferralReason` enum. No migration is needed.

#### EnvironmentVariables additions

| Variable | Type | Default | Description |
|---|---|---|---|
| `COOLDOWN_WHOLE_BLOOD_DAYS` | integer | 56 | Cooldown days for whole blood |
| `COOLDOWN_PLATELETS_DAYS` | integer | 7 | Cooldown days for platelets |
| `COOLDOWN_PLASMA_DAYS` | integer | 28 | Cooldown days for plasma |

#### BloodComponent enum (new)

```typescript
export enum BloodComponent {
  WHOLE_BLOOD = 'whole_blood',
  PLATELETS = 'platelets',
  PLASMA = 'plasma',
}
```

Added to `donations/enums/donation.enum.ts`. An optional `bloodComponent` column is added to `DonationEntity`.

#### ActivityType enum addition

```typescript
export enum ActivityType {
  // ... existing ...
  ADMIN_OVERRIDE = 'admin_override',
}
```

### Soroban

#### DonationPledge (extended)

```rust
pub struct DonationPledge {
    pub id: u64,
    pub donor: Address,
    pub amount_per_period: i128,
    pub interval_secs: u64,
    pub payee_pool: String,
    pub cause: String,
    pub region: String,
    pub emergency_pool: bool,
    pub active: bool,
    pub created_at: u64,
    // New fields (Req 7):
    pub fulfilled: bool,
    pub donation_tx_hash: Option<BytesN<32>>,
    pub deadline: u64,
    pub incentive_amount: i128,
    pub platform_reserve: Address,
    pub expired: bool,
}
```

Because Soroban persistent storage is keyed by contract type, adding fields to `DonationPledge` is a breaking change for existing stored pledges. Existing pledges created before this upgrade will fail to deserialize. Mitigation: deploy to a fresh contract instance or run a migration script that re-serializes all existing pledges with default values for the new fields.

#### CoordinatorContract storage additions

| Key | Type | Description |
|---|---|---|
| `DataKey::CallerWhitelist` | `Vec<Address>` | Persistent list of authorized callers |

---

## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system — essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

### Property 1: Cooldown deferral is written correctly on confirmation

*For any* donation confirmation with a given `BloodComponent`, after `confirmDonation` completes, the donor's `DonorDeferralEntity` record must have `reason = RECENT_DONATION`, `isActive = true`, and `deferredUntil = confirmationTimestamp + cooldownDays(bloodComponent)`.

**Validates: Requirements 1.1, 1.2**

---

### Property 2: Active cooldown returns COOLDOWN status

*For any* donor who has a `RECENT_DONATION` deferral with `deferredUntil` strictly in the future, `checkEligibility` must return `{ eligible: false, reason: 'COOLDOWN', nextEligibleAt }` where `nextEligibleAt` matches `deferredUntil`.

**Validates: Requirements 2.1**

---

### Property 3: Expired cooldown does not block eligibility

*For any* donor whose only active deferral is a `RECENT_DONATION` record with `deferredUntil` in the past, `checkEligibility` must return `{ eligible: true }`.

**Validates: Requirements 2.2**

---

### Property 4: Most-restrictive status wins

*For any* donor with a combination of active deferrals, `checkEligibility` must return the status with the highest priority in the ordering `PERMANENTLY_EXCLUDED > DEFERRED > COOLDOWN > ELIGIBLE`.

**Validates: Requirements 2.4**

---

### Property 5: Ineligible donor is blocked at POST /donations with correct response

*For any* donor whose `checkEligibility` returns `eligible: false`, a `POST /donations` request must return HTTP 403 with a body containing the `error` field set to the reason code, and no `DonationEntity` record must be created.

**Validates: Requirements 3.1, 3.2, 3.3**

---

### Property 6: Admin override bypasses cooldown and writes audit entry

*For any* admin-authenticated `POST /donations` request with a non-empty `justification`, the cooldown check is skipped, the donation is created, and `UserActivityService.logActivity` is called with `activityType = ADMIN_OVERRIDE` and metadata containing `donorId`, `adminUserId`, and the verbatim `justification`.

**Validates: Requirements 4.1, 4.2**

---

### Property 7: Admin override input validation

*For any* request providing an `adminOverride` field: if the caller is not `ADMIN` role, the response is HTTP 403; if the caller is `ADMIN` but `justification` is absent or empty, the response is HTTP 400.

**Validates: Requirements 4.3, 4.4**

---

### Property 8: batch_release fee arithmetic is lossless

*For any* payment amount `a` and fee basis points `f` in `[0, 10_000]`, the integer computation `fee = a * f / 10_000` satisfies `fee + (a - fee) = a`.

**Validates: Requirements 6.3, 6.6**

---

### Property 9: batch_release atomicity — partial failure aborts entire batch

*For any* batch containing at least one payment not in `Locked` status, `batch_release` must return `Error::BatchPartialFailure` and leave all payment statuses unchanged.

**Validates: Requirements 6.2**

---

### Property 10: batch_release emits correct event on success

*For any* successful `batch_release` call, the emitted `BatchReleased` event must have `count` equal to the number of payment IDs, `total_released` equal to the sum of `(amount - fee)` for each payment, and `total_fees` equal to the sum of fees.

**Validates: Requirements 6.5**

---

### Property 11: mark_pledge_fulfilled round-trip

*For any* active, non-expired pledge, after `mark_pledge_fulfilled(pledge_id, tx_hash)` succeeds, `get_pledge(pledge_id)` must return a pledge with `fulfilled = true` and `donation_tx_hash = tx_hash`.

**Validates: Requirements 7.1, 7.10**

---

### Property 12: Expired pledge rejects fulfillment and incentive release

*For any* pledge whose `deadline` has passed (whether expired via `expire_pledge` or simply past the deadline timestamp), both `mark_pledge_fulfilled` and `release_pledge_incentive` must return an error and make no state changes.

**Validates: Requirements 7.2, 7.6**

---

### Property 13: Unfulfilled pledge blocks incentive release

*For any* pledge with `fulfilled = false`, `release_pledge_incentive` must return `Error::PledgeNotFulfilled` and make no state changes.

**Validates: Requirements 7.3**

---

### Property 14: expire_pledge returns funds after deadline

*For any* pledge past its `deadline` with `fulfilled = false`, `expire_pledge` must set `expired = true` and transfer `incentive_amount` to `platform_reserve`.

**Validates: Requirements 7.4**

---

### Property 15: Whitelist management requires admin auth

*For any* non-admin caller, `add_authorized_caller` and `remove_authorized_caller` must fail with an authorization error and leave the whitelist unchanged.

**Validates: Requirements 8.2**

---

### Property 16: Whitelist idempotency errors

*For any* address already in the whitelist, `add_authorized_caller` must return `CoordinatorError::CallerAlreadyWhitelisted`. *For any* address not in the whitelist, `remove_authorized_caller` must return `CoordinatorError::CallerNotFound`.

**Validates: Requirements 8.3, 8.4**

---

### Property 17: Whitelist enforcement on state-mutation functions

*For any* caller that is neither the admin nor present in the `CallerWhitelist`, all three of `allocate_units`, `confirm_delivery`, and `settle_payment` must return `CoordinatorError::UnauthorizedCaller` and make no state changes. After removing a caller from the whitelist, subsequent calls from that address must also fail.

**Validates: Requirements 8.5, 8.7, 8.8**

---

## Error Handling

### Backend

| Scenario | HTTP Status | Response Body |
|---|---|---|
| Donor in cooldown | 403 | `{ error: 'COOLDOWN', nextEligibleAt: '<ISO 8601>' }` |
| Donor deferred (non-cooldown) | 403 | `{ error: 'DEFERRED', nextEligibleAt: '<ISO 8601>' }` |
| Donor permanently excluded | 403 | `{ error: 'PERMANENTLY_EXCLUDED' }` |
| Admin override with empty justification | 400 | Standard NestJS validation error |
| Non-admin providing adminOverride | 403 | `{ error: 'FORBIDDEN' }` |
| Donation not found | 404 | Standard NestJS not-found |

The `DonationsController` catches `ForbiddenException` from the eligibility guard and re-throws with the structured body. NestJS `ValidationPipe` handles the 400 for empty justification automatically via `class-validator`.

### Soroban – PaymentContract

| Error | Code | Trigger |
|---|---|---|
| `BatchTooLarge` | 506 | `payment_ids.len() > 50` |
| `BatchPartialFailure` | 507 | Any payment in batch not `Locked` |
| `PledgeNotFound` | 508 | `pledge_id` not in storage |
| `PledgeExpired` | 509 | `deadline < env.ledger().timestamp()` or `expired = true` |
| `PledgeNotFulfilled` | 510 | `fulfilled = false` on `release_pledge_incentive` |
| `PledgeNotExpired` | 511 | `expire_pledge` called before deadline |
| `Unauthorized` | 512 | Non-admin calling admin-only function |

All error paths make no state changes (checked before any `store_*` call).

### Soroban – CoordinatorContract

| Error | Code | Trigger |
|---|---|---|
| `CallerAlreadyWhitelisted` | 840 | Address already in whitelist |
| `CallerNotFound` | 841 | Address not in whitelist on remove |
| `UnauthorizedCaller` | 842 | Caller not admin and not in whitelist |

The whitelist check is performed before any cross-contract calls, so no partial state changes occur on authorization failure.

---

## Testing Strategy

### Backend – Unit and Integration Tests (Jest)

**Unit tests** (Jest, existing pattern in `*.service.spec.ts`):

- `DonorEligibilityService`: test COOLDOWN status returned for active RECENT_DONATION deferral; test expired deferral does not block; test priority ordering with multiple concurrent deferrals.
- `DonationService`: test `confirmDonation` calls `createDeferral` with correct `deferredUntil` for each `BloodComponent`; test null component defaults to 56 days; test config values are read from `ConfigService`.
- `DonationController`: test 403 with COOLDOWN body; test 403 with DEFERRED body; test 400 for empty justification; test 403 for non-admin override; test admin override bypasses check.

**Property-based tests** (using `fast-check`, minimum 100 runs each):

Each property test must be tagged with a comment in the format:
`// Feature: health-chain-feature-batch, Property N: <property_text>`

- Property 1: Generate random `BloodComponent` values and confirmation timestamps; verify `deferredUntil` equals `timestamp + cooldownDays`.
- Property 2: Generate random future `deferredUntil` timestamps; verify `checkEligibility` returns COOLDOWN.
- Property 3: Generate random past `deferredUntil` timestamps; verify `checkEligibility` returns ELIGIBLE.
- Property 4: Generate random combinations of deferral types; verify most-restrictive status is returned.
- Property 5: Generate random ineligible donors; verify 403 response and no record creation.
- Property 6: Generate random admin override requests with non-empty justifications; verify bypass and audit entry.
- Property 7: Generate random non-admin and empty-justification inputs; verify 403/400 responses.

Recommended library: [`fast-check`](https://github.com/dubzzz/fast-check) (already common in TypeScript/NestJS projects).

### Soroban – Unit and Property Tests (Rust, `soroban-sdk` test harness)

**Unit tests** (existing pattern in `test.rs`):

- `batch_release`: happy path with 1, 10, 50 payments; `BatchTooLarge` for 51 payments; `BatchPartialFailure` for mixed-status batch; fee arithmetic spot checks.
- Pledge lifecycle: `mark_pledge_fulfilled` → `get_pledge` round-trip; `release_pledge_incentive` on unfulfilled pledge; `expire_pledge` before and after deadline; `mark_pledge_fulfilled` on expired pledge.
- Whitelist: `add_authorized_caller` then call succeeds; `remove_authorized_caller` then call fails; duplicate add returns `CallerAlreadyWhitelisted`; remove non-existent returns `CallerNotFound`; empty whitelist + non-admin returns `UnauthorizedCaller`.

**Property-based tests** (using [`proptest`](https://github.com/proptest-rs/proptest) crate, minimum 100 runs each):

Each property test must be tagged:
`// Feature: health-chain-feature-batch, Property N: <property_text>`

- Property 8: For any `(amount: i128, fee_bps: u32)` in valid ranges, `fee + (amount - fee) == amount`.
- Property 9: For any batch with at least one non-Locked payment, `batch_release` returns `BatchPartialFailure` and all statuses are unchanged.
- Property 10: For any successful batch, emitted event totals match computed sums.
- Property 11: For any active pledge and random 32-byte hash, `mark_pledge_fulfilled` then `get_pledge` returns the same hash.
- Property 12: For any pledge with `deadline < now`, `mark_pledge_fulfilled` returns `PledgeExpired`.
- Property 13: For any pledge with `fulfilled = false`, `release_pledge_incentive` returns `PledgeNotFulfilled`.
- Property 14: For any pledge with `deadline < now` and `fulfilled = false`, `expire_pledge` sets `expired = true` and transfers funds.
- Property 15: For any non-admin address, `add_authorized_caller` and `remove_authorized_caller` fail.
- Property 16: For any address already in whitelist, `add_authorized_caller` returns `CallerAlreadyWhitelisted`; for any address not in whitelist, `remove_authorized_caller` returns `CallerNotFound`.
- Property 17: For any caller not in whitelist and not admin, all three state-mutation functions return `UnauthorizedCaller`.

Add `proptest` to `lifebank-soroban/Cargo.toml` as a dev-dependency:

```toml
[dev-dependencies]
proptest = "1"
```
