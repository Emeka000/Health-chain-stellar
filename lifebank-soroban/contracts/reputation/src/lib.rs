#![no_std]
use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, symbol_short, Address, Env, Vec,
};

// ── Constants (all arithmetic is integer, scaled ×100 for two decimal places) ──

/// Maximum raw score before clamping to 100_00 (100.00)
const MAX_SCORE: i64 = 100_00;
const MIN_SCORE: i64 = 0;

/// Weights — must sum to 100
const W_RATING: i64 = 35; // weighted average rating
const W_COMPLETION: i64 = 25; // completion rate
const W_RESPONSE: i64 = 20; // response time
const W_CONSISTENCY: i64 = 10; // consistency bonus
const W_FRAUD: i64 = 10; // fraud penalty (subtracted)

/// Decay: score loses 1 point per DECAY_PERIOD_SECS of inactivity
const DECAY_PERIOD_SECS: u64 = 30 * 24 * 3600; // 30 days
const MAX_DECAY: i64 = 20_00; // cap decay at 20 points

/// Recency half-life: ratings older than HALF_LIFE_SECS count at half weight
const HALF_LIFE_SECS: u64 = 90 * 24 * 3600; // 90 days

/// Fraud thresholds
const FRAUD_FLAG_PENALTY: i64 = 15_00; // per confirmed fraud flag
const MAX_FRAUD_PENALTY: i64 = 50_00; // cap total fraud penalty

/// Consistency bonus: awarded when std-dev of ratings is low
const CONSISTENCY_LOW_STDDEV: i64 = 50; // ×100 → 0.50 stars
const CONSISTENCY_BONUS_HIGH: i64 = 10_00;
const CONSISTENCY_BONUS_MED: i64 = 5_00;

/// Penalty points per violation type
const PENALTY_MINOR: i64 = 5_00;
const PENALTY_MEDIUM: i64 = 15_00;
const PENALTY_SERIOUS: i64 = 40_00;

/// Recovery: penalties expire after 60 days
const PENALTY_EXPIRY_SECS: u64 = 60 * 24 * 3600;

const DEFAULT_MIN_RATING: i64 = 1;
const DEFAULT_MAX_RATING: i64 = 5;
const DEFAULT_MIN_INTERACTIONS: u32 = 3;
const DEFAULT_BADGE_MIN_SCORE: i64 = 80_00;
const DEFAULT_BADGE_MIN_INTERACTIONS: u32 = 10;

/// Violation types for penalties
#[contracttype]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ViolationType {
    Minor = 0,
    Medium = 1,
    Serious = 2,
}

/// A record of a penalty applied to an entity.
#[contracttype]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct PenaltyRecord {
    pub id: u32,
    pub violation_type: ViolationType,
    pub timestamp: u64,
    pub is_resolved: bool,
    pub is_appealed: bool,
}

// ── Types ──────────────────────────────────────────────────────────────────────

/// A single rating event submitted for an entity.
#[contracttype]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct RatingEvent {
    /// Score 1–5 (stored as 1_00–5_00, i.e. ×100)
    pub score: i64,
    /// Unix timestamp when the rating was given
    pub timestamp: u64,
}

/// Operational metrics used as inputs to the reputation algorithm.
#[contracttype]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ReputationInput {
    /// Historical rating events (up to 100 most recent)
    pub ratings: Vec<RatingEvent>,
    /// Total requests/orders assigned
    pub total_assigned: u32,
    /// Successfully completed requests
    pub total_completed: u32,
    /// Sum of all response times in seconds
    pub total_response_secs: u64,
    /// Number of response time samples
    pub response_count: u32,
    /// Number of confirmed fraud flags against this entity
    pub fraud_flags: u32,
    /// Unix timestamp of last activity
    pub last_active_at: u64,
    /// History of applied penalties
    pub penalties: Vec<PenaltyRecord>,
}

