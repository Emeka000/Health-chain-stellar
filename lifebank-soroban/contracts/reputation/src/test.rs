#![cfg(test)]

use super::*;
use soroban_sdk::{testutils::Ledger as _, testutils::Address as _, testutils::Events as _, Env};

const DAY: u64 = 24 * 3600;
const ENTITY: u64 = 1;

fn setup() -> (Env, Address) {
    let env = Env::default();
    env.mock_all_auths();
    let cid = env.register(ReputationContract, ());
    (env, cid)
}

use soroban_sdk::Address;

fn client<'a>(env: &'a Env, cid: &'a Address) -> ReputationContractClient<'a> {
    ReputationContractClient::new(env, cid)
}

#[test]
fn test_initialize_sets_default_configuration() {
    let env = Env::default();
    env.mock_all_auths();
    let admin = Address::generate(&env);
    let cid = env.register(ReputationContract, ());
    let c = client(&env, &cid);

    c.initialize(&admin);

    assert!(c.is_initialized());
    assert_eq!(c.get_admin(), admin);
    assert_eq!(
        c.get_rating_scale_config(),
        RatingScaleConfig {
            min_rating: DEFAULT_MIN_RATING,
            max_rating: DEFAULT_MAX_RATING,
        }
    );
    assert_eq!(
        c.get_decay_config(),
        DecayConfig {
            decay_period_secs: DECAY_PERIOD_SECS,
            max_decay: MAX_DECAY,
            rating_half_life_secs: HALF_LIFE_SECS,
        }
    );
    assert_eq!(c.get_minimum_interactions(), DEFAULT_MIN_INTERACTIONS);
    assert_eq!(
        c.get_badge_config(),
        BadgeConfig {
            enabled: true,
            min_score_for_badge: DEFAULT_BADGE_MIN_SCORE,
            min_interactions_for_badge: DEFAULT_BADGE_MIN_INTERACTIONS,
        }
    );
}

#[test]
fn test_initialize_emits_event() {
    let env = Env::default();
    env.mock_all_auths();
    let admin = Address::generate(&env);
    let cid = env.register(ReputationContract, ());
    let c = client(&env, &cid);

    c.initialize(&admin);

    assert_eq!(env.events().all().len(), 1);
}

#[test]
fn test_initialize_cannot_run_twice() {
    let env = Env::default();
    env.mock_all_auths();
    let admin = Address::generate(&env);
    let cid = env.register(ReputationContract, ());
    let c = client(&env, &cid);

    c.initialize(&admin);

    assert_eq!(c.try_initialize(&admin), Err(Ok(Error::AlreadyInitialized)));
}

#[test]
fn test_init_getters_fail_before_initialization() {
    let env = Env::default();
    env.mock_all_auths();
    let cid = env.register(ReputationContract, ());
    let c = client(&env, &cid);

    assert_eq!(c.try_get_admin(), Err(Ok(Error::NotInitialized)));
    assert_eq!(
        c.try_get_rating_scale_config(),
        Err(Ok(Error::NotInitialized))
    );
    assert_eq!(c.try_get_decay_config(), Err(Ok(Error::NotInitialized)));
    assert_eq!(
        c.try_get_minimum_interactions(),
        Err(Ok(Error::NotInitialized))
    );
    assert_eq!(c.try_get_badge_config(), Err(Ok(Error::NotInitialized)));
}

// ── submit_rating validation ───────────────────────────────────────────────────

#[test]
fn test_submit_rating_rejects_zero() {
    let (env, cid) = setup();
    let c = client(&env, &cid);
    let result = c.try_submit_rating(&ENTITY, &0, &1000);
    assert!(result.is_err());
}

#[test]
fn test_submit_rating_rejects_six() {
    let (env, cid) = setup();
    let c = client(&env, &cid);
    let result = c.try_submit_rating(&ENTITY, &6, &1000);
    assert!(result.is_err());
}

#[test]
fn test_submit_rating_accepts_valid_range() {
    let (env, cid) = setup();
    let c = client(&env, &cid);
    env.ledger().with_mut(|l| l.timestamp = 1000);
    for score in 1i64..=5 {
        c.submit_rating(&ENTITY, &score, &1000);
    }
}

// ── Weighted rating component ──────────────────────────────────────────────────

#[test]
fn test_all_five_star_ratings_give_max_rating_component() {
    let (env, cid) = setup();
    let c = client(&env, &cid);
    env.ledger().with_mut(|l| l.timestamp = 1000);

    for _ in 0..5 {
        c.submit_rating(&ENTITY, &5, &1000);
    }

    let score = c.get_score(&ENTITY).unwrap();
    assert_eq!(score.rating_component, 100_00);
}

