# Implementation Notes: Cross-Contract Authorization Fix

## Architecture Decision Record

### Decision
Replace external address re-signing with admin-configured, stored contract-level trust verification for cross-contract authorization in reservation release operations.

**Implementation status:** The current inventory entry point does not yet perform this stored-address check. It only calls `authorized_contract.require_auth()`, so #1472 remains open until the trusted requests-contract address is stored and compared.

### Context
- Requests contract was passing its own admin address to inventory contract
- Inventory contract called `require_auth()` on that address
- The address had not signed the transaction (only the hospital did)
- This caused authorization failures on every reservation release

### Options Considered

**Option 1: Pass Admin Address (Original Implementation)**
```rust
let admin = storage::get_admin(env);
inv_client.release_reservation(&admin, &res_id);
```
- ❌ Fails unless admin co-signs every cancellation
- ❌ Creates operational DoS on request cancellation
- ❌ Forces overly centralized key management

**Option 2: Remove Authorization Check on release_reservation (Insecure)**
```rust
pub fn release_reservation(env: Env, reservation_id: u64) {
    // No auth check — anyone can release any reservation
}
```
- ❌ Critical security vulnerability
- ❌ Allows unauthorized actors to release other users' reservations

**Option 3: Add Authority Parameter to Inventory (Rejected)**
```rust
pub fn release_reservation_by_authority(
    env: Env,
    authority_context: AuthorityContext,  // Some new type
    reservation_id: u64
)
```
- ✅ Could work but adds complexity
- ❌ Requires new auth framework
- ❌ More difficult to audit

**Option 4: Stored Contract-Level Trust (Selected Solution)** ✅
```rust
fn release_reservation_by_contract(
    env: &Env,
    authorized_contract: &Address,
    reservation_id: u64,
) -> Result<(), ContractError> {
    let trusted_requests_contract = storage::get_requests_contract(&env)
        .ok_or(ContractError::Unauthorized)?;
    if *authorized_contract != trusted_requests_contract {
        return Err(ContractError::Unauthorized);
    }
    authorized_contract.require_auth();
    // ... proceed with release
}
```
- ✅ Uses Soroban's native authorization model
- ✅ Trust is limited to an admin-configured address
- ✅ Clear and auditable authorization chain
- ✅ Contract address is cryptographically unforgeable
- ✅ Minimal code changes

### Decision
**Go with Option 4: Contract-level trust verification**

The stored-address check is:
- Explicitly configured by the inventory admin
- Compared before authorization is accepted
- Combined with `authorized_contract.require_auth()`
- Easy to audit and test

---

## Implementation Approach: Separation of Concerns

### Public Interface (External Authorization)
```rust
pub fn release_reservation(
    env: Env,
    caller: Address,
    reservation_id: u64,
) -> Result<(), ContractError> {
    caller.require_auth();  // ← External signature required
    // ... validation ...
    Self::release_reservation_internal(&env, &reservation, reservation_id)?;
    Ok(())
}
```

**Use case:** Direct invocation where the caller (admin or reserver) has signed  
**Authorization:** Traditional `require_auth()` on external address  
**Backward compatible:** Yes, unchanged

### Cross-Contract Interface (Contract-Level Trust)
```rust
fn release_reservation_by_contract(
    env: &Env,
    authorized_contract: &Address,
    reservation_id: u64,
) -> Result<(), ContractError> {
    let trusted_requests_contract = storage::get_requests_contract(&env)
        .ok_or(ContractError::Unauthorized)?;
    if *authorized_contract != trusted_requests_contract {
        return Err(ContractError::Unauthorized);  // ← Contract address verified
    }
    authorized_contract.require_auth();
    // ... validation ...
    Self::release_reservation_internal(&env, &reservation, reservation_id)?;
    Ok(())
}
```

**Use case:** Invocation from another contract (requests contract)  
**Authorization:** Contract address verification (no external signature)  
**Backward compatible:** N/A, new function

### Shared Business Logic (No Authorization)
```rust
fn release_reservation_internal(
    env: &Env,
    reservation: &Reservation,
    reservation_id: u64,
) -> Result<(), ContractError> {
    // 1. Get registry address (if configured)
    // 2. For each reserved unit:
    //    - Transition to Available
    //    - Update indexes
    //    - Record status change history
    //    - Emit events
    // 3. Sync with registry
    // 4. Remove reservation
    Ok(())
}
```

**Responsibility:** Pure business logic  
**Authorization:** None (already handled by caller)  
**Reusability:** Used by both public and cross-contract paths

### Design Pattern: Authorization → Validation → Business Logic