/// Full breakdown of the computed reputation score.
#[contracttype]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ReputationScore {
    /// Final clamped score ×100 (e.g. 7823 = 78.23 / 100)
    pub score: i64,
    /// Weighted rating component ×100
    pub rating_component: i64,
    /// Completion rate component ×100
    pub completion_component: i64,
    /// Response time component ×100
    pub response_component: i64,
    /// Consistency bonus ×100
    pub consistency_bonus: i64,
    /// Fraud penalty ×100 (positive value, subtracted from score)
    pub fraud_penalty: i64,
    /// Decay applied ×100 (positive value, subtracted from score)
    pub decay_applied: i64,
    /// Total active penalty points from violations ×100
    pub penalty_points: i64,
}

#[contracttype]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct RatingScaleConfig {
    pub min_rating: i64,
    pub max_rating: i64,
}

#[contracttype]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct DecayConfig {
    pub decay_period_secs: u64,
    pub max_decay: i64,
    pub rating_half_life_secs: u64,
}

#[contracttype]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct BadgeConfig {
    pub enabled: bool,
    pub min_score_for_badge: i64,
    pub min_interactions_for_badge: u32,
}

#[contracterror]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[repr(u32)]
pub enum Error {
    InvalidRating = 400,
    InvalidInput = 401,
    EntityNotFound = 402,
    NotAuthorized = 403,
    PenaltyNotFound = 404,
    AlreadyInitialized = 405,
    NotInitialized = 406,
    ContractPaused = 407,
}

/// Storage key for persisted reputation scores.
#[contracttype]
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum DataKey {
    Score(u64), // entity_id → ReputationScore
    Input(u64), // entity_id → ReputationInput
    Admin,      // Address → Admin identity
    RatingScaleConfig,
    DecayConfig,
    MinimumInteractions,
    BadgeConfig,
    Paused,
}

// ── Contract ───────────────────────────────────────────────────────────────────

#[contract]
pub struct ReputationContract;

#[contractimpl]
impl ReputationContract {
    /// Initialize the contract with the default configuration.
    pub fn initialize(env: Env, admin: Address) -> Result<(), Error> {
        admin.require_auth();

        if Self::is_initialized(env.clone()) {
            return Err(Error::AlreadyInitialized);
        }

        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().set(
            &DataKey::RatingScaleConfig,
            &RatingScaleConfig {
                min_rating: DEFAULT_MIN_RATING,
                max_rating: DEFAULT_MAX_RATING,
            },
        );
        env.storage().instance().set(
            &DataKey::DecayConfig,
            &DecayConfig {
                decay_period_secs: DECAY_PERIOD_SECS,
                max_decay: MAX_DECAY,
                rating_half_life_secs: HALF_LIFE_SECS,
            },
        );
        env.storage()
            .instance()
            .set(&DataKey::MinimumInteractions, &DEFAULT_MIN_INTERACTIONS);
        env.storage().instance().set(
            &DataKey::BadgeConfig,
            &BadgeConfig {
                enabled: true,
                min_score_for_badge: DEFAULT_BADGE_MIN_SCORE,
                min_interactions_for_badge: DEFAULT_BADGE_MIN_INTERACTIONS,
            },
        );

        env.events()
            .publish((symbol_short!("init"), symbol_short!("v1")), admin);

        Ok(())
    }

    /// Pause all state-mutating functions. Admin only.
    pub fn pause(env: Env, admin: Address) -> Result<(), Error> {
        admin.require_auth();
        let stored: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(Error::NotAuthorized)?;
        if admin != stored {
            return Err(Error::NotAuthorized);
        }
        env.storage().instance().set(&DataKey::Paused, &true);
        Ok(())
    }

    /// Unpause the contract. Admin only.
    pub fn unpause(env: Env, admin: Address) -> Result<(), Error> {
        admin.require_auth();
        let stored: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(Error::NotAuthorized)?;
        if admin != stored {
            return Err(Error::NotAuthorized);
        }
        env.storage().instance().set(&DataKey::Paused, &false);
        Ok(())
    }

    /// Returns whether the contract is currently paused.
    pub fn is_paused(env: Env) -> bool {
        env.storage()
            .instance()
            .get(&DataKey::Paused)
            .unwrap_or(false)
    }

    fn require_not_paused(env: &Env) -> Result<(), Error> {
        if env
            .storage()
            .instance()
            .get(&DataKey::Paused)
            .unwrap_or(false)
        {
            return Err(Error::ContractPaused);
        }
        Ok(())
    }

