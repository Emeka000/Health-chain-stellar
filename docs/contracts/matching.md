# Matching Contract

The Matching Contract finds compatible blood units from inventory to fulfill pending blood requests, using ABO/Rh compatibility rules and intelligent scoring for urgency and expiration.

## Quick Start

Matching performs **blood type compatibility matching** to find suitable donor units for hospital blood requests:

1. Load pending request (blood type, quantity, urgency, hospital)
2. Derive all compatible donor blood types (ABO/Rh matrix)
3. Fetch available units from inventory for each compatible type
4. Score and select units based on:
   - Exact type match (highest priority)
   - Urgency level (Critical > Urgent > Scheduled)
   - Expiration time (FIFO: oldest expiration first)
   - Hospital location preference (same hospital preferred)
5. Return matched units with partial-fulfillment flag

---

## Entrypoints

### Lifecycle & Initialization

#### `initialize(env, admin, inventory_contract, requests_contract) → Result<(), MatchingError>`
- **Description**: Initialize the matching contract with dependencies
- **Auth required**: Yes, signer must be `admin`
- **Parameters**:
  - `admin: Address` — Admin address
  - `inventory_contract: Address` — Inventory contract ID
  - `requests_contract: Address` — Requests contract ID
- **Returns**: `Ok(())` on success; `Err(AlreadyInitialized)` if already initialized
- **Side effects**:
  - Sets admin
  - Stores inventory and requests contract addresses
  - Sets Initialized flag
- **Access Control**: Any address (must sign as admin)

#### `is_initialized(env) → bool`
- **Description**: Check if contract has been initialized
- **Returns**: `true` if initialized; `false` otherwise

### Control & Pause

#### `pause(env, admin) → Result<(), MatchingError>`
- **Description**: Pause all state-mutating functions (admin only)
- **Auth required**: Yes, signer must be admin
- **Parameters**:
  - `admin: Address` — The admin calling the function
- **Returns**: `Ok(())` on success; `Err(Unauthorized)` if caller is not admin
- **Side effects**: Sets Paused flag to `true`
- **Access Control**: Admin only

#### `unpause(env, admin) → Result<(), MatchingError>`
- **Description**: Unpause the contract (admin only)
- **Auth required**: Yes, signer must be admin
- **Returns**: `Ok(())` on success; `Err(Unauthorized)` if caller is not admin
- **Side effects**: Sets Paused flag to `false`
- **Access Control**: Admin only

#### `is_paused(env) → bool`
- **Description**: Check if contract is paused
- **Returns**: `true` if paused; `false` otherwise

### Core Matching

#### `match_request(env, request_id) → Result<MatchResult, MatchingError>`
- **Description**: Find compatible blood units to fulfill a single pending blood request
- **Auth required**: No
- **Parameters**:
  - `request_id: u64` — Request ID to match
- **Returns**: `Ok(MatchResult)` with matched units and partial-fulfillment flag
- **Errors**:
  - `NotInitialized` — Contract not initialized
  - `ContractPaused` — Contract is paused
  - `RequestNotFound` — Request ID doesn't exist
  - `InvalidRequest` — Request status is not Pending (only Pending requests can be matched)
- **Algorithm**:
  1. Load request from requests contract
  2. Verify request status is Pending
  3. Determine compatible donor blood types (using ABO/Rh rules)
  4. Collect all available units across compatible types from inventory (capped at 500 max)
  5. Run scoring algorithm:
     - Filter to Available status only
     - Prefer exact blood-type matches over compatible ones
     - Within each tier, use FIFO (oldest expiration first)
     - Support partial matching (return whatever is available)
  6. Return MatchResult with matched units, total matched mL, remaining mL, partial fulfillment flag
- **Side effects**: None (read-only matching)

#### `match_multiple_requests(env, request_ids) → Result<Vec<MatchResult>, MatchingError>`
- **Description**: Match multiple requests in priority order (urgency → deadline)
- **Auth required**: No
- **Parameters**:
  - `request_ids: Vec<u64>` — Vector of request IDs to match
- **Returns**: `Ok(Vec<MatchResult>)` — One result per request, in priority-sorted order
- **Errors**: Same as `match_request()`
- **Algorithm**:
  1. Load all requests from requests contract
  2. Sort requests by urgency (Critical → Urgent → Scheduled)
  3. Within same urgency level, sort by required_by_timestamp (earliest first)
  4. Call `match_request()` for each request in sorted order
  5. Return results in priority order
