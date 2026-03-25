#![no_std]
use soroban_sdk::{contract, contractimpl, contracttype, Address, Env};

/// Rating scale bounds (1–100)
pub const RATING_MIN: u32 = 1;
pub const RATING_MAX: u32 = 100;

/// Decay applied per ledger period (basis points, e.g. 10 = 0.1%)
pub const DEFAULT_DECAY_BPS: u32 = 10;

/// How many seconds constitute one decay period (e.g. 86400 = 1 day)
pub const DECAY_PERIOD_SECS: u64 = 86400;

/// Minimum interactions before a reputation score is considered valid
pub const DEFAULT_MIN_INTERACTIONS: u32 = 3;

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum Badge {
    Bronze,
    Silver,
    Gold,
    Platinum,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Config {
    pub rating_min: u32,
    pub rating_max: u32,
    pub decay_bps: u32,
    pub min_interactions: u32,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ReputationRecord {
    pub score: u32,
    pub interactions: u32,
    pub badge: Badge,
    pub last_updated: u64,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum DataKey {
    Admin,
    Config,
    Reputation(Address),
}

#[contract]
pub struct ReputationContract;

#[contractimpl]
impl ReputationContract {
    /// Initialize the contract. Can only be called once.
    pub fn initialize(env: Env, admin: Address) {
        if env.storage().persistent().has(&DataKey::Admin) {
            panic!("Already initialized");
        }

        env.storage().persistent().set(&DataKey::Admin, &admin);

        let config = Config {
            rating_min: RATING_MIN,
            rating_max: RATING_MAX,
            decay_bps: DEFAULT_DECAY_BPS,
            min_interactions: DEFAULT_MIN_INTERACTIONS,
        };
        env.storage().persistent().set(&DataKey::Config, &config);
    }

    /// Returns the current config.
    pub fn get_config(env: Env) -> Config {
        env.storage()
            .persistent()
            .get(&DataKey::Config)
            .expect("Not initialized")
    }

    /// Returns the reputation record for an address with decay applied, or None if not found.
    pub fn get_reputation(env: Env, address: Address) -> Option<ReputationRecord> {
        let key = DataKey::Reputation(address);
        let record: ReputationRecord = env.storage().persistent().get(&key)?;
        let config: Config = env
            .storage()
            .persistent()
            .get(&DataKey::Config)
            .expect("Not initialized");
        let decayed = Self::compute_decay(&env, record, &config);
        env.storage().persistent().set(&key, &decayed);
        Some(decayed)
    }

    /// Explicitly applies decay to an address's reputation and saves it.
    pub fn apply_decay(env: Env, address: Address) {
        let key = DataKey::Reputation(address);
        if let Some(record) = env.storage().persistent().get::<DataKey, ReputationRecord>(&key) {
            let config: Config = env
                .storage()
                .persistent()
                .get(&DataKey::Config)
                .expect("Not initialized");
            let decayed = Self::compute_decay(&env, record, &config);
            env.storage().persistent().set(&key, &decayed);
        }
    }

    /// Computes decayed score based on elapsed periods since last_updated.
    /// Each period reduces the score by decay_bps / 10000, floored at rating_min.
    fn compute_decay(env: &Env, mut record: ReputationRecord, config: &Config) -> ReputationRecord {
        let now = env.ledger().timestamp();
        if now <= record.last_updated || record.last_updated == 0 {
            return record;
        }
        let elapsed = now - record.last_updated;
        let periods = elapsed / DECAY_PERIOD_SECS;
        if periods == 0 {
            return record;
        }
        // Apply decay: score = score * (1 - decay_bps/10000)^periods
        // Approximated iteratively to avoid floating point
        let mut score = record.score;
        for _ in 0..periods {
            let decay = (score * config.decay_bps) / 10_000;
            score = score.saturating_sub(decay).max(config.rating_min);
            if score == config.rating_min {
                break;
            }
        }
        record.score = score;
        record.badge = Self::compute_badge(score);
        record.last_updated = record.last_updated + periods * DECAY_PERIOD_SECS;
        record
    }

    /// Upserts a reputation record for an address (admin only).
    pub fn set_reputation(env: Env, address: Address, score: u32) {
        let admin: Address = env
            .storage()
            .persistent()
            .get(&DataKey::Admin)
            .expect("Not initialized");
        admin.require_auth();

        let config: Config = env
            .storage()
            .persistent()
            .get(&DataKey::Config)
            .expect("Not initialized");

        if score < config.rating_min || score > config.rating_max {
            panic!("Score out of range");
        }

        let key = DataKey::Reputation(address.clone());
        let mut record: ReputationRecord = env
            .storage()
            .persistent()
            .get(&key)
            .unwrap_or(ReputationRecord {
                score: 0,
                interactions: 0,
                badge: Badge::Bronze,
                last_updated: 0,
            });

        record.score = score;
        record.interactions += 1;
        record.last_updated = env.ledger().timestamp();
        record.badge = Self::compute_badge(score);

        env.storage().persistent().set(&key, &record);
    }

    fn compute_badge(score: u32) -> Badge {
        if score >= 90 {
            Badge::Platinum
        } else if score >= 70 {
            Badge::Gold
        } else if score >= 40 {
            Badge::Silver
        } else {
            Badge::Bronze
        }
    }
}

mod test;
