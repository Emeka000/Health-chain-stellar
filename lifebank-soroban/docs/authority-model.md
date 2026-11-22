# Lifebank Soroban Authority Model

This document describes the trust relationships and authorization patterns across all Lifebank Soroban contracts. Understanding this model is critical for deployment, integration, and debugging.

## Executive Summary

The Lifebank contracts form a trust network centered on the **Coordinator contract**, which orchestrates the blood delivery workflow by calling Requests, Inventory, and Payments contracts. Trust flows in specific directions:

- **Coordinator** is the orchestration hub; it trusts (and calls) Requests, Inventory, and Payments
- **Payments** trusts Coordinator for escrow settlement and Temperature for dispute signals
- **Requests** trusts Inventory through a cross-contract authorization pattern (not by direct admin passing)
- **Temperature** calls Coordinator to report breaches
- **Identity, Reputation, Delivery, Matching** are ancillary; no critical trust dependencies

**Key insight:** No contract is an "admin" of another in the traditional sense. Instead, each contract stores the addresses of the contracts it needs to call, and uses Soroban's cross-contract invocation system with authorization requirements at each layer.

---

## Trust Graph

```
                      ┌──────────────────────────────────────────────────┐
                      │                 COORDINATOR                       │
                      │ Orchestrates 3-step delivery workflow            │
                      │ Trusts & calls: Requests, Inventory, Payments    │
                      │ Receives: Temperature breach notifications        │
                      └────┬──────────────────┬──────────────────┬───────┘
                           │                  │                  │
                  read:     │                  │      calls       │ calls
              get_request() │     calls        │  update_status() │ release_escrow()
                           │  update_status   │  record_dispute()│ refund_escrow()
                           │                  │                  │
                    ┌──────▼────────┐ ┌──────▼────────┐ ┌───────▼──────┐
                    │  REQUESTS     │ │  INVENTORY    │ │   PAYMENTS   │
                    │               │ │               │ │              │
                    │ Hospital      │ │ Blood unit    │ │ Escrow       │
                    │ requests      │ │ lifecycle     │ │ Disputes     │
                    │ lifecycle     │ │ reservations  │ │              │
                    └───────┬───────┘ └──────┬────────┘ └──────────────┘
                            │                │
                 trusts via │                │ calls:
              cross-contract│         (Coordinator
              auth pattern  │         as intermediary)
                            │
              (see CROSS_   │
               CONTRACT_    └──────────────────────────┐
               AUTHORIZATION_FIX.md)                   │
                                                       │
                                              ┌────────▼────────┐
                                              │   TEMPERATURE   │
                                              │                 │
                                              │ IoT readings,   │
                                              │ excursion       │
                                              │ detection       │
                                              │                 │
                                              │ Calls:          │
                                              │ Coordinator.    │
                                              │ flag_temp...()  │
                                              └─────────────────┘

      ┌─────────────┐ ┌──────────────┐ ┌──────────────┐
      │  IDENTITY   │ │ REPUTATION   │ │  DELIVERY    │ ┌──────────────┐
      │             │ │              │ │              │ │  ANALYTICS   │
      │ Org/role    │ │ Scoring      │ │ Compliance   │ │              │
      │ registry    │ │ engine       │ │ tracking     │ │ Metrics      │
      │             │ │              │ │              │ │ snapshots    │
      └─────────────┘ └──────────────┘ └──────────────┘ └──────────────┘
         (standalone)    (analytics)      (ancillary)      (analytics)
```

---

## Privileged Entrypoints by Contract

### 1. COORDINATOR

The coordinator orchestrates the blood delivery workflow and holds all critical contract addresses. **It is the single point of failure for initialization and configuration.**

