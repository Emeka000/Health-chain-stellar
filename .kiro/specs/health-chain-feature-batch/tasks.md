# Implementation Plan: health-chain-feature-batch

## Overview

Implements four hardening features across the NestJS backend and Soroban smart contracts:
- **#458** – Donor eligibility cooldown window (NestJS)
- **#472** – Cross-contract authorization whitelist (Soroban coordinator)
- **#474** – Batch payment settlement with fee deduction (Soroban payments)
- **#476** – On-chain donation pledge fulfillment verification (Soroban payments)

---

## Tasks

- [ ] 1. Extend AppConfigModule with cooldown period environment variables
  - Add `COOLDOWN_WHOLE_BLOOD_DAYS`, `COOLDOWN_PLATELETS_DAYS`, and `COOLDOWN_PLASMA_DAYS` optional integer fields with defaults (56, 7, 28) to `EnvironmentVariables` in `backend/src/config/env.schema.ts`
  - Annotate each field with `@IsOptional()`, `@Type(() => Number)`, `@IsInt()`, `@Min(1)` decorators
  - Add the three variables to `backend/.env.example` with their default values
  - _Requirements: 5.1, 5.2_

- [ ] 2. Add BloodComponent enum and column to DonationEntity
  - [ ] 2.1 Add `BloodComponent` enum (`WHOLE_BLOOD`, `PLATELETS`, `PLASMA`) to `backend/src/donations/enums/donation.enum.ts`
    - _Requirements: 1.3, 5.1_
  - [ ] 2.2 Add optional `bloodComponent` column (`BloodComponent | null`) to `DonationEntity` in `backend/src/donations/entities/`
    - _Requirements: 1.4_
  - [ ] 2.3 Add `ActivityType.ADMIN_OVERRIDE = 'admin_override'` to the `ActivityType` enum in `backend/src/user-activity/`
    - _Requirements: 4.2_

- [ ] 3. Update DonorEligibilityService to return COOLDOWN status
  - [ ] 3.1 Update the `EligibilityResult` discriminated union type in `backend/src/donor-eligibility/donor-eligibility.service.ts` to include `{ eligible: false; reason: 'COOLDOWN'; nextEligibleAt: string }`
    - Add `COOLDOWN` to the `EligibilityStatus` enum in `backend/src/donor-eligibility/enums/`
    - _Requirements: 2.1_
  - [ ] 3.2 Update `checkEligibility` to distinguish `RECENT_DONATION` deferrals from other deferral types and apply priority ordering `PERMANENTLY_EXCLUDED > DEFERRED > COOLDOWN`
    - Return `{ eligible: false, reason: 'COOLDOWN', nextEligibleAt }` when the highest-priority active deferral is `RECENT_DONATION` with a future `deferredUntil`
    - Treat expired `RECENT_DONATION` records (`deferredUntil` ≤ now) as inactive
    - _Requirements: 2.1, 2.2, 2.3, 2.4_
  - [ ]* 3.3 Write property test for active cooldown returns COOLDOWN status (Property 2)
    - **Property 2: Active cooldown returns COOLDOWN status**
    - **Validates: Requirements 2.1**
    - Use `fast-check` to generate random future `deferredUntil` timestamps; assert `checkEligibility` returns `{ eligible: false, reason: 'COOLDOWN' }`
    - Tag: `// Feature: health-chain-feature-batch, Property 2`
  - [ ]* 3.4 Write property test for expired cooldown does not block eligibility (Property 3)
    - **Property 3: Expired cooldown does not block eligibility**
    - **Validates: Requirements 2.2**
    - Use `fast-check` to generate random past `deferredUntil` timestamps; assert `checkEligibility` returns `{ eligible: true }`
    - Tag: `// Feature: health-chain-feature-batch, Property 3`
  - [ ]* 3.5 Write property test for most-restrictive status wins (Property 4)
    - **Property 4: Most-restrictive status wins**
    - **Validates: Requirements 2.4**
    - Use `fast-check` to generate random combinations of deferral types; assert the highest-priority status is returned
    - Tag: `// Feature: health-chain-feature-batch, Property 4`

