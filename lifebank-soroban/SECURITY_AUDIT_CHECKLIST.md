# Pre-Deployment Security Audit Checklist

**Project:** HealthChain Stellar — Soroban Smart Contracts  
**Scope:** `lifebank-soroban/contracts/`  
**Purpose:** Systematic security review before Stellar Mainnet deployment with real funds  
**Status Legend:** ✅ Pass · ❌ Fail · ⚠️ Partial · 🔲 Not Applicable

---

## 1. Authentication & Authorization

### 1.1 Every state-mutating function calls `require_auth()` on the appropriate address

| Contract | Function | Auth Call | Status | Notes |
|---|---|---|---|---|
| `payments` | `create_payment` | `payer.require_auth()` | ✅ | |
| `payments` | `create_escrow` | `hospital.require_auth()` | ✅ | |
| `payments` | `release_escrow` | `caller.require_auth()` | ✅ | |
| `payments` | `refund_escrow` | `caller.require_auth()` | ✅ | |
| `payments` | `update_status` | ❌ **MISSING** | ❌ | No `require_auth()` — any account can transition payment status |
| `payments` | `record_dispute` | ❌ **MISSING** | ❌ | No `require_auth()` — any account can open a dispute |
| `payments` | `resolve_dispute` | ❌ **MISSING** | ❌ | No `require_auth()` — any account can resolve a dispute |
| `payments` | `batch_create_payments` | Delegates to `create_payment` | ✅ | Each sub-call enforces auth |
| `payments` | `create_pledge` | `donor.require_auth()` | ✅ | |
| `payments` | `set_pledge_active` | `donor.require_auth()` | ✅ | |
| `payments` | `create_vesting` | `admin.require_auth()` | ✅ | |
| `payments` | `claim_vested` | `donor.require_auth()` | ✅ | |
| `payments` | `set_dispute_timeout` | `admin.require_auth()` | ✅ | |
| `payments` | `process_expired_disputes` | `admin.require_auth()` | ✅ | |
| `inventory` | `register_blood` | `bank_id.require_auth()` | ✅ | |
| `inventory` | `update_status` | `authorized_by.require_auth()` | ✅ | |
| `inventory` | `batch_update_status` | `authorized_by.require_auth()` | ✅ | |
| `inventory` | `reserve_blood` | `requester.require_auth()` | ✅ | |
| `inventory` | `release_reservation` | ❌ **MISSING** | ❌ | No `require_auth()` — any account can release any reservation |
| `inventory` | `batch_reserve_blood` | `requester.require_auth()` | ✅ | |
| `inventory` | `batch_register_blood` | `bank_id.require_auth()` | ✅ | |
| `temperature` | `initialize` | `admin.require_auth()` | ✅ | |
| `temperature` | `pause` / `unpause` | `admin.require_auth()` | ✅ | |
| `temperature` | `set_threshold` | `admin.require_auth()` | ✅ | |
| `temperature` | `log_reading` | ❌ **MISSING** | ❌ | No `require_auth()` — any account can submit temperature readings |
| `temperature` | `add_oracle` | `admin.require_auth()` | ✅ | |
| `temperature` | `report_excursion_to_coordinator` | `caller.require_auth()` | ✅ | |
| `temperature` | `reset_compromised_status` | `admin.require_auth()` | ✅ | |
| `coordinator` | `initialize` | `admin.require_auth()` | ✅ | |
| `coordinator` | `pause` / `unpause` | `admin.require_auth()` | ✅ | |
| `coordinator` | `emergency_halt` | `admin.require_auth()` | ✅ | |
| `coordinator` | `allocate_units` | `caller.require_auth()` | ✅ | |
| `coordinator` | `confirm_delivery` | `caller.require_auth()` | ✅ | |
| `coordinator` | `settle_payment` | `caller.require_auth()` | ✅ | |
| `coordinator` | `rollback` | `get_admin(&env).require_auth()` | ✅ | |
| `coordinator` | `flag_temperature_breach` | `caller.require_auth()` | ✅ | |
| `requests` | `create_request` | `hospital.require_auth()` | ✅ | |
| `requests` | `cancel_request` | `caller.require_auth()` | ✅ | |
| `requests` | `update_request_status` | `caller.require_auth()` | ✅ | |
| `requests` | `partial_fulfill_request` | `caller.require_auth()` | ✅ | |
| `delivery` | `initialize` | `admin.require_auth()` | ✅ | |
| `delivery` | `record_compliance_attestation` | `admin.require_auth()` | ✅ | |

