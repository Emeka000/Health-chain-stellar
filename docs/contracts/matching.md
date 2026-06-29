# Matching Contract

**Location:** `lifebank-soroban/contracts/matching/src/lib.rs`  
**Purpose:** Implements ABO/Rh-compatible blood matching logic on-chain. Given a blood request, it queries the Inventory contract for available units, scores and sorts them by compatibility and urgency, and returns ranked match results.

---

## Public Interface

### Initialization

| Function | Parameters | Returns | Auth |
|---|---|---|---|
| `initialize` | `env, admin, inventory_contract, requests_contract` | `Result<(), MatchingError>` | `admin` |
| `pause` | `env, admin` | `Result<(), MatchingError>` | Admin |
| `unpause` | `env, admin` | `Result<(), MatchingError>` | Admin |

### Matching

| Function | Parameters | Returns | Auth |
|---|---|---|---|
| `find_matches` | `env, request_id: u64, max_results?: u32` | `Result<Vec<MatchResult>, MatchingError>` | Public |
| `preview_matches` | `env, blood_type: BloodType, component: BloodComponent, quantity_ml: u32, urgency: Urgency` | `Result<Vec<MatchResult>, MatchingError>` | Public |

### Query

| Function | Parameters | Returns | Auth |
|---|---|---|---|
| `is_compatible` | `env, donor: BloodType, recipient: BloodType` | `bool` | Public |
| `compatible_donor_types` | `env, recipient: BloodType` | `Vec<BloodType>` | Public |

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

### `MatchKind`
```rust
pub enum MatchKind {
    Exact,       // Same ABO/Rh type
    Compatible,  // Donor compatible, different type
}
```

### `MatchResult`
```rust
pub struct MatchResult {
    pub unit_id: u64,
    pub score: u32,
    pub kind: MatchKind,
    pub blood_type: BloodType,
    pub quantity_ml: u32,
    pub expiration_date: u64,
}
```

### `Urgency`
```rust
pub enum Urgency { Routine, Urgent, Critical }
```

---

## Scoring Algorithm

`score_unit` computes a score for each candidate unit:
- **Exact match** adds a large bonus; compatible-only match scores lower.
- **Expiration proximity** — units expiring sooner score higher (FIFO logic reduces wastage).
- **Urgency multiplier** — `Critical` requests weight expiration proximity less heavily than `Routine`.

Units are then sorted by score descending via `sort_by_expiration`.

---

## Compatibility Matrix

Implements standard ABO/Rh donation rules:

| Donor | Can donate to |
|---|---|
| O− | All types |
| O+ | O+, A+, B+, AB+ |
| A− | A±, AB± |
| A+ | A+, AB+ |
| B− | B±, AB± |
| B+ | B+, AB+ |
| AB− | AB± |
| AB+ | AB+ |

---

## Cross-Contract Clients

The Matching contract calls:
- `InventoryContractClient::get_blood_unit(env, blood_unit_id)`
- `InventoryContractClient::get_units_by_blood_type(env, blood_type)`
- `RequestsContractClient::get_request(env, request_id)`

---

## Error Codes

| Name | Meaning |
|---|---|
| `NotInitialized` | `initialize` not called |
| `AlreadyInitialized` | `initialize` called twice |
| `Unauthorized` | Caller is not admin |
| `ContractPaused` | All mutations blocked |
| `RequestNotFound` | Request ID does not exist |
| `NoCompatibleUnits` | No inventory matches the request |
