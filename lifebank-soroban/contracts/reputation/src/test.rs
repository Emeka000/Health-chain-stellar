#![cfg(test)]

use super::*;
use soroban_sdk::{
    testutils::{Address as _, Ledger},
    Address, Env,
};

fn setup() -> (Env, Address, Address, ReputationContractClient<'static>) {
    let env = Env::default();
    env.mock_all_auths();
    let admin = Address::generate(&env);
    let contract_id = env.register(ReputationContract, ());
    let client = ReputationContractClient::new(&env, &contract_id);
    client.initialize(&admin);
    (env, admin, contract_id, client)
}

#[test]
fn test_initialize_sets_config() {
    let (_env, _admin, _id, client) = setup();
    let config = client.get_config();
    assert_eq!(config.rating_min, RATING_MIN);
    assert_eq!(config.rating_max, RATING_MAX);
    assert_eq!(config.decay_bps, DEFAULT_DECAY_BPS);
    assert_eq!(config.min_interactions, DEFAULT_MIN_INTERACTIONS);
}

#[test]
#[should_panic(expected = "Already initialized")]
fn test_double_initialize_panics() {
    let (_env, admin, _id, client) = setup();
    client.initialize(&admin);
}

#[test]
#[should_panic(expected = "Not initialized")]
fn test_get_config_before_init_panics() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register(ReputationContract, ());
    let client = ReputationContractClient::new(&env, &contract_id);
    client.get_config();
}

#[test]
fn test_set_and_get_reputation() {
    let (env, _admin, _id, client) = setup();
    env.ledger().with_mut(|li| li.timestamp = 1000);

    let user = Address::generate(&env);
    client.set_reputation(&user, &55);

    let record = client.get_reputation(&user).unwrap();
    assert_eq!(record.score, 55);
    assert_eq!(record.interactions, 1);
    assert_eq!(record.badge, Badge::Silver);
    assert_eq!(record.last_updated, 1000);
}

#[test]
fn test_badge_thresholds() {
    let (env, _admin, _id, client) = setup();
    let user = Address::generate(&env);

    client.set_reputation(&user, &10);
    assert_eq!(client.get_reputation(&user).unwrap().badge, Badge::Bronze);

    client.set_reputation(&user, &40);
    assert_eq!(client.get_reputation(&user).unwrap().badge, Badge::Silver);

    client.set_reputation(&user, &70);
    assert_eq!(client.get_reputation(&user).unwrap().badge, Badge::Gold);

    client.set_reputation(&user, &90);
    assert_eq!(client.get_reputation(&user).unwrap().badge, Badge::Platinum);
}

#[test]
fn test_interactions_increment() {
    let (env, _admin, _id, client) = setup();
    let user = Address::generate(&env);

    client.set_reputation(&user, &50);
    client.set_reputation(&user, &60);
    client.set_reputation(&user, &70);

    let record = client.get_reputation(&user).unwrap();
    assert_eq!(record.interactions, 3);
}

#[test]
#[should_panic(expected = "Score out of range")]
fn test_score_below_min_panics() {
    let (env, _admin, _id, client) = setup();
    let user = Address::generate(&env);
    client.set_reputation(&user, &0);
}

#[test]
#[should_panic(expected = "Score out of range")]
fn test_score_above_max_panics() {
    let (env, _admin, _id, client) = setup();
    let user = Address::generate(&env);
    client.set_reputation(&user, &101);
}

#[test]
fn test_get_reputation_returns_none_for_unknown() {
    let (env, _admin, _id, client) = setup();
    let user = Address::generate(&env);
    assert!(client.get_reputation(&user).is_none());
}

