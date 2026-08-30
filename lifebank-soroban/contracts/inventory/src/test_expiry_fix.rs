//! Test for issue #845: Expired blood units should not be reservable
//! Test for reservation TTL fix: temporary storage entry must survive its duration

#[cfg(test)]
mod expiry_tests {
    use crate::{BloodType, InventoryContract, InventoryContractClient};
    use soroban_sdk::{
        testutils::{Address as _, Ledger as _},
        Address, Env, String as SorobanString,
    };

    #[test]
    fn test_expired_unit_cannot_be_reserved() {
        let env = Env::default();
        env.mock_all_auths();

        let contract_id = env.register(InventoryContract, ());
        let client = InventoryContractClient::new(&env, &contract_id);

        let admin = Address::generate(&env);
        let bank = Address::generate(&env);

        // Initialize and authorize bank
        client.initialize(&admin);
        client.authorize_bank(&admin, &bank, &true);

        // Register a blood unit
        let serial = SorobanString::from_str(&env, "EXPIRY-TEST-001");
        let blood_type = BloodType::OPositive;
        let unit_id = client.register_blood(&bank, &serial, &blood_type, &450, &None);

        // Verify unit is initially available
        let unit = client.get_blood_unit(&unit_id);
        assert_eq!(unit.status, crate::types::BloodStatus::Available);

        // Fast-forward time past expiration (35 days shelf life + 1 day)
        env.ledger().with_mut(|li| {
            li.timestamp += 36 * 24 * 3600; // 36 days in seconds
        });

        // Attempt to reserve the expired unit
        let mut unit_ids = soroban_sdk::Vec::new(&env);
        unit_ids.push_back(unit_id);

        let result = client.try_reserve_blood(&bank, &unit_ids, &1u64, &3600u64);

        // MUST fail with BloodUnitExpired error
        assert!(
            result.is_err(),
            "Expired blood unit was allowed to be reserved - CRITICAL SAFETY BUG!"
        );
    }

    #[test]
    fn test_non_expired_unit_can_be_reserved() {
        let env = Env::default();
        env.mock_all_auths();

        let contract_id = env.register(InventoryContract, ());
        let client = InventoryContractClient::new(&env, &contract_id);

        let admin = Address::generate(&env);
        let bank = Address::generate(&env);

        client.initialize(&admin);
        client.authorize_bank(&admin, &bank, &true);

        let serial = SorobanString::from_str(&env, "FRESH-001");
        let blood_type = BloodType::ABPositive;
        let unit_id = client.register_blood(&bank, &serial, &blood_type, &500, &None);

        // Reserve immediately (well before expiration)
        let mut unit_ids = soroban_sdk::Vec::new(&env);
        unit_ids.push_back(unit_id);

        let result = client.try_reserve_blood(&bank, &unit_ids, &1u64, &7200u64);

        // Should succeed
        assert!(result.is_ok(), "Fresh blood unit could not be reserved");
    }

    /// Regression test for the reservation TTL bug:
    ///
    /// A reservation created with a multi-day duration must still be readable
    /// (and releasable) after the ledger advances to just before expiry. Without
    /// the `extend_ttl` fix, Soroban would have purged the temporary entry using
    /// the network-default TTL (much shorter than 7 days), causing
    /// `get_reservation` to return `ReservationNotFound` and the reserved units
    /// to be permanently stuck in `Reserved` status.
    ///
    /// The test advances the ledger by `(duration_seconds / LEDGER_CLOSE_SECS) - 1`
    /// ledgers — i.e., one ledger before the entry would expire under the extended
    /// TTL — and asserts the reservation is still retrievable and releasable.
    #[test]
    fn test_reservation_survives_full_duration() {
        let env = Env::default();
        env.mock_all_auths();

        let contract_id = env.register(InventoryContract, ());
        let client = InventoryContractClient::new(&env, &contract_id);

        let admin = Address::generate(&env);
        let bank = Address::generate(&env);

        client.initialize(&admin);
        client.authorize_bank(&admin, &bank, &true);

        // Register a unit with enough shelf life to accommodate a 7-day reservation.
        // Blood shelf life is 35 days; we need > 7 days remaining at reservation time.
        let serial = SorobanString::from_str(&env, "TTL-TEST-001");
        let unit_id = client.register_blood(&bank, &serial, &BloodType::OPositive, &450, &None);

        let mut unit_ids = soroban_sdk::Vec::new(&env);
        unit_ids.push_back(unit_id);

        // Use maximum allowed duration: 7 days in seconds.
        const MAX_DURATION_SECS: u64 = 86_400 * 7;
        const LEDGER_CLOSE_SECS: u64 = 5;

        let reservation_id = client.reserve_blood(&bank, &unit_ids, &1u64, &MAX_DURATION_SECS);

        // Advance ledger to just before the TTL would expire
        // (duration_ledgers - 1, ignoring the small buffer which only helps us).
        let advance_ledgers = (MAX_DURATION_SECS / LEDGER_CLOSE_SECS) - 1;
        env.ledger().with_mut(|li| {
            li.sequence_number += advance_ledgers as u32;
            // Also advance timestamp so expiry logic is consistent
            li.timestamp += MAX_DURATION_SECS - LEDGER_CLOSE_SECS;
        });

        // The reservation must still be readable — not purged by the ledger.
        let reservation = client.get_reservation(&reservation_id);
        assert_eq!(
            reservation.unit_ids.len(),
            1,
            "Reservation was purged before its duration elapsed — TTL fix not applied"
        );

        // And it must be releasable, returning the unit to Available.
        client.release_reservation(&bank, &reservation_id);

        let unit = client.get_blood_unit(&unit_id);
        assert_eq!(
            unit.status,
            crate::types::BloodStatus::Available,
            "Unit not returned to Available after releasing long-lived reservation"
        );
    }