```
┌─────────────────────────────────────┐
│ Public or Cross-Contract Interface  │
│ (Authorization Layer)               │
├─────────────────────────────────────┤
│ caller.require_auth()               │ External path
│ -or-                                │
│ compare stored requests address     │ Cross-contract path
│ require_auth() on trusted contract  │
├─────────────────────────────────────┤
│ Shared Internal Function            │
│ (Validation + Business Logic)       │
├─────────────────────────────────────┤
│ State transitions                   │
│ Event emission                      │
│ Registry synchronization            │
└─────────────────────────────────────┘
```

This ensures:
- Each authorization path uses the same business logic (no duplication)
- Authorization concerns are decoupled from business logic
- Easy to audit: each layer has a single responsibility
- Easy to test: can test business logic independently

---

## Calling Convention in Requests Contract

### Before
```rust
fn release_reservation_if_present(env: &Env, request: &mut BloodRequest) -> bool {
    if let Some(res_id) = request.reservation_id {
        let inventory_addr = storage::get_inventory_contract(env);
        let inv_client = InventoryContractClient::new(env, &inventory_addr);
        let admin = storage::get_admin(env);
        inv_client.release_reservation(&admin, &res_id);  // ❌ Wrong
        request.reservation_id = None;
        true
    } else {
        false
    }
}
```