**Critical findings:**
- `payments::update_status` — no auth check; anyone can move a payment to any status including `Released`
- `payments::record_dispute` — no auth check; anyone can open a dispute on any payment
- `payments::resolve_dispute` — no auth check; anyone can mark a dispute as resolved
- `inventory::release_reservation` — no auth check; anyone can release any reservation, returning reserved blood units to available pool
- `temperature::log_reading` — no auth check; anyone can submit arbitrary temperature readings, potentially triggering false excursions

### 1.2 Role restrictions are enforced (not just authentication)

| Contract | Function | Role Check | Status | Notes |
|---|---|---|---|---|
| `payments` | `release_escrow` | `require_admin` | ✅ | |
| `payments` | `refund_escrow` | `require_admin` | ✅ | |
| `payments` | `update_status` | None | ❌ | No role check at all (see 1.1) |
| `payments` | `record_dispute` | None | ❌ | No role check at all (see 1.1) |
| `inventory` | `update_status` | admin or unit's `bank_id` | ✅ | |
| `inventory` | `reserve_blood` | `is_authorized_bank` | ✅ | |
| `inventory` | `release_reservation` | None | ❌ | No role check at all (see 1.1) |
| `temperature` | `log_reading` | None | ❌ | Should be restricted to whitelisted oracles |
| `coordinator` | `allocate_units` | `caller.require_auth()` only | ⚠️ | No admin/role restriction — any authenticated account can allocate |
| `coordinator` | `confirm_delivery` | `caller.require_auth()` only | ⚠️ | No role restriction on who can confirm delivery |
| `coordinator` | `settle_payment` | `caller.require_auth()` only | ⚠️ | No role restriction on who can settle |
| `requests` | `authorize_hospital` | `get_admin().require_auth()` | ✅ | |
| `requests` | `update_request_status` | admin only | ✅ | |

### 1.3 Admin key is a multi-sig account, not a single keypair

| Item | Status | Notes |
|---|---|---|
| Admin address is set at `initialize` time | ✅ | All contracts accept an `admin: Address` parameter |
| Admin address can be a multi-sig Stellar account | ✅ | Soroban `Address` supports multi-sig accounts |
| Admin rotation mechanism exists | ❌ | No `transfer_admin` or `set_admin` function in any contract — admin is immutable after initialization |
| Admin is documented as requiring multi-sig | ❌ | No enforcement or documentation in contracts |

**Recommendation:** Add an `transfer_admin(env, current_admin, new_admin)` function to all contracts. Document in deployment runbook that the admin address MUST be a Stellar multi-sig account with threshold ≥ 2.

---

## 2. Input Validation

### 2.1 Numeric inputs are bounds-checked (no overflow, no zero/negative where invalid)

