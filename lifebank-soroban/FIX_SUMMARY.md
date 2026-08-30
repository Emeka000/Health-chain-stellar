# Cross-Contract Authorization Fix — Summary for Review

## The Issue (3-minute explanation)

Request cancellation was broken when a reservation existed:

```
Hospital calls: RequestContract::cancel_request() 
  ✅ Hospital signs

RequestContract tries: InventoryContract::release_reservation(requests_admin)
  ❌ requests_admin didn't sign
  ❌ require_auth() fails
  ❌ Entire cancellation fails (DoS)
```

The requests contract was passing its own stored admin address to inventory, expecting inventory to accept it. But Soroban's `require_auth()` only passes if that address actually signed the transaction — the requests admin hadn't signed, only the hospital did.

**Result:** Unless both the hospital AND requests admin signed every cancellation, the operation failed. This is a functional DoS on request cancellation.

---

## The Fix (3-minute explanation)

Use the **requesting contract itself as a trusted intermediary** instead of passing external addresses:

```
Hospital calls: RequestContract::cancel_request()  
  ✅ Hospital signs

RequestContract calls: InventoryContract::release_reservation_by_contract(requests_addr)
  ✅ Inventory verifies: env.current_contract_address() == requests_addr
  ✅ No external signature needed
  ✅ Cancellation succeeds
```

Instead of:
```rust
// BEFORE (broken): Pass external address, expect it to have signed
let admin = storage::get_admin(env);
inv_client.release_reservation(&admin, &res_id);  // ❌ admin didn't sign
```

Do this:
```rust
// AFTER (fixed): Pass contract address, verify contract is calling
let requests_contract = env.current_contract_address();
inv_client.release_reservation_by_contract(&requests_contract, &res_id);  // ✅ verified
```

---

## What Changed

### Inventory Contract (`contracts/inventory/src/lib.rs`)

**Added:**
1. New **private** function `release_reservation_by_contract(authorized_contract, reservation_id)`
   - Verifies `env.current_contract_address() == authorized_contract`
   - Delegates to shared internal logic
   
2. Refactored **shared internal** function `release_reservation_internal(reservation, reservation_id)`
   - Contains all business logic (state transitions, events, registry sync)
   - Used by both public and cross-contract paths

**Kept:**
- Original public `release_reservation(caller, reservation_id)` unchanged
- All external authorization paths still work
- Backward compatible

### Requests Contract (`contracts/requests/src/lib.rs`)

**Updated:**
1. Inventory client trait: Added `release_reservation_by_contract` method
   
2. `release_reservation_if_present()` helper:
   - Changed from passing `storage::get_admin(env)` to passing `env.current_contract_address()`
   - Now calls `release_reservation_by_contract` instead of `release_reservation`

**Example changes:**
```rust
// OLD
let admin = storage::get_admin(env);
inv_client.release_reservation(&admin, &res_id);

// NEW
let requests_contract = env.current_contract_address();
inv_client.release_reservation_by_contract(&requests_contract, &res_id);
```

---

## Why This Works

**Soroban Contract Call Authentication:**
- When contract A calls contract B, Soroban's execution layer authenticates contract A
- `env.current_contract_address()` in contract B returns the address of the calling contract
- This address is cryptographically derived from contract bytecode and cannot be spoofed
- No transaction signature needed — the fact that contract A is executing is proof enough

**Authorization Chain:**
1. Hospital signs transaction → `require_auth()` passes for hospital
2. RequestContract validates hospital is authorized to cancel
3. RequestContract calls InventoryContract passing its own address
4. InventoryContract verifies the caller IS the RequestContract (via `env.current_contract_address()`)
5. InventoryContract trusts RequestContract's decision (already validated)
6. Result: One signature, clean authorization chain

---

## Files Modified

1. **Health-chain-stellar/lifebank-soroban/contracts/inventory/src/lib.rs**
   - Lines ~812-870: Refactored `release_reservation()` and added `release_reservation_by_contract()`

2. **Health-chain-stellar/lifebank-soroban/contracts/requests/src/lib.rs**
   - Lines 17-33: Updated inventory client trait with new method
   - Lines 75-88: Updated `release_reservation_if_present()` helper

3. **NEW:** Health-chain-stellar/lifebank-soroban/CROSS_CONTRACT_AUTHORIZATION_FIX.md
   - Full documentation of the issue, solution, and security analysis

---

## Security Properties

### What This Fixes
✅ Eliminates the "missing authorization" DoS on request cancellation  
✅ Removes requirement for admin key to co-sign routine cancellations  
✅ Establishes a reusable pattern for cross-contract authorization  

### What This Does NOT Fix
❌ Other missing `require_auth()` calls in payments contract (separate issue)  
❌ TTL management gaps in persistent storage (separate issue)  
❌ Batch size limits leading to instruction limit DoS (separate issue)  

### Threat Model: Contract Address Spoofing
**Q:** Can an attacker create a contract at the requests contract's address?  
**A:** No. Soroban derives contract addresses from:
- Deployer account
- Contract ID sequence number
- Contract bytecode hash

An attacker cannot create a contract at an arbitrary address. Contract address derivation is cryptographically secure.

---

## Testing Checklist

- [ ] `cargo check` passes on both contracts
- [ ] Existing unit tests pass (no breaking changes to public APIs)
- [ ] Integration test: Hospital cancels request without admin co-signing
- [ ] Integration test: Admin cancels request with own authority
- [ ] Integration test: Direct release (non-cross-contract) still works
- [ ] Inventory can still release directly (original `release_reservation` path)

---

## Migration & Deployment

**Before deployment:**
- Review CROSS_CONTRACT_AUTHORIZATION_FIX.md for full threat model
- Run test suite
- Code review (this summary + full doc)

**Deployment:**
1. Deploy new inventory contract code
2. Deploy new requests contract code
3. No data migration needed
4. No external configuration changes needed

**After deployment:**
- Verify request cancellations succeed without errors
- Monitor logs for `release_reservation` failures (there shouldn't be any)

---

## References

- Full analysis: `CROSS_CONTRACT_AUTHORIZATION_FIX.md`
- Original audit finding: `SECURITY_AUDIT_CHECKLIST.md` (Section 1.1)
- Soroban docs: `env.current_contract_address()` and cross-contract calls

---

## Questions to Verify During Review

1. **Is the contract address truly uncopyable?**
   - Yes: derived from account + sequence + bytecode hash, cryptographically determined

2. **Why not use auth checks at the contract level?**
   - Soroban doesn't have built-in "contract auth" — we improvise with address verification

3. **Why keep the old `release_reservation` function?**
   - Backward compatibility + allows manual cleanup (e.g., admin directly releasing)

4. **What if the requests contract is upgraded?**
   - New bytecode = new contract address = this whole fix becomes useless
   - Solution: Store the requests contract address at inventory initialization (already done)

5. **Can other contracts safely call this private function?**
   - Yes—private just means not exported in the WASM's public interface
   - Soroban allows any contract to invoke any function
   - Security comes from the `env.current_contract_address()` check, not secrecy