    /// Backward-compatible initializer wrapper.
    pub fn init(env: Env, admin: Address) {
        Self::initialize(env, admin).unwrap();
    }

    pub fn is_initialized(env: Env) -> bool {
        env.storage().instance().has(&DataKey::Admin)
    }

    pub fn get_admin(env: Env) -> Result<Address, Error> {
        env.storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(Error::NotInitialized)
    }

    pub fn get_rating_scale_config(env: Env) -> Result<RatingScaleConfig, Error> {
        env.storage()
            .instance()
            .get(&DataKey::RatingScaleConfig)
            .ok_or(Error::NotInitialized)
    }

    pub fn get_decay_config(env: Env) -> Result<DecayConfig, Error> {
        env.storage()
            .instance()
            .get(&DataKey::DecayConfig)
            .ok_or(Error::NotInitialized)
    }

    pub fn get_minimum_interactions(env: Env) -> Result<u32, Error> {
        env.storage()
            .instance()
            .get(&DataKey::MinimumInteractions)
            .ok_or(Error::NotInitialized)
    }

    pub fn get_badge_config(env: Env) -> Result<BadgeConfig, Error> {
        env.storage()
            .instance()
            .get(&DataKey::BadgeConfig)
            .ok_or(Error::NotInitialized)
    }

    // ── Write ──────────────────────────────────────────────────────────────────

    /// Submit a rating event for an entity and recalculate its score.
    ///
    /// `score` must be 1–5 (inclusive).
    pub fn submit_rating(
        env: Env,
        entity_id: u64,
        score: i64,
        timestamp: u64,
    ) -> Result<ReputationScore, Error> {
        Self::require_not_paused(&env)?;
        if score < 1 || score > 5 {
            return Err(Error::InvalidRating);
        }

        let mut input: ReputationInput = env
            .storage()
            .persistent()
            .get(&DataKey::Input(entity_id))
            .unwrap_or(ReputationInput {
                ratings: Vec::new(&env),
                total_assigned: 0,
                total_completed: 0,
                total_response_secs: 0,
                response_count: 0,
                fraud_flags: 0,
                last_active_at: timestamp,
                penalties: Vec::new(&env),
            });

        // Append rating (score stored ×100)
        input.ratings.push_back(RatingEvent {
            score: score * 100,
            timestamp,
        });
        // Keep only the 100 most recent ratings to bound storage
        if input.ratings.len() > 100 {
            let mut trimmed = Vec::new(&env);
            let start = input.ratings.len() - 100;
            for i in start..input.ratings.len() {
                trimmed.push_back(input.ratings.get(i).unwrap());
            }
            input.ratings = trimmed;
        }
        input.last_active_at = timestamp;

        env.storage()
            .persistent()
            .set(&DataKey::Input(entity_id), &input);

        let result = Self::calculate_reputation(env.clone(), entity_id)?;
        Ok(result)
    }

    /// Record a completed or failed assignment and recalculate score.
    pub fn record_assignment(
        env: Env,
        entity_id: u64,
        completed: bool,
        response_secs: u64,
        timestamp: u64,
    ) -> Result<ReputationScore, Error> {
        Self::require_not_paused(&env)?;
        let mut input: ReputationInput = env
            .storage()
            .persistent()
            .get(&DataKey::Input(entity_id))
            .unwrap_or(ReputationInput {
                ratings: Vec::new(&env),
                total_assigned: 0,
                total_completed: 0,
                total_response_secs: 0,
                response_count: 0,
                fraud_flags: 0,
                last_active_at: timestamp,
                penalties: Vec::new(&env),
            });

        input.total_assigned += 1;
        if completed {
            input.total_completed += 1;
        }
        input.total_response_secs += response_secs;
        input.response_count += 1;
        input.last_active_at = timestamp;

        env.storage()
            .persistent()
            .set(&DataKey::Input(entity_id), &input);

        Self::calculate_reputation(env, entity_id)
    }