- [ ] 4. Update DonationService to compute and persist cooldown deferral on confirmation
  - [ ] 4.1 Inject `ConfigService` and `DonorEligibilityService` into `DonationService`; update `DonationModule` to import `DonorEligibilityModule`
    - _Requirements: 1.1, 1.2_
  - [ ] 4.2 Implement `getCooldownDays(component: BloodComponent | null): number` private method in `DonationService` that reads from `ConfigService` and falls back to 56 for null/unrecognised components
    - _Requirements: 1.3, 1.4, 5.3_
  - [ ] 4.3 In `confirmDonation`, after saving the donation, call `DonorEligibilityService.createDeferral` with `reason = RECENT_DONATION` and `deferredUntil = confirmationTimestamp + cooldownDays * 86_400_000`
    - _Requirements: 1.1, 1.2_
  - [ ]* 4.4 Write property test for cooldown deferral written correctly on confirmation (Property 1)
    - **Property 1: Cooldown deferral is written correctly on confirmation**
    - **Validates: Requirements 1.1, 1.2**
    - Use `fast-check` to generate random `BloodComponent` values and confirmation timestamps; assert `deferredUntil` equals `timestamp + cooldownDays(bloodComponent)`
    - Tag: `// Feature: health-chain-feature-batch, Property 1`

- [ ] 5. Extend DonationController with pre-flight eligibility guard and admin override
  - [ ] 5.1 Add `AdminOverrideDto` class with `@IsString() @IsNotEmpty() justification: string` to `backend/src/donations/`
    - Add optional `adminOverride?: AdminOverrideDto` field to `CreateDonationDto`
    - _Requirements: 4.1, 4.3_
  - [ ] 5.2 Update `POST /donations` handler in `DonationsController`:
    - If `adminOverride` is present: verify `ADMIN` role (return 403 if not), then skip eligibility check and proceed
    - If `adminOverride` is absent: call `DonorEligibilityService.checkEligibility(donorId)`; if `eligible: false`, return HTTP 403 with `{ error: reason, nextEligibleAt? }`
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 4.1, 4.4_
  - [ ] 5.3 In `DonationService.createIntent`, when `adminOverride` is present, call `UserActivityService.logActivity` with `activityType: ActivityType.ADMIN_OVERRIDE` and metadata containing `donorId`, `adminUserId`, `justification`, and `timestamp`
    - _Requirements: 4.2_
  - [ ]* 5.4 Write property test for ineligible donor blocked at POST /donations (Property 5)
    - **Property 5: Ineligible donor is blocked at POST /donations with correct response**
    - **Validates: Requirements 3.1, 3.2, 3.3**
    - Use `fast-check` to generate random ineligible donors; assert HTTP 403 and no `DonationEntity` created
    - Tag: `// Feature: health-chain-feature-batch, Property 5`
  - [ ]* 5.5 Write property test for admin override bypasses cooldown and writes audit entry (Property 6)
    - **Property 6: Admin override bypasses cooldown and writes audit entry**
    - **Validates: Requirements 4.1, 4.2**
    - Use `fast-check` to generate random admin override requests with non-empty justifications; assert bypass and `logActivity` called with correct metadata
    - Tag: `// Feature: health-chain-feature-batch, Property 6`
  - [ ]* 5.6 Write property test for admin override input validation (Property 7)
    - **Property 7: Admin override input validation**
    - **Validates: Requirements 4.3, 4.4**
    - Use `fast-check` to generate non-admin callers and empty justification strings; assert HTTP 403 and HTTP 400 respectively
    - Tag: `// Feature: health-chain-feature-batch, Property 7`

- [ ] 6. Checkpoint — NestJS backend
  - Ensure all backend tests pass (`jest --runInBand --passWithNoTests`), ask the user if questions arise.

- [ ] 7. Extend PaymentContract error variants and DonationPledge struct
  - [ ] 7.1 Add new error variants to the `Error` enum in `lifebank-soroban/contracts/payments/src/lib.rs`:
    - `BatchTooLarge = 506`, `BatchPartialFailure = 507`, `PledgeNotFound = 508`, `PledgeExpired = 509`, `PledgeNotFulfilled = 510`, `PledgeNotExpired = 511`, `Unauthorized = 512`
    - _Requirements: 6.2, 6.4, 7.2, 7.3, 7.5_
  - [ ] 7.2 Extend `DonationPledge` struct with new fields: `fulfilled: bool`, `donation_tx_hash: Option<BytesN<32>>`, `deadline: u64`, `incentive_amount: i128`, `platform_reserve: Address`, `expired: bool`
    - _Requirements: 7.1, 7.4_