| Contract | Input | Check | Status | Notes |
|---|---|---|---|---|
| `payments` | `amount` in `create_payment` | `amount <= 0` → error | ✅ | |
| `payments` | `amount` in `create_escrow` | `amount <= 0` → error | ✅ | |
| `payments` | `amount_per_period` in `create_pledge` | `<= 0` → error | ✅ | |
| `payments` | `interval_secs` in `create_pledge` | `== 0` → error | ✅ | |
| `payments` | `total_amount` in `create_vesting` | `<= 0` → error | ✅ | |
| `payments` | `duration_secs` in `create_vesting` | `== 0` → error | ✅ | |
| `payments` | `page_size` in paginated queries | Defaults to 20 if 0 | ✅ | |
| `payments` | `payment_ids` batch size in `process_expired_disputes` | No max size limit | ⚠️ | Unbounded batch could hit instruction limit |
| `inventory` | `quantity_ml` | `validate_quantity` (100–600 ml) | ✅ | |
| `inventory` | `duration_seconds` in `reserve_blood` | No lower bound check | ⚠️ | Zero duration creates immediately-expired reservation |
| `inventory` | `unit_ids` batch size | No max size limit | ⚠️ | Unbounded batch could hit instruction limit |
| `temperature` | `min_celsius_x100 >= max_celsius_x100` | Checked | ✅ | |
| `temperature` | `temperature_celsius_x100` range | No bounds check | ⚠️ | Accepts any i32; extreme values (±2,147,483,647) are physically impossible |
| `temperature` | `timestamp` in `log_reading` | No validation | ⚠️ | Accepts timestamps in the past or far future |
| `requests` | `quantity_ml` | `validate_quantity` | ✅ | |
| `requests` | `required_by_timestamp` | `validate_timestamp` (must be future) | ✅ | |
| `coordinator` | `unit_ids` batch size | No max size limit | ⚠️ | Unbounded batch in `allocate_units` |

### 2.2 String inputs are validated against allowlists where applicable

| Contract | Input | Validation | Status | Notes |
|---|---|---|---|---|
| `payments` | `case_id` in `record_dispute` | No validation | ⚠️ | Arbitrary string stored on-chain; no length limit |
| `requests` | `reason` in `cancel_request` | Non-empty check | ✅ | |
| `requests` | `reason` in `update_request_status` | Non-empty check for Rejected | ✅ | |
| `inventory` | `serial_number` | No length/format validation | ⚠️ | Arbitrary string stored on-chain |
| `coordinator` | `location` in `confirm_delivery` | No validation | ⚠️ | Arbitrary string stored on-chain; no length limit |
| `delivery` | `compliance_hash` | `Bytes` type (binary) | ✅ | Binary hash, not free-form string |

### 2.3 Vec/batch inputs have maximum size limits

| Contract | Function | Limit | Status | Notes |
|---|---|---|---|---|
| `payments` | `batch_create_payments` | None | ❌ | No max batch size |
| `payments` | `process_expired_disputes` | None | ❌ | No max batch size |
| `inventory` | `batch_register_blood` | None | ❌ | No max batch size |
| `inventory` | `batch_update_status` | None | ❌ | No max batch size |
| `inventory` | `reserve_blood` (unit_ids) | None | ❌ | No max unit count per reservation |
| `inventory` | `batch_reserve_blood` | None | ❌ | No max batch size |
| `coordinator` | `allocate_units` (unit_ids) | None | ❌ | No max unit count |
| `requests` | `batch_create_requests` | None | ❌ | No max batch size |
| `requests` | `get_requests_by_hospital` | `page_size.min(50)` | ✅ | Capped at 50 |
| `payments` | `get_payment_timeline` | `limit.min(100)` | ✅ | Capped at 100 |

**Recommendation:** Add a `MAX_BATCH_SIZE` constant (suggested: 50) and enforce it at the start of every batch function.

---

## 3. Storage

### 3.1 All `persistent()` storage entries have TTL extension on access