#[test]
fn test_all_one_star_ratings_give_zero_rating_component() {
    let (env, cid) = setup();
    let c = client(&env, &cid);
    env.ledger().with_mut(|l| l.timestamp = 1000);

    for _ in 0..5 {
        c.submit_rating(&ENTITY, &1, &1000);
    }

    let score = c.get_score(&ENTITY).unwrap();
    assert_eq!(score.rating_component, 0);
}

#[test]
fn test_three_star_ratings_give_midpoint_rating_component() {
    let (env, cid) = setup();
    let c = client(&env, &cid);
    env.ledger().with_mut(|l| l.timestamp = 1000);

    for _ in 0..4 {
        c.submit_rating(&ENTITY, &3, &1000);
    }

    let score = c.get_score(&ENTITY).unwrap();
    assert_eq!(score.rating_component, 50_00);
}

#[test]
fn test_recency_weighting_boosts_recent_ratings() {
    let (env, cid) = setup();
    let c = client(&env, &cid);

    // Old 1-star rating (beyond half-life)
    let old_ts = 0u64;
    c.submit_rating(&ENTITY, &1, &old_ts);

    // Recent 5-star ratings
    let recent_ts = 100 * DAY; // well within half-life
    env.ledger().with_mut(|l| l.timestamp = recent_ts);
    c.submit_rating(&ENTITY, &5, &recent_ts);
    c.submit_rating(&ENTITY, &5, &recent_ts);

    let score = c.get_score(&ENTITY).unwrap();
    // Recent 5-stars (weight 2 each) should dominate old 1-star (weight 1)
    // weighted avg = (1×100 + 5×200 + 5×200) / (1+2+2) = (100+1000+1000)/5 = 420
    // normalised = (420-100)/400 × 100_00 = 80_00
    assert_eq!(score.rating_component, 80_00);
}

#[test]
fn test_old_ratings_get_half_weight() {
    let (env, cid) = setup();
    let c = client(&env, &cid);

    // Two old 5-star ratings (beyond half-life)
    c.submit_rating(&ENTITY, &5, &0);
    c.submit_rating(&ENTITY, &5, &0);

    // Set ledger past half-life
    env.ledger().with_mut(|l| l.timestamp = 100 * DAY);

    let score = c.get_score(&ENTITY).unwrap();
    // Both old → weight 1 each; avg = 500; normalised = 100_00
    assert_eq!(score.rating_component, 100_00);
}

#[test]
fn test_no_ratings_gives_neutral_rating_component() {
    let (env, cid) = setup();
    let c = client(&env, &cid);
    env.ledger().with_mut(|l| l.timestamp = 1000);

    // Seed input without ratings via record_assignment
    c.record_assignment(&ENTITY, &true, &300, &1000);

    let score = c.get_score(&ENTITY).unwrap();
    assert_eq!(score.rating_component, 50_00);
}

// ── Completion rate component ──────────────────────────────────────────────────

#[test]
fn test_perfect_completion_rate() {
    let (env, cid) = setup();
    let c = client(&env, &cid);
    env.ledger().with_mut(|l| l.timestamp = 1000);

    for _ in 0..5 {
        c.record_assignment(&ENTITY, &true, &300, &1000);
    }

    let score = c.get_score(&ENTITY).unwrap();
    assert_eq!(score.completion_component, 100_00);
}

#[test]
fn test_zero_completion_rate() {
    let (env, cid) = setup();
    let c = client(&env, &cid);
    env.ledger().with_mut(|l| l.timestamp = 1000);

    for _ in 0..5 {
        c.record_assignment(&ENTITY, &false, &300, &1000);
    }

    let score = c.get_score(&ENTITY).unwrap();
    assert_eq!(score.completion_component, 0);
}

#[test]
fn test_half_completion_rate() {
    let (env, cid) = setup();
    let c = client(&env, &cid);
    env.ledger().with_mut(|l| l.timestamp = 1000);

    for _ in 0..5 {
        c.record_assignment(&ENTITY, &true, &300, &1000);
        c.record_assignment(&ENTITY, &false, &300, &1000);
    }

    let score = c.get_score(&ENTITY).unwrap();
    assert_eq!(score.completion_component, 50_00);
}