    /// Flag an entity for fraud and recalculate score.
    pub fn flag_fraud(env: Env, entity_id: u64, timestamp: u64) -> Result<ReputationScore, Error> {
        Self::require_not_paused(&env)?;
        let mut input: ReputationInput = env
            .storage()
            .persistent()
            .get(&DataKey::Input(entity_id))
            .ok_or(Error::EntityNotFound)?;

        input.fraud_flags += 1;
        input.last_active_at = timestamp;
        env.storage()
            .persistent()
            .set(&DataKey::Input(entity_id), &input);

        Self::calculate_reputation(env, entity_id)
    }

    /// Apply a penalty for a violation. Can only be called by admin.
    pub fn apply_penalty(
        env: Env,
        entity_id: u64,
        violation: ViolationType,
    ) -> Result<ReputationScore, Error> {
        let admin: soroban_sdk::Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(Error::NotAuthorized)?;
        admin.require_auth();
        Self::require_not_paused(&env)?;

        let mut input: ReputationInput = env
            .storage()
            .persistent()
            .get(&DataKey::Input(entity_id))
            .ok_or(Error::EntityNotFound)?;

        let id = input.penalties.len();
        input.penalties.push_back(PenaltyRecord {
            id,
            violation_type: violation,
            timestamp: env.ledger().timestamp(),
            is_resolved: false,
            is_appealed: false,
        });

        env.storage()
            .persistent()
            .set(&DataKey::Input(entity_id), &input);

        Self::calculate_reputation(env, entity_id)
    }

    /// File an appeal for a specific penalty.
    pub fn appeal_penalty(env: Env, entity_id: u64, penalty_id: u32) -> Result<(), Error> {
        Self::require_not_paused(&env)?;
        let mut input: ReputationInput = env
            .storage()
            .persistent()
            .get(&DataKey::Input(entity_id))
            .ok_or(Error::EntityNotFound)?;

        let mut found = false;
        for i in 0..input.penalties.len() {
            let mut p = input.penalties.get(i).unwrap();
            if p.id == penalty_id {
                p.is_appealed = true;
                input.penalties.set(i, p);
                found = true;
                break;
            }
        }

        if !found {
            return Err(Error::PenaltyNotFound);
        }

        env.storage()
            .persistent()
            .set(&DataKey::Input(entity_id), &input);
        Ok(())
    }

    /// Resolve or dismiss a penalty (Admin only).
    pub fn resolve_penalty(
        env: Env,
        entity_id: u64,
        penalty_id: u32,
        should_remove: bool,
    ) -> Result<ReputationScore, Error> {
        let admin: soroban_sdk::Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(Error::NotAuthorized)?;
        admin.require_auth();

        let mut input: ReputationInput = env
            .storage()
            .persistent()
            .get(&DataKey::Input(entity_id))
            .ok_or(Error::EntityNotFound)?;

        let mut found_idx: Option<u32> = None;
        for i in 0..input.penalties.len() {
            if input.penalties.get(i).unwrap().id == penalty_id {
                found_idx = Some(i);
                break;
            }
        }

        let idx = found_idx.ok_or(Error::PenaltyNotFound)?;

        if should_remove {
            input.penalties.remove(idx);
        } else {
            let mut p = input.penalties.get(idx).unwrap();
            p.is_resolved = true;
            input.penalties.set(idx, p);
        }

        env.storage()
            .persistent()
            .set(&DataKey::Input(entity_id), &input);
        Self::calculate_reputation(env, entity_id)
    }

    // ── Core algorithm ─────────────────────────────────────────────────────────