| Entrypoint | Caller | What It Does | Critical? |
|---|---|---|---|
| `initialize(admin, request_contract, inventory_contract, payment_contract)` | Any (auth: admin) | Stores admin address, contract addresses; can only be called once | **CRITICAL** |
| `allocate_units(request_id, unit_ids, payment_id, caller)` | Admin | Step 1: Reserves inventory units, binds payment to request | **CRITICAL** |
| `confirm_delivery(request_id, caller, location)` | Admin | Step 2: Marks units as Delivered | **CRITICAL** |
| `settle_payment(request_id, caller)` | Admin | Step 3: Releases escrowed payment | **CRITICAL** |
| `rollback(request_id)` | Admin | Reverts Allocated workflow; releases units, refunds payment | **CRITICAL** |
| `expire_workflow(request_id)` | Any | Releases units + refunds payment if workflow timeout elapsed | Important |
| `set_temperature_oracle(admin, oracle)` | Admin | Registers temperature contract as breach notifier | Important |
| `flag_temperature_breach(caller, payment_id, excursion)` | Oracle or Admin | Records temperature dispute; blocks payment release | **CRITICAL** |
| `pause(admin)` | Admin | Blocks all state-mutating functions; allows reads | Important |
| `unpause(admin)` | Admin | Restores normal operation | Important |
| `emergency_halt(admin)` | Admin | Blocks in-flight workflows (confirm_delivery, settle_payment) | Important |
| `clear_emergency_halt(admin)` | Admin | Clears the halt flag | Important |
| `propose_admin(current_admin, new_admin)` | Admin | Starts two-step admin transfer | Important |
| `accept_admin(new_admin)` | Proposed admin | Completes admin transfer | Important |

**Cross-Contract Calls Made by Coordinator:**
- `requests.get_request(request_id)` — read-only
- `inventory.get_admin()` — to use as parameter for inventory calls
- `inventory.update_status(unit_id, new_status, admin, ...)` — state mutation
- `inventory.mark_delivered(unit_id, admin, location)` — state mutation
- `payments.get_payment(payment_id)` — read-only
- `payments.release_escrow(caller, payment_id)` — release funds
- `payments.refund_escrow(caller, payment_id)` — refund funds
- `payments.record_dispute(payment_id, reason, case_id, caller)` — dispute recording

**Key Authorization Model:**
- All privileged calls require the **admin address** to call `.require_auth()`
- Admin address is stored during initialization and verified on every privileged call
- There is no delegation; only the stored admin can authorize these actions
- **Problem:** This locks humans out of direct dispute resolution, token allowlisting, and contract upgrades on the payments contract if coordinator is set as payments admin

---

### 2. PAYMENTS

Holds escrowed funds and manages payment lifecycle. Must be called by Coordinator.

| Entrypoint | Caller | What It Does | Critical? |
|---|---|---|---|
| `initialize(coordinator_contract, requests_contract_option)` | Any (auth) | Stores coordinator address; can only be called once | **CRITICAL** |
| `add_allowed_token(caller, token)` | Admin | Whitelists a token for escrow | Important |
| `update_status(payment_id, status, caller)` | Coordinator or Admin | State transition for payments | **CRITICAL** |
| `release_escrow(caller, payment_id)` | Coordinator | Transfers funds to payee on successful delivery | **CRITICAL** |
| `refund_escrow(caller, payment_id)` | Coordinator | Transfers funds back to payer on rollback | **CRITICAL** |
| `record_dispute(payment_id, reason, case_id, caller)` | Coordinator or Temperature | Marks payment as Disputed | **CRITICAL** |
| `resolve_dispute(payment_id, resolution, caller)` | Admin | Settles dispute: ReleaseToPayee or RefundToPayer | **CRITICAL** |
| `pause(admin)` | Admin | Blocks all state mutations | Important |
| `unpause(admin)` | Admin | Restores operations | Important |

**Cross-Contract Calls Made by Payments:**
- None (payments is a sink; other contracts call it, not vice versa)

**Cross-Contract Calls Made to Payments:**
- `payments.get_payment(payment_id)` — read-only, called by Coordinator
- `payments.release_escrow(coordinator_addr, payment_id)` — called by Coordinator
- `payments.refund_escrow(coordinator_addr, payment_id)` — called by Coordinator
- `payments.record_dispute(payment_id, reason, case_id, temp_oracle_addr)` — called by Temperature or Coordinator

**Key Authorization Challenge:**
- Coordinator must be set as the admin to call `release_escrow()` and `refund_escrow()`
- This **locks humans out** of the `resolve_dispute()` entrypoint if coordinator is the admin
- Human dispute resolution (settling disagreements manually) becomes impossible
- **Solution:** Use a multisig admin key (see Recommended Key Setup, below)