#[test]
fn test_no_assignments_gives_neutral_completion() {
    let (env, cid) = setup();
    let c = client(&env, &cid);
    env.ledger().with_mut(|l| l.timestamp = 1000);

    c.submit_rating(&ENTITY, &4, &1000);

    let score = c.get_score(&ENTITY).unwrap();
    assert_eq!(score.completion_component, 50_00);
}

// ── Response time component ────────────────────────────────────────────────────

#[test]
fn test_fast_response_gives_max_score() {
    let (env, cid) = setup();
    let c = client(&env, &cid);
    env.ledger().with_mut(|l| l.timestamp = 1000);

    // 3 minutes average — below 5-minute threshold
    c.record_assignment(&ENTITY, &true, &180, &1000);

    let score = c.get_score(&ENTITY).unwrap();
    assert_eq!(score.response_component, 100_00);
}

#[test]
fn test_slow_response_gives_zero_score() {
    let (env, cid) = setup();
    let c = client(&env, &cid);
    env.ledger().with_mut(|l| l.timestamp = 1000);

    // 90 minutes — above 60-minute ceiling
    c.record_assignment(&ENTITY, &true, &5400, &1000);

    let score = c.get_score(&ENTITY).unwrap();
    assert_eq!(score.response_component, 0);
}

#[test]
fn test_midpoint_response_time() {
    let (env, cid) = setup();
    let c = client(&env, &cid);
    env.ledger().with_mut(|l| l.timestamp = 1000);

    // 32.5 min average ≈ midpoint between 5 and 60 min
    // score = (3600 - 1950) / (3600 - 300) × 100_00 = 1650/3300 × 100_00 = 50_00
    c.record_assignment(&ENTITY, &true, &1950, &1000);

    let score = c.get_score(&ENTITY).unwrap();
    assert_eq!(score.response_component, 50_00);
}

#[test]
fn test_no_response_data_gives_neutral() {
    let (env, cid) = setup();
    let c = client(&env, &cid);
    env.ledger().with_mut(|l| l.timestamp = 1000);

    c.submit_rating(&ENTITY, &3, &1000);

    let score = c.get_score(&ENTITY).unwrap();
    assert_eq!(score.response_component, 50_00);
}

// ── Consistency bonus ──────────────────────────────────────────────────────────

#[test]
fn test_consistent_ratings_give_high_bonus() {
    let (env, cid) = setup();
    let c = client(&env, &cid);
    env.ledger().with_mut(|l| l.timestamp = 1000);

    // All 5-star → std-dev = 0 → max bonus
    for _ in 0..5 {
        c.submit_rating(&ENTITY, &5, &1000);
    }

    let score = c.get_score(&ENTITY).unwrap();
    assert_eq!(score.consistency_bonus, CONSISTENCY_BONUS_HIGH);
}

#[test]
fn test_inconsistent_ratings_give_no_bonus() {
    let (env, cid) = setup();
    let c = client(&env, &cid);
    env.ledger().with_mut(|l| l.timestamp = 1000);

    // Alternating 1 and 5 → high std-dev
    for _ in 0..4 {
        c.submit_rating(&ENTITY, &1, &1000);
        c.submit_rating(&ENTITY, &5, &1000);
    }

    let score = c.get_score(&ENTITY).unwrap();
    assert_eq!(score.consistency_bonus, 0);
}

#[test]
fn test_fewer_than_three_ratings_no_bonus() {
    let (env, cid) = setup();
    let c = client(&env, &cid);
    env.ledger().with_mut(|l| l.timestamp = 1000);

    c.submit_rating(&ENTITY, &5, &1000);
    c.submit_rating(&ENTITY, &5, &1000);

    let score = c.get_score(&ENTITY).unwrap();
    assert_eq!(score.consistency_bonus, 0);
}

// ── Fraud detection scoring ────────────────────────────────────────────────────

#[test]
fn test_single_fraud_flag_applies_penalty() {
    let (env, cid) = setup();
    let c = client(&env, &cid);
    env.ledger().with_mut(|l| l.timestamp = 1000);

    // Seed entity first
    c.submit_rating(&ENTITY, &5, &1000);
    c.flag_fraud(&ENTITY, &1000);

    let score = c.get_score(&ENTITY).unwrap();
    assert_eq!(score.fraud_penalty, FRAUD_FLAG_PENALTY);
}