    /// Edge case: a minimum-duration reservation (1 second) must also survive.
    /// The RESERVATION_TTL_MIN_LEDGERS floor ensures the entry is not created
    /// and immediately garbage-collected before the caller can act on it.
    #[test]
    fn test_reservation_ttl_minimum_floor_applied() {
        let env = Env::default();
        env.mock_all_auths();

        let contract_id = env.register(InventoryContract, ());
        let client = InventoryContractClient::new(&env, &contract_id);

        let admin = Address::generate(&env);
        let bank = Address::generate(&env);

        client.initialize(&admin);
        client.authorize_bank(&admin, &bank, &true);

        let serial = SorobanString::from_str(&env, "TTL-MIN-001");
        let unit_id = client.register_blood(&bank, &serial, &BloodType::BNegative, &300, &None);

        let mut unit_ids = soroban_sdk::Vec::new(&env);
        unit_ids.push_back(unit_id);

        // 1-second duration — degenerate case
        let reservation_id = client.reserve_blood(&bank, &unit_ids, &42u64, &1u64);

        // Must be immediately readable without advancing the ledger at all.
        let reservation = client.get_reservation(&reservation_id);
        assert_eq!(reservation.request_id, 42u64);

        // Release it cleanly
        client.release_reservation(&bank, &reservation_id);
    }

    /// Boundary test: unit is still valid one second before expiration_timestamp.
    /// Verifies the real 35-day boundary via reserve_blood (end-to-end).
    #[test]
    fn test_unit_reservable_one_second_before_expiry() {
        let env = Env::default();
        env.mock_all_auths();

        let contract_id = env.register(InventoryContract, ());
        let client = InventoryContractClient::new(&env, &contract_id);

        let admin = Address::generate(&env);
        let bank = Address::generate(&env);

        client.initialize(&admin);
        client.authorize_bank(&admin, &bank, &true);

        let serial = SorobanString::from_str(&env, "BOUNDARY-BEFORE");
        let unit_id = client.register_blood(&bank, &serial, &BloodType::OPositive, &450, &None);

        // Advance to exactly 1 second before expiration_timestamp
        // expiration = donation_time + BLOOD_SHELF_LIFE_DAYS * SECONDS_PER_DAY
        //            = 0 + 35 * 86400 = 3_024_000
        // so advance to 3_024_000 - 1 = 3_023_999
        env.ledger().with_mut(|li| {
            li.timestamp = 35 * 86_400 - 1;
        });

        let mut unit_ids = soroban_sdk::Vec::new(&env);
        unit_ids.push_back(unit_id);

        let result = client.try_reserve_blood(&bank, &unit_ids, &1u64, &1u64);
        assert!(result.is_ok(), "Unit must be reservable 1 second before expiry");
    }

    /// Boundary test: unit is expired at exactly expiration_timestamp.
    /// Verifies the real 35-day boundary via reserve_blood (end-to-end).
    #[test]
    fn test_unit_not_reservable_at_expiry_timestamp() {
        let env = Env::default();
        env.mock_all_auths();

        let contract_id = env.register(InventoryContract, ());
        let client = InventoryContractClient::new(&env, &contract_id);

        let admin = Address::generate(&env);
        let bank = Address::generate(&env);

        client.initialize(&admin);
        client.authorize_bank(&admin, &bank, &true);

        let serial = SorobanString::from_str(&env, "BOUNDARY-AT");
        let unit_id = client.register_blood(&bank, &serial, &BloodType::OPositive, &450, &None);

        // Advance to exactly expiration_timestamp = 35 * 86400
        env.ledger().with_mut(|li| {
            li.timestamp = 35 * 86_400;
        });

        let mut unit_ids = soroban_sdk::Vec::new(&env);
        unit_ids.push_back(unit_id);

        let result = client.try_reserve_blood(&bank, &unit_ids, &1u64, &1u64);
        assert!(result.is_err(), "Unit must be rejected at expiration_timestamp");
    }
}