| Contract | Key | TTL Extended on Write | TTL Extended on Read | Status | Notes |
|---|---|---|---|---|---|
| `payments` | `payment_key(id)` | ❌ No `extend_ttl` on write | ❌ | ❌ | Payment records can silently expire |
| `payments` | `pledge_key(id)` | ❌ | ❌ | ❌ | Pledge records can silently expire |
| `payments` | `vesting_key(donor)` | ❌ | ❌ | ❌ | Vesting schedules can silently expire |
| `payments` | `payer_index_key` | ✅ `extend_ttl` on write | ❌ on read | ⚠️ | Extended on write only |
| `payments` | `payee_index_key` | ✅ | ❌ | ⚠️ | Extended on write only |
| `payments` | `status_index_key` | ✅ | ❌ | ⚠️ | Extended on write only |
| `payments` | `req_idx_key` | ❌ | ❌ | ❌ | No TTL management |
| `payments` | `request_timeline_key` | ✅ | ❌ | ⚠️ | Extended on write only |
| `inventory` | `BloodUnit` entries | ❌ | ❌ | ❌ | Blood unit records can silently expire |
| `inventory` | Status index Vecs | ❌ | ❌ | ❌ | Index entries can silently expire |
| `inventory` | `Reservation` entries | Temporary storage (auto-expiry) | 🔲 | ✅ | Intentional TTL via temporary storage |
| `temperature` | `TempPage` / `TempPageLen` | ❌ | ❌ | ❌ | Temperature logs can silently expire |
| `temperature` | `ConsecutiveViolationStreak` | ❌ | ❌ | ❌ | |
| `temperature` | `IsCompromised` | ❌ | ❌ | ❌ | |
| `temperature` | `OracleWhitelist(addr)` | ❌ | ❌ | ❌ | Oracle entries can silently expire |
| `coordinator` | `Workflow(request_id)` | ❌ | ❌ | ❌ | Workflow records can silently expire |
| `requests` | `BloodRequest` entries | ❌ | ❌ | ❌ | Request records can silently expire |

**Critical finding:** The majority of persistent storage entries across all contracts have no TTL management. On Stellar, persistent entries that are not bumped will eventually be evicted. For a healthcare system, silent eviction of payment records, blood unit data, or workflow state is a critical data-loss risk.

**Recommendation:** Add `extend_ttl` calls with appropriate thresholds to every `persistent().set()` call, and also on every `persistent().get()` that reads a critical record.

### 3.2 No unbounded Vecs in `instance()` storage

| Contract | Instance Key | Type | Status | Notes |
|---|---|---|---|---|
| `payments` | `STATS_KEY` | `PaymentStats` (fixed struct) | ✅ | |
| `payments` | `ADMIN_KEY`, `PAUSED_KEY`, etc. | Scalar values | ✅ | |
| `inventory` | `DataKey::Admin`, `DataKey::Paused` | Scalar values | ✅ | |
| `temperature` | `DataKey::Admin`, `DataKey::Paused` | Scalar values | ✅ | |
| `temperature` | `DataKey::CoordinatorContract` | Single `Address` | ✅ | |
| `coordinator` | All instance keys | Scalar `Address` values | ✅ | |
| `requests` | All instance keys | Scalar values | ✅ | |

**Result:** No unbounded Vecs found in instance storage. ✅

### 3.3 No data can be written without being reachable for future reads

| Contract | Write Path | Read Path | Status | Notes |
|---|---|---|---|---|
| `payments` | `store_payment(id)` | `load_payment(id)` via counter | ✅ | |
| `payments` | `index_by_payer` | `get_payments_by_payer` | ✅ | |
| `payments` | `index_by_request` | `get_payment_by_request` | ✅ | |
| `inventory` | `set_blood_unit(id)` | `get_blood_unit(id)` via counter | ✅ | |
| `inventory` | `serial_key` | Checked on registration | ✅ | Write-once guard, not a query index |
| `temperature` | `TempPage(unit_id, page)` | `get_readings` / `get_violations` | ✅ | |
| `temperature` | `OracleWhitelist(addr)` | `report_excursion_to_coordinator` | ✅ | |
| `coordinator` | `Workflow(request_id)` | `get_workflow(request_id)` | ✅ | |
| `requests` | `BloodRequest(id)` | `get_request(id)` | ✅ | |

**Result:** All written data has a corresponding read path. ✅

---

## 4. Cross-Contract Calls

### 4.1 Failure modes of all cross-contract calls are handled