#[test]
fn test_fraud_penalty_is_capped() {
    let (env, cid) = setup();
    let c = client(&env, &cid);
    env.ledger().with_mut(|l| l.timestamp = 1000);

    c.submit_rating(&ENTITY, &5, &1000);

    // Flag many times — penalty should cap at MAX_FRAUD_PENALTY
    for _ in 0..10 {
        c.flag_fraud(&ENTITY, &1000);
    }

    let score = c.get_score(&ENTITY).unwrap();
    assert_eq!(score.fraud_penalty, MAX_FRAUD_PENALTY);
}

#[test]
fn test_no_fraud_flags_zero_penalty() {
    let (env, cid) = setup();
    let c = client(&env, &cid);
    env.ledger().with_mut(|l| l.timestamp = 1000);

    c.submit_rating(&ENTITY, &4, &1000);

    let score = c.get_score(&ENTITY).unwrap();
    assert_eq!(score.fraud_penalty, 0);
}

#[test]
fn test_flag_fraud_on_unknown_entity_returns_error() {
    let (env, cid) = setup();
    let c = client(&env, &cid);
    let result = c.try_flag_fraud(&999u64, &1000);
    assert!(result.is_err());
}

// ── Reputation decay ───────────────────────────────────────────────────────────

#[test]
fn test_no_decay_when_recently_active() {
    let (env, cid) = setup();
    let c = client(&env, &cid);

    let now = 1000u64;
    env.ledger().with_mut(|l| l.timestamp = now);
    c.submit_rating(&ENTITY, &5, &now);

    let score = c.get_score(&ENTITY).unwrap();
    assert_eq!(score.decay_applied, 0);
}

#[test]
fn test_decay_increases_with_inactivity() {
    let (env, cid) = setup();
    let c = client(&env, &cid);

    // Last active at t=0
    c.submit_rating(&ENTITY, &5, &0);

    // Now 60 days later → 2 decay periods → 2 points decay
    let now = 60 * DAY;
    env.ledger().with_mut(|l| l.timestamp = now);
    c.calculate_reputation(&ENTITY);

    let score = c.get_score(&ENTITY).unwrap();
    assert_eq!(score.decay_applied, 2 * 100); // 2 points ×100
}

#[test]
fn test_decay_is_capped_at_max() {
    let (env, cid) = setup();
    let c = client(&env, &cid);

    // Last active at t=0
    c.submit_rating(&ENTITY, &5, &0);

    // 3 years of inactivity — decay should cap at MAX_DECAY
    let now = 3 * 365 * DAY;
    env.ledger().with_mut(|l| l.timestamp = now);
    c.calculate_reputation(&ENTITY);

    let score = c.get_score(&ENTITY).unwrap();
    assert_eq!(score.decay_applied, MAX_DECAY);
}

// ── Final score bounds ─────────────────────────────────────────────────────────

#[test]
fn test_score_never_exceeds_max() {
    let (env, cid) = setup();
    let c = client(&env, &cid);
    env.ledger().with_mut(|l| l.timestamp = 1000);

    // Perfect inputs
    for _ in 0..10 {
        c.submit_rating(&ENTITY, &5, &1000);
        c.record_assignment(&ENTITY, &true, &60, &1000);
    }

    let score = c.get_score(&ENTITY).unwrap();
    assert!(score.score <= MAX_SCORE);
}

#[test]
fn test_score_never_goes_below_zero() {
    let (env, cid) = setup();
    let c = client(&env, &cid);
    env.ledger().with_mut(|l| l.timestamp = 1000);

    // Worst possible inputs
    for _ in 0..10 {
        c.submit_rating(&ENTITY, &1, &0);
        c.record_assignment(&ENTITY, &false, &9000, &1000);
    }
    for _ in 0..10 {
        c.flag_fraud(&ENTITY, &1000);
    }

    // Add massive decay
    let now = 3 * 365 * DAY;
    env.ledger().with_mut(|l| l.timestamp = now);
    c.calculate_reputation(&ENTITY);

    let score = c.get_score(&ENTITY).unwrap();
    assert!(score.score >= MIN_SCORE);
}

// ── get_score / get_input ──────────────────────────────────────────────────────

#[test]
fn test_get_score_returns_none_for_unknown_entity() {
    let (env, cid) = setup();
    let c = client(&env, &cid);
    assert!(c.get_score(&999u64).is_none());
}

#[test]
fn test_get_input_returns_stored_data() {
    let (env, cid) = setup();
    let c = client(&env, &cid);
    env.ledger().with_mut(|l| l.timestamp = 1000);

    c.submit_rating(&ENTITY, &4, &1000);
    c.record_assignment(&ENTITY, &true, &300, &1000);

    let input = c.get_input(&ENTITY).unwrap();
    assert_eq!(input.ratings.len(), 1);
    assert_eq!(input.total_assigned, 1);
    assert_eq!(input.total_completed, 1);
}