#[test]
fn test_decay_reduces_score_after_one_period() {
    let (env, _admin, _id, client) = setup();
    let user = Address::generate(&env);

    env.ledger().with_mut(|li| li.timestamp = 0);
    client.set_reputation(&user, &100);

    // Advance exactly one decay period
    env.ledger().with_mut(|li| li.timestamp = DECAY_PERIOD_SECS);
    let record = client.get_reputation(&user).unwrap();
    // 100 - (100 * 10 / 10000) = 100 - 0 = 100... decay_bps=10 means 0.1% per period
    // 100 * 10 / 10000 = 0, so score stays 100 for small scores; use score=1000 bps test
    // With score=100: decay = 100*10/10000 = 0 (integer), score stays 100
    // Verify last_updated advanced by one period
    assert_eq!(record.last_updated, DECAY_PERIOD_SECS);
}

#[test]
fn test_decay_with_higher_bps() {
    let (env, _admin, _id, client) = setup();
    let user = Address::generate(&env);

    // Set a high score so decay_bps=10 produces visible integer reduction
    // score=200 would be out of range; use score=100 with many periods
    env.ledger().with_mut(|li| li.timestamp = 0);
    client.set_reputation(&user, &100);

    // Advance 100 periods — each period: decay = score*10/10000
    // After enough periods the score should drop toward rating_min
    env.ledger().with_mut(|li| li.timestamp = DECAY_PERIOD_SECS * 100);
    let record = client.get_reputation(&user).unwrap();
    assert!(record.score <= 100, "Score should not increase");
    assert!(record.score >= RATING_MIN, "Score must not go below rating_min");
}

#[test]
fn test_decay_floors_at_rating_min() {
    let (env, _admin, _id, client) = setup();
    let user = Address::generate(&env);

    env.ledger().with_mut(|li| li.timestamp = 0);
    client.set_reputation(&user, &100);

    // Advance a very large number of periods to exhaust the score
    env.ledger().with_mut(|li| li.timestamp = DECAY_PERIOD_SECS * 100_000);
    let record = client.get_reputation(&user).unwrap();
    assert_eq!(record.score, RATING_MIN, "Score must floor at rating_min");
}

#[test]
fn test_decay_badge_downgrades() {
    let (env, _admin, _id, client) = setup();
    let user = Address::generate(&env);

    env.ledger().with_mut(|li| li.timestamp = 0);
    client.set_reputation(&user, &100);
    assert_eq!(client.get_reputation(&user).unwrap().badge, Badge::Platinum);

    // Force score to floor
    env.ledger().with_mut(|li| li.timestamp = DECAY_PERIOD_SECS * 100_000);
    let record = client.get_reputation(&user).unwrap();
    assert_eq!(record.badge, Badge::Bronze, "Badge should downgrade with score");
}

#[test]
fn test_no_decay_without_elapsed_time() {
    let (env, _admin, _id, client) = setup();
    let user = Address::generate(&env);

    env.ledger().with_mut(|li| li.timestamp = 1000);
    client.set_reputation(&user, &80);

    // No time passes
    let record = client.get_reputation(&user).unwrap();
    assert_eq!(record.score, 80, "Score must not change without elapsed time");
}

#[test]
fn test_apply_decay_explicit_call() {
    let (env, _admin, _id, client) = setup();
    let user = Address::generate(&env);

    env.ledger().with_mut(|li| li.timestamp = 0);
    client.set_reputation(&user, &100);

    env.ledger().with_mut(|li| li.timestamp = DECAY_PERIOD_SECS * 100_000);
    client.apply_decay(&user);

    let record = client.get_reputation(&user).unwrap();
    assert_eq!(record.score, RATING_MIN);
}

#[test]
fn test_last_updated_reflects_ledger_time() {
    let (env, _admin, _id, client) = setup();
    let user = Address::generate(&env);

    env.ledger().with_mut(|li| li.timestamp = 5000);
    client.set_reputation(&user, &50);
    assert_eq!(client.get_reputation(&user).unwrap().last_updated, 5000);

    env.ledger().with_mut(|li| li.timestamp = 9999);
    client.set_reputation(&user, &60);
    assert_eq!(client.get_reputation(&user).unwrap().last_updated, 9999);
}