- **Sorting Implementation**: Insertion sort (O(n²) worst-case, but O(n) for nearly-sorted batches; acceptable for typical batch sizes ≤50 requests)
- **Side effects**: None

### Query Helpers

#### `get_compatible_types(env, recipient) → Vec<BloodType>`
- **Description**: Return all blood types that can donate to a recipient
- **Auth required**: No
- **Parameters**:
  - `recipient: BloodType` — Recipient blood type (e.g., O+, AB-, etc.)
- **Returns**: `Vec<BloodType>` of all compatible donor types in donation order
- **Side effects**: None
- **Example**: `get_compatible_types(O+) → [O+, O-, A+, A-, B+, B-, AB+, AB-]`

#### `check_compatibility(env, donor, recipient) → bool`
- **Description**: Check if a donor blood type can be given to a recipient
- **Auth required**: No
- **Parameters**:
  - `donor: BloodType` — Donor blood type
  - `recipient: BloodType` — Recipient blood type
- **Returns**: `true` if donation is safe; `false` otherwise
- **Side effects**: None

### Admin Queries

#### `get_admin(env) → Result<Address, MatchingError>`
- **Description**: Return the admin address
- **Returns**: Admin address or `Err(NotInitialized)` if not initialized

---

## Data Structures

### MatchResult
```rust
pub struct MatchResult {
    pub request_id: u64,                    // Original request ID
    pub matched_units: Vec<MatchedUnit>,   // Matched blood units
    pub total_matched_ml: u32,              // Total volume matched (mL)
    pub remaining_ml: u32,                  // Unmatched volume (mL)
    pub partial_fulfillment: bool,          // true if 0 < matched < requested
}
```

### MatchedUnit
```rust
pub struct MatchedUnit {
    pub blood_unit_id: u64,                 // Inventory blood unit ID
    pub blood_type: BloodType,              // Donor blood type
    pub quantity_ml: u32,                   // Quantity matched from this unit (mL)
    pub expiration_date: u64,               // Unix timestamp
    pub score: u32,                         // Relevance score (higher = better)
}
```

### BloodRequest (from requests contract)
```rust
pub struct BloodRequest {
    pub id: u64,                            // Request ID
    pub blood_type: BloodType,              // Recipient blood type needed
    pub quantity_ml: u32,                   // Total mL needed
    pub urgency: Urgency,                   // Critical, Urgent, or Scheduled
    pub required_by_timestamp: u64,         // Deadline (Unix timestamp)
    pub hospital_id: Address,               // Requesting hospital
    pub status: RequestStatus,              // Pending, Fulfilled, Cancelled, etc.
}
```

### BloodUnit (from inventory contract)
```rust
pub struct BloodUnit {
    pub id: u64,                            // Unit ID
    pub blood_type: BloodType,              // Donor blood type
    pub blood_component: BloodComponent,    // Whole blood, plasma, RBC, etc.
    pub quantity_ml: u32,                   // Available quantity (mL)
    pub collection_date: u64,               // Collection time (Unix timestamp)
    pub expiration_date: u64,               // Expiration time (Unix timestamp)
    pub storage_location: Address,          // Storage facility
    pub status: BloodStatus,                // Available, Reserved, Expired, etc.
}
```

### BloodType
- O+ (O positive)
- O− (O negative)
- A+ (A positive)
- A− (A negative)
- B+ (B positive)
- B− (B negative)
- AB+ (AB positive)
- AB− (AB negative)

### Urgency
- `Critical` — Highest priority (priority value = 0)
- `Urgent` — Medium priority (priority value = 1)
- `Scheduled` — Lowest priority (priority value = 2)

### RequestStatus
- `Pending` — Open request (only Pending can be matched)
- `Fulfilled` — All units matched
- `Cancelled` — Request cancelled
- `Expired` — Deadline passed

### BloodStatus
- `Available` — Ready to use (only Available units are matched)
- `Reserved` — Held for another request
- `Expired` — Expiration date passed
- `Used` — Already used in a delivery
- `Discarded` — Damaged or contaminated

### BloodComponent
- `WholeBlood` — Whole blood product
- `RedCells` — RBC concentrate
- `Plasma` — Plasma product
- `Platelets` — Platelet concentrate