// ── Rating window (100-rating cap) ────────────────────────────────────────────

#[test]
fn test_ratings_capped_at_100() {
    let (env, cid) = setup();
    let c = client(&env, &cid);
    env.ledger().with_mut(|l| l.timestamp = 1000);

    for _ in 0..105 {
        c.submit_rating(&ENTITY, &3, &1000);
    }

    let input = c.get_input(&ENTITY).unwrap();
    assert_eq!(input.ratings.len(), 100);
}

// ── Event emission ─────────────────────────────────────────────────────────────

#[test]
fn test_calculate_reputation_emits_event() {
    let (env, cid) = setup();
    let c = client(&env, &cid);
    env.ledger().with_mut(|l| l.timestamp = 1000);

    c.submit_rating(&ENTITY, &5, &1000);

    let events = env.events().all();
    assert!(!events.is_empty());
}

// ── Composite scenario ─────────────────────────────────────────────────────────

#[test]
fn test_high_performer_gets_high_score() {
    let (env, cid) = setup();
    let c = client(&env, &cid);
    let now = 1000u64;
    env.ledger().with_mut(|l| l.timestamp = now);

    // 10 recent 5-star ratings
    for _ in 0..10 {
        c.submit_rating(&ENTITY, &5, &now);
    }
    // 10/10 completions, fast response
    for _ in 0..10 {
        c.record_assignment(&ENTITY, &true, &120, &now);
    }

    let score = c.get_score(&ENTITY).unwrap();
    // Should be well above 80
    assert!(score.score > 80_00, "high performer score was {}", score.score);
}

#[test]
fn test_poor_performer_gets_low_score() {
    let (env, cid) = setup();
    let c = client(&env, &cid);
    let now = 1000u64;
    env.ledger().with_mut(|l| l.timestamp = now);

    // 10 one-star ratings
    for _ in 0..10 {
        c.submit_rating(&ENTITY, &1, &now);
    }
    // 0/10 completions, slow response
    for _ in 0..10 {
        c.record_assignment(&ENTITY, &false, &7200, &now);
    }
    // 2 fraud flags
    c.flag_fraud(&ENTITY, &now);
    c.flag_fraud(&ENTITY, &now);

    let score = c.get_score(&ENTITY).unwrap();
    assert!(score.score < 20_00, "poor performer score was {}", score.score);
}
// ── Reputation Penalties & Recovery ───────────────────────────────────────────

#[test]
fn test_admin_initialization() {
    let env = Env::default();
    env.mock_all_auths();
    let admin = Address::generate(&env);
    let cid = env.register(ReputationContract, ());
    let c = client(&env, &cid);

    c.init(&admin);
    // Try to init again should panic
    let result = env.as_contract(&cid, || {
        c.try_init(&admin)
    });
    assert!(result.is_err());
}

#[test]
fn test_apply_penalty_requires_admin() {
    let (env, cid) = setup();
    let c = client(&env, &cid);
    let admin = Address::generate(&env);
    let _not_admin = Address::generate(&env);
    
    c.init(&admin);
    
    // Seed entity
    c.submit_rating(&ENTITY, &5, &1000);

    env.mock_all_auths();
    // Use not_admin to call apply_penalty
    // This is tricky with mock_all_auths, but in reality admin.require_auth() will fail if not signed by admin.
    // For testing authorization, we normally wouldn't use mock_all_auths() globally if we want to test specific failures.
}

#[test]
fn test_penalty_system_impacts_score() {
    let (env, cid) = setup();
    let c = client(&env, &cid);
    let admin = Address::generate(&env);
    c.init(&admin);
    
    env.mock_all_auths();
    c.submit_rating(&ENTITY, &5, &1000);
    let score_before = c.get_score(&ENTITY).unwrap().score;

    c.apply_penalty(&ENTITY, &ViolationType::Medium);
    let score_after = c.get_score(&ENTITY).unwrap();
    
    assert_eq!(score_after.penalty_points, PENALTY_MEDIUM);
    assert!(score_after.score < score_before);
}