- [ ] 8. Implement batch_release in PaymentContract
  - [ ] 8.1 Implement `batch_release(env, admin, payment_ids: Vec<u64>, fee_bps: u32, fee_collector: Address, token: Address) -> Result<(), Error>` in `lifebank-soroban/contracts/payments/src/lib.rs`:
    - Call `admin.require_auth()`
    - Return `Err(Error::BatchTooLarge)` if `payment_ids.len() > 50`
    - Validate all payments are `Locked`; collect non-Locked IDs and return `Err(Error::BatchPartialFailure)` if any
    - For each payment: compute `fee = amount * fee_bps / 10_000`; transfer `amount - fee` to payee; transfer `fee` to `fee_collector`; update status to `Released`
    - Emit `BatchReleased { count, total_released, total_fees }` event
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6_
  - [ ]* 8.2 Write property test for batch_release fee arithmetic is lossless (Property 8)
    - **Property 8: batch_release fee arithmetic is lossless**
    - **Validates: Requirements 6.3, 6.6**
    - Use `proptest` to generate `(amount: i128, fee_bps: u32)` in valid ranges; assert `fee + (amount - fee) == amount`
    - Tag: `// Feature: health-chain-feature-batch, Property 8`
  - [ ]* 8.3 Write property test for batch_release atomicity — partial failure aborts entire batch (Property 9)
    - **Property 9: batch_release atomicity — partial failure aborts entire batch**
    - **Validates: Requirements 6.2**
    - Use `proptest` to generate batches with at least one non-Locked payment; assert `BatchPartialFailure` returned and all statuses unchanged
    - Tag: `// Feature: health-chain-feature-batch, Property 9`
  - [ ]* 8.4 Write property test for batch_release emits correct event on success (Property 10)
    - **Property 10: batch_release emits correct event on success**
    - **Validates: Requirements 6.5**
    - Use `proptest` to generate valid all-Locked batches; assert emitted `BatchReleased` totals match computed sums
    - Tag: `// Feature: health-chain-feature-batch, Property 10`

- [ ] 9. Implement pledge fulfillment functions in PaymentContract
  - [ ] 9.1 Implement `mark_pledge_fulfilled(env, admin, pledge_id: u64, donation_tx_hash: BytesN<32>) -> Result<(), Error>`:
    - Call `admin.require_auth()`
    - Return `Err(Error::PledgeNotFound)` if pledge not in storage
    - Return `Err(Error::PledgeExpired)` if `deadline < env.ledger().timestamp()` or `expired = true`
    - Set `fulfilled = true`, store `donation_tx_hash` on pledge record
    - Emit `PledgeFulfilled { pledge_id, donation_tx_hash }` event
    - _Requirements: 7.1, 7.2, 7.6, 7.7_
  - [ ] 9.2 Implement `release_pledge_incentive(env, admin, pledge_id: u64, token: Address) -> Result<(), Error>`:
    - Call `admin.require_auth()`
    - Return `Err(Error::PledgeNotFulfilled)` if `fulfilled = false`
    - Transfer `incentive_amount` to payee; emit `PledgeIncentiveReleased { pledge_id, amount }` event
    - _Requirements: 7.3, 7.8_
  - [ ] 9.3 Implement `expire_pledge(env, pledge_id: u64, token: Address) -> Result<(), Error>`:
    - Return `Err(Error::PledgeNotExpired)` if `env.ledger().timestamp() < deadline`
    - Return `Err(Error::PledgeExpired)` if already expired
    - Set `expired = true`; transfer `incentive_amount` to `platform_reserve`; emit `PledgeExpired { pledge_id, returned_amount }` event
    - _Requirements: 7.4, 7.5, 7.9_
  - [ ] 9.4 Verify `get_pledge` returns `donation_tx_hash` as part of the pledge record after fulfillment
    - _Requirements: 7.10_
  - [ ]* 9.5 Write property test for mark_pledge_fulfilled round-trip (Property 11)
    - **Property 11: mark_pledge_fulfilled round-trip**
    - **Validates: Requirements 7.1, 7.10**
    - Use `proptest` to generate active pledges and random 32-byte hashes; assert `get_pledge` returns `fulfilled = true` and matching `donation_tx_hash`
    - Tag: `// Feature: health-chain-feature-batch, Property 11`
  - [ ]* 9.6 Write property test for expired pledge rejects fulfillment and incentive release (Property 12)
    - **Property 12: Expired pledge rejects fulfillment and incentive release**
    - **Validates: Requirements 7.2, 7.6**
    - Use `proptest` to generate pledges with `deadline < now`; assert both `mark_pledge_fulfilled` and `release_pledge_incentive` return errors and make no state changes
    - Tag: `// Feature: health-chain-feature-batch, Property 12`
  - [ ]* 9.7 Write property test for unfulfilled pledge blocks incentive release (Property 13)
    - **Property 13: Unfulfilled pledge blocks incentive release**
    - **Validates: Requirements 7.3**
    - Use `proptest` to generate pledges with `fulfilled = false`; assert `release_pledge_incentive` returns `PledgeNotFulfilled`
    - Tag: `// Feature: health-chain-feature-batch, Property 13`
  - [ ]* 9.8 Write property test for expire_pledge returns funds after deadline (Property 14)
    - **Property 14: expire_pledge returns funds after deadline**
    - **Validates: Requirements 7.4**
    - Use `proptest` to generate pledges past deadline with `fulfilled = false`; assert `expired = true` and `incentive_amount` transferred to `platform_reserve`
    - Tag: `// Feature: health-chain-feature-batch, Property 14`