### DataKey (Storage Keys)
- `Admin` → Address
- `InventoryContract` → Address
- `RequestsContract` → Address
- `Initialized` → bool
- `Paused` → bool

---

## ABO/Rh Compatibility Matrix

**Universal donor rules:**
- O− can give to anyone (last resort)
- O+ can give to O+, A+, B+, AB+ (O negative preferred for emergencies)

**Universal recipient:**
- AB+ can receive from anyone

**Standard compatibility (ABO + Rh):**
- Same ABO type: Always compatible (most preferred)
- ABO compatible with Rh match: Compatible (preferred if exact ABO not available)
- ABO compatible with Rh mismatch: Compatible (less preferred, depending on urgency)

**Rh consideration:**
- Rh+ donors can give to Rh+ recipients only
- Rh− donors can give to any Rh status (more universally useful)

---

## Scoring & Selection Algorithm

**Tier 1: Exact blood type match**
- Score: 1000 + recency bonus

**Tier 2: Compatible ABO, same Rh**
- Score: 900 + recency bonus

**Tier 3: Compatible ABO, different Rh (Rh− only)**
- Score: 800 + recency bonus

**Within tier, apply FIFO:**
- Oldest expiration date gets highest priority (less risk of expiration before use)

**Recency bonus:**
- Newer collection dates get slight priority (better cell viability)

**Hospital affinity:**
- Same-hospital units get small bonus (reduced transport/handling time)

**Selection stops when:**
- Total matched quantity ≥ requested quantity, OR
- All available units exhausted, OR
- 500 candidate units examined (hardcoded MAX_MATCH_CANDIDATES)

---

## Error Codes

| Code | Name | Cause |
|------|------|-------|
| 100 | `NotInitialized` | Contract not yet initialized |
| 101 | `AlreadyInitialized` | Contract already initialized |
| 102 | `RequestNotFound` | Request ID doesn't exist |
| 103 | `InvalidRequest` | Request status is not Pending |
| 104 | `Unauthorized` | Caller is not admin (for pause/unpause) |
| 105 | `ContractPaused` | Contract is paused, matching unavailable |

---

## Event Types

- No events published by this contract (read-only matching)

---

## Usage Patterns

### Initialize Matching

```
initialize(admin, inventory, requests)
→ Ready for matching
```

### Match a Single Request

```
match_request(request_id=42)
→ MatchResult {
     matched_units: [
       {blood_unit_id: 1001, blood_type: O+, quantity_ml: 450, score: 1000},
       {blood_unit_id: 1002, blood_type: O+, quantity_ml: 50, score: 900}
     ],
     total_matched_ml: 500,
     remaining_ml: 0,
     partial_fulfillment: false
  }
```

### Match Multiple Requests (Sorted by Urgency)

```
match_multiple_requests([req_3, req_1, req_2])  // requests unordered
→ [
    MatchResult{request_id: req_1, ...},  // Urgent, processed first
    MatchResult{request_id: req_2, ...},  // Scheduled, processed second
    MatchResult{request_id: req_3, ...}   // Cancelled, not matched
  ]
```

### Check Compatibility

```
check_compatibility(O−, AB+)  → true (O− universal donor)
check_compatibility(A+, O+)   → false (A+ cannot give to O+)
```

### Get Compatible Types

```
get_compatible_types(AB+)  
→ [O+, O−, A+, A−, B+, B−, AB+, AB−]  (all types can donate)

get_compatible_types(O+)
→ [O+, O−]  (only O types)
```

---

## Key Design Notes

- **Request status gated**: Only Pending requests can be matched. Cancelled or Expired requests are rejected.
- **Unit status gated**: Only Available units are considered. Reserved, Used, Expired units are skipped.
- **Candidate cap**: At most 500 units per compatible blood type are examined to prevent unbounded loops.
- **Partial fulfillment**: If available units can't fully satisfy a request, the partial flag is true but matching succeeds (not an error).
- **Deterministic ordering**: Requests with same urgency are ordered by deadline (required_by_timestamp), ensuring consistent matching across multiple calls.
- **Read-only**: Matching never mutates state (no units reserved, no requests marked fulfilled). State changes happen in requests/inventory contracts after matching suggests a pairing.
- **Lazy cross-contract loading**: Units are loaded from inventory on-demand during matching (no pre-fetching), reducing on-chain memory overhead.