---

### 3. REQUESTS

Manages hospital blood request lifecycle and cross-contract authorization with Inventory.

| Entrypoint | Caller | What It Does | Critical? |
|---|---|---|---|
| `initialize(admin, inventory_contract)` | Any (auth: admin) | Stores admin, inventory contract; single call | **CRITICAL** |
| `authorize_hospital(hospital)` | Admin | Allows hospital to create requests | Important |
| `revoke_hospital(hospital)` | Admin | Removes hospital authorization | Important |
| `authorize_blood_bank(bank)` | Admin | Allows blood bank participation | Important |
| `revoke_blood_bank(bank)` | Admin | Removes blood bank authorization | Important |
| `authorize_rider(rider)` | Admin | Allows rider/delivery person participation | Important |
| `revoke_rider(rider)` | Admin | Removes rider authorization | Important |
| `cancel_request(request_id, caller, reason)` | Hospital or Admin | Cancels request; releases inventory reservation | Important |

**Cross-Contract Calls Made by Requests:**
- `inventory.release_reservation_by_contract(requests_contract_addr, reservation_id)` — **uses cross-contract authorization pattern**

**Key Authorization Pattern - Cross-Contract Authorization:**

When a hospital cancels a request with a reservation, Requests must release the reservation from Inventory without forcing the hospital to re-sign. The solution:

1. Hospital signs: `requests.cancel_request(hospital_addr)`
2. Requests calls: `inventory.release_reservation_by_contract(requests_contract_addr, res_id)`
3. Inventory verifies BOTH:
   - `authorized_contract == stored_requests_contract` (address check)
   - `authorized_contract.require_auth()` (signature check)

This pattern allows Requests to release reservations **without requiring admin co-signature on every cancellation**. See `CROSS_CONTRACT_AUTHORIZATION_FIX.md` for details.

---

### 4. INVENTORY

Manages blood unit lifecycle, reservations, and cross-contract authorization from Requests.

| Entrypoint | Caller | What It Does | Critical? |
|---|---|---|---|
| `initialize(admin)` | Any (auth: admin) | Stores admin; authorizes admin as first blood bank | **CRITICAL** |
| `authorize_bank(admin, bank, authorized)` | Admin | Grants/revokes blood bank authorization | Important |
| `grant_role(admin, grantee, role)` | Admin | Assigns role (Admin, BloodBank, Rider, Hospital) | Important |
| `revoke_role(admin, grantee)` | Admin | Removes role | Important |
| `register_blood(bank_id, blood_type, quantity_ml, donor_id)` | BloodBank | Creates blood unit record | Important |
| `update_status(unit_id, new_status, admin, rider_or_hospital)` | Admin or Rider/Hospital (via Coordinator) | State transition (Available → Reserved → InTransit → Delivered) | **CRITICAL** |
| `mark_delivered(unit_id, admin, location)` | Admin | Records delivery completion | **CRITICAL** |
| `release_reservation_by_contract(authorized_contract, reservation_id)` | RequestsContract (via cross-contract auth) | Releases reservation without external re-signing | **CRITICAL** |
| `pause(admin)` | Admin | Blocks state mutations | Important |
| `unpause(admin)` | Admin | Restores operations | Important |

**Cross-Contract Calls Made by Inventory:**
- None

**Cross-Contract Calls Made to Inventory:**
- `inventory.get_admin()` — read-only, called by Coordinator
- `inventory.update_status(unit_id, status, inv_admin, None)` — called by Coordinator
- `inventory.mark_delivered(unit_id, inv_admin, location)` — called by Coordinator
- `inventory.release_reservation_by_contract(requests_contract_addr, res_id)` — called by Requests

**Key Authorization Mechanism:**
- Role-based state transitions: Riders can mark InTransit, Hospitals can mark Delivered, Admin can do either
- Cross-contract authorization: Requests passes itself as `authorized_contract`; Inventory verifies stored address matches

---

### 5. TEMPERATURE