| Caller | Callee | Function | Error Handling | Status | Notes |
|---|---|---|---|---|---|
| `coordinator` | `requests` | `get_request` | `map_err` → `RequestNotFound` | ✅ | |
| `coordinator` | `inventory` | `update_status` | `map_err` → `InventoryUpdateFailed` | ✅ | |
| `coordinator` | `inventory` | `mark_delivered` | `map_err` → `InventoryUpdateFailed` | ✅ | |
| `coordinator` | `inventory` | `get_admin` | Direct call (no `try_`) | ⚠️ | Panics if inventory contract is unavailable |
| `coordinator` | `payments` | `get_payment` | `map_err` → `PaymentNotFound` | ✅ | |
| `coordinator` | `payments` | `update_status` | `map_err` → `PaymentUpdateFailed` | ✅ | |
| `coordinator` | `payments` | `record_dispute` | `map_err` → `PaymentFlagFailed` | ✅ | |
| `temperature` | `coordinator` | `flag_temperature_breach` | `map_err` → `CoordinatorCallFailed` | ✅ | |
| `requests` | `inventory` | `release_reservation` | Direct call (no `try_`) | ⚠️ | Panics if inventory contract is unavailable; blocks request cancellation |

**Findings:**
- `coordinator::allocate_units` calls `inv_client.get_admin()` without `try_` — if the inventory contract is unavailable or returns an unexpected type, the coordinator panics and the entire transaction aborts.
- `requests::release_reservation_if_present` calls `inv_client.release_reservation()` without `try_` — a failure in the inventory contract will block request cancellation entirely.

### 4.2 Correct `require_auth()` propagation across contract boundaries

| Scenario | Status | Notes |
|---|---|---|
| `coordinator` calls `inventory::update_status` with `inv_admin` address | ⚠️ | The coordinator fetches the inventory admin address and passes it as `authorized_by`, but the inventory contract calls `authorized_by.require_auth()` — this will fail unless the coordinator is authorized to act on behalf of the inventory admin |
| `coordinator` calls `inventory::mark_delivered` with `inv_admin` | ⚠️ | Same issue as above |
| `requests` calls `inventory::release_reservation` | ✅ | `release_reservation` has no auth check (see 1.1 — itself a bug) |
| `temperature` calls `coordinator::flag_temperature_breach` with `caller` | ✅ | Caller auth is propagated correctly |

**Critical finding:** The coordinator passes `inv_admin` as the `authorized_by` argument to inventory functions, but `inventory::update_status` calls `authorized_by.require_auth()`. For this to work, the coordinator contract must be authorized to sign on behalf of the inventory admin, which is not possible without the inventory admin explicitly authorizing the coordinator. This is likely broken in production and needs a dedicated coordinator-role mechanism in the inventory contract.

---

## 5. Token Handling

### 5.1 Token transfers are atomic with storage updates

| Contract | Function | Transfer Order | Status | Notes |
|---|---|---|---|---|
| `payments` | `create_escrow` | Transfer **before** storage write | ✅ | If transfer fails, no record is written |
| `payments` | `release_escrow` | Transfer **before** status update | ⚠️ | Transfer happens before `store_payment` — if `store_payment` panics after transfer, funds are moved but status is stale. In practice Soroban transactions are atomic so this is safe, but the ordering is worth noting. |
| `payments` | `refund_escrow` | Transfer **before** status update | ⚠️ | Same as above |
| `payments` | `claim_vested` | Schedule updated **before** transfer | ⚠️ | `store_vesting` is called before `token_client.transfer` — if the transfer fails, the claimed amount is already incremented. This is a **reentrancy-safe** pattern (update state first) but means a failed transfer leaves the schedule in an inconsistent state. |
| `payments` | `process_expired_disputes` | Transfer **before** status update | ⚠️ | Same ordering concern as `release_escrow` |

