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
    MatchResult, MatchedUnit, RequestStatus, Urgency,
};

use soroban_sdk::{contract, contractclient, contractimpl, Address, Env, Vec};

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

    pub fn version(_env: Env) -> u32 {
        CONTRACT_VERSION
    }

    /// Pause all state-mutating functions. Admin only.
    pub fn pause(env: Env, admin: Address) -> Result<(), MatchingError> {
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
        Ok(())
    }

    /// Unpause the contract. Admin only.
    pub fn unpause(env: Env, admin: Address) -> Result<(), MatchingError> {
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
        Ok(())
    }

    /// Returns whether the contract is currently paused.
    pub fn is_paused(env: Env) -> bool {
        env.storage()
            .instance()
            .get(&DataKey::Paused)
            .unwrap_or(false)
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

    /// Same matching algorithm as `match_request`, but drops any candidate
    /// unit whose id is present in `excluded`. Used by `match_multiple_requests`
    /// so units already assigned earlier in the same batch cannot be
    /// double-allocated to a later request in that batch.
    fn match_request_excluding(
        env: &Env,
        request_id: u64,
        excluded: &Vec<u64>,
    ) -> Result<MatchResult, MatchingError> {
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
                    candidates.push_back(unit);
                }
            }
            if candidates.len() >= MAX_MATCH_CANDIDATES.try_into().unwrap() {
                break;
            }
        }

        let now = env.ledger().timestamp();
        let matched = select_units(
            env,
            candidates,
            request.blood_type,
            request.urgency,
            request.quantity_ml,
            Some(&request.hospital_id),
            now,
        );

        let total_matched_ml: u32 = {
            let mut sum = 0u32;
            for i in 0..matched.len() {
                sum = sum.saturating_add(matched.get(i).unwrap().quantity_ml);
            }
            sum
        };
        let remaining_ml = request.quantity_ml.saturating_sub(total_matched_ml);
        let partial_fulfillment = total_matched_ml > 0 && remaining_ml > 0;

        Ok(MatchResult {
            request_id,
            matched_units: matched,
            total_matched_ml,
            remaining_ml,
            partial_fulfillment,
        })
    }

    /// Match multiple requests in urgency-priority order.
    ///
    /// Requests are sorted by urgency (Critical → Scheduled) before matching
    /// so that critical requests get first pick of available inventory.
    /// Within the same urgency level, requests with an earlier
    /// `required_by_timestamp` are processed first.
    ///
    /// Uses insertion sort — O(n²) worst-case but acceptable for batches up to
    /// `MAX_BATCH_SIZE`. Callers that exceed `MAX_BATCH_SIZE` receive
    /// `MatchingError::BatchTooLarge` rather than hitting the instruction limit.
    pub fn match_multiple_requests(
        env: Env,
        request_ids: Vec<u64>,
    ) -> Result<Vec<MatchResult>, MatchingError> {
        Self::require_initialized(&env)?;
        Self::require_not_paused(&env)?;

        if request_ids.len() > MAX_BATCH_SIZE {
            return Err(MatchingError::BatchTooLarge);
        }

        let req_addr: Address = env
            .storage()
            .instance()
            .get(&DataKey::RequestsContract)
            .unwrap();
        let req_client = RequestsContractClient::new(&env, &req_addr);

        // Load all requests in one pass, skipping any that cannot be loaded
        // or are no longer Pending rather than aborting the whole batch
        // (issue #1321). A single stale or missing request ID must not
        // discard results for every other valid request in the batch.
        let mut requests: Vec<BloodRequest> = Vec::new(&env);
        for i in 0..request_ids.len() {
            let rid = request_ids.get(i).unwrap();
            // Skip requests that don't exist or can't be loaded.
            let req = match req_client
                .try_get_request(&rid)
                .ok()
                .and_then(|r| r.ok())
            {
                Some(r) => r,
                None => continue,
            };
            // Skip requests that are no longer Pending (e.g. cancelled or
            // approved concurrently between submission and execution).
            if req.status != RequestStatus::Pending {
                continue;
            }
            requests.push_back(req);
        }

        // Insertion sort: O(n²) worst-case but O(n) for already-sorted input.
        // Batch sizes are bounded by the transaction instruction limit so n is small.
        let len = requests.len();
        for i in 1..len {
            let mut j = i;
            while j > 0 {
                let a = requests.get(j - 1).unwrap();
                let b = requests.get(j).unwrap();
                let a_pri = a.urgency.priority();
                let b_pri = b.urgency.priority();
                let swap = if a_pri != b_pri {
                    a_pri < b_pri
                } else {
                    a.required_by_timestamp > b.required_by_timestamp
                };
                if swap {
                    requests.set(j - 1, b);
                    requests.set(j, a);
                    j -= 1;
                } else {
                    break;
                }
            }
        }

        // Track units already assigned earlier in this batch so a later
        // request in the same call cannot be matched to the same unit as an
        // earlier one (each sub-match otherwise sees inventory as untouched).
        let mut assigned: Vec<u64> = Vec::new(&env);
        let mut results: Vec<MatchResult> = Vec::new(&env);
        for i in 0..requests.len() {
            let req = requests.get(i).unwrap();
            // Skip individual requests that fail to match (e.g. the request
            // transitioned away from Pending between the load pass above and
            // this execution pass) instead of aborting the entire batch.
            let result = match Self::match_request_excluding(&env, req.id, &assigned) {
                Ok(r) => r,
                Err(_) => continue,
            };
            for j in 0..result.matched_units.len() {
                assigned.push_back(result.matched_units.get(j).unwrap().unit_id);
            }
            results.push_back(result);
        }

        Ok(results)
    }

    // ── Query helpers ────────────────────────────────────────────────────────

    /// Return the ordered list of blood types that can donate to `recipient`.
    pub fn get_compatible_types(env: Env, recipient: BloodType) -> Vec<BloodType> {
        compatible_donor_types(&env, recipient)
    }

    /// Check whether `donor` can donate to `recipient`.
    pub fn check_compatibility(_env: Env, donor: BloodType, recipient: BloodType) -> bool {
        is_compatible(donor, recipient)
    }

    // ── Admin ────────────────────────────────────────────────────────────────

    pub fn get_admin(env: Env) -> Result<Address, MatchingError> {
        Self::require_initialized(&env)?;
        Ok(env.storage().instance().get(&DataKey::Admin).unwrap())
    }

    pub fn is_initialized(env: Env) -> bool {
        env.storage().instance().has(&DataKey::Initialized)
    }

    // ── Internal ─────────────────────────────────────────────────────────────

    fn require_initialized(env: &Env) -> Result<(), MatchingError> {
        if !env.storage().instance().has(&DataKey::Initialized) {
            return Err(MatchingError::NotInitialized);
        }
        Ok(())
    }
}
