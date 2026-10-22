# Reputation Contract

**Location:** `lifebank-soroban/contracts/reputation/src/lib.rs`  
**Purpose:** Computes and maintains a composite reputation score (0–100) for each entity (keyed by `entity_id: u64`) in the HealthDonor network. Scores are derived from weighted ratings, completion rate, response time, consistency, activity decay, and fraud penalties. Scores are stored in `ReputationScore` and decay over time based on inactivity.

---

## Public Interface

### Initialization & Admin

| Function | Parameters | Returns | Auth |
|---|---|---|---|
| `initialize` | `env, admin: Address` | `Result<(), Error>` | Signed by `admin` |
| `version` | `env` | `u32` | Public |
| `is_initialized` | `env` | `bool` | Public |
| `get_admin` | `env` | `Result<Address, Error>` | Public |
| `propose_admin` | `env, admin: Address, new_admin: Address` | `Result<(), Error>` | Signed by current Admin |
| `accept_admin` | `env, new_admin: Address` | `Result<(), Error>` | Signed by proposed admin |
| `get_pending_admin` | `env` | `Option<Address>` | Public |
| `upgrade` | `env, admin: Address, new_wasm_hash: BytesN<32>` | `Result<(), Error>` | Signed by Admin |
| `pause` | `env, admin: Address` | `Result<(), Error>` | Signed by Admin |
| `unpause` | `env, admin: Address` | `Result<(), Error>` | Signed by Admin |
| `is_paused` | `env` | `bool` | Public |

### Configuration

| Function | Parameters | Returns | Auth |
|---|---|---|---|
| `get_rating_scale_config` | `env` | `Result<RatingScaleConfig, Error>` | Public |
| `set_rating_scale_config` | `env, caller: Address, config: RatingScaleConfig` | `Result<(), Error>` | Signed by Admin |
| `get_decay_config` | `env` | `Result<DecayConfig, Error>` | Public |
| `set_decay_config` | `env, caller: Address, config: DecayConfig` | `Result<(), Error>` | Signed by Admin |
| `get_minimum_interactions` | `env` | `Result<u32, Error>` | Public |
| `get_badge_config` | `env` | `Result<BadgeConfig, Error>` | Public |

### Score Recording & Updates

| Function | Parameters | Returns | Auth |
|---|---|---|---|
| `submit_rating` | `env, caller: Address, entity_id: u64, score: i64, timestamp: u64` | `Result<ReputationScore, Error>` | Signed by Admin. Score scaled ×100 (e.g., 300 = 3.0). Timestamp must not exceed ledger time. |
| `record_assignment` | `env, caller: Address, entity_id: u64, completed: bool, response_secs: u64, timestamp: u64` | `Result<ReputationScore, Error>` | Signed by Admin. Records assignment attempt; increments completion count if `completed=true`. Returns recalculated score. |
| `update_from_event` | `env, entity_id: u64, event: ReputationInputEvent` | `Result<ReputationScore, Error>` | Public (no signature required) |
| `flag_fraud` | `env, caller: Address, entity_id: u64` | `Result<ReputationScore, Error>` | Signed by Admin. Increments fraud flag count; applies immediate penalty. |
| `apply_penalty` | `env, caller: Address, entity_id: u64, violation_type: ViolationType` | `Result<(u32, ReputationScore), Error>` | Signed by Admin. Returns `(penalty_id, new_score)`. Penalties expire after 60 days. |
| `appeal_penalty` | `env, caller: Address, entity_id: u64, penalty_id: u32` | `Result<ReputationScore, Error>` | Signed by entity (or Admin on behalf). Marks penalty as appealed; admin must `resolve_penalty`. |
| `resolve_penalty` | `env, caller: Address, entity_id: u64, penalty_id: u32, upheld: bool` | `Result<ReputationScore, Error>` | Signed by Admin. If `upheld=true`, keeps penalty; if `upheld=false`, removes it. Returns new score. |

### Score Query

| Function | Parameters | Returns | Auth |
|---|---|---|---|
| `calculate_reputation` | `env, entity_id: u64` | `Result<ReputationScore, Error>` | Public. Returns detailed breakdown including components and penalties. |
| `get_score` | `env, entity_id: u64` | `Option<ReputationScore>` | Public (returns None if entity has no input). |
| `get_input` | `env, entity_id: u64` | `Option<ReputationInput>` | Public (internal input data; for debugging). |

---

## Storage Layout