Reports temperature excursions from IoT devices; triggers disputes via Coordinator.

| Entrypoint | Caller | What It Does | Critical? |
|---|---|---|---|
| `initialize(admin)` | Any (auth: admin) | Stores admin; single call | Important |
| `add_oracle(admin, oracle)` | Admin | Registers IoT oracle address | Important |
| `remove_oracle(admin, oracle)` | Admin | Unregisters oracle | Important |
| `propose_threshold_change(admin, unit_id, min_celsius_x100, max_celsius_x100)` | Admin | Proposes threshold change (7-day delay) | Important |
| `apply_threshold_change(unit_id)` | Any (time-locked) | Applies pending threshold after 7-day delay | Important |
| `report_excursion(oracle, unit_id, readings)` | RegisteredOracle | Reports temperature reading; detects violations | **CRITICAL** |
| `pause(admin)` | Admin | Blocks new reports and threshold proposals | Important |
| `unpause(admin)` | Admin | Restores operations | Important |

**Cross-Contract Calls Made by Temperature:**
- `coordinator.flag_temperature_breach(temperature_contract_addr, payment_id, excursion)` — on detection of 3+ consecutive violations

**Key Authorization Model:**
- Oracles must be registered by admin before they can report
- Threshold changes are time-locked (7-day delay) to allow governance
- Temperature breach reporting is **the only non-admin cross-contract call** in the system; any registered oracle can trigger disputes

---

### 6. IDENTITY

Registry of organizations, roles, and badges. Ancillary to core workflow.

| Entrypoint | Caller | What It Does | Critical? |
|---|---|---|---|
| `initialize(admin, requests_contract_optional)` | Any (auth: admin) | Stores admin, optional requests address | Important |
| `register_organization(owner, org_type, name, license, location_hash)` | Owner | Creates organization record | Important |
| `verify_organization(org_id)` | Admin | Marks organization as verified | Important |
| `unverify_organization(org_id, reason)` | Admin | Revokes verification | Important |
| `grant_role(grantee, role, expires_at)` | Admin | Assigns role (Admin, BloodBank, Hospital, Donor, Rider, Custom) | Important |
| `revoke_role(grantee, role)` | Admin | Removes role; cannot revoke last Admin | Important |
| `record_delivery_proof(request_id, org_id, recipient, quantity_ml, temp_ok)` | Rider | Records proof of delivery | Important |
| `propose_admin(current_admin, new_admin)` | Admin | Starts two-step admin transfer | Important |
| `accept_admin(new_admin)` | Proposed admin | Completes admin transfer | Important |

**No critical authorization challenges** — standalone contract with no forced dependencies.

---

### 7. REPUTATION, DELIVERY, MATCHING, ANALYTICS

**Ancillary contracts:** No critical authorization dependencies. Each follows the standard two-step admin transfer pattern.

| Contract | Key Pattern |
|---|---|
| REPUTATION | Admin records penalties; public read for score calculations |
| DELIVERY | Admin records compliance hashes; tracks proof requirements |
| MATCHING | Admin-authorized matching helpers; read-only calls to Inventory/Requests |
| ANALYTICS | Admin records domain events; computes metrics |

---

## Critical Trust Assumptions

### 1. **Coordinator Admin Must Be Trusted**

The coordinator admin holds the keys to:
- Step 1: allocate units (reserves inventory)
- Step 2: confirm delivery (marks delivered)
- Step 3: settle payments (releases escrow)

**Risk:** If coordinator admin key is compromised, an attacker can:
- Allocate units without hospitals requesting them (fraud)
- Mark deliveries as confirmed without actual transport (fraud)
- Release payments without confirmation (theft)

**Mitigation:** Use a multisig admin for Coordinator (see Recommended Key Setup).

### 2. **Coordinator Must Know the Correct Contract Addresses**

During `initialize()`, the coordinator stores the addresses of Requests, Inventory, and Payments. These are hardcoded and **cannot be updated**. If any address is wrong, the workflow breaks.

**Risk:** If addresses are misconfigured:
- Coordinator calls the wrong contract (funds go to wrong place)
- Workflow becomes impossible to complete

**Mitigation:** Triple-check addresses during initialization; test on testnet first.