**Recommendation for `claim_vested`:** The current pattern (update storage, then transfer) is the correct reentrancy-safe approach for Soroban. However, if the token transfer fails (e.g., contract paused), the vesting schedule will show `claimed` incremented with no actual transfer. Add a rollback or use `try_transfer` and revert the storage update on failure.

---

## 6. Summary of Critical Issues (Must Fix Before Mainnet)

| # | Severity | Contract | Issue | Fix |
|---|---|---|---|---|
| 1 | 🔴 Critical | `payments` | `update_status` has no `require_auth()` — anyone can release or cancel any payment | Add `caller: Address` param, `caller.require_auth()`, and restrict to admin or payment parties |
| 2 | 🔴 Critical | `payments` | `record_dispute` has no `require_auth()` — anyone can dispute any payment | Add `caller: Address` param, `caller.require_auth()`, restrict to admin or payer |
| 3 | 🔴 Critical | `payments` | `resolve_dispute` has no `require_auth()` — anyone can resolve any dispute | Add `caller: Address` param, `caller.require_auth()`, restrict to admin |
| 4 | 🔴 Critical | `inventory` | `release_reservation` has no `require_auth()` — anyone can release any reservation | Add `caller: Address` param, `caller.require_auth()`, restrict to reservation owner or admin |
| 5 | 🔴 Critical | `temperature` | `log_reading` has no `require_auth()` — anyone can submit fake temperature data | Add `oracle: Address` param, `oracle.require_auth()`, check oracle whitelist |
| 6 | 🔴 Critical | All contracts | No TTL management on persistent storage — records will silently expire on-chain | Add `extend_ttl` on all `persistent().set()` and critical `persistent().get()` calls |
| 7 | 🟠 High | `coordinator` | Cross-contract auth propagation broken — passes `inv_admin` to `inventory::update_status` which calls `inv_admin.require_auth()` | Add a coordinator-role mechanism to inventory, or use `env.current_contract_address()` as the authorized caller |
| 8 | 🟠 High | All contracts | Admin key has no rotation mechanism and no multi-sig enforcement | Add `transfer_admin` function; document multi-sig requirement in deployment runbook |
| 9 | 🟡 Medium | All batch functions | No maximum batch size — large batches can hit Soroban instruction limits | Add `MAX_BATCH_SIZE = 50` constant and enforce at function entry |
| 10 | 🟡 Medium | `requests` | `release_reservation_if_present` uses direct call (no `try_`) — inventory failure blocks request cancellation | Wrap in `try_release_reservation` and handle failure gracefully |
| 11 | 🟡 Medium | `coordinator` | `inv_client.get_admin()` uses direct call — panics if inventory unavailable | Use `try_get_admin` with proper error mapping |
| 12 | 🟡 Medium | `payments` | `claim_vested` increments `claimed` before token transfer — failed transfer leaves inconsistent state | Use `try_transfer` and revert storage update on failure |
| 13 | 🟡 Medium | `temperature` | `log_reading` accepts any `timestamp` value — past/future timestamps accepted | Validate timestamp is within a reasonable window of `env.ledger().timestamp()` |
| 14 | 🟡 Medium | `inventory` | `reserve_blood` accepts `duration_seconds = 0` — creates immediately-expired reservation | Add `duration_seconds > 0` check |

---

## 7. Deployment Checklist

Before deploying to Stellar Mainnet:

- [ ] All Critical (🔴) issues above are resolved and re-audited
- [ ] All High (🟠) issues above are resolved
- [ ] Admin address for each contract is a Stellar multi-sig account with threshold ≥ 2
- [ ] Admin key holders are documented and stored in a hardware security module (HSM)
- [ ] All contracts are deployed with `extend_ttl` calls in place
- [ ] Contract addresses are recorded and cross-referenced in `contracts.json`
- [ ] A testnet dry-run of the full workflow (allocate → deliver → settle) has been completed
- [ ] Emergency halt procedure is documented and tested
- [ ] Off-chain indexer is monitoring all contract events
- [ ] Incident response runbook is in place for disputed payments and temperature excursions
