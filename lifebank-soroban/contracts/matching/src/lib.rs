#![no_std]
#![deny(deprecated)]

mod error;
mod matching;
mod types;

#[cfg(test)]
mod test;

pub use error::MatchingError;
pub use matching::{
    compatible_donor_types, is_compatible, score_unit, select_units, sort_by_expiration,
};
pub use types::{
    BloodComponent, BloodRequest, BloodStatus, BloodType, BloodUnit, DataKey, MatchKind,
    MatchResult, MatchedUnit, RequestHistoryEntry, RequestStatus, Urgency,
};

use soroban_sdk::{contract, contractclient, contractevent, contractimpl, Address, Env, Vec};

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/// Maximum number of candidate blood units to consider in a single match.
/// Protects against O(n²) sorting and unbounded gas costs when inventory is large.
/// Threshold chosen to stay within per-transaction compute limits with safety margin.
const MAX_MATCH_CANDIDATES: usize = 500;

/// Maximum number of request IDs accepted by `match_multiple_requests`.
/// Enforces an explicit, graceful error instead of letting the transaction hit
/// the instruction limit with an opaque failure.
const MAX_BATCH_SIZE: u32 = 50;

/// Number of ledgers the instance storage TTL is extended by on every
/// entrypoint. Instance entries (`Admin`, `InventoryContract`,
/// `RequestsContract`, `Initialized`, `Paused`) would otherwise archive and
/// every subsequent call would fail with `NotInitialized`.
const INSTANCE_TTL_THRESHOLD: u32 = 100;
const INSTANCE_TTL_EXTEND_TO: u32 = 518_400; // ~30 days at 5s ledgers

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Paused {
    #[topic]
    pub admin: Address,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Unpaused {
    #[topic]
    pub admin: Address,
}

// ---------------------------------------------------------------------------
// Cross-contract client interfaces
// ---------------------------------------------------------------------------

/// Minimal interface we need from the inventory contract.
#[contractclient(name = "InventoryContractClient")]
pub trait InventoryContractInterface {
    fn get_blood_unit(env: Env, blood_unit_id: u64) -> BloodUnit;
    fn get_units_by_blood_type(env: Env, blood_type: BloodType) -> Vec<u64>;
}

/// Minimal interface we need from the requests contract.
#[contractclient(name = "RequestsContractClient")]
pub trait RequestsContractInterface {
    fn get_request(env: Env, request_id: u64) -> BloodRequest;
}

// ---------------------------------------------------------------------------
// Contract
// ---------------------------------------------------------------------------

const CONTRACT_VERSION: u32 = 1;

#[contract]
pub struct MatchingContract;

#[contractimpl]
impl MatchingContract {
    // ── Lifecycle ────────────────────────────────────────────────────────────

    pub fn initialize(
        env: Env,
        admin: Address,
        inventory_contract: Address,
        requests_contract: Address,
    ) -> Result<(), MatchingError> {
        Self::bump_instance_ttl(&env);
        admin.require_auth();

        if env.storage().instance().has(&DataKey::Initialized) {
            return Err(MatchingError::AlreadyInitialized);
        }

        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage()
            .instance()
            .set(&DataKey::InventoryContract, &inventory_contract);
        env.storage()
            .instance()
            .set(&DataKey::RequestsContract, &requests_contract);
        env.storage().instance().set(&DataKey::Initialized, &true);

        Ok(())
    }

    pub fn version(env: Env) -> u32 {
        Self::bump_instance_ttl(&env);
        CONTRACT_VERSION
    }

    /// Pause all state-mutating functions. Admin only.
    pub fn pause(env: Env, admin: Address) -> Result<(), MatchingError> {
        Self::bump_instance_ttl(&env);
        admin.require_auth();
        let stored: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(MatchingError::Unauthorized)?;
        if admin != stored {
            return Err(MatchingError::Unauthorized);
        }
        env.storage().instance().set(&DataKey::Paused, &true);
        Paused { admin }.publish(&env);
        Ok(())
    }

    /// Unpause the contract. Admin only.
    pub fn unpause(env: Env, admin: Address) -> Result<(), MatchingError> {
        Self::bump_instance_ttl(&env);
        admin.require_auth();
        let stored: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(MatchingError::Unauthorized)?;
        if admin != stored {
            return Err(MatchingError::Unauthorized);
        }
        env.storage().instance().set(&DataKey::Paused, &false);
        Unpaused { admin }.publish(&env);
        Ok(())
    }

    /// Returns whether the contract is currently paused.
    pub fn is_paused(env: Env) -> bool {
        Self::bump_instance_ttl(&env);
        env.storage()
            .instance()
            .get(&DataKey::Paused)
            .unwrap_or(false)
    }

    /// Extend the instance storage TTL so the contract's configuration
    /// entries never archive while the contract is in use.
    fn bump_instance_ttl(env: &Env) {
        env.storage()
            .instance()
            .extend_ttl(INSTANCE_TTL_THRESHOLD, INSTANCE_TTL_EXTEND_TO);
    }

    fn require_not_paused(env: &Env) -> Result<(), MatchingError> {
        if env
            .storage()
            .instance()
            .get(&DataKey::Paused)
            .unwrap_or(false)
        {
            return Err(MatchingError::ContractPaused);
        }
        Ok(())
    }

    // ── Core matching ────────────────────────────────────────────────────────

    /// Match a single blood request against available inventory.
    ///
    /// Algorithm:
    /// 1. Load the request from the requests contract.
    /// 2. Derive all compatible donor blood types (ABO/Rh matrix).
    /// 3. Fetch available units for each compatible type from inventory.
    /// 4. Run `select_units` which:
    ///    a. Filters to `Available` status only.
    ///    b. Prefers exact blood-type matches over compatible ones.
    ///    c. Within each tier, applies FIFO (oldest expiration first).
    ///    d. Supports partial matching — returns whatever is available.
    /// 5. Return a `MatchResult` with scores and partial-fulfillment flag.
    pub fn match_request(env: Env, request_id: u64) -> Result<MatchResult, MatchingError> {
        let excluded: Vec<u64> = Vec::new(&env);
        Self::match_request_excluding(&env, request_id, &excluded)
    }

    /// Match several blood requests in one call, allocating each unit at most
    /// once across the whole batch.
    ///
    /// Algorithm:
    /// 1. Reject batches larger than `MAX_BATCH_SIZE` with `BatchTooLarge`.
    /// 2. Load each request and sort by urgency
    ///    (Critical → Urgent → Routine → Scheduled), then by
    ///    `required_by_timestamp` (earliest first).
    /// 3. Match each request in that order via `match_request_excluding`,
    ///    passing the unit ids already selected earlier in the batch so they
    ///    cannot be double-allocated.
    /// 4. Requests that cannot be loaded or are not `Pending` are skipped
    ///    instead of aborting the whole batch.
    pub fn match_multiple_requests(
        env: Env,
        request_ids: Vec<u64>,
    ) -> Result<Vec<MatchResult>, MatchingError> {
        if request_ids.len() > MAX_BATCH_SIZE {
            return Err(MatchingError::BatchTooLarge);
        }

        Self::require_initialized(&env)?;
        Self::require_not_paused(&env)?;

        let req_addr: Address = env
            .storage()
            .instance()
            .get(&DataKey::RequestsContract)
            .unwrap();
        let req_client = RequestsContractClient::new(&env, &req_addr);

        // Load the requests we can, skipping invalid or non-Pending ones.
        let mut pending: Vec<BloodRequest> = Vec::new(&env);
        for i in 0..request_ids.len() {
            let request_id = request_ids.get(i).unwrap();
            if let Ok(Ok(request)) = req_client.try_get_request(&request_id) {
                if request.status == RequestStatus::Pending {
                    pending.push_back(request);
                }
            }
        }

        // Insertion sort by urgency, then required_by_timestamp (stable).
        let len = pending.len();
        for i in 1..len {
            let mut j = i;
            while j > 0 {
                let prev = pending.get(j - 1).unwrap();
                let cur = pending.get(j).unwrap();
                let prev_rank = urgency_rank(prev.urgency);
                let cur_rank = urgency_rank(cur.urgency);
                let out_of_order = cur_rank < prev_rank
                    || (cur_rank == prev_rank
                        && cur.required_by_timestamp < prev.required_by_timestamp);
                if !out_of_order {
                    break;
                }
                pending.set(j - 1, cur);
                pending.set(j, prev);
                j -= 1;
            }
        }

        let mut excluded: Vec<u64> = Vec::new(&env);
        let mut results: Vec<MatchResult> = Vec::new(&env);
        for i in 0..pending.len() {
            let request = pending.get(i).unwrap();
            if let Ok(result) = Self::match_request_excluding(&env, request.id, &excluded) {
                for k in 0..result.matched_units.len() {
                    let unit = result.matched_units.get(k).unwrap();
                    excluded.push_back(unit.blood_unit_id);
                }
                results.push_back(result);
            }
        }

        Ok(results)
    }

    /// Same matching algorithm as `match_request`, but drops any candidate
    /// unit whose id is present in `excluded`. Used by `match_multiple_requests`
    /// so units already assigned earlier in the same batch cannot be
    /// double-allocated to a later request in that batch.
    fn match_request_excluding(
        env: &Env,
        request_id: u64,
        excluded: &Vec<u64>,
    ) -> Result<MatchResult, MatchingError> {
        Self::bump_instance_ttl(env);
        Self::require_initialized(env)?;
        Self::require_not_paused(env)?;

        // Load request
        let req_addr: Address = env
            .storage()
            .instance()
            .get(&DataKey::RequestsContract)
            .unwrap();
        let req_client = RequestsContractClient::new(env, &req_addr);
        let request = req_client
            .try_get_request(&request_id)
            .map_err(|_| MatchingError::RequestNotFound)?
            .map_err(|_| MatchingError::RequestNotFound)?;

        if request.status != RequestStatus::Pending {
            return Err(MatchingError::InvalidRequest);
        }

        // Collect all candidate units across compatible blood types
        let inv_addr: Address = env
            .storage()
            .instance()
            .get(&DataKey::InventoryContract)
            .unwrap();
        let inv_client = InventoryContractClient::new(env, &inv_addr);

        let compatible_types = compatible_donor_types(env, request.blood_type);
        let now = env.ledger().timestamp();

        let mut candidates: Vec<BloodUnit> = Vec::new(env);
        for i in 0..compatible_types.len() {
            let bt = compatible_types.get(i).unwrap();
            let unit_ids = inv_client
                .try_get_units_by_blood_type(&bt)
                .unwrap_or(Ok(Vec::new(env)))
                .unwrap_or(Vec::new(env));

            for j in 0..unit_ids.len() {
                if candidates.len() >= MAX_MATCH_CANDIDATES.try_into().unwrap() {
                    break;
                }
                let uid = unit_ids.get(j).unwrap();
                if excluded.contains(uid) {
                    continue;
                }
                if let Ok(Ok(unit)) = inv_client.try_get_blood_unit(&uid) {
                    // Only usable units count toward the cap (#1457). The type
                    // index also holds Reserved/Delivered/Expired/... units;
                    // letting them fill the cap would hide Available units
                    if unit.status == BloodStatus::Available {
                        candidates.push_back(unit);
                    }
                }
            }
        }

        let selected = select_units(env, &candidates, request.blood_type, request.quantity_ml, now);

        let mut matched: Vec<MatchedUnit> = Vec::new(env);
        let mut total_ml: u32 = 0;
        for i in 0..selected.len() {
            let unit = selected.get(i).unwrap();
            total_ml = total_ml.saturating_add(unit.quantity_ml);
            matched.push_back(MatchedUnit {
                blood_unit_id: unit.id,
                blood_type: unit.blood_type,
                quantity_ml: unit.quantity_ml,
                score: score_unit(&unit, request.blood_type, now),
            });
        }

        Ok(MatchResult {
            request_id,
            matched_units: matched,
            total_matched_ml: total_ml,
            is_partial: total_ml < request.quantity_ml,
        })
    }

    fn require_initialized(env: &Env) -> Result<(), MatchingError> {
        if !env.storage().instance().has(&DataKey::Initialized) {
            return Err(MatchingError::NotInitialized);
        }
        Ok(())
    }
}

/// Ordering rank for batch matching: Critical → Urgent → Routine → Scheduled.
fn urgency_rank(urgency: Urgency) -> u32 {
    match urgency {
        Urgency::Critical => 0,
        Urgency::Urgent => 1,
        Urgency::Routine => 2,
        Urgency::Scheduled => 3,
    }
}
