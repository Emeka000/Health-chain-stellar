# Requirements Document

## Introduction

This document covers four related features for the HealthDonor Protocol platform (issues #458, #472, #474, #476). Together they harden the donation lifecycle by enforcing donor eligibility cooldowns in the NestJS backend, adding batch payment settlement and pledge fulfillment verification to the Soroban payments contract, and locking down cross-contract calls in the Soroban coordinator contract via a caller whitelist.

---

## Glossary

- **DonationsService**: NestJS service responsible for creating and confirming blood donation records.
- **DonorEligibilityService**: NestJS service that evaluates whether a donor is eligible to donate.
- **DonorDeferralEntity**: TypeORM entity persisting deferral records for a donor, including cooldown windows.
- **BloodComponent**: The type of blood product donated (whole blood, platelets, or plasma).
- **CooldownPeriod**: The mandatory rest interval after a donation before the donor may donate again, expressed in days and configurable per BloodComponent.
- **nextEligibleAt**: An ISO 8601 timestamp indicating when a donor's cooldown expires and the donor becomes eligible again.
- **AdminOverride**: An admin-initiated action that bypasses the cooldown, accompanied by a mandatory justification string that is written to the audit trail.
- **PaymentContract**: The Soroban smart contract (`lifebank-soroban/contracts/payments`) that manages escrow payments and donation pledges.
- **CoordinatorContract**: The Soroban smart contract (`lifebank-soroban/contracts/coordinator`) that orchestrates the cross-contract workflow.
- **batch_release**: A new PaymentContract function that settles multiple locked payments atomically in a single transaction.
- **fee_bps**: Platform fee expressed in basis points (1 bp = 0.01%). For example, 50 bp = 0.5%.
- **fee_collector**: The on-chain address that receives the platform fee portion of each settled payment.
- **DonationPledge**: A PaymentContract struct representing an earmarked recurring donation commitment recorded on-chain.
- **PledgeFulfillment**: The act of linking a confirmed on-chain donation transaction hash to a DonationPledge, marking it fulfilled.
- **CallerWhitelist**: A persistent list of `Address` values stored in the CoordinatorContract that are permitted to invoke state-mutation functions.
- **AuditTrail**: The append-only log of privileged actions maintained by the backend, used to record admin overrides and other sensitive operations.

---

## Requirements

### Requirement 1: Cooldown Timestamp on Donation Confirmation

**User Story:** As a blood bank operator, I want the system to automatically record when a donor next becomes eligible after each confirmed donation, so that eligibility checks are always based on accurate, up-to-date cooldown data.

#### Acceptance Criteria

1. WHEN a donation is confirmed via `DonationsService.confirmDonation`, THE DonationsService SHALL compute `nextEligibleAt` as the confirmation timestamp plus the configured CooldownPeriod for the donated BloodComponent.
2. WHEN `nextEligibleAt` is computed, THE DonationsService SHALL persist the value to the donor's `DonorDeferralEntity` record with `reason = RECENT_DONATION` and `isActive = true`.
3. THE DonationsService SHALL derive the CooldownPeriod from the application config module, with default values of 56 days for whole blood, 7 days for platelets, and 28 days for plasma.
4. IF no BloodComponent is specified on the donation record, THEN THE DonationsService SHALL apply the whole-blood default of 56 days.

---

### Requirement 2: Cooldown Enforcement in Eligibility Check

**User Story:** As a blood bank operator, I want the eligibility check to explicitly detect and report an active cooldown, so that donors and staff receive a clear, actionable response when a donation is attempted too soon.

#### Acceptance Criteria

1. WHEN `DonorEligibilityService.checkEligibility` is called for a donor whose `nextEligibleAt` is in the future, THE DonorEligibilityService SHALL return `{ eligible: false, reason: 'COOLDOWN', nextEligibleAt }`.
2. WHEN the cooldown has expired (current time ≥ `nextEligibleAt`), THE DonorEligibilityService SHALL NOT treat the expired cooldown record as an active deferral.
3. THE DonorEligibilityService SHALL evaluate cooldown status independently from other deferral types, so that a COOLDOWN result does not mask a concurrent DEFERRED or PERMANENTLY_EXCLUDED status.
4. IF a donor has both an active cooldown and an active non-cooldown deferral, THEN THE DonorEligibilityService SHALL return the most restrictive status (PERMANENTLY_EXCLUDED > DEFERRED > COOLDOWN).

---

### Requirement 3: Pre-flight Eligibility Guard on POST /donations

**User Story:** As a platform administrator, I want the donation submission endpoint to reject requests from donors in a cooldown window before any record is created, so that invalid donation attempts are blocked at the API boundary.

#### Acceptance Criteria

1. WHEN a request is received at `POST /donations`, THE DonationsController SHALL invoke `DonorEligibilityService.checkEligibility` for the requesting donor before creating any donation record.
2. IF the eligibility check returns `eligible: false` with `reason: 'COOLDOWN'`, THEN THE DonationsController SHALL return HTTP 403 Forbidden with a response body containing `{ error: 'COOLDOWN', nextEligibleAt: <ISO 8601 string> }`.
3. IF the eligibility check returns `eligible: false` with any other reason, THEN THE DonationsController SHALL return HTTP 403 Forbidden with a response body containing the applicable reason code.
4. WHEN the eligibility check returns `eligible: true`, THE DonationsController SHALL proceed with donation creation without modification.

---

### Requirement 4: Admin Cooldown Override

**User Story:** As an admin, I want to override a donor's active cooldown with a documented justification, so that exceptional medical or operational circumstances can be accommodated while maintaining a complete audit record.

#### Acceptance Criteria

1. WHEN an admin submits a `POST /donations` request with a valid `adminOverride` object containing a non-empty `justification` string, THE DonationsController SHALL bypass the cooldown check and proceed with donation creation.
2. WHEN an admin override is applied, THE DonationsService SHALL write an entry to the AuditTrail containing the admin's user ID, the donor's ID, the timestamp, and the verbatim `justification` string.
3. THE DonationsController SHALL reject admin override requests where the `justification` field is absent or empty with HTTP 400 Bad Request.
4. WHERE the admin override feature is used, THE DonationsController SHALL require the caller to hold the `ADMIN` role; non-admin callers providing an `adminOverride` field SHALL receive HTTP 403 Forbidden.

---

### Requirement 5: Configurable Cooldown Periods per Blood Component

**User Story:** As a platform operator, I want cooldown durations to be configurable per blood component type without code changes, so that the platform can adapt to evolving medical guidelines.

#### Acceptance Criteria

1. THE AppConfigModule SHALL expose cooldown period values (in days) for each BloodComponent: `COOLDOWN_WHOLE_BLOOD_DAYS`, `COOLDOWN_PLATELETS_DAYS`, and `COOLDOWN_PLASMA_DAYS`.
2. WHEN a cooldown period environment variable is absent, THE AppConfigModule SHALL fall back to the default values: 56 days (whole blood), 7 days (platelets), 28 days (plasma).
3. THE DonationsService SHALL read cooldown periods exclusively from the AppConfigModule and SHALL NOT hard-code duration values.

---

### Requirement 6: Batch Payment Settlement

**User Story:** As a platform operator, I want to settle multiple locked payments in a single on-chain transaction with automatic fee deduction, so that high-throughput settlement scenarios are efficient and atomic.

#### Acceptance Criteria

1. THE PaymentContract SHALL expose a `batch_release(env, admin, payment_ids: Vec<u64>, fee_bps: u32, fee_collector: Address)` function callable only by the admin address.
2. WHEN `batch_release` is called with a list of payment IDs, THE PaymentContract SHALL verify that every payment in the list has `status = Locked` before transferring any funds; IF any payment is not in Locked status, THEN THE PaymentContract SHALL abort the entire batch and return `Error::BatchPartialFailure` containing the IDs of the non-Locked payments.
3. WHEN all payments in the batch are Locked, THE PaymentContract SHALL compute `fee = amount * fee_bps / 10_000` for each payment using integer arithmetic, transfer `amount - fee` to the payee, and transfer `fee` to the `fee_collector` address.
4. IF the `payment_ids` vector contains more than 50 entries, THEN THE PaymentContract SHALL return `Error::BatchTooLarge` without processing any payments.
5. WHEN a batch is successfully settled, THE PaymentContract SHALL emit a `BatchReleased { count: u32, total_released: i128, total_fees: i128 }` event.
6. THE PaymentContract SHALL perform fee arithmetic such that `fee + (amount - fee) = amount` for every payment, ensuring no funds are created or destroyed by rounding.

---

### Requirement 7: Pledge Fulfillment Verification

**User Story:** As a platform administrator, I want to record and verify that a donation pledge has been fulfilled on-chain before releasing any linked incentive payment, so that incentives are only disbursed for confirmed real-world donations.

#### Acceptance Criteria

1. THE PaymentContract SHALL expose `mark_pledge_fulfilled(env, admin, pledge_id: u64, donation_tx_hash: BytesN<32>)` callable only by the admin address, which sets `DonationPledge.fulfilled = true` and stores the `donation_tx_hash` on the pledge record.
2. WHEN `mark_pledge_fulfilled` is called on a pledge whose `deadline` has already passed, THE PaymentContract SHALL return `Error::PledgeExpired` and make no state changes.
3. THE PaymentContract SHALL expose `release_pledge_incentive(env, admin, pledge_id: u64)` callable only by the admin address; IF `DonationPledge.fulfilled = false`, THEN THE PaymentContract SHALL return `Error::PledgeNotFulfilled`.
4. THE PaymentContract SHALL expose `expire_pledge(env, pledge_id: u64)` callable by any address; WHEN called after `DonationPledge.deadline` has passed without fulfillment, THE PaymentContract SHALL set the pledge to an expired state and return the escrowed incentive amount to the platform reserve address.
5. IF `expire_pledge` is called before the pledge deadline, THEN THE PaymentContract SHALL return `Error::PledgeNotExpired` and make no state changes.
6. WHEN `mark_pledge_fulfilled` is called on an already-expired pledge, THE PaymentContract SHALL return `Error::PledgeExpired` and make no state changes.
7. WHEN `mark_pledge_fulfilled` succeeds, THE PaymentContract SHALL emit a `PledgeFulfilled { pledge_id: u64, donation_tx_hash: BytesN<32> }` event.
8. WHEN `release_pledge_incentive` succeeds, THE PaymentContract SHALL emit a `PledgeIncentiveReleased { pledge_id: u64, amount: i128 }` event.
9. WHEN `expire_pledge` succeeds, THE PaymentContract SHALL emit a `PledgeExpired { pledge_id: u64, returned_amount: i128 }` event.
10. THE PaymentContract `get_pledge` function SHALL return the stored `donation_tx_hash` as part of the pledge record after fulfillment.

---

### Requirement 8: Cross-Contract Authorization Whitelist in Coordinator

**User Story:** As a platform security engineer, I want the coordinator contract to restrict state-mutation calls to a pre-approved set of contract addresses, so that unauthorized callers cannot manipulate the workflow state.

#### Acceptance Criteria

1. THE CoordinatorContract SHALL maintain a `CallerWhitelist` storage entry (a `Vec<Address>`) in persistent storage.
2. THE CoordinatorContract SHALL expose `add_authorized_caller(env, admin, caller_address: Address)` and `remove_authorized_caller(env, admin, caller_address: Address)`, both gated by `admin.require_auth()`.
3. WHEN `add_authorized_caller` is called with an address already present in the CallerWhitelist, THE CoordinatorContract SHALL return `CoordinatorError::CallerAlreadyWhitelisted` and make no state changes.
4. WHEN `remove_authorized_caller` is called with an address not present in the CallerWhitelist, THE CoordinatorContract SHALL return `CoordinatorError::CallerNotFound` and make no state changes.
5. WHEN `allocate_units`, `confirm_delivery`, or `settle_payment` is invoked, THE CoordinatorContract SHALL verify that the `caller` argument is either the admin address or present in the CallerWhitelist; IF the caller is neither, THEN THE CoordinatorContract SHALL return `CoordinatorError::UnauthorizedCaller` and make no state changes.
6. THE CoordinatorContract SHALL treat the admin address as implicitly authorized for all state-mutation functions regardless of CallerWhitelist contents.
7. WHEN the CallerWhitelist is empty and the caller is not the admin, THE CoordinatorContract SHALL return `CoordinatorError::UnauthorizedCaller`.
8. WHEN a caller is removed from the CallerWhitelist, subsequent calls from that address to state-mutation functions SHALL return `CoordinatorError::UnauthorizedCaller` immediately.
