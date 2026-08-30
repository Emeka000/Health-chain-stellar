# Reputation Contract

**Location:** `lifebank-soroban/contracts/reputation/src/lib.rs`  
**Purpose:** Computes and maintains a composite reputation score (0–100) for each actor (rider, blood bank, hospital) in the HealthDonor network. Scores are derived from weighted ratings, completion rate, response time, consistency, activity decay, and fraud penalties.

---

## Public Interface

### Initialization & Config

| Function | Parameters | Returns | Auth |
|---|---|---|---|
| `initialize` | `env, admin: Address` | `Result<(), ReputationError>` | `admin` |
| `set_config` | `env, admin, config: ReputationConfig` | `Result<(), ReputationError>` | Admin |

### Score Updates

| Function | Parameters | Returns | Auth |
|---|---|---|---|
| `submit_rating` | `env, rater, entity, score: i64, timestamp: u64` | `Result<(), ReputationError>` | Any caller |
| `record_completion` | `env, caller, entity, response_time_secs: u64` | `Result<(), ReputationError>` | Authorized caller |
| `apply_violation` | `env, admin, entity, violation: ViolationType` | `Result<(), ReputationError>` | Admin |
| `flag_fraud` | `env, admin, entity` | `Result<(), ReputationError>` | Admin |
| `resolve_penalty` | `env, admin, entity, penalty_id: u32` | `Result<(), ReputationError>` | Admin |
| `appeal_penalty` | `env, entity, penalty_id: u32` | `Result<(), ReputationError>` | Entity itself |

### Score Query

| Function | Parameters | Returns | Auth |
|---|---|---|---|
| `get_score` | `env, entity` | `Result<i64, ReputationError>` | Public |
| `get_profile` | `env, entity` | `Result<ReputationProfile, ReputationError>` | Public |
| `get_leaderboard` | `env, limit: u32` | `Vec<(Address, i64)>` | Public |

---

## Storage Layout

| Key | Storage Tier | Description |
|---|---|---|
| `DataKey::Admin` | Instance | Admin address |
| `DataKey::Config` | Instance | `ReputationConfig` |
| `DataKey::Profile(Address)` | Persistent | Full `ReputationProfile` per entity |
| `DataKey::Leaderboard` | Persistent | Sorted `Vec<(Address, i64)>` |

---

## Scoring Algorithm

Score is calculated as a weighted sum (all arithmetic is integer, scaled ×100 for two decimal places):

| Component | Weight |
|---|---|
| Weighted average rating (recency-adjusted) | 35% |
| Completion rate | 25% |
| Response time | 20% |
| Consistency bonus | 10% |

Additional adjustments:
- **Activity decay**: −1 point per 30-day period of inactivity (cap: −20 points).
- **Recency half-life**: ratings older than 90 days count at half weight.
- **Fraud penalty**: −15 points per confirmed fraud flag (cap: −50 points).
- **Violation penalties** (expire after 60 days):
  - `Minor`: −5 points
  - `Medium`: −15 points
  - `Serious`: −40 points
- **Consistency bonus**: +10 points if rating std-dev ≤ 0.5; +5 points if ≤ 1.0.

Final score is clamped to [0, 100].

---

## Types

### `ViolationType`
```rust
pub enum ViolationType { Minor = 0, Medium = 1, Serious = 2 }
```

### `RatingEvent`
```rust
pub struct RatingEvent {
    pub score: i64,     // 1_00–5_00 (×100)
    pub timestamp: u64, // Unix timestamp
}
```

### `PenaltyRecord`
```rust
pub struct PenaltyRecord {
    pub id: u32,
    pub violation_type: ViolationType,
    pub timestamp: u64,
    pub is_resolved: bool,
    pub is_appealed: bool,
}
```

---

## Constants

| Constant | Value | Meaning |
|---|---|---|
| `W_RATING` | 35 | Rating component weight |
| `W_COMPLETION` | 25 | Completion rate weight |
| `W_RESPONSE` | 20 | Response time weight |
| `W_CONSISTENCY` | 10 | Consistency bonus weight |
| `DECAY_PERIOD_SECS` | 2 592 000 (30 days) | Inactivity decay period |
| `MAX_DECAY` | 20_00 | Cap on inactivity decay |
| `HALF_LIFE_SECS` | 7 776 000 (90 days) | Rating recency half-life |
| `FRAUD_FLAG_PENALTY` | 15_00 | Per confirmed fraud flag |
| `MAX_FRAUD_PENALTY` | 50_00 | Cap on total fraud penalty |
| `PENALTY_EXPIRY_SECS` | 5 184 000 (60 days) | Violation penalty expiry |

---

## Events

| Topics | Data | When |
|---|---|---|
| `["rating", "submitted"]` | `{entity, score, timestamp}` | Rating recorded |
| `["violation", "applied"]` | `{entity, violation_type, penalty_id}` | Violation penalty applied |
| `["fraud", "flagged"]` | `{entity}` | Fraud flag confirmed |
| `["score", "updated"]` | `{entity, new_score}` | Score recalculated |

---

## Error Codes

| Name | Meaning |
|---|---|
| `NotInitialized` | Contract not initialized |
| `AlreadyInitialized` | `initialize` called twice |
| `Unauthorized` | Caller not permitted |
| `EntityNotFound` | No profile for this address |
| `InvalidRating` | Rating outside configured min/max |
| `PenaltyNotFound` | Penalty ID does not exist |
| `PenaltyAlreadyResolved` | Penalty is already resolved |