### 3. **Payments Contract Must Trust Coordinator**

The Payments contract stores the Coordinator address and only Coordinator can call `release_escrow()` and `refund_escrow()`.

**Risk:** If coordinator address is wrong, payment settlement fails.

**Mitigation:** Coordinate initialization order; Payments must be initialized after Coordinator address is known.

### 4. **Inventory Admin Must Match Coordinator's Expectations**

Coordinator calls `inventory.get_admin()` and then passes that admin address to `inventory.update_status()`. If Inventory's admin changes after Coordinator initialization, calls fail.

**Risk:** Admin key rotation breaks Coordinator's workflow.

**Mitigation:** Do NOT rotate admin keys after initialization; use two-step admin transfer instead.

### 5. **Temperature Must Know the Coordinator Address**

Temperature calls `coordinator.flag_temperature_breach()` to report excursions. If Coordinator address is wrong, temperature alerts are lost.

**Risk:** Excursions aren't recorded; disputes aren't filed.

**Mitigation:** Configure temperature oracle during Coordinator setup.

---

## Recommended Key Setup for Mainnet

### Admin Key Strategy

**Problem:** If Coordinator's admin is a single externally owned account (EOA):
- Every allocation, confirmation, and settlement requires coordinator-admin to sign
- Coordinator admin becomes a hot key
- Admin key compromise = full system compromise

**Recommended Solution: Multisig Coordinator Admin**

Use a multisig smart contract as the Coordinator admin. This allows:
- Splitting authorization across multiple signers
- Requiring M-of-N signatures for critical operations
- Cold storage of N-1 keys; only 1 signer needs to be online
- Auditability of who authorized each step

**Setup Example (2-of-3 multisig):**

```
Coordinator Admin = Multisig Contract (2-of-3)
  Signer 1: Operational key (hot, online, used daily)
  Signer 2: Emergency key (cold storage, for override)
  Signer 3: Governance key (cold storage, policy changes only)

For each workflow step (allocate/confirm/settle):
  Operational key + one of {Emergency, Governance} must sign
```

### Coordinator as Scoped Operator

Once Coordinator is initialized, it becomes a "scoped operator" with these capabilities:
- **On Inventory:** Update blood unit status (read admin via get_admin, use it as parameter)
- **On Payments:** Release/refund escrow (requires payments admin = coordinator admin)
- **On Requests:** Read-only access to request records

**Key constraint:** Coordinator can ONLY call the contracts it knows about (set during init). It cannot:
- Call Temperature (Temperature calls Coordinator, not vice versa)
- Call Identity, Reputation, Delivery, Matching, Analytics (no dependencies)
- Upgrade its own code (upgrade requires admin key directly)

### Token Allowlist Management

On Payments contract, the `add_allowed_token()` function requires admin. If Coordinator is Payments admin:
- Only Coordinator admin can allowlist tokens
- But Coordinator has no entrypoint for this (human operators need it)
- **Solution:** Keep Payments admin separate from Coordinator admin

**Recommended:**
```
Coordinator Admin = Multisig (2-of-3) for workflow steps
Payments Admin = Separate multisig (3-of-5) for treasury operations
  (includes tokens, dispute resolution, emergency pause)

Payments stores Coordinator address for escrow settlement
But Payments admin ≠ Coordinator admin
This allows humans to manage disputes and token lists independently
```

---

## Deployment Order

1. **Deploy** all 10 contract WASMs (no initialization yet)
2. **Get contract addresses** from deployment
3. **Initialize in dependency order:**
   - Identity (no deps)
   - Reputation (no deps)
   - Temperature (no deps)
   - Inventory (admin only)
   - Requests (admin, inventory_contract)
   - Payments (admin, coordinator_contract_optional)
   - Delivery (admin, requests_contract)
   - Matching (admin, inventory_contract, requests_contract)
   - Analytics (admin, inventory_contract, requests_contract, payments_contract)
   - **Coordinator last** (admin, request_contract, inventory_contract, payment_contract)