    /// Recalculate and persist the reputation score for `entity_id`.
    ///
    /// Score breakdown (all values ×100):
    ///
    /// 1. **Weighted rating** (35%): recency-weighted average of rating events,
    ///    normalised to 0–100.
    /// 2. **Completion rate** (25%): `completed / assigned × 100`.
    /// 3. **Response time** (20%): faster average → higher score (capped at 1 h).
    /// 4. **Consistency bonus** (10%): low std-dev of ratings → bonus.
    /// 5. **Fraud penalty** (10%): deducted per confirmed fraud flag.
    /// 6. **Decay**: inactivity reduces score by 1 pt per 30-day period (max 20 pt).
    pub fn calculate_reputation(env: Env, entity_id: u64) -> Result<ReputationScore, Error> {
        let input: ReputationInput = env
            .storage()
            .persistent()
            .get(&DataKey::Input(entity_id))
            .ok_or(Error::EntityNotFound)?;

        let now = env.ledger().timestamp();

        // 1. Recency-weighted rating component
        let rating_component = Self::weighted_rating_score(&input.ratings, now);

        // 2. Completion rate component
        let completion_component =
            Self::completion_rate_score(input.total_completed, input.total_assigned);

        // 3. Response time component
        let response_component =
            Self::response_time_score(input.total_response_secs, input.response_count);

        // 4. Consistency bonus
        let consistency_bonus = Self::consistency_bonus(&input.ratings);

        // 5. Fraud penalty
        let fraud_penalty = Self::fraud_penalty(input.fraud_flags);

        // 5b. Violation penalties (with recovery logic)
        let penalty_points = Self::calculate_penalty_points(&input.penalties, now);

        // 6. Weighted sum of main components
        let raw = (rating_component * W_RATING
            + completion_component * W_COMPLETION
            + response_component * W_RESPONSE)
            / 100;

        // Add consistency bonus (already scaled)
        let with_bonus = raw + (consistency_bonus * W_CONSISTENCY / 100);

        // Subtract fraud and violation penalties
        let after_penalties = (with_bonus - fraud_penalty - penalty_points).max(MIN_SCORE);

        // 7. Decay for inactivity
        let decay_applied = Self::decay_penalty(input.last_active_at, now);
        let final_score = (after_penalties - decay_applied).clamp(MIN_SCORE, MAX_SCORE);

        let result = ReputationScore {
            score: final_score,
            rating_component,
            completion_component,
            response_component,
            consistency_bonus,
            fraud_penalty,
            decay_applied,
            penalty_points,
        };

        env.storage()
            .persistent()
            .set(&DataKey::Score(entity_id), &result);

        env.events().publish(
            (
                symbol_short!("rep"),
                symbol_short!("updated"),
                symbol_short!("v1"),
            ),
            (entity_id, final_score),
        );

        Ok(result)
    }

    // ── Read ───────────────────────────────────────────────────────────────────

    /// Return the last persisted reputation score for an entity.
    pub fn get_score(env: Env, entity_id: u64) -> Option<ReputationScore> {
        env.storage().persistent().get(&DataKey::Score(entity_id))
    }

    /// Return the raw input data for an entity.
    pub fn get_input(env: Env, entity_id: u64) -> Option<ReputationInput> {
        env.storage().persistent().get(&DataKey::Input(entity_id))
    }

    // ── Algorithm helpers (pure, no storage) ──────────────────────────────────

    /// Recency-weighted average rating, normalised to 0–100_00.
    ///
    /// Ratings older than `HALF_LIFE_SECS` receive half the weight of recent ones.
    /// Result is scaled ×100 (0–100_00).
    fn weighted_rating_score(ratings: &Vec<RatingEvent>, now: u64) -> i64 {
        if ratings.is_empty() {
            return 50_00; // neutral default
        }

        let mut weighted_sum: i64 = 0;
        let mut weight_total: i64 = 0;

        for i in 0..ratings.len() {
            let r = ratings.get(i).unwrap();
            // Weight: 2 if recent, 1 if older than half-life
            let age = now.saturating_sub(r.timestamp);
            let weight: i64 = if age < HALF_LIFE_SECS { 2 } else { 1 };
            weighted_sum += r.score * weight; // score already ×100
            weight_total += weight;
        }

        if weight_total == 0 {
            return 50_00;
        }

        let avg = weighted_sum / weight_total; // 100–500 range
                                               // Normalise: (avg - 100) / 400 × 100_00
        ((avg - 100) * 100_00) / 400
    }

    /// Completion rate → 0–100_00.
    fn completion_rate_score(completed: u32, assigned: u32) -> i64 {
        if assigned == 0 {
            return 50_00; // neutral default
        }
        ((completed as i64) * 100_00) / (assigned as i64)
    }