| Key | Storage Tier | TTL | Description |
|---|---|---|---|
| `DataKey::Admin` | Instance | Instance lifetime | Admin address |
| `DataKey::PendingAdmin` | Instance | Instance lifetime | Proposed new admin (for two-step transfer) |
| `DataKey::Paused` | Instance | Instance lifetime | Pause flag |
| `DataKey::Input(u64)` | Persistent | INPUT_TTL_LEDGERS (~60 days) | `ReputationInput` accumulating ratings, assignments, fraud flags, penalties |
| `DataKey::Score(u64)` | Persistent | INPUT_TTL_LEDGERS (~60 days) | Cached `ReputationScore` (latest computed result) |
| `DataKey::RatingScaleConfig` | Instance | Instance lifetime | Min/max rating bounds |
| `DataKey::DecayConfig` | Instance | Instance lifetime | Decay period, half-life, minimum interactions |
| `DataKey::BadgeConfig` | Instance | Instance lifetime | Badge award thresholds |

### TTL Constants
- `INPUT_TTL_LEDGERS`: Persistent storage for inputs and scores; refreshed on each update to stay alive (~60 days).


---

## Types

### `ViolationType`
```rust
pub enum ViolationType { Minor = 0, Medium = 1, Serious = 2 }
```

### `RatingEvent`
```rust
pub struct RatingEvent {
    pub score: i64,     // Scaled ×100 (e.g., 300 = 3.0 stars)
    pub timestamp: u64, // Unix timestamp in seconds
}
```

### `ReputationInput`
```rust
pub struct ReputationInput {
    pub ratings: Vec<RatingEvent>,           // Most recent 100 kept
    pub total_assigned: u32,                 // Total assignments recorded
    pub total_completed: u32,                // Assignments marked complete
    pub total_response_secs: u64,            // Cumulative response time
    pub response_count: u32,                 // Count of response measurements
    pub fraud_flags: u32,                    // Count of fraud flags applied
    pub last_active_at: u64,                 // Last activity timestamp (for decay)
    pub penalties: Vec<PenaltyRecord>,       // Violation penalties
    pub next_penalty_id: u32,                // Auto-incrementing ID for penalties
}
```

### `ReputationScore`
```rust
pub struct ReputationScore {
    pub score: i64,                  // Final score 0–100 (scaled ×100)
    pub rating_component: i64,       // Weighted rating contribution
    pub completion_component: i64,   // Completion rate contribution
    pub response_component: i64,     // Response time contribution
    pub consistency_bonus: i64,      // Bonus for low variance
    pub fraud_penalty: i64,          // Negative impact from fraud flags
    pub decay_applied: i64,          // Negative impact from inactivity
    pub penalty_points: i64,         // Negative impact from violations
}
```

### `PenaltyRecord`
```rust
pub struct PenaltyRecord {
    pub id: u32,
    pub violation_type: ViolationType,
    pub timestamp: u64,              // When penalty was applied
    pub is_resolved: bool,           // Admin has called `resolve_penalty`
    pub is_appealed: bool,           // Entity appealed; awaiting admin decision
}
```

### `RatingScaleConfig`
```rust
pub struct RatingScaleConfig {
    pub min_rating: i64,             // Minimum allowed rating (scaled ×100)
    pub max_rating: i64,             // Maximum allowed rating (scaled ×100)
}
```

### `DecayConfig`
```rust
pub struct DecayConfig {
    pub decay_period_secs: u64,      // Inactivity threshold (e.g., 2_592_000 = 30 days)
    pub max_decay_points: i64,       // Cap on inactivity penalty (e.g., 2000 = 20.00)
    pub rating_half_life_secs: u64,  // Recency half-life (e.g., 7_776_000 = 90 days)
    pub minimum_interactions: u32,   // Minimum rated interactions required
}
```

### `BadgeConfig`
```rust
pub struct BadgeConfig {
    pub top_rated_threshold: i64,
    pub high_compliance_threshold: i64,
    pub fast_response_threshold: i64,
    pub long_service_threshold: u64,
    pub verified_provider_threshold: i64,
}
```

### `ReputationInputEvent` (for `update_from_event`)
```rust
pub enum ReputationInputEvent {
    RatingSubmitted { score: i64, timestamp: u64 },
    AssignmentRecorded { completed: bool, response_secs: u64, timestamp: u64 },
    FraudFlagged,
    PenaltyApplied { violation_type: ViolationType },
}
```

---

## Scoring Algorithm

Final score is calculated as a weighted sum of components, all arithmetic using integer math scaled ×100:

### Components

| Component | Weight | Range | Description |
|---|---|---|---|
| Weighted Rating | 35% | 0–500 (0–5.0) | Recency-adjusted average of recent ratings; ratings older than `rating_half_life_secs` count at half weight |
| Completion Rate | 25% | 0–500 | `(total_completed * 500) / total_assigned`, clamped [0, 500] |
| Response Time | 20% | 0–500 | Based on average response time; slower response ≈ lower score |
| Consistency Bonus | 10% | 0–500 | +500 if rating std-dev ≤ 0.5; +250 if ≤ 1.0; else 0 |