4. **Configure cross-contract trust:**
   - Requests: Store Inventory contract address (via initialize)
   - Payments: Store Coordinator contract address (via initialize)
   - Coordinator: Store Requests, Inventory, Payments addresses (via initialize)
   - Temperature: Store Coordinator address (via set_temperature_oracle after Coordinator init)
5. **Test the workflow:** Allocate → Confirm → Settle on testnet before mainnet

---

## Initialization Script Validation

The `initialize-contracts.sh` script must verify that every trust edge it creates matches the contracts' expectations.

**Every `set_*` call must establish a trust edge:**

| Script Call | Contract | Stored Address | Used By |
|---|---|---|---|
| `coordinator initialize --request-contract` | Coordinator | RequestContract | `allocate_units()` → calls `requests.get_request()` |
| `coordinator initialize --inventory-contract` | Coordinator | InventoryContract | `allocate_units()` → calls `inventory.update_status()` |
| `coordinator initialize --payment-contract` | Coordinator | PaymentContract | `settle_payment()` → calls `payments.release_escrow()` |
| `requests initialize --inventory-contract` | Requests | InventoryContract | `cancel_request()` → calls `inventory.release_reservation_by_contract()` |
| `payments initialize --coordinator` | Payments | Coordinator | `release_escrow()` receives auth from Coordinator |
| `temperature set-temperature-oracle` | Coordinator | TemperatureOracle | `flag_temperature_breach()` only callable by oracle or admin |
| `inventory set-requests-contract` (if needed) | Inventory | RequestsContract | `release_reservation_by_contract()` verifies caller address |

**Validation rule:** Every trust edge in authority-model.md must correspond to a set_* call in initialize-contracts.sh, and vice versa.

---

## Troubleshooting: When Authorization Fails

### "Unauthorized" Error on Coordinator → Payments

**Symptom:** `settle_payment()` fails with `Unauthorized`

**Causes:**
1. Payments admin ≠ Coordinator address → Coordinator cannot call `release_escrow()`
2. Payments never called `initialize()` to store Coordinator address

**Fix:**
```bash
# Check initialization order
# 1. Initialize Payments AFTER getting Coordinator address
# 2. Pass Coordinator address to Payments initialize
payments.initialize(admin, coordinator_addr)
```

### "Unauthorized" Error on Requests → Inventory

**Symptom:** `cancel_request()` fails with `Unauthorized` on `release_reservation_by_contract()`

**Causes:**
1. Inventory doesn't store Requests contract address (or stores wrong address)
2. Inventory address check fails: `authorized_contract != stored_requests_contract`

**Fix:**
```bash
# Inventory must store Requests address
# (This happens via Requests initialization or manual configuration)
inventory.set_requests_contract(requests_addr)
```

### "WorkflowNotFound" After Allocation

**Symptom:** `confirm_delivery()` fails with `WorkflowNotFound` but `allocate_units()` succeeded

**Causes:**
1. State storage issue (persistent storage TTL expired)
2. Ledger timeout between allocation and confirmation

**Fix:**
- Test on local network first (no ledger delays)
- Allocate → Confirm → Settle within same test transaction

### "InventoryUpdateFailed" on Any Coordinator Operation

**Symptom:** `allocate_units()`, `confirm_delivery()`, or `rollback()` fails with `InventoryUpdateFailed`

**Causes:**
1. Inventory contract address wrong in Coordinator
2. Inventory contract not initialized
3. Inventory admin key doesn't match what Coordinator is passing

**Fix:**
```bash
# Verify addresses
coordinator.get_contract_address(RequestContract)  # should match Requests
coordinator.get_contract_address(InventoryContract)  # should match Inventory

# Verify Inventory is initialized
inventory.version()  # should return 1 if initialized
```

---

## References

- `ARCHITECTURE.md` — Visual dependency graph and workflow steps
- `CROSS_CONTRACT_AUTHORIZATION_FIX.md` — Cross-contract authorization pattern details
- `initialize-contracts.sh` — Deployment and initialization script
- Coordinator source: `contracts/coordinator/src/lib.rs`
- Payments source: `contracts/payments/src/lib.rs`
- Requests source: `contracts/requests/src/lib.rs`
- Inventory source: `contracts/inventory/src/lib.rs`
