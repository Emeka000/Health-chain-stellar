#![no_std]

mod error;
mod storage;
mod types;

use crate::error::ContractError;
use crate::types::{DataKey, ExcursionSummary, PendingThresholdChange, TemperatureReading, TemperatureSummary, TemperatureThreshold};
use soroban_sdk::{contract, contractclient, contractevent, contractimpl, Address, Env, Vec};

#[contractevent(topics = ["threshold", "proposed"], data_format = "vec")]
pub struct ThresholdProposed {
    pub unit_id: u64,
    pub min_celsius_x100: i32,
    pub max_celsius_x100: i32,
    pub effective_at: u64,
}

#[contractevent(topics = ["threshold", "applied"], data_format = "vec")]
pub struct ThresholdApplied {
    pub unit_id: u64,
    pub min_celsius_x100: i32,
    pub max_celsius_x100: i32,
}

#[contractevent(topics = ["oracle", "added"], data_format = "single-value")]
pub struct OracleAdded {
    pub oracle: Address,
}

#[contractevent(topics = ["oracle", "removed"], data_format = "single-value")]
pub struct OracleRemoved {
    pub oracle: Address,
}

#[contractevent(topics = ["tmp_excur"], data_format = "vec")]
pub struct ExcursionReported {
    pub unit_id: u64,
    pub payment_id: u64,
    pub violation_count: u32,
}

const PAGE_SIZE: u32 = 20;
/// TTL constants for persistent oracle approval entries (in ledgers; ~5 s each).
/// Entries are bumped whenever their remaining TTL falls below the threshold.
const ORACLE_BUMP_THRESHOLD: u32 = 518_400; // ~30 days
const ORACLE_BUMP_TO: u32 = 1_036_800;      // ~60 days

#[contract]
pub struct TemperatureContract;

/// Minimal coordinator interface for cross-contract excursion reporting.
#[contractclient(name = "CoordinatorContractClient")]
pub trait CoordinatorContractInterface {
    fn flag_temperature_breach(
        env: soroban_sdk::Env,
        caller: Address,
        payment_id: u64,
        excursion_summary: ExcursionSummary,
    ) -> Result<(), soroban_sdk::Error>;
}

#[contractimpl]
impl TemperatureContract {
    pub fn initialize(env: Env, admin: Address) -> Result<(), ContractError> {
        admin.require_auth();

        if env.storage().instance().has(&DataKey::Admin) {
            return Err(ContractError::AlreadyInitialized);
        }

        storage::set_admin(&env, &admin);
        Ok(())
    }

    /// Propose a threshold change with time-lock governance
    ///
    /// This function initiates a 7-day delay before the threshold can be applied.
    /// The delay provides transparency and allows stakeholders to review parameter changes.
    ///
    /// # Arguments
    /// * `admin` - Admin address proposing the change
    /// * `unit_id` - Blood unit ID for which to change the threshold
    /// * `min_celsius_x100` - New minimum temperature threshold
    /// * `max_celsius_x100` - New maximum temperature threshold
    ///
    /// # Errors
    /// - `Unauthorized`: Caller is not the admin
    /// - `InvalidThreshold`: Min >= Max
    pub fn propose_threshold_change(
        env: Env,
        admin: Address,
        unit_id: u64,
        min_celsius_x100: i32,
        max_celsius_x100: i32,
    ) -> Result<(), ContractError> {
        admin.require_auth();

    /// Pause all state-mutating functions. Admin only.
    pub fn pause(env: Env, admin: Address) -> Result<(), ContractError> {
        admin.require_auth();
        let stored_admin = storage::get_admin(&env);
        if admin != stored_admin {
            return Err(ContractError::Unauthorized);
        }

        if min_celsius_x100 >= max_celsius_x100 {
            return Err(ContractError::InvalidThreshold);
        }

        let effective_at = env.ledger().timestamp() + GOVERNANCE_DELAY_SECONDS;
        let pending_change = PendingThresholdChange {
            unit_id,
            new_min_celsius_x100: min_celsius_x100,
            new_max_celsius_x100: max_celsius_x100,
            effective_at,
            proposed_by: admin.clone(),
        };

        env.storage()
            .persistent()
            .set(&DataKey::PendingThresholdChange(unit_id), &pending_change);

        // Emit event for transparency
        ThresholdProposed {
            unit_id,
            min_celsius_x100,
            max_celsius_x100,
            effective_at,
        }
        .publish(&env);

        Ok(())
    }

    /// Apply a pending threshold change after the time-lock period
    ///
    /// Can be called by anyone once the delay period has passed.
    ///
    /// # Arguments
    /// * `unit_id` - Blood unit ID for which to apply the threshold change
    ///
    /// # Errors
    /// - `NoPendingChange`: No pending change exists for this unit
    /// - `ChangeNotReady`: Time-lock period has not elapsed yet
    pub fn apply_threshold_change(env: Env, unit_id: u64) -> Result<(), ContractError> {
        let pending_change: PendingThresholdChange = env
            .storage()
            .persistent()
            .get(&DataKey::PendingThresholdChange(unit_id))
            .ok_or(ContractError::NoPendingChange)?;

        let current_time = env.ledger().timestamp();
        if current_time < pending_change.effective_at {
            return Err(ContractError::ChangeNotReady);
        }

        // Apply the threshold change
        let threshold = TemperatureThreshold {
            min_celsius_x100: pending_change.new_min_celsius_x100,
            max_celsius_x100: pending_change.new_max_celsius_x100,
        };
        storage::set_threshold(&env, unit_id, &threshold);

        // Remove the pending change
        env.storage()
            .persistent()
            .remove(&DataKey::PendingThresholdChange(unit_id));

        // Emit event
        ThresholdApplied {
            unit_id,
            min_celsius_x100: threshold.min_celsius_x100,
            max_celsius_x100: threshold.max_celsius_x100,
        }
        .publish(&env);

        Ok(())
    }

    /// Get pending threshold change for a unit (if any)
    pub fn get_pending_threshold_change(
        env: Env,
        unit_id: u64,
    ) -> Option<PendingThresholdChange> {
        env.storage()
            .persistent()
            .get(&DataKey::PendingThresholdChange(unit_id))
    }

    /// Set threshold immediately (legacy method - kept for backward compatibility)
    ///
    /// WARNING: This bypasses governance. Consider using propose_threshold_change instead.
        env.storage().instance().set(&DataKey::Paused, &true);
        Ok(())
    }