### Penalties

Subtracted from the weighted sum:

- **Fraud Penalty**: −1500 per fraud flag (capped at −5000 total)
- **Violation Penalties** (expire 60 days after applied):
  - `Minor`: −500
  - `Medium`: −1500
  - `Serious`: −4000
- **Inactivity Decay**: −100 points per `decay_period_secs` of inactivity (capped at `max_decay_points`)

### Final Clamping

Score is clamped to `[0, 10000]` (representing [0.0, 100.0] after division by 100).

### Example Calculation

```
Weighted sum = (350 * 35 + 450 * 25 + 400 * 20) / 100
             = (12250 + 11250 + 8000) / 100
             = 3150

Consistency bonus = 250 (rating std-dev ≤ 1.0)

With bonus = 3150 + (250 * 10 / 100) = 3150 + 25 = 3175

After fraud penalty (1 flag) = 3175 - 1500 = 1675

After decay (90-day inactivity, 30-day period) = 1675 - 300 = 1375

Final = clamp(1375, 0, 10000) = 1375 (= 13.75 score)
```

---

## Constants

| Constant | Value | Meaning |
|---|---|---|
| `W_RATING` | 35 | Rating component weight |
| `W_COMPLETION` | 25 | Completion rate weight |
| `W_RESPONSE` | 20 | Response time weight |
| `W_CONSISTENCY` | 10 | Consistency bonus weight |
| `MIN_SCORE` | 0 | Minimum clamped score |
| `MAX_SCORE` | 10000 | Maximum clamped score (100.0 when divided by 100) |
| `INPUT_TTL_LEDGERS` | 5_184_000 | ~60 days (for persistent storage TTL) |

---

## Events

| Topics | Data | When |
|---|---|---|
| `["reputation", "initialized"]` | `{admin}` | Contract initialized |
| `["reputation", "rating_submitted"]` | `{entity_id, score, timestamp}` | Rating recorded |
| `["reputation", "assignment_recorded"]` | `{entity_id, completed, response_secs, timestamp}` | Assignment recorded |
| `["reputation", "fraud_flagged"]` | `{entity_id}` | Fraud flag applied |
| `["reputation", "penalty_applied"]` | `{entity_id, penalty_id, violation_type, timestamp}` | Violation penalty applied |
| `["reputation", "penalty_appealed"]` | `{entity_id, penalty_id}` | Entity appealed penalty |
| `["reputation", "penalty_resolved"]` | `{entity_id, penalty_id, upheld}` | Admin resolved appeal |
| `["reputation", "score_updated"]` | `{entity_id, score}` | Score recalculated |
| `["reputation", "admin_proposed"]` | `{current_admin, new_admin}` | Admin transfer proposed |
| `["reputation", "admin_transferred"]` | `{old_admin, new_admin}` | Admin transfer accepted |

---

## Error Codes

| Code | Name | Meaning |
|---|---|---|
| 100 | `NotInitialized` | Contract not initialized |
| 101 | `AlreadyInitialized` | `initialize` called twice |
| 102 | `Unauthorized` | Caller not permitted (not admin, etc.) |
| 103 | `ContractPaused` | All state mutations blocked while paused |
| 104 | `EntityNotFound` | No input record for this `entity_id` |
| 105 | `InvalidRating` | Rating outside configured min/max |
| 106 | `InvalidTimestamp` | Timestamp exceeds current ledger time |
| 107 | `PenaltyNotFound` | Penalty ID does not exist |
| 108 | `PenaltyAlreadyResolved` | Penalty already resolved; cannot resolve twice |
| 109 | `PenaltyNotAppealable` | Penalty resolved or already appealed |

---

## Integration Notes

1. **Entity IDs**: Entities are keyed by `u64`, not `Address`. Map addresses to numeric IDs in your client or off-chain layer.
2. **Score Scaling**: All scores in `ReputationScore` and config are scaled ×100. Divide by 100 for display (e.g., 1375 → 13.75).
3. **Timestamps**: Pass Unix timestamps in seconds. Contract validates they do not exceed ledger time.
4. **Ratings Storage**: Only the 100 most recent ratings are kept; older ones are dropped on insertion.
5. **Penalty Expiry**: Violations expire after 60 days. Expired penalties still appear in history but do not affect the score until they expire (then they are ignored in calculations).
6. **Admin Transfer**: Uses propose/accept pattern. Proposed admin must accept to finalize.
7. **Pause/Unpause**: Pausing blocks `submit_rating`, `record_assignment`, `flag_fraud`, `apply_penalty`, `resolve_penalty`, `appeal_penalty`, and config setters. Query functions remain available.