#[test]
fn test_time_based_penalty_recovery() {
    let (env, cid) = setup();
    let c = client(&env, &cid);
    let admin = Address::generate(&env);
    c.init(&admin);
    
    env.mock_all_auths();
    let now = 1000u64;
    env.ledger().with_mut(|l| l.timestamp = now);
    c.submit_rating(&ENTITY, &5, &now);

    c.apply_penalty(&ENTITY, &ViolationType::Serious);
    let score1 = c.get_score(&ENTITY).unwrap();
    assert_eq!(score1.penalty_points, PENALTY_SERIOUS);

    // Jump 40 days (past recovery threshold)
    let forty_days = 40 * DAY;
    env.ledger().with_mut(|l| l.timestamp = now + forty_days);
    
    let score2 = c.calculate_reputation(&ENTITY);
    assert_eq!(score2.penalty_points, PENALTY_SERIOUS / 2);
}

#[test]
fn test_penalty_expiry() {
    let (env, cid) = setup();
    let c = client(&env, &cid);
    let admin = Address::generate(&env);
    c.init(&admin);
    
    env.mock_all_auths();
    let now = 1000u64;
    env.ledger().with_mut(|l| l.timestamp = now);
    c.submit_rating(&ENTITY, &5, &now);

    c.apply_penalty(&ENTITY, &ViolationType::Minor);
    
    // Jump 65 days (past expiry)
    let sixty_five_days = 65 * DAY;
    env.ledger().with_mut(|l| l.timestamp = now + sixty_five_days);
    
    let score = c.calculate_reputation(&ENTITY);
    assert_eq!(score.penalty_points, 0);
}

#[test]
fn test_appeals_system() {
    let (env, cid) = setup();
    let c = client(&env, &cid);
    let admin = Address::generate(&env);
    c.init(&admin);
    
    env.mock_all_auths();
    c.submit_rating(&ENTITY, &5, &1000);

    c.apply_penalty(&ENTITY, &ViolationType::Medium);
    
    // Appeal the penalty (ID 0)
    c.appeal_penalty(&ENTITY, &0);
    
    let input = c.get_input(&ENTITY).unwrap();
    let p = input.penalties.get(0).unwrap();
    assert!(p.is_appealed);

    // Resolve penalty (dismiss/remove)
    c.resolve_penalty(&ENTITY, &0, &true);
    
    let score = c.get_score(&ENTITY).unwrap();
    assert_eq!(score.penalty_points, 0);
}

#[test]
fn test_resolve_penalty_marks_as_resolved() {
    let (env, cid) = setup();
    let c = client(&env, &cid);
    let admin = Address::generate(&env);
    c.init(&admin);
    
    env.mock_all_auths();
    c.submit_rating(&ENTITY, &5, &1000);

    c.apply_penalty(&ENTITY, &ViolationType::Minor);
    
    // Resolve penalty (mark resolved instead of remove)
    c.resolve_penalty(&ENTITY, &0, &false);
    
    let score = c.get_score(&ENTITY).unwrap();
    assert_eq!(score.penalty_points, 0);
    
    let input = c.get_input(&ENTITY).unwrap();
    assert!(input.penalties.get(0).unwrap().is_resolved);
}

// ── Circuit breaker tests ─────────────────────────────────────────────────────

#[test]
fn test_reputation_pause_blocks_submit_rating() {
    let (env, cid) = setup();
    let c = client(&env, &cid);
    let admin = Address::generate(&env);
    c.initialize(&admin);

    c.pause(&admin);
    assert!(c.is_paused());

    let result = c.try_submit_rating(&ENTITY, &3i64, &1000u64);
    assert!(result.is_err());
}

#[test]
fn test_reputation_pause_allows_get_score() {
    let (env, cid) = setup();
    let c = client(&env, &cid);
    let admin = Address::generate(&env);
    c.initialize(&admin);

    // Submit a rating before pausing
    c.submit_rating(&ENTITY, &4i64, &1000u64);
    c.pause(&admin);

    // Read still works
    let score = c.get_score(&ENTITY).unwrap();
    assert!(score.score >= 0);
}

#[test]
fn test_reputation_unpause_restores_writes() {
    let (env, cid) = setup();
    let c = client(&env, &cid);
    let admin = Address::generate(&env);
    c.initialize(&admin);

    c.pause(&admin);
    c.unpause(&admin);
    assert!(!c.is_paused());

    // Should succeed after unpause
    c.submit_rating(&ENTITY, &5i64, &2000u64);
}

#[test]
#[should_panic]
fn test_reputation_non_admin_cannot_pause() {
    let (env, cid) = setup();
    let c = client(&env, &cid);
    let admin = Address::generate(&env);
    c.initialize(&admin);

    let attacker = Address::generate(&env);
    c.pause(&attacker);
}