    /// Unpause the contract. Admin only.
    pub fn unpause(env: Env, admin: Address) -> Result<(), ContractError> {
        admin.require_auth();
        let stored_admin = storage::get_admin(&env);
        if admin != stored_admin {
            return Err(ContractError::Unauthorized);
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

    fn require_not_paused(env: &Env) -> Result<(), ContractError> {
        if env
            .storage()
            .instance()
            .get(&DataKey::Paused)
            .unwrap_or(false)
        {
            return Err(ContractError::ContractPaused);
        }
        Ok(())
    }

    pub fn set_threshold(
        env: Env,
        admin: Address,
        unit_id: u64,
        min_celsius_x100: i32,
        max_celsius_x100: i32,
    ) -> Result<(), ContractError> {
        admin.require_auth();
        Self::require_not_paused(&env)?;

        let stored_admin = storage::get_admin(&env);
        if admin != stored_admin {
            return Err(ContractError::Unauthorized);
        }

        if min_celsius_x100 >= max_celsius_x100 {
            return Err(ContractError::InvalidThreshold);
        }

        let threshold = TemperatureThreshold {
            min_celsius_x100,
            max_celsius_x100,
        };
        storage::set_threshold(&env, unit_id, &threshold);
        Ok(())
    }

    pub fn log_reading(
        env: Env,
        oracle: Address,
        unit_id: u64,
        temperature_celsius_x100: i32,
    ) -> Result<(), ContractError> {
        oracle.require_auth();
        Self::require_not_paused(&env)?;

        // Gate: caller must be admin or a whitelisted oracle.
        let stored_admin = storage::get_admin(&env);
        let is_admin = oracle == stored_admin;
        let is_approved: bool = env
            .storage()
            .persistent()
            .get(&DataKey::OracleApproved(oracle.clone()))
            .unwrap_or(false);

        if !is_admin && !is_approved {
            return Err(ContractError::OracleNotWhitelisted);
        }

        // Bump the oracle entry TTL on every successful read so active oracles
        // never expire while they are still submitting readings.
        if is_approved {
            let key = DataKey::OracleApproved(oracle.clone());
            env.storage()
                .persistent()
                .extend_ttl(&key, ORACLE_BUMP_THRESHOLD, ORACLE_BUMP_TO);
        }

        let threshold =
            storage::get_threshold(&env, unit_id).ok_or(ContractError::ThresholdNotFound)?;

        let is_violation =
            temperature_celsius_x100 < threshold.min_celsius_x100
                || temperature_celsius_x100 > threshold.max_celsius_x100;

        let timestamp = env.ledger().timestamp();
        let reading = TemperatureReading {
            temperature_celsius_x100,
            timestamp,
            is_violation,
        };

        // Update consecutive violation streak
        let streak_key = DataKey::ConsecutiveViolationStreak(unit_id);
        let current_streak: u32 = env.storage().persistent().get(&streak_key).unwrap_or(0);
        
        let new_streak = if is_violation {
            current_streak.saturating_add(1)
        } else {
            0 // Reset streak on non-violation
        };
        
        env.storage().persistent().set(&streak_key, &new_streak);
        
        // Check if unit should be compromised (3 consecutive violations)
        if new_streak >= 3 {
            let compromised_key = DataKey::IsCompromised(unit_id);
            env.storage().persistent().set(&compromised_key, &true);
        }

        let mut page_num: u32 = 0;
        let position: u32;

        loop {
            let len = storage::get_temp_page_len(&env, unit_id, page_num);
            if len == 0 && page_num > 0 {
                position = 0;
                break;
            }
            if len < PAGE_SIZE {
                position = len;
                break;
            }
            page_num = page_num.saturating_add(1); // Prevent overflow
        }

        let mut page = storage::get_temp_page(&env, unit_id, page_num);

        while page.len() < position {
            page.push_back(TemperatureReading::default());
        }

        if page.len() == position {
            page.push_back(reading);
        } else {
            page.set(position, reading);
        }

        storage::set_temp_page(&env, unit_id, page_num, &page);
        storage::set_temp_page_len(&env, unit_id, page_num, position.saturating_add(1)); // Prevent overflow

        Ok(())
    }

    pub fn get_violations(env: Env, unit_id: u64, page: u32, page_size: u32) -> Result<Vec<TemperatureReading>, ContractError> {
        let page_size = page_size.min(100);
        let mut violations = Vec::new(&env);
        let mut collected = 0u32;
        let mut seen = 0u32;
        let skip = page.saturating_mul(page_size);

        let mut page_num: u32 = 0;

        loop {
            let page_len = storage::get_temp_page_len(&env, unit_id, page_num);
            if page_len == 0 && page_num > 0 {
                break;
            }
            if page_len == 0 {
                page_num = page_num.saturating_add(1);
                continue;
            }

            let page_data = storage::get_temp_page(&env, unit_id, page_num);
            for i in 0..page_len {
                let reading = page_data.get(i).unwrap_or_default();
                if reading.is_violation {
                    if seen >= skip && collected < page_size {
                        violations.push_back(reading);
                        collected = collected.saturating_add(1);
                    }
                    seen = seen.saturating_add(1);
                    if collected >= page_size {
                        return Ok(violations);
                    }
                }
            }

            page_num = page_num.saturating_add(1);
        }

        Ok(violations)
    }

    /// Get all temperature readings for a blood unit (paginated)
    pub fn get_readings(env: Env, unit_id: u64, page: u32, page_size: u32) -> Result<Vec<TemperatureReading>, ContractError> {
        let page_size = page_size.min(100);
        let mut all_readings = Vec::new(&env);
        let mut collected = 0u32;
        let mut seen = 0u32;
        let skip = page.saturating_mul(page_size);

        let mut page_num: u32 = 0;
        loop {
            let page_len = storage::get_temp_page_len(&env, unit_id, page_num);

            if page_len == 0 && page_num > 0 {
                break;
            }

            if page_len == 0 {
                page_num = page_num.saturating_add(1);
                continue;
            }

            let page_data = storage::get_temp_page(&env, unit_id, page_num);

            for i in 0..page_len {
                let reading = page_data.get(i).unwrap_or_default();
                if seen >= skip && collected < page_size {
                    all_readings.push_back(reading);
                    collected = collected.saturating_add(1);
                }
                seen = seen.saturating_add(1);
                if collected >= page_size {
                    return Ok(all_readings);
                }
            }

            page_num = page_num.saturating_add(1);
        }

        Ok(all_readings)
    }

    /// Get temperature summary statistics for a blood unit
    /// Uses i64 accumulator to prevent overflow with large datasets
    pub fn get_temperature_summary(env: Env, unit_id: u64) -> Result<TemperatureSummary, ContractError> {
        let mut count: u32 = 0;
        let mut sum: i64 = 0; // Use i64 to prevent overflow
        let mut min_temp: i32 = i32::MAX;
        let mut max_temp: i32 = i32::MIN;
        let mut violation_count: u32 = 0;

        let mut page_num: u32 = 0;
        loop {
            let page_len = storage::get_temp_page_len(&env, unit_id, page_num);

            if page_len == 0 && page_num > 0 {
                break;
            }

            if page_len == 0 {
                page_num = page_num.saturating_add(1); // Prevent overflow
                continue;
            }

            let page = storage::get_temp_page(&env, unit_id, page_num);

            for i in 0..page_len {
                let reading = page.get(i).unwrap_or_default();
                
                // Use i64 for accumulation to prevent overflow
                sum += reading.temperature_celsius_x100 as i64;
                count = count.saturating_add(1); // Prevent overflow

                if reading.temperature_celsius_x100 < min_temp {
                    min_temp = reading.temperature_celsius_x100;
                }
                if reading.temperature_celsius_x100 > max_temp {
                    max_temp = reading.temperature_celsius_x100;
                }
                if reading.is_violation {
                    violation_count = violation_count.saturating_add(1); // Prevent overflow
                }
            }

            page_num = page_num.saturating_add(1); // Prevent overflow
        }

        if count == 0 {
            return Err(ContractError::UnitNotFound);
        }

        // Safe to cast back to i32 after division since individual readings fit in i32
        let avg_celsius_x100 = (sum / count as i64) as i32;

        Ok(TemperatureSummary {
            count,
            avg_celsius_x100,
            min_celsius_x100: min_temp,
            max_celsius_x100: max_temp,
            violation_count,
        })
    }

    /// Get the current consecutive violation streak for a blood unit
    ///
    /// # Arguments
    /// * `unit_id` - The blood unit to check
    ///
    /// # Returns
    /// Current consecutive violation count
    pub fn get_consecutive_violation_streak(env: Env, unit_id: u64) -> u32 {
        let streak_key = DataKey::ConsecutiveViolationStreak(unit_id);
        env.storage().persistent().get(&streak_key).unwrap_or(0)
    }

    /// Check if a blood unit has been compromised due to consecutive violations
    ///
    /// # Arguments
    /// * `unit_id` - The blood unit to check
    ///
    /// # Returns
    /// `true` if unit has 3 or more consecutive violations (compromised), `false` otherwise
    pub fn is_compromised(env: Env, unit_id: u64) -> bool {
        let compromised_key = DataKey::IsCompromised(unit_id);
        env.storage().persistent().get(&compromised_key).unwrap_or(false)
    }

    /// Reset the compromised status and violation streak for a blood unit (admin only)
    ///
    /// # Arguments
    /// * `admin` - Admin address performing the reset
    /// * `unit_id` - The blood unit to reset
    ///
    /// # Errors
    /// - `Unauthorized`: Caller is not the admin
    pub fn reset_compromised_status(
        env: Env,
        admin: Address,
        unit_id: u64,
    ) -> Result<(), ContractError> {
        admin.require_auth();
        Self::require_not_paused(&env)?;

        let stored_admin = storage::get_admin(&env);
        if admin != stored_admin {
            return Err(ContractError::Unauthorized);
        }

        let streak_key = DataKey::ConsecutiveViolationStreak(unit_id);
        let compromised_key = DataKey::IsCompromised(unit_id);

        env.storage().persistent().set(&streak_key, &0u32);
        env.storage().persistent().set(&compromised_key, &false);

        env.events().publish(
            (symbol_short!("temp"), symbol_short!("reset")),
            unit_id,
        );

        Ok(())
    }

    // ── Coordinator integration ────────────────────────────────────────────────

    /// Configure the coordinator contract address. Admin only.
    pub fn set_coordinator(
        env: Env,
        admin: Address,
        coordinator: Address,
    ) -> Result<(), ContractError> {
        admin.require_auth();
        let stored_admin = storage::get_admin(&env);
        if admin != stored_admin {
            return Err(ContractError::Unauthorized);
        }
        env.storage()
            .instance()
            .set(&DataKey::CoordinatorContract, &coordinator);
        Ok(())
    }

    /// Whitelist an IoT oracle address that may call log_reading and
    /// report_excursion_to_coordinator.
    ///
    /// Each oracle is stored as an independent persistent() entry:
    ///   `DataKey::OracleApproved(oracle_address)` → `bool`
    ///
    /// This design scales to an unlimited number of IoT sensor addresses
    /// (one per blood transport vehicle, cold-storage unit, or field sensor)
    /// without growing instance storage or impacting unrelated contract calls.
    /// Membership checks are O(1) regardless of whitelist size.
    pub fn add_oracle(
        env: Env,
        admin: Address,
        oracle: Address,
    ) -> Result<(), ContractError> {
        admin.require_auth();
        let stored_admin = storage::get_admin(&env);
        if admin != stored_admin {
            return Err(ContractError::Unauthorized);
        }
        let key = DataKey::OracleApproved(oracle.clone());
        env.storage().persistent().set(&key, &true);
        env.storage()
            .persistent()
            .extend_ttl(&key, ORACLE_BUMP_THRESHOLD, ORACLE_BUMP_TO);
        OracleAdded { oracle }.publish(&env);
        Ok(())
    }

    /// Remove an IoT oracle from the whitelist, preventing it from submitting
    /// further temperature readings or excursion reports.
    ///
    /// Use this for oracle rotation (replacing a compromised sensor) or
    /// temporary suspension (taking a sensor offline for maintenance).
    ///
    /// # Arguments
    /// * `admin`  - Admin address performing the removal
    /// * `oracle` - Oracle address to de-whitelist
    ///
    /// # Errors
    /// - `Unauthorized` - Caller is not the admin
    pub fn remove_oracle(
        env: Env,
        admin: Address,
        oracle: Address,
    ) -> Result<(), ContractError> {
        admin.require_auth();
        let stored_admin = storage::get_admin(&env);
        if admin != stored_admin {
            return Err(ContractError::Unauthorized);
        }
        let key = DataKey::OracleApproved(oracle.clone());
        env.storage().persistent().remove(&key);
        OracleRemoved { oracle }.publish(&env);
        Ok(())
    }

    /// Check whether an address is currently an approved oracle.
    ///
    /// Returns `true` if the address has been added via `add_oracle` and not
    /// subsequently removed. The admin address always passes this check.
    ///
    /// O(1) — reads a single persistent() entry regardless of whitelist size.
    pub fn is_oracle(env: Env, address: Address) -> bool {
        let stored_admin = storage::get_admin(&env);
        if address == stored_admin {
            return true;
        }
        env.storage()
            .persistent()
            .get(&DataKey::OracleApproved(address))
            .unwrap_or(false)
    }

    /// Report a sustained temperature excursion to the coordinator contract,
    /// which will transition the linked payment from Locked → Disputed.
    ///
    /// Only the admin or a whitelisted IoT oracle may call this function.
    ///
    /// # Arguments
    /// * `caller`            - Admin or whitelisted oracle address
    /// * `unit_id`           - Blood unit that experienced the excursion
    /// * `payment_id`        - Payment ID to flag in the coordinator
    /// * `excursion_summary` - Structured summary of the excursion
    ///
    /// # Errors
    /// - `Unauthorized`          - Caller is not admin or whitelisted oracle
    /// - `CoordinatorNotSet`     - Coordinator address not configured
    /// - `CoordinatorCallFailed` - Cross-contract call to coordinator failed
    pub fn report_excursion_to_coordinator(
        env: Env,
        caller: Address,
        unit_id: u64,
        payment_id: u64,
        excursion_summary: ExcursionSummary,
    ) -> Result<(), ContractError> {
        caller.require_auth();
        Self::require_not_paused(&env)?;

        // Gate: caller must be admin or whitelisted oracle
        let stored_admin = storage::get_admin(&env);
        let is_admin = caller == stored_admin;
        let is_oracle: bool = env
            .storage()
            .persistent()
            .get(&DataKey::OracleApproved(caller.clone()))
            .unwrap_or(false);

        if !is_admin && !is_oracle {
            return Err(ContractError::Unauthorized);
        }

        // Verify unit has recorded violations before reporting
        let violations = Self::get_violations(env.clone(), unit_id, 0, 1)?;
        if violations.is_empty() {
            return Err(ContractError::UnitNotFound);
        }

        let coordinator_addr: Address = env
            .storage()
            .instance()
            .get(&DataKey::CoordinatorContract)
            .ok_or(ContractError::CoordinatorNotSet)?;

        let coord_client = CoordinatorContractClient::new(&env, &coordinator_addr);
        coord_client
            .try_flag_temperature_breach(&caller, &payment_id, &excursion_summary)
            .map_err(|_| ContractError::CoordinatorCallFailed)?
            .map_err(|_| ContractError::CoordinatorCallFailed)?;

        ExcursionReported {
            unit_id,
            payment_id,
            violation_count: excursion_summary.violation_count,
        }
        .publish(&env);

        Ok(())
    }

    /// Upgrade the contract to a new WASM hash. Only admin can call this.
    ///
    /// # Arguments
    /// * `admin` - Admin address that must authorize the upgrade
    /// * `new_wasm_hash` - Hash of the new WASM code to upgrade to
    ///
    /// # Errors
    /// * `Unauthorized` - If caller is not the admin
    pub fn upgrade(env: Env, admin: Address, new_wasm_hash: soroban_sdk::BytesN<32>) -> Result<(), ContractError> {
        admin.require_auth();
        let stored_admin = storage::get_admin(&env);
        if admin != stored_admin {
            return Err(ContractError::Unauthorized);
        }
        env.deployer().update_current_contract_wasm(new_wasm_hash);
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use soroban_sdk::testutils::Address as _;

    fn create_test_contract<'a>() -> (Env, Address, Address, TemperatureContractClient<'a>) {
        let env = Env::default();
        env.mock_all_auths();

        let contract_id = env.register(TemperatureContract, ());
        let client = TemperatureContractClient::new(&env, &contract_id);

        let admin = Address::generate(&env);
        client.initialize(&admin);

        // Register a default oracle for use in tests.
        // All tests use mock_all_auths() so the oracle address just needs to
        // be passed through — no real signing is required in the test environment.
        let oracle = Address::generate(&env);
        client.add_oracle(&admin, &oracle);

        (env, admin, oracle, client)
    }

    #[test]
    fn test_zero_padded_entries_not_returned_as_violations() {
        let (_env, admin, oracle, client) = create_test_contract();

        let unit_id = 42u64;
        // Set threshold: min = 200 (2.00°C), max = 600 (6.00°C)
        client.set_threshold(&admin, &unit_id, &200, &600);

        // Log exactly 21 readings (one more than page size of 20)
        for i in 0..21u64 {
            let temp = 400 + (i % 3) as i32; // Vary between 400-402 (all within range)
            client.log_reading(&oracle, &unit_id, &temp);
        }

        // Get violations
        let violations = client.get_violations(&unit_id, &0u32, &100u32);

        // Should have zero violations since all logged readings are within threshold
        assert_eq!(violations.len(), 0, "Expected no violations but got {}", violations.len());
    }

    #[test]
    fn test_page_size_plus_one_with_violation_in_second_page() {
        let (_env, admin, oracle, client) = create_test_contract();

        let unit_id = 43u64;
        // Set threshold: min = 200 (2.00°C), max = 600 (6.00°C)
        client.set_threshold(&admin, &unit_id, &200, &600);

        // Log exactly 21 readings
        // First 20 readings: all within range
        for i in 0..20u64 {
            let temp = 400 + (i % 3) as i32; // Within 200-600 range
            client.log_reading(&oracle, &unit_id, &temp);
        }

        // 21st reading: a violation (too cold)
        client.log_reading(&oracle, &unit_id, &100);

        // Get violations
        let violations = client.get_violations(&unit_id, &0u32, &100u32);

        // Should have exactly 1 violation
        assert_eq!(violations.len(), 1, "Expected 1 violation but got {}", violations.len());
        assert_eq!(violations.get(0).unwrap().temperature_celsius_x100, 100);
    }

    #[test]
    fn test_multiple_pages_correct_violation_count() {
        let (_env, admin, oracle, client) = create_test_contract();

        let unit_id = 44u64;
        // Set threshold: min = 200, max = 600
        client.set_threshold(&admin, &unit_id, &200, &600);

        // Log 50 readings across multiple pages
        let mut expected_violations = 0;
        for i in 0..50u64 {
            let temp = if i % 10 == 9 {
                // Every 10th reading is a violation (too hot)
                expected_violations += 1;
                700
            } else {
                400 // Within range
            };
            client.log_reading(&oracle, &unit_id, &temp);
        }

        // Get violations
        let violations = client.get_violations(&unit_id, &0u32, &100u32);

        // Should have exactly 5 violations (indices 9, 19, 29, 39, 49)
        assert_eq!(
            violations.len() as u64,
            expected_violations,
            "Expected {} violations but got {}",
            expected_violations,
            violations.len()
        );

        // Verify all returned readings are violations
        for violation in violations.iter() {
            let reading = violation;
            assert!(
                reading.is_violation,
                "Returned reading should be marked as violation"
            );
            assert!(
                reading.temperature_celsius_x100 < 200 || reading.temperature_celsius_x100 > 600,
                "Returned reading should actually violate threshold"
            );
        }
    }

    #[test]
    fn test_get_all_readings_ignores_padding() {
        let (_env, admin, oracle, client) = create_test_contract();

        let unit_id = 45u64;
        // Set threshold: min = 200, max = 600
        client.set_threshold(&admin, &unit_id, &200, &600);

        // Log exactly 21 readings
        for i in 0..21u64 {
            let temp = 400 + (i % 3) as i32;
            client.log_reading(&oracle, &unit_id, &temp);
        }

        // Get all readings
        let readings = client.get_readings(&unit_id, &0u32, &100u32);

        // Should have exactly 21 readings, not 40 (2 pages)
        assert_eq!(
            readings.len(),
            21,
            "Expected 21 readings but got {}",
            readings.len()
        );

        // Verify none are zero-padded (all should have valid timestamps)
        for reading in readings.iter() {
            assert!(
                reading.timestamp >= 1000 && reading.timestamp < 1021,
                "Reading should have valid timestamp from actual log"
            );
        }
    }

    #[test]
    fn test_threshold_violation_detection_with_zero_temp() {
        let (_env, admin, oracle, client) = create_test_contract();

        let unit_id = 46u64;
        // Set threshold: min = 200, max = 600
        client.set_threshold(&admin, &unit_id, &200, &600);

        // Log exactly 21 readings (21st will be in second page with padding)
        for i in 0..21u64 {
            let temp = 400;
            client.log_reading(&oracle, &unit_id, &temp);
        }

        // Verify the second page still exists but has no padding pollution
        let violations = client.get_violations(&unit_id);
        assert_eq!(violations.len(), 0, "No readings should be violations");

        let all_readings = client.get_readings(&unit_id);
        assert_eq!(all_readings.len(), 21, "Should have exactly 21 readings");

        // Verify the 21st reading is not a default/zero-padded entry
        let last_reading = all_readings.get(20).unwrap();
        assert_eq!(last_reading.temperature_celsius_x100, 400, "21st reading should be valid");
        assert_eq!(last_reading.timestamp, 1020, "21st reading should have correct timestamp");
    }

    #[test]
    fn test_temperature_summary_basic() {
        let (_env, admin, oracle, client) = create_test_contract();

        let unit_id = 100u64;
        client.set_threshold(&admin, &unit_id, &200, &600);

        // Log 10 readings: 5 at 400°C, 5 at 500°C
        // Average should be 450°C
        for i in 0..10u64 {
            let temp = if i < 5 { 400 } else { 500 };
            client.log_reading(&oracle, &unit_id, &temp);
        }

        let summary = client.get_temperature_summary(&unit_id);
        assert_eq!(summary.count, 10);
        assert_eq!(summary.avg_celsius_x100, 450);
        assert_eq!(summary.min_celsius_x100, 400);
        assert_eq!(summary.max_celsius_x100, 500);
        assert_eq!(summary.violation_count, 0);
    }

    #[test]
    fn test_temperature_summary_with_violations() {
        let (_env, admin, oracle, client) = create_test_contract();

        let unit_id = 101u64;
        client.set_threshold(&admin, &unit_id, &200, &600);

        // Log readings with some violations
        client.log_reading(&oracle, &unit_id, &100); // violation (too cold)
        client.log_reading(&oracle, &unit_id, &400); // ok
        client.log_reading(&oracle, &unit_id, &700); // violation (too hot)
        client.log_reading(&oracle, &unit_id, &500); // ok

        let summary = client.get_temperature_summary(&unit_id);
        assert_eq!(summary.count, 4);
        assert_eq!(summary.avg_celsius_x100, 425); // (100 + 400 + 700 + 500) / 4
        assert_eq!(summary.min_celsius_x100, 100);
        assert_eq!(summary.max_celsius_x100, 700);
        assert_eq!(summary.violation_count, 2);
    }

    #[test]
    fn test_temperature_summary_large_dataset_no_overflow() {
        let (_env, admin, oracle, client) = create_test_contract();

        let unit_id = 102u64;
        client.set_threshold(&admin, &unit_id, &0, &60_000_000);

        // Keep this small enough for CI while still proving the accumulator
        // must be wider than i32: 30,000,000 * 100 = 3,000,000,000.
        let test_temp = 30_000_000i32;
        let num_readings = 100u64;

        for i in 0..num_readings {
            client.log_reading(&oracle, &unit_id, &test_temp);
        }

        let summary = client.get_temperature_summary(&unit_id);
        
        // Verify correct count
        assert_eq!(summary.count, num_readings as u32, "Count should be 100");
        
        // Verify average is correct (should be exactly 450)
        assert_eq!(
            summary.avg_celsius_x100, 
            test_temp,
            "Average should be {} but got {}", 
            test_temp, 
            summary.avg_celsius_x100
        );
        
        // Verify min/max are correct
        assert_eq!(summary.min_celsius_x100, test_temp);
        assert_eq!(summary.max_celsius_x100, test_temp);
        assert_eq!(summary.violation_count, 0);
    }

    #[test]
    fn test_temperature_summary_extreme_values() {
        let (_env, admin, oracle, client) = create_test_contract();

        let unit_id = 103u64;
        client.set_threshold(&admin, &unit_id, &-5000, &5000);

        // Test with extreme temperature values
        client.log_reading(&oracle, &unit_id, &-4000);
        client.log_reading(&oracle, &unit_id, &4000);
        client.log_reading(&oracle, &unit_id, &0);

        let summary = client.get_temperature_summary(&unit_id);
        assert_eq!(summary.count, 3);
        assert_eq!(summary.avg_celsius_x100, 0); // (-4000 + 4000 + 0) / 3 = 0
        assert_eq!(summary.min_celsius_x100, -4000);
        assert_eq!(summary.max_celsius_x100, 4000);
    }

    #[test]
    fn test_temperature_summary_multiple_pages() {
        let (_env, admin, oracle, client) = create_test_contract();

        let unit_id = 104u64;
        client.set_threshold(&admin, &unit_id, &200, &600);

        // Log 100 readings across multiple pages (PAGE_SIZE = 20)
        // This will span 5 pages
        for i in 0..100u64 {
            let temp = 300 + (i % 10) as i32; // Vary between 300-309
            client.log_reading(&oracle, &unit_id, &temp);
        }

        let summary = client.get_temperature_summary(&unit_id);
        assert_eq!(summary.count, 100);
        
        // Average should be 304 (sum of 300-309 repeated 10 times / 100)
        // (300+301+302+303+304+305+306+307+308+309) * 10 / 100 = 3045 / 10 = 304.5 -> 304
        assert_eq!(summary.avg_celsius_x100, 304);
        assert_eq!(summary.min_celsius_x100, 300);
        assert_eq!(summary.max_celsius_x100, 309);
    }

    #[test]
    #[should_panic(expected = "Error(Contract, #601)")]
    fn test_temperature_summary_no_readings() {
        let (_env, admin, _oracle, client) = create_test_contract();

        let unit_id = 105u64;
        client.set_threshold(&admin, &unit_id, &200, &600);

        // Don't log any readings
        client.get_temperature_summary(&unit_id);
    }

    // ============================================================================
    // Consecutive Violation Streak Tests
    // ============================================================================

    /// Test 1: Streak reset on non-violation
    /// 2 violations → 1 normal → 2 violations → assert streak is 2 (not 4) and unit is not Compromised
    #[test]
    fn test_streak_reset_on_non_violation() {
        let (_env, admin, oracle, client) = create_test_contract();

        let unit_id = 200u64;
        client.set_threshold(&admin, &unit_id, &200, &600);

        // Log 2 violations
        client.log_reading(&oracle, &unit_id, &100); // violation 1
        client.log_reading(&oracle, &unit_id, &100); // violation 2

        // Check streak is 2
        assert_eq!(client.get_consecutive_violation_streak(&unit_id), 2);
        assert!(!client.is_compromised(&unit_id));

        // Log 1 normal reading (resets streak)
        client.log_reading(&oracle, &unit_id, &400); // normal

        // Check streak was reset to 0
        assert_eq!(client.get_consecutive_violation_streak(&unit_id), 0);

        // Log 2 more violations
        client.log_reading(&oracle, &unit_id, &100); // violation 1
        client.log_reading(&oracle, &unit_id, &100); // violation 2

        // Streak should be 2, not 4 (it was reset)
        assert_eq!(client.get_consecutive_violation_streak(&unit_id), 2);
        assert!(!client.is_compromised(&unit_id), "Unit should NOT be compromised with only 2 consecutive violations");
    }

    /// Test 2: Exact threshold - exactly 3 consecutive violations → assert Compromised triggered
    #[test]
    fn test_exact_threshold_triggers_compromised() {
        let (_env, admin, oracle, client) = create_test_contract();

        let unit_id = 201u64;
        client.set_threshold(&admin, &unit_id, &200, &600);

        // Log exactly 3 consecutive violations
        client.log_reading(&oracle, &unit_id, &100); // violation 1
        assert_eq!(client.get_consecutive_violation_streak(&unit_id), 1);
        assert!(!client.is_compromised(&unit_id));

        client.log_reading(&oracle, &unit_id, &100); // violation 2
        assert_eq!(client.get_consecutive_violation_streak(&unit_id), 2);
        assert!(!client.is_compromised(&unit_id));

        client.log_reading(&oracle, &unit_id, &100); // violation 3
        assert_eq!(client.get_consecutive_violation_streak(&unit_id), 3);
        assert!(client.is_compromised(&unit_id), "Unit should be compromised after 3 consecutive violations");
    }

    /// Test 3: Threshold not met
    /// 2 consecutive → 1 normal → 2 consecutive → assert not Compromised
    #[test]
    fn test_threshold_not_met_not_compromised() {
        let (_env, admin, oracle, client) = create_test_contract();

        let unit_id = 202u64;
        client.set_threshold(&admin, &unit_id, &200, &600);

        // Log 2 consecutive violations
        client.log_reading(&oracle, &unit_id, &100);
        client.log_reading(&oracle, &unit_id, &100);
        assert_eq!(client.get_consecutive_violation_streak(&unit_id), 2);

        // Log 1 normal reading
        client.log_reading(&oracle, &unit_id, &400);
        assert_eq!(client.get_consecutive_violation_streak(&unit_id), 0);

        // Log 2 more consecutive violations
        client.log_reading(&oracle, &unit_id, &100);
        client.log_reading(&oracle, &unit_id, &100);
        assert_eq!(client.get_consecutive_violation_streak(&unit_id), 2);

        // Should NOT be compromised
        assert!(!client.is_compromised(&unit_id), "Unit should NOT be compromised - never reached 3 consecutive");
    }

    /// Test 4: Streak after recovery
    /// unit is Compromised → admin resets → 2 new violations → assert not Compromised again yet
    #[test]
    fn test_streak_after_recovery() {
        let (_env, admin, oracle, client) = create_test_contract();

        let unit_id = 203u64;
        client.set_threshold(&admin, &unit_id, &200, &600);

        // Trigger compromised status with 3 violations
        client.log_reading(&oracle, &unit_id, &100);
        client.log_reading(&oracle, &unit_id, &100);
        client.log_reading(&oracle, &unit_id, &100);
        assert!(client.is_compromised(&unit_id));
        assert_eq!(client.get_consecutive_violation_streak(&unit_id), 3);

        // Admin resets the status
        client.reset_compromised_status(&admin, &unit_id);
        assert!(!client.is_compromised(&unit_id), "Should be reset after admin intervention");
        assert_eq!(client.get_consecutive_violation_streak(&unit_id), 0, "Streak should be reset to 0");

        // Log 2 new violations
        client.log_reading(&oracle, &unit_id, &100);
        client.log_reading(&oracle, &unit_id, &100);
        assert_eq!(client.get_consecutive_violation_streak(&unit_id), 2);

        // Should NOT be compromised again yet (only 2 violations)
        assert!(!client.is_compromised(&unit_id), "Should not be compromised again with only 2 new violations");
    }

    /// Test 5: Single-reading unit
    /// 1 violation → assert streak is 1, not Compromised
    #[test]
    fn test_single_reading_unit() {
        let (_env, admin, oracle, client) = create_test_contract();

        let unit_id = 204u64;
        client.set_threshold(&admin, &unit_id, &200, &600);

        // Log single violation
        client.log_reading(&oracle, &unit_id, &100);

        // Check streak is 1
        assert_eq!(client.get_consecutive_violation_streak(&unit_id), 1, "Streak should be 1 after single violation");

        // Should NOT be compromised
        assert!(!client.is_compromised(&unit_id), "Single violation should not compromise unit");
    }

    /// Test 6: Interleaved violations across custody transfers
    /// violations logged by different custodians → streak is continuous across custodian changes
    /// 
    /// Note: This test demonstrates that the streak tracking is based on the blood unit itself,
    /// not on who logs the reading. The custody transfer is simulated conceptually - in practice,
    /// any authorized party can log temperature readings, and the streak counter persists.
    #[test]
    fn test_interleaved_violations_across_custody_transfers() {
        let (_env, admin, oracle, client) = create_test_contract();

        let unit_id = 205u64;
        client.set_threshold(&admin, &unit_id, &200, &600);

        // Custodian A logs violations (e.g., during initial storage)
        client.log_reading(&oracle, &unit_id, &100); // violation 1
        client.log_reading(&oracle, &unit_id, &100); // violation 2
        assert_eq!(client.get_consecutive_violation_streak(&unit_id), 2);

        // Simulate custody transfer (conceptually - same unit, different handler)
        // Custodian B logs a violation (e.g., during transport)
        client.log_reading(&oracle, &unit_id, &700); // violation 3 (too hot)
        
        // Streak should be continuous across the conceptual custody change
        assert_eq!(client.get_consecutive_violation_streak(&unit_id), 3);
        assert!(client.is_compromised(&unit_id), "Unit should be compromised - violations span custody transfer");

        // Custodian B logs a normal reading
        client.log_reading(&oracle, &unit_id, &400); // normal
        
        // Streak should reset even after custody transfer
        assert_eq!(client.get_consecutive_violation_streak(&unit_id), 0);
        
        // Note: Unit remains compromised even after streak resets
        // (once compromised, always compromised until admin reset)
        assert!(client.is_compromised(&unit_id));
    }

    /// Test 7: Large streak
    /// 100 consecutive violations → assert Compromised triggered on the 3rd and streak value is 100 at end
    #[test]
    fn test_large_streak() {
        let (_env, admin, oracle, client) = create_test_contract();

        let unit_id = 206u64;
        client.set_threshold(&admin, &unit_id, &200, &600);

        // Log 100 consecutive violations
        for i in 0..100u64 {
            client.log_reading(&oracle, &unit_id, &100));
            
            // Check that compromised was triggered on the 3rd violation
            if i == 2 {
                assert!(client.is_compromised(&unit_id), "Should be compromised on 3rd consecutive violation");
            }
        }

        // Final streak should be 100
        assert_eq!(client.get_consecutive_violation_streak(&unit_id), 100, "Streak should be 100 after 100 consecutive violations");
        
        // Should definitely be compromised
        assert!(client.is_compromised(&unit_id), "Unit should be compromised after 100 violations");
    }

    // ── Circuit breaker tests ─────────────────────────────────────────────────

    #[test]
    fn test_temperature_pause_blocks_log_reading() {
        let (_env, admin, oracle, client) = create_test_contract();
        let unit_id = 1u64;
        client.set_threshold(&admin, &unit_id, &200, &600);

        client.pause(&admin);
        assert!(client.is_paused());

        let result = client.try_log_reading(&oracle, &unit_id, &400);
        assert!(result.is_err());
    }

    #[test]
    fn test_temperature_pause_allows_get_readings() {
        let (_env, admin, oracle, client) = create_test_contract();
        let unit_id = 2u64;
        client.set_threshold(&admin, &unit_id, &200, &600);
        client.log_reading(&oracle, &unit_id, &400);

        client.pause(&admin);

        // Read still works
        let readings = client.get_readings(&unit_id);
        assert!(!readings.is_empty());
    }

    #[test]
    fn test_temperature_unpause_restores_writes() {
        let (_env, admin, oracle, client) = create_test_contract();
        let unit_id = 3u64;
        client.set_threshold(&admin, &unit_id, &200, &600);

        client.pause(&admin);
        client.unpause(&admin);
        assert!(!client.is_paused());

        client.log_reading(&oracle, &unit_id, &400);
        let readings = client.get_readings(&unit_id);
        assert!(!readings.is_empty());
    }

    #[test]
    #[should_panic]
    fn test_temperature_non_admin_cannot_pause() {
        let (env, _admin, _oracle, client) = create_test_contract();
        let attacker = Address::generate(&env);
        client.pause(&attacker);
    }

    // ── Oracle whitelist tests ────────────────────────────────────────────────

    /// Non-whitelisted address cannot submit temperature readings.
    #[test]
    fn test_non_oracle_cannot_log_reading() {
        let (env, admin, _oracle, client) = create_test_contract();
        let unit_id = 300u64;
        client.set_threshold(&admin, &unit_id, &200, &600);

        let stranger = Address::generate(&env);
        let result = client.try_log_reading(&stranger, &unit_id, &400);
        assert!(result.is_err(), "Non-whitelisted address should not be able to log readings");
    }

    /// Admin can always log readings without being explicitly whitelisted.
    #[test]
    fn test_admin_can_log_reading_without_whitelist() {
        let (_env, admin, _oracle, client) = create_test_contract();
        let unit_id = 301u64;
        client.set_threshold(&admin, &unit_id, &200, &600);

        // Admin is not in the oracle whitelist but should still be able to log
        client.log_reading(&admin, &unit_id, &400);
        let readings = client.get_readings(&unit_id);
        assert_eq!(readings.len(), 1);
    }

    /// Removed oracle can no longer submit readings.
    #[test]
    fn test_removed_oracle_cannot_log_reading() {
        let (env, admin, _oracle, client) = create_test_contract();
        let unit_id = 302u64;
        client.set_threshold(&admin, &unit_id, &200, &600);

        // Add a new oracle
        let sensor = Address::generate(&env);
        client.add_oracle(&admin, &sensor);

        // Confirm it can log
        client.log_reading(&sensor, &unit_id, &400);

        // Remove the oracle
        client.remove_oracle(&admin, &sensor);

        // Now it should be rejected
        let result = client.try_log_reading(&sensor, &unit_id, &400);
        assert!(result.is_err(), "Removed oracle should not be able to log readings");
    }

    /// is_oracle returns correct values for whitelisted, removed, and unknown addresses.
    #[test]
    fn test_is_oracle_reflects_whitelist_state() {
        let (env, admin, oracle, client) = create_test_contract();

        // The oracle created in create_test_contract should be approved
        assert!(client.is_oracle(&oracle), "Registered oracle should return true");

        // A random address should not be an oracle
        let stranger = Address::generate(&env);
        assert!(!client.is_oracle(&stranger), "Unknown address should return false");

        // Admin always counts as oracle
        assert!(client.is_oracle(&admin), "Admin should always return true");

        // After removal, is_oracle returns false
        client.remove_oracle(&admin, &oracle);
        assert!(!client.is_oracle(&oracle), "Removed oracle should return false");
    }

    /// Multiple independent oracles can be added and each works independently.
    #[test]
    fn test_multiple_oracles_independent() {
        let (env, admin, _oracle, client) = create_test_contract();
        let unit_id = 303u64;
        client.set_threshold(&admin, &unit_id, &200, &600);

        let sensor_a = Address::generate(&env);
        let sensor_b = Address::generate(&env);
        client.add_oracle(&admin, &sensor_a);
        client.add_oracle(&admin, &sensor_b);

        // Both can log
        client.log_reading(&sensor_a, &unit_id, &400);
        client.log_reading(&sensor_b, &unit_id, &410);

        // Remove only sensor_a
        client.remove_oracle(&admin, &sensor_a);

        // sensor_b still works, sensor_a does not
        let result_a = client.try_log_reading(&sensor_a, &unit_id, &400);
        assert!(result_a.is_err(), "Removed sensor_a should be rejected");

        client.log_reading(&sensor_b, &unit_id, &420);
        let readings = client.get_readings(&unit_id);
        assert_eq!(readings.len(), 3, "Should have 3 readings total");
    }
}