    /// Response time score → 0–100_00.
    ///
    /// Average response ≤ 5 min → 100_00; ≥ 60 min → 0.
    /// Linear interpolation in between.
    fn response_time_score(total_secs: u64, count: u32) -> i64 {
        if count == 0 {
            return 50_00;
        }
        let avg_secs = (total_secs / count as u64) as i64;
        let min_secs: i64 = 5 * 60; // 5 minutes → perfect
        let max_secs: i64 = 60 * 60; // 60 minutes → zero

        if avg_secs <= min_secs {
            return 100_00;
        }
        if avg_secs >= max_secs {
            return 0;
        }
        // Linear: score = (max - avg) / (max - min) × 100_00
        ((max_secs - avg_secs) * 100_00) / (max_secs - min_secs)
    }

    /// Consistency bonus based on std-dev of ratings.
    ///
    /// Low variance → high bonus. Returns 0–100_00.
    fn consistency_bonus(ratings: &Vec<RatingEvent>) -> i64 {
        if ratings.len() < 3 {
            return 0; // not enough data
        }

        let n = ratings.len() as i64;
        let mut sum: i64 = 0;
        for i in 0..ratings.len() {
            sum += ratings.get(i).unwrap().score;
        }
        let mean = sum / n;

        // Variance (×100² scale)
        let mut variance: i64 = 0;
        for i in 0..ratings.len() {
            let diff = ratings.get(i).unwrap().score - mean;
            variance += diff * diff;
        }
        variance /= n;

        // Integer sqrt approximation
        let stddev = Self::isqrt(variance as u64) as i64;

        if stddev <= CONSISTENCY_LOW_STDDEV {
            CONSISTENCY_BONUS_HIGH
        } else if stddev <= CONSISTENCY_LOW_STDDEV * 2 {
            CONSISTENCY_BONUS_MED
        } else {
            0
        }
    }

    /// Fraud penalty: `flags × FRAUD_FLAG_PENALTY`, capped at `MAX_FRAUD_PENALTY`.
    fn fraud_penalty(flags: u32) -> i64 {
        ((flags as i64) * FRAUD_FLAG_PENALTY).min(MAX_FRAUD_PENALTY)
    }

    /// Decay penalty for inactivity.
    ///
    /// 1 point per `DECAY_PERIOD_SECS` of inactivity, capped at `MAX_DECAY`.
    fn decay_penalty(last_active: u64, now: u64) -> i64 {
        let inactive = now.saturating_sub(last_active);
        let periods = (inactive / DECAY_PERIOD_SECS) as i64;
        (periods * 100).min(MAX_DECAY) // 1 point (×100) per period
    }

    /// Integer square root (Newton's method, no_std safe).
    fn isqrt(n: u64) -> u64 {
        if n == 0 {
            return 0;
        }
        let mut x = n;
        let mut y = (x + 1) / 2;
        while y < x {
            x = y;
            y = (x + n / x) / 2;
        }
        x
    }

    /// Calculate total active penalty points from violation history.
    ///
    /// Implements time-based recovery: penalties lose 50% weight after 30 days,
    /// and expire completely after `PENALTY_EXPIRY_SECS` (60 days).
    fn calculate_penalty_points(penalties: &Vec<PenaltyRecord>, now: u64) -> i64 {
        let mut total: i64 = 0;
        let recovery_threshold_secs: u64 = 30 * 24 * 3600; // 30 days

        for i in 0..penalties.len() {
            let p = penalties.get(i).unwrap();
            if p.is_resolved {
                continue;
            }

            let age = now.saturating_sub(p.timestamp);
            if age >= PENALTY_EXPIRY_SECS {
                continue;
            }

            let mut points = match p.violation_type {
                ViolationType::Minor => PENALTY_MINOR,
                ViolationType::Medium => PENALTY_MEDIUM,
                ViolationType::Serious => PENALTY_SERIOUS,
            };

            // Time-based recovery: 50% reduction after 30 days
            if age >= recovery_threshold_secs {
                points /= 2;
            }

            // Appeals might reduce weight or suspend penalty?
            // For now, let's say appealed penalties still count but maybe less?
            // Actually, let's keep it simple: they count full until resolved.

            total += points;
        }
        total
    }
}

mod test;
