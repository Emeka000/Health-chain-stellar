# Reputation Contract

The Reputation Contract computes and maintains reputation scores for entities (keyed by entity_id: u64) based on ratings, assignment completion, response times, penalties, fraud flags, and decay from inactivity.

## Quick Start

Reputation is a composite score (0–100.00, stored ×100) comprising:
- Weighted Rating (35%) — Recency-weighted average of 1–5 star ratings
- Completion Rate (25%) — completed / assigned × 100
- Response Time (20%) — Faster average → higher score (5 min perfect, 60 min zero)
- Consistency Bonus (10%) — Low variance of ratings → bonus (+10 pts max)
- Fraud Penalty (10%) — Deducted per confirmed fraud flag (max –50 pts)
- Inactivity Decay — –1 pt per 30 days without activity (max –20 pts)
- Violation Penalties — Time-decaying penalties for rule violations

All values stored ×100 (e.g., 7823 = 78.23 points).

## Entrypoints (20 functions)

### Lifecycle
- initialize(env, admin) → Result: Init with default configuration
- init(env, admin) → (): Backward-compatible wrapper
- is_initialized(env) → bool
- get_admin(env) → Result<Address>
- pause(env, admin) → Result: Pause mutations (admin only)
- unpause(env, admin) → Result: Unpause (admin only)
- is_paused(env) → bool

### Configuration
- get_rating_scale_config(env) → Result<RatingScaleConfig>
- get_decay_config(env) → Result<DecayConfig>
- get_minimum_interactions(env) → Result<u32>
- get_badge_config(env) → Result<BadgeConfig>

### Scoring Updates (auto-recalculate)
- submit_rating(env, entity_id: u64, score: i64, timestamp: u64) → Result<ReputationScore>: Submit 1–5 rating
- record_assignment(env, entity_id: u64, completed: bool, response_secs: u64, timestamp: u64) → Result<ReputationScore>
- flag_fraud(env, entity_id: u64, timestamp: u64) → Result<ReputationScore>
- apply_penalty(env, entity_id: u64, violation: ViolationType) → Result<ReputationScore>: Admin only
- appeal_penalty(env, entity_id: u64, penalty_id: u32) → Result: File appeal
- resolve_penalty(env, entity_id: u64, penalty_id: u32, should_remove: bool) → Result<ReputationScore>: Admin only

### Core Algorithm
- calculate_reputation(env, entity_id: u64) → Result<ReputationScore>: Compute and persist score

### Reads
- get_score(env, entity_id: u64) → Option<ReputationScore>: Last persisted score
- get_input(env, entity_id: u64) → Option<ReputationInput>: Raw input data

## Score Components (all ×100)

1. **Weighted Rating** (35%): Recency-weighted average 1–5
   - Recent (< 90 days): 2× weight
   - Older: 1× weight
   - Normalized to 0–100.00

2. **Completion Rate** (25%): completed / assigned × 100

3. **Response Time** (20%): 
   - ≤ 5 min: 100.00
   - ≥ 60 min: 0
   - Linear between

4. **Consistency Bonus** (10%, optional +):
   - Low std-dev (≤ 0.50): +10.00 pts
   - Medium (≤ 1.00): +5.00 pts

5. **Fraud Penalty** (10%, –):
   - fraud_flags × 15.00 pts (capped at –50.00)

6. **Violation Penalties** (–):
   - Minor: –5.00 pts (–2.50 after 30 days, expires 60 days)
   - Medium: –15.00 pts (–7.50 after 30 days, expires 60 days)
   - Serious: –40.00 pts (–20 after 30 days, expires 60 days)

7. **Inactivity Decay** (–):
   - 1 pt per 30 days, capped at –20.00 pts

## Error Codes

- 400: InvalidRating (not 1–5)
- 401: InvalidInput
- 402: EntityNotFound
- 403: NotAuthorized
- 404: PenaltyNotFound
- 405: AlreadyInitialized
- 406: NotInitialized
- 407: ContractPaused

## Data Types

### ReputationScore
score (i64), rating_component, completion_component, response_component, consistency_bonus, fraud_penalty, decay_applied, penalty_points (all ×100)

### ReputationInput
ratings (Vec<RatingEvent>), total_assigned (u32), total_completed (u32), total_response_secs (u64), response_count (u32), fraud_flags (u32), last_active_at (u64), penalties (Vec<PenaltyRecord>)

### RatingEvent
score (i64: 1–5 as 1_00–5_00), timestamp (u64)

### PenaltyRecord
id (u32), violation_type (ViolationType), timestamp (u64), is_resolved (bool), is_appealed (bool)

### ViolationType
Minor, Medium, Serious

## Key Design

- **Entity ID is u64** (not Address)
- **Recency Weighting**: Ratings < 90 days get 2× weight
- **Score Storage**: ×100 for integer arithmetic
- **Auto-Recalculate**: Every write triggers full recalculation
- **Time-Based Recovery**: Penalties lose 50% after 30 days, expire after 60 days
- **Capped Fraud**: Multiple flags capped at –50 pts
- **Inactivity Decay**: Prevents old scores dominating
- **Pause**: Admin can pause mutations without affecting reads