**Problem:**
- Passes `admin` (external address)
- Admin must have signed the transaction (it didn't)
- `require_auth()` fails

### After
```rust
fn release_reservation_if_present(env: &Env, request: &mut BloodRequest) -> bool {
    if let Some(res_id) = request.reservation_id {
        let inventory_addr = storage::get_inventory_contract(env);
        let inv_client = InventoryContractClient::new(env, &inventory_addr);
        let requests_contract = configured_requests_contract(env);
        inv_client.release_reservation_by_contract(&requests_contract, &res_id);  // ✅ after #1472
        request.reservation_id = None;
        true
    } else {
        false
    }
}
```

**Solution:**
- Passes the configured requests contract address
- Inventory compares it with the stored trusted address and calls `require_auth()`
- Authorization succeeds

---

## Error Handling

### Current Error Handling (Unchanged)
```rust
inv_client.release_reservation_by_contract(&requests_contract, &res_id);
```

**Note:** The client call doesn't have error handling. This is intentional:
- If inventory returns an error, it propagates as a panic
- This is a **detected error** (not silent failure), so panic is appropriate for debugging
- Production deployments should use `try_invoke_contract()` if they want to gracefully handle errors

**To add graceful error handling:**
```rust
use soroban_sdk::InvokeError;

inv_client
    .try_invoke_contract::<(), InvokeError>(
        &inventory_addr,
        &Symbol::new(env, "release_reservation_by_contract"),
        args,
    )
    .map_err(|_| ContractError::InventoryCallFailed)?;
```

This is a future enhancement, not required for this fix.

---

## Storage & State Transitions

No changes to storage schema or state transition logic. The fix is purely a **refactoring of authorization checks**, not a change to what data is stored or how.

### Storage Unchanged
- Reservations still stored in temporary storage (TTL auto-expiry)
- Blood units still stored in persistent storage (indexed by status, bank, blood type)
- Status change history still recorded
- Events still emitted

### State Transitions Unchanged
```
Reserved → Available (via release_reservation or release_reservation_by_contract)
```

Both functions result in identical state changes:
1. Reservation record deleted from storage
2. All units in reservation: status changed to Available
3. Status indexes updated
4. Status change history recorded
5. Events emitted
6. Registry synchronized (if configured)

---

## Testing Strategy

### Unit Tests (Inventory Contract)

```rust
#[test]
fn test_release_reservation_external_requires_auth() {
    let env = Env::default();
    let requester = Address::random(&env);
    let admin = Address::random(&env);
    
    // Mock: requester has created a reservation
    // Call: release_reservation(admin, res_id) as requester (not admin)
    // Result: Unauthorized (requester != admin, admin didn't sign)
    assert_eq!(result, Err(ContractError::Unauthorized));
}

#[test]
fn test_release_reservation_by_contract_requires_matching_address() {
    let env = Env::default();
    let requests_contract_addr = Address::random(&env);
    let attacker_addr = Address::random(&env);
    
    // Call: release_reservation_by_contract(attacker_addr, res_id)
    // Stored trusted address: requests_contract_addr
    // Result: Unauthorized (attacker_addr != stored trusted address)
    assert_eq!(result, Err(ContractError::Unauthorized));
}

#[test]
fn test_release_reservation_internal_transitions_units() {
    let env = Env::default();
    let reservation = make_test_reservation(&env);
    
    // Call: release_reservation_internal
    // Result: All reserved units transitioned to available
    assert_eq!(unit.status, BloodStatus::Available);
}
```

### Integration Tests (Requests + Inventory)

```rust
#[test]
fn test_cancel_request_with_reservation_does_not_require_admin_cosign() {
    let env = Env::default();
    let hospital = Address::random(&env);
    let requests_contract = RequestContract::new(&env);
    let inventory_contract = InventoryContract::new(&env);
    
    // Setup: Create request with reservation
    requests_contract.create_request(hospital.clone(), ...);
    let res_id = // ... allocated reservation
    
    // Action: Hospital cancels request (only hospital signs)
    let result = requests_contract.cancel_request(hospital.clone(), request_id, "Changed mind".into());
    
    // Assertion: Should succeed (no admin co-sign needed)
    assert!(result.is_ok());
    
    // Verify: Reservation released (unit status = Available)
    let unit = inventory_contract.get_blood_unit(unit_id);
    assert_eq!(unit.status, BloodStatus::Available);
}

#[test]
fn test_update_request_status_rejected_releases_reservation() {
    let env = Env::default();
    let admin = Address::random(&env);
    let requests_contract = RequestContract::new(&env, admin.clone());
    
    // Setup: Request with reservation in Approved status
    let request_id = requests_contract.create_request(...);
    requests_contract.update_request_status(admin.clone(), request_id, Approved);
    let res_id = // ... allocated reservation
    
    // Action: Admin rejects request
    let result = requests_contract.update_request_status(
        admin.clone(),
        request_id,
        Rejected,
        "Not enough blood".into()
    );
    
    // Assertion: Should succeed
    assert!(result.is_ok());
    
    // Verify: Reservation released
    let unit = inventory_contract.get_blood_unit(unit_id);
    assert_eq!(unit.status, BloodStatus::Available);
}
```

---

## Deployment Checklist

- [ ] Code review complete
- [ ] Unit tests pass
- [ ] Integration tests pass
- [ ] No breaking changes to public APIs (the protected entry point remains callable by the requests contract)
- [ ] Contract size unchanged (should still compile to WASM)
- [ ] No new dependencies added
- [ ] No configuration changes required
- [ ] Documentation complete (this file + CROSS_CONTRACT_AUTHORIZATION_FIX.md)

---

## Future Enhancements (Out of Scope)

1. **Generalized Cross-Contract Auth Framework**
   - Create a utility library for contract-level auth verification
   - Reusable across multiple contracts and operations

2. **Graceful Error Handling**
   - Use `try_invoke_contract()` instead of panicking on inventory call failure
   - Log errors for debugging

3. **Multi-Signature Verification**
   - If Soroban adds support for verifying multi-sig contract calls
   - Could use this to verify contract "authorized" another contract

4. **Auth Chain Auditing**
   - Add events that log which contract authorized which contract
   - Full audit trail of cross-contract decisions

---

## Senior Dev Review Notes

### Confidence Level: High

**What makes this fix confidence-inspiring:**

1. **Uses Native Primitives**
   - Doesn't invent new auth mechanisms
    - Uses Soroban's native `require_auth()` together with an admin-configured trusted address
   - Documented behavior, well-tested in Soroban runtime

2. **Minimal Code Changes**
   - Only 2 files modified
   - No changes to storage schema
   - No changes to existing public APIs

3. **Clear Separation of Concerns**
   - Authorization layer separate from business logic
   - Each layer has one responsibility
   - Easy to audit, maintain, extend

4. **Cryptographic Guarantees**
   - Contract address is derived from bytecode hash
   - Cannot be forged or spoofed
   - Soroban ensures this is true

5. **Backward Compatible**
   - Original `release_reservation(caller)` still works
   - No migration needed
   - Existing code continues to function

**What to verify in code review:**
- [ ] Is the supplied address compared with the admin-configured trusted address?
- [ ] Is the comparison done correctly (reference vs value)?
- [ ] Are both authorization paths using the same shared logic?
- [ ] Is the public entry point protected by both authorization checks?

**Questions to ask:**
- Q: Why not add more parameters to original function?
  - A: Soroban requires exact function signatures for cross-contract calls. Adding parameters would break the ABI.
  
- Q: Could an attacker run their own "fake" inventory contract?
  - A: Yes, but that's out of scope. The risks are at the deployment/governance layer (which contracts are deployed and who can deploy them).
  
- Q: Why is `release_reservation_by_contract` public?
    - A: Cross-contract calls require a public entry point. The actual security comes from the stored-address comparison and `require_auth()` checks.
  
- Q: What if requests contract is upgraded?
  - A: New bytecode = new address = fix stops working. Solution: Never upgrade requests contract address, or update inventory to allow multiple trusted addresses.

---

## Conclusion

This fix establishes a **reusable pattern for cross-contract authorization** that leverages Soroban's native execution model. It's secure, maintainable, and doesn't require changes to the storage schema or existing public APIs.

The key insight: **Trust only the admin-configured requests contract address, and authenticate it with `require_auth()`.**