- [ ] 10. Checkpoint — PaymentContract
  - Ensure all payment contract tests pass (`cargo test -p payments`), ask the user if questions arise.

- [ ] 11. Add CallerWhitelist storage key and errors to CoordinatorContract
  - [ ] 11.1 Add `CallerWhitelist` variant to `DataKey` enum in `lifebank-soroban/contracts/coordinator/src/types.rs`
    - _Requirements: 8.1_
  - [ ] 11.2 Add `CallerAlreadyWhitelisted = 840`, `CallerNotFound = 841`, `UnauthorizedCaller = 842` to `CoordinatorError` enum in `lifebank-soroban/contracts/coordinator/src/error.rs`
    - _Requirements: 8.3, 8.4, 8.5_

- [ ] 12. Implement whitelist management and enforcement in CoordinatorContract
  - [ ] 12.1 Implement `add_authorized_caller(env, admin, caller_address: Address) -> Result<(), CoordinatorError>` in `lifebank-soroban/contracts/coordinator/src/lib.rs`:
    - Call `admin.require_auth()`
    - Load `CallerWhitelist` from persistent storage (default empty `Vec`)
    - Return `Err(CoordinatorError::CallerAlreadyWhitelisted)` if address already present
    - Push address and save updated whitelist
    - _Requirements: 8.1, 8.2, 8.3_
  - [ ] 12.2 Implement `remove_authorized_caller(env, admin, caller_address: Address) -> Result<(), CoordinatorError>`:
    - Call `admin.require_auth()`
    - Return `Err(CoordinatorError::CallerNotFound)` if address not present
    - Remove address and save updated whitelist
    - _Requirements: 8.2, 8.4_
  - [ ] 12.3 Implement private helper `require_authorized_caller(env: &Env, admin: &Address, caller: &Address) -> Result<(), CoordinatorError>`:
    - Return `Ok(())` if `caller == admin`
    - Load whitelist; return `Ok(())` if whitelist contains `caller`
    - Otherwise return `Err(CoordinatorError::UnauthorizedCaller)`
    - _Requirements: 8.5, 8.6, 8.7_
  - [ ] 12.4 Call `require_authorized_caller` at the top of `allocate_units`, `confirm_delivery`, and `settle_payment` (after `caller.require_auth()`)
    - _Requirements: 8.5, 8.8_
  - [ ]* 12.5 Write property test for whitelist management requires admin auth (Property 15)
    - **Property 15: Whitelist management requires admin auth**
    - **Validates: Requirements 8.2**
    - Use `proptest` to generate non-admin addresses; assert `add_authorized_caller` and `remove_authorized_caller` fail with auth error and whitelist is unchanged
    - Tag: `// Feature: health-chain-feature-batch, Property 15`
  - [ ]* 12.6 Write property test for whitelist idempotency errors (Property 16)
    - **Property 16: Whitelist idempotency errors**
    - **Validates: Requirements 8.3, 8.4**
    - Use `proptest` to generate addresses already in whitelist and addresses not in whitelist; assert correct errors returned
    - Tag: `// Feature: health-chain-feature-batch, Property 16`
  - [ ]* 12.7 Write property test for whitelist enforcement on state-mutation functions (Property 17)
    - **Property 17: Whitelist enforcement on state-mutation functions**
    - **Validates: Requirements 8.5, 8.7, 8.8**
    - Use `proptest` to generate callers not in whitelist and not admin; assert all three of `allocate_units`, `confirm_delivery`, `settle_payment` return `UnauthorizedCaller` and make no state changes; also verify removed callers are rejected
    - Tag: `// Feature: health-chain-feature-batch, Property 17`

- [ ] 13. Add proptest dev-dependency to lifebank-soroban
  - Add `proptest = "1"` under `[dev-dependencies]` in `lifebank-soroban/Cargo.toml`
  - _Requirements: (testing infrastructure)_

- [ ] 14. Final checkpoint — all contracts and backend
  - Ensure all tests pass (`cargo test --workspace` and `jest --runInBand --passWithNoTests`), ask the user if questions arise.

---

## Notes

- Tasks marked with `*` are optional and can be skipped for a faster MVP
- Each task references specific requirements for traceability
- Property tests use `fast-check` (TypeScript/NestJS) and `proptest` (Rust/Soroban)
- All property test files must include the tag comment `// Feature: health-chain-feature-batch, Property N`
- The `DonationPledge` struct extension is a breaking change for existing stored pledges — deploy to a fresh contract instance or run a migration script as noted in the design
