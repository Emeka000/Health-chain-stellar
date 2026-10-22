# Matching Contract

**Location:** `lifebank-soroban/contracts/matching/src/lib.rs`  
**Purpose:** Implements ABO/Rh-compatible blood matching logic. Given a blood request ID (or batch of IDs), queries the Inventory contract for available units, filters by compatibility, and returns ranked match results based on blood type, expiration, and urgency.

---

## Public Interface

### Initialization & Admin

| Function | Parameters | Returns | Auth |
|---|---|---|---|
| `initialize` | `env, admin: Address, inventory_contract: Address, requests_contract: Address` | `Result<(), MatchingError>` | Signed by `admin` |
| `version` | `env` | `u32` | Public |
| `pause` | `env, admin: Address` | `Result<(), MatchingError>` | Signed by Admin |
| `unpause` | `env, admin: Address` | `Result<(), MatchingError>` | Signed by Admin |
| `is_paused` | `env` | `bool` | Public |

### Matching

| Function | Parameters | Returns | Auth |
|---|---|---|---|
| `match_request` | `env, request_id: u64` | `Result<MatchResult, MatchingError>` | Public. Only Pending requests match. Up to 500 candidates considered. |
| `match_multiple_requests` | `env, request_ids: Vec<u64>` | `Result<Vec<MatchResult>, MatchingError>` | Public. Batch size capped at MAX_BATCH_SIZE. Matched units excluded from subsequent requests in batch. |

---

## Storage Layout

| Key | Storage Tier | Description |
|---|---|---|
| `DataKey::Admin` | Instance | Admin address |
| `DataKey::InventoryContract` | Instance | Inventory contract address |
| `DataKey::RequestsContract` | Instance | Requests contract address |
| `DataKey::Initialized` | Instance | Initialization flag |
| `DataKey::Paused` | Instance | Pause flag |

---

## Types

### `MatchResult`
```rust
pub struct MatchResult {
    pub request_id: u64,
    pub matched_units: Vec<MatchedUnit>,
    pub total_matched_ml: u32,
    pub is_partial: bool,           // true if total_matched_ml < requested quantity
}
```

### `MatchedUnit`
```rust
pub struct MatchedUnit {
    pub blood_unit_id: u64,
    pub blood_type: BloodType,
    pub quantity_ml: u32,
    pub score: u32,                 // Ranking score
}
```

---

## Matching Algorithm

### Request Filtering
- Only `Pending` requests can be matched; `Approved`, `Fulfilled`, `Rejected`, or `Cancelled` requests return `InvalidRequest` error.

### Candidate Collection
- For each blood type compatible with the request's blood type, query inventory for all units of that type.
- Filter to `Available` status only.
- Cap search at 500 candidates (`MAX_MATCH_CANDIDATES`).

### Unit Scoring & Selection
Units are scored based on:
1. **Blood type match**: Exact match vs. compatible-only
2. **Expiration proximity**: Units expiring sooner score higher (FIFO reduces wastage)
3. **Urgency multiplier**: `Critical` requests weight expiration proximity less; `Routine` requests weight it more

Highest-scoring units are selected first until either:
- Requested quantity is fulfilled (`is_partial = false`)
- No more compatible units remain (`is_partial = true`)

### Batch Processing
`match_multiple_requests` sorts pending requests by urgency (highest first), then by `required_by_timestamp`. Matched units from earlier requests are excluded from later ones.

---

## Compatibility Matrix

Standard ABO/Rh donation rules:

| Donor | Can donate to |
|---|---|
| O− | All types (universal donor) |
| O+ | O+, A+, B+, AB+ |
| A− | A−, A+, AB−, AB+ |
| A+ | A+, AB+ |
| B− | B−, B+, AB−, AB+ |
| B+ | B+, AB+ |
| AB− | AB−, AB+ (universal recipient for negative) |
| AB+ | AB+ (universal recipient) |

---

## Cross-Contract Calls

The Matching contract calls:
- `InventoryContractClient::get_units_by_blood_type(env, blood_type)` — returns `Vec<u64>` of unit IDs
- `InventoryContractClient::try_get_blood_unit(env, blood_unit_id)` — returns `Result<BloodUnit>`
- `RequestsContractClient::try_get_request(env, request_id)` — returns `Result<BloodRequest>`

---

## Error Codes

| Name | Meaning |
|---|---|
| `NotInitialized` | `initialize` not called |
| `AlreadyInitialized` | `initialize` called twice |
| `Unauthorized` | Caller is not admin |
| `ContractPaused` | All entry points blocked while paused |
| `RequestNotFound` | Request ID does not exist on requests contract |
| `InvalidRequest` | Request is not in `Pending` status |
| `BatchTooLarge` | Batch size exceeds `MAX_BATCH_SIZE` |

---

## Constants

| Constant | Value | Meaning |
|---|---|---|
| `MAX_MATCH_CANDIDATES` | 500 | Maximum candidates considered per match |
| `MAX_BATCH_SIZE` | 100 | Maximum requests per batch call |
| `CONTRACT_VERSION` | 1 | Contract version |
