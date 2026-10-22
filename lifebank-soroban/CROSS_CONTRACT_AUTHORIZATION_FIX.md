# Cross-Contract Authorization Fix: Reservation Release

## Problem Statement

The request cancellation flow had a critical authorization gap that could cause a functional DoS (denial of service) on request cancellation whenever a reservation exists.

### The Issue

**Call Chain:**
1. Hospital/admin calls `RequestContract::cancel_request(caller)` with `caller.require_auth()`
2. Inside cancel_request, the requests contract calls:
   ```rust
   inv_client.release_reservation(&admin, &res_id)
   ```
   where `admin = storage::get_admin(env)` (the **requests contract's admin**)
3. Inventory's `release_reservation()` immediately calls:
   ```rust
   caller.require_auth()  // caller = requests_contract_admin
   ```

**Why This Fails:**
- The `requests_contract_admin` is a plain external address stored in the requests contract
- This address **did NOT sign the original transaction** — the hospital did
- For `require_auth()` to pass on an address, that address must have signed the transaction
- Unless the requests contract's admin key **also actively co-signs every hospital cancellation**, the call fails with an authorization error
- This forces overly centralized signing: both the hospital AND the admin key must sign every cancellation

**Real-World Impact:**
```
Hospital calls: cancel_request(hospital_addr)  
  ✅ hospital_addr signs the transaction

Requests contract tries: release_reservation(requests_admin_addr)
  ❌ requests_admin_addr did NOT sign the transaction
  ❌ require_auth() fails
  ❌ cancel_request fails
  ❌ DoS: cannot cancel any request with a reservation
```

---

## Required Solution: Cross-Contract Authorization Pattern

Instead of trusting an arbitrary address supplied by the caller, inventory must store **the deployed requests contract address as an admin-configured trusted address**. The cross-contract entry point must require both that the supplied address matches the stored address and that the supplied contract address authenticates the call.

**Current status:** The shipped implementation only calls `authorized_contract.require_auth()` and does not compare the address with a stored trusted address. Until #1472 is fixed, `release_reservation_by_contract` is vulnerable because an attacker can supply an address they control and release another account's reservation.

### The Fix

#### 1. **New Function in Inventory Contract** (`release_reservation_by_contract`)

```rust
fn release_reservation_by_contract(
    env: &Env,
    authorized_contract: Address,
    reservation_id: u64,
) -> Result<(), ContractError> {
    Self::require_not_paused(&env)?;

    // The requests contract address is set by the inventory admin during setup.
    let trusted_requests_contract = storage::get_requests_contract(&env)
        .ok_or(ContractError::Unauthorized)?;
    if authorized_contract != trusted_requests_contract {
        return Err(ContractError::Unauthorized);
    }
    authorized_contract.require_auth();

    let reservation = storage::get_reservation(&env, reservation_id)
        .ok_or(ContractError::ReservationNotFound)?;

    Self::release_reservation_internal(&env, &reservation, reservation_id)?;
    Ok(())
}
```

**Key insight:** The safe pattern is to verify a **stored, trusted requests-contract address** and then authenticate that contract:
- The inventory admin sets the trusted requests-contract address during initialization or configuration
- Inventory verifies `authorized_contract == stored_requests_contract`
- Inventory then calls `authorized_contract.require_auth()`
- Both checks are required; an arbitrary caller-supplied address must never be trusted by itself

#### 2. **Updated Requests Contract Call**

```rust
fn release_reservation_if_present(env: &Env, request: &mut BloodRequest) -> bool {
    if let Some(res_id) = request.reservation_id {
        let inventory_addr = storage::get_inventory_contract(env);
        let inv_client = InventoryContractClient::new(env, &inventory_addr);
        let trusted_requests_contract = configured_requests_contract(env);
        inv_client.release_reservation_by_contract(&trusted_requests_contract, &res_id);
        request.reservation_id = None;
        true
    } else {
        false
    }
}
```

**Before (broken):**
```rust
let admin = storage::get_admin(env);  // Wrong: external address, not signed
inv_client.release_reservation(&admin, &res_id);
```

**After #1472 (required):**
```rust
let trusted_requests_contract = configured_requests_contract(env);
inv_client.release_reservation_by_contract(&trusted_requests_contract, &res_id);
```

---

## Authorization Chain with the Fix

```
1. Hospital signs transaction with hospital_addr
   hospital.require_auth() ✅ (hospital_addr is a transaction signer)
   
2. Hospital calls: RequestContract::cancel_request(hospital_addr)
   
3. RequestContract authenticates the cancellation:
   - Verifies caller is hospital or admin (via require_auth())
   - Calls: InventoryContract::release_reservation_by_contract(requests_contract_addr)
   
4. InventoryContract verifies the trusted contract:
    - authorized_contract == stored_requests_contract ✅
    - authorized_contract.require_auth() ✅
    - Proceeds with reservation release
   
5. Result: ✅ Cancellation succeeds without requiring admin co-signature
```

---

## Design Principles

This fix implements three critical security principles for cross-contract authorization:

### 1. **Trust Chain Preservation**
- The requests contract already validated the caller's authorization (hospital or admin)
- Requests contract passes this decision to inventory as a trusted intermediary
- Inventory verifies the caller is the admin-configured requests contract before trusting that decision

### 2. **Layered Authorization**
- **Layer 1:** External actor (hospital) authenticates via `require_auth()`
- **Layer 2:** Requests contract validates the actor is authorized to cancel
- **Layer 3:** Inventory trusts the requests contract to make valid release decisions
- Each layer adds its own validation without forcing all actors to sign at every level

### 3. **No Over-Signing**
- Only the originating actor (hospital) must sign
- Admin keys don't need to co-sign every routine operation
- Admin keys only sign when they directly need to act (e.g., if admin directly cancels)

---

## Backward Compatibility

The original `release_reservation(caller: Address, reservation_id: u64)` function **remains public** and unchanged:

```rust
pub fn release_reservation(
    env: Env,
    caller: Address,
    reservation_id: u64,
) -> Result<(), ContractError> {
    caller.require_auth();
    // ... external authorization only
}
```

This allows:
- Direct cancellations where the caller (e.g., admin) actually signs the transaction
- Manual cleanup where a reserver directly releases their own reservation
- Backward compatibility with any existing integrations

**New function** `release_reservation_by_contract()` is a public contract entry point used by the requests contract via the generated client. It must remain protected by the stored-address comparison and `require_auth()` checks described above.

---

## Implementation Details

### Shared Internal Logic

Both public pathways (`release_reservation` and the new cross-contract path) delegate to a shared internal function:

```rust
fn release_reservation_internal(
    env: &Env,
    reservation: &Reservation,
    reservation_id: u64,
) -> Result<(), ContractError> {
    // All actual state changes happen here:
    // 1. Loop through reserved units
    // 2. Transition each to Available
    // 3. Update status indexes
    // 4. Record status change history
    // 5. Emit events
    // 6. Sync with registry if configured
    // 7. Remove reservation from storage
}
```

This ensures:
- Both authorization paths use identical business logic
- No duplication or inconsistency
- Single place to maintain the state transition logic

### Inventory Client Update

Added the new function to the inventory contract client trait:

```rust
#[contractclient(name = "InventoryContractClient")]
pub trait InventoryContractInterface {
    fn release_reservation(env: Env, caller: Address, reservation_id: u64);
    fn release_reservation_by_contract(
        env: Env,
        authorized_contract: Address,
        reservation_id: u64,
    );
}
```

Soroban's `#[contractclient]` macro auto-generates the calling code based on this trait definition.

---

## Security Analysis

### Threat Model: What Could Go Wrong?

**Threat 1: Unauthorized Contract Calls Reservation Release**
- **Attack:** Malicious contract calls `release_reservation_by_contract(malicious_addr, res_id)`
- **Defense:** We verify `authorized_contract == stored_requests_contract` and then call `authorized_contract.require_auth()`
    - The stored address is set by the inventory admin during setup
    - The equality check rejects arbitrary addresses
    - The auth check requires the trusted contract to authenticate the invocation

**Threat 2: Requests Contract Modified to Release Wrong Reservations**
- **Attack:** Malicious modification of requests contract to release any reservation
- **Defense:** Out of scope for this contract layer
  - Access control for contract upgrades is a deployment/governance concern
  - Assumed that requests contract bytecode integrity is maintained
  - This is the same assumption required for all contract interactions

**Threat 3: Authorization Bypass via Contract Address Spoofing**
- **Attack:** Attacker creates a contract at a known address to spoof requests contract
- **Defense:** Soroban's addressing scheme makes this infeasible
  - Contract addresses are derived from deployment details (account, contract ID)
  - An attacker cannot create a contract at an arbitrary address
  - They cannot replay or copy an existing contract's address

### What This Fix Does NOT Address

This fix addresses **authorization** for reservation release only. Other security concerns remain in scope for the broader audit:

1. **Authorization gaps in payments contract** (`update_status`, `record_dispute`, etc.) — separate issue
2. **TTL management on persistent storage** — separate issue
3. **Batch size limits** — separate issue

---

## Testing Recommendations

### Unit Tests

```rust
#[test]
fn test_release_reservation_by_contract_succeeds_from_requests_contract() {
    // Mock setup: inventory stores requests_addr as its trusted contract.
    let env = Env::default();
    let requests_addr = Address::random(&env);
    
    // Inventory::release_reservation_by_contract should succeed
    // when authorized_contract == the stored trusted requests address
}

#[test]
fn test_release_reservation_by_contract_fails_from_unauthorized_contract() {
    // Mock setup: attacker contract calls inventory
    let env = Env::default();
    let attacker_addr = Address::random(&env);
    
    // Should fail: attacker_addr != the stored trusted requests address
    assert_eq!(result, Unauthorized);
}

#[test]
fn test_release_reservation_external_still_requires_auth() {
    // Verify that the original public function still enforces require_auth()
    // on the caller parameter
}
```

### Integration Tests

```rust
#[test]
fn test_cancel_request_with_reservation_succeeds_without_admin_cosign() {
    // Hospital cancels request, inventory releases reservation
    // Hospital signature alone should suffice
    // Admin should NOT need to co-sign
}

#[test]
fn test_update_request_status_rejected_with_reservation_succeeds() {
    // Admin rejects request, triggering release
    // Should succeed with only admin's signature
}
```

---

## Deployment Notes

### Deployment After #1472 Is Fixed

- Inventory contract: Store the trusted requests contract address and enforce both checks
- Requests contract: Call the protected entry point with its configured address
- Existing `release_reservation` callers remain on the external `require_auth()` path

### Configuration

The inventory admin must configure the deployed requests contract address during initialization or through an admin-only setter. The entry point then compares the supplied address with that stored value and calls `require_auth()` on it.

### Migration Path (if applicable)

If existing requests instances need to be updated:
1. Deploy the inventory code containing the stored-address check
2. Configure the deployed requests contract address as trusted
3. Deploy or update the requests contract call site
4. Verify unauthorized addresses are rejected before enabling cancellation flows

---

## References

### Soroban Documentation

- `#[contractclient]` macro: Auto-generates typed clients for cross-contract calls
- Address authorization: Must combine a trusted-address comparison with `require_auth()`

### Related Issues

- Security Audit Finding 1.1: "inventory::release_reservation — no `require_auth()`"
- Security Audit Finding 1.2: "Unauthorized cross-contract authorization patterns"

---

## Summary

| Aspect | Before | After |
|--------|--------|-------|
| **Authorization Model** | External address re-signs | Contract-level trust chain |
| **Required Signatures** | Admin + Hospital | Hospital only (admin only if admin acts) |
| **Cancellation Failure Rate** | High (unless admin co-signs) | Zero (requests contract trusted) |
| **Complexity** | High (multiple signers) | Low (single decision authority) |
| **Security** | Authorization bypass risk | Verified via contract address |
| **Backward Compatibility** | N/A | Full (old function still works) |

This fix eliminates the functional DoS on request cancellation while maintaining a clean, principle-driven cross-contract authorization model that's easy to audit and maintain.
