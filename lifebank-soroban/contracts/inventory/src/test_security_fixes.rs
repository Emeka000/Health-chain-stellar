/// Security regression tests (issues #1150, #1153, #1314, #1315).
///
/// These tests were originally written against a stale API (issue #1317) and
/// have been updated to match the current contract interface:
///   - `Address::random` → `Address::generate`
///   - `BloodType::OPos` → `BloodType::OPositive`
///   - `authorize_bank` now takes a 4th `authorized: bool` argument
///   - `String::from_slice` → `String::from_str`
///   - `batch_reserve_blood` now uses a Vec<(Vec<u64>, u64, u64)> tuple batch
#[cfg(test)]
mod security_tests {
    use crate::{BloodType, ContractError, InventoryContract};
    use soroban_sdk::{testutils::{Address as _, Ledger as _}, vec, Address, Env, String};

    /// #1150: Verify reserve_blood enforces bank_id ownership check.
    /// Bank B cannot reserve blood units that belong to Bank A.
    #[test]
    fn test_reserve_blood_prevents_cross_bank_allocation() {
        let env = Env::default();
        let admin = Address::generate(&env);
        let bank_a = Address::generate(&env);
        let bank_b = Address::generate(&env);

        env.mock_all_auths();

        InventoryContract::initialize(env.clone(), admin.clone()).unwrap();
        InventoryContract::authorize_bank(env.clone(), admin.clone(), bank_a.clone(), true)
            .unwrap();
        InventoryContract::authorize_bank(env.clone(), admin.clone(), bank_b.clone(), true)
            .unwrap();

        // Bank A registers a blood unit
        let unit_id = InventoryContract::register_blood(
            env.clone(),
            bank_a.clone(),
            String::from_str(&env, "SN001"),
            BloodType::OPositive,
            500,
            None,
        )
        .unwrap();

        // Bank B attempts to reserve Bank A's blood unit
        let unit_ids = vec![&env, unit_id];
        let result = InventoryContract::reserve_blood(
            env.clone(),
            bank_b.clone(),
            unit_ids,
            1,
            3600,
        );

        // Should fail: unit belongs to Bank A, not Bank B
        assert_eq!(result, Err(ContractError::NotUnitOwner));
    }

    /// #1150: Verify reserve_blood allows owner bank to reserve its own units.
    #[test]
    fn test_reserve_blood_owner_bank_succeeds() {
        let env = Env::default();
        let admin = Address::generate(&env);
        let bank_a = Address::generate(&env);

        env.mock_all_auths();

        InventoryContract::initialize(env.clone(), admin.clone()).unwrap();
        InventoryContract::authorize_bank(env.clone(), admin.clone(), bank_a.clone(), true)
            .unwrap();

        // Bank A registers a blood unit
        let unit_id = InventoryContract::register_blood(
            env.clone(),
            bank_a.clone(),
            String::from_str(&env, "SN001"),
            BloodType::OPositive,
            500,
            None,
        )
        .unwrap();

        // Bank A reserves its own blood unit
        let unit_ids = vec![&env, unit_id];
        let result = InventoryContract::reserve_blood(
            env.clone(),
            bank_a.clone(),
            unit_ids,
            1,
            3600,
        );

        assert!(result.is_ok());
    }

    /// #1150: Verify batch operations enforce bank ownership.
    #[test]
    fn test_batch_reserve_blood_enforces_ownership() {
        let env = Env::default();
        let admin = Address::generate(&env);
        let bank_a = Address::generate(&env);
        let bank_b = Address::generate(&env);

        env.mock_all_auths();

        InventoryContract::initialize(env.clone(), admin.clone()).unwrap();
        InventoryContract::authorize_bank(env.clone(), admin.clone(), bank_a.clone(), true)
            .unwrap();
        InventoryContract::authorize_bank(env.clone(), admin.clone(), bank_b.clone(), true)
            .unwrap();

        // Bank A registers units
        let unit_1 = InventoryContract::register_blood(
            env.clone(),
            bank_a.clone(),
            String::from_str(&env, "SN001"),
            BloodType::OPositive,
            500,
            None,
        )
        .unwrap();

        let unit_2 = InventoryContract::register_blood(
            env.clone(),
            bank_a.clone(),
            String::from_str(&env, "SN002"),
            BloodType::OPositive,
            500,
            None,
        )
        .unwrap();

        // Bank B attempts batch reserve of Bank A's units
        let unit_ids = vec![&env, unit_1, unit_2];
        let batch = vec![&env, (unit_ids, 1u64, 3600u64)];

        let result = InventoryContract::batch_reserve_blood(
            env.clone(),
            bank_b.clone(),
            batch,
        );

        // Should fail on first unit ownership check
        assert_eq!(result, Err(ContractError::NotUnitOwner));
    }

    /// #1153: Verify register_blood requires bank authorization.
    /// Unauthorized addresses cannot register blood units.
    #[test]
    fn test_register_blood_requires_authorized_bank() {
        let env = Env::default();
        let admin = Address::generate(&env);
        let unauthorized_bank = Address::generate(&env);

        env.mock_all_auths();

        InventoryContract::initialize(env.clone(), admin.clone()).unwrap();

        // Unauthorized bank attempts to register blood
        let result = InventoryContract::register_blood(
            env.clone(),
            unauthorized_bank,
            String::from_str(&env, "SN001"),
            BloodType::OPositive,
            500,
            None,
        );

        // Should fail: bank is not authorized
        assert_eq!(result, Err(ContractError::NotAuthorizedBloodBank));
    }

    /// #1153: Verify register_blood succeeds for authorized banks.
    #[test]
    fn test_register_blood_by_authorized_bank_succeeds() {
        let env = Env::default();
        let admin = Address::generate(&env);
        let authorized_bank = Address::generate(&env);

        env.mock_all_auths();

        InventoryContract::initialize(env.clone(), admin.clone()).unwrap();
        InventoryContract::authorize_bank(
            env.clone(),
            admin.clone(),
            authorized_bank.clone(),
            true,
        )
        .unwrap();

        let result = InventoryContract::register_blood(
            env.clone(),
            authorized_bank,
            String::from_str(&env, "SN001"),
            BloodType::OPositive,
            500,
            None,
        );

        assert!(result.is_ok());
    }

    /// #1315: Verify reserve_blood rejects oversized duration_seconds with typed error.
    /// Previously this panicked; now it should return InvalidInput error.
    #[test]
    fn test_reserve_blood_rejects_oversized_duration() {
        let env = Env::default();
        let admin = Address::generate(&env);
        let bank = Address::generate(&env);

        env.mock_all_auths();

        InventoryContract::initialize(env.clone(), admin.clone()).unwrap();
        InventoryContract::authorize_bank(env.clone(), admin.clone(), bank.clone(), true).unwrap();

        let unit_id = InventoryContract::register_blood(
            env.clone(),
            bank.clone(),
            String::from_str(&env, "SN001"),
            BloodType::OPositive,
            500,
            None,
        )
        .unwrap();

        // Attempt to reserve with duration exceeding MAX_RESERVATION_DURATION_SECS (86400 * 7)
        let max_allowed = 86_400u64 * 7;
        let oversized_duration = max_allowed + 1;

        let unit_ids = vec![&env, unit_id];
        let result = InventoryContract::reserve_blood(
            env.clone(),
            bank.clone(),
            unit_ids,
            1,
            oversized_duration,
        );

        // Should return InvalidInput error, not panic
        assert_eq!(result, Err(ContractError::InvalidInput));
    }

    /// #1315: Verify reserve_blood succeeds with maximum allowed duration.
    #[test]
    fn test_reserve_blood_accepts_max_duration() {
        let env = Env::default();
        let admin = Address::generate(&env);
        let bank = Address::generate(&env);

        env.mock_all_auths();

        InventoryContract::initialize(env.clone(), admin.clone()).unwrap();
        InventoryContract::authorize_bank(env.clone(), admin.clone(), bank.clone(), true).unwrap();

        let unit_id = InventoryContract::register_blood(
            env.clone(),
            bank.clone(),
            String::from_str(&env, "SN001"),
            BloodType::OPositive,
            500,
            None,
        )
        .unwrap();

        let max_allowed = 86_400u64 * 7;
        let unit_ids = vec![&env, unit_id];
        let result = InventoryContract::reserve_blood(
            env.clone(),
            bank,
            unit_ids,
            1,
            max_allowed,
        );

        assert!(result.is_ok());
    }

    /// #1314: Verify release_reservation_by_contract is callable as a public entry point.
    #[test]
    fn test_release_reservation_by_contract_is_callable() {
        let env = Env::default();
        let admin = Address::generate(&env);
        let bank = Address::generate(&env);
        let authorized_contract = Address::generate(&env);

        env.mock_all_auths();

        InventoryContract::initialize(env.clone(), admin.clone()).unwrap();
        InventoryContract::authorize_bank(env.clone(), admin.clone(), bank.clone(), true).unwrap();

        let unit_id = InventoryContract::register_blood(
            env.clone(),
            bank.clone(),
            String::from_str(&env, "SN001"),
            BloodType::OPositive,
            500,
            None,
        )
        .unwrap();

        let unit_ids = vec![&env, unit_id];
        let reservation_id =
            InventoryContract::reserve_blood(env.clone(), bank.clone(), unit_ids, 1, 3600)
                .unwrap();

        // Verify reservation exists before release
        let reservation =
            InventoryContract::get_reservation(env.clone(), reservation_id).unwrap();
        assert_eq!(reservation.unit_ids.len(), 1);

        // Call release_reservation_by_contract with the public signature
        let result = InventoryContract::release_reservation_by_contract(
            env.clone(),
            authorized_contract,
            reservation_id,
        );

        // Should succeed (authorized_contract auth is mocked)
        assert!(result.is_ok());

        // Verify reservation was released.
        // Reservation does not implement PartialEq, so use unwrap_err() (issue #1317).
        let result = InventoryContract::get_reservation(env, reservation_id);
        assert_eq!(result.unwrap_err(), ContractError::ReservationNotFound);
    }

    // ── Issue #1316: delegated-role paths ────────────────────────────────────

    /// A granted Rider can transition a unit to InTransit without being the bank owner.
    #[test]
    fn test_rider_can_mark_unit_in_transit() {
        use crate::types::{BloodStatus, Role};

        let env = Env::default();
        let admin = Address::generate(&env);
        let bank = Address::generate(&env);
        let rider = Address::generate(&env);

        env.mock_all_auths();
        env.ledger().set_timestamp(1000u64);

        InventoryContract::initialize(env.clone(), admin.clone()).unwrap();
        InventoryContract::authorize_bank(env.clone(), admin.clone(), bank.clone(), true).unwrap();
        InventoryContract::grant_role(env.clone(), admin.clone(), rider.clone(), Role::Rider)
            .unwrap();

        let unit_id = InventoryContract::register_blood(
            env.clone(),
            bank.clone(),
            String::from_str(&env, "SN-RIDER-001"),
            BloodType::OPositive,
            450,
            None,
        )
        .unwrap();

        // Move to Reserved (by bank owner) before rider picks up
        InventoryContract::update_status(
            env.clone(),
            unit_id,
            BloodStatus::Reserved,
            bank.clone(),
            None,
        )
        .unwrap();

        // Rider marks as InTransit — must succeed (issue #1316 fix)
        let result = InventoryContract::update_status(
            env.clone(),
            unit_id,
            BloodStatus::InTransit,
            rider.clone(),
            None,
        );
        assert!(result.is_ok(), "Rider should be able to mark unit InTransit");
        assert_eq!(result.unwrap().status, BloodStatus::InTransit);
    }

    /// A granted Hospital can transition a unit to Delivered without being the bank owner.
    #[test]
    fn test_hospital_can_mark_unit_delivered() {
        use crate::types::{BloodStatus, Role};

        let env = Env::default();
        let admin = Address::generate(&env);
        let bank = Address::generate(&env);
        let hospital = Address::generate(&env);

        env.mock_all_auths();
        env.ledger().set_timestamp(1000u64);

        InventoryContract::initialize(env.clone(), admin.clone()).unwrap();
        InventoryContract::authorize_bank(env.clone(), admin.clone(), bank.clone(), true).unwrap();
        InventoryContract::grant_role(
            env.clone(),
            admin.clone(),
            hospital.clone(),
            Role::Hospital,
        )
        .unwrap();

        let unit_id = InventoryContract::register_blood(
            env.clone(),
            bank.clone(),
            String::from_str(&env, "SN-HOSP-001"),
            BloodType::APositive,
            450,
            None,
        )
        .unwrap();

        // Advance to InTransit (by bank owner)
        InventoryContract::update_status(
            env.clone(),
            unit_id,
            BloodStatus::Reserved,
            bank.clone(),
            None,
        )
        .unwrap();
        InventoryContract::update_status(
            env.clone(),
            unit_id,
            BloodStatus::InTransit,
            bank.clone(),
            None,
        )
        .unwrap();

        // Hospital marks as Delivered — must succeed (issue #1316 fix)
        let result = InventoryContract::update_status(
            env.clone(),
            unit_id,
            BloodStatus::Delivered,
            hospital.clone(),
            None,
        );
        assert!(
            result.is_ok(),
            "Hospital should be able to mark unit Delivered"
        );
        assert_eq!(result.unwrap().status, BloodStatus::Delivered);
    }

    /// A Rider must NOT be able to mark a unit Delivered (wrong role for that transition).
    #[test]
    fn test_rider_cannot_mark_unit_delivered() {
        use crate::types::{BloodStatus, Role};

        let env = Env::default();
        let admin = Address::generate(&env);
        let bank = Address::generate(&env);
        let rider = Address::generate(&env);

        env.mock_all_auths();
        env.ledger().set_timestamp(1000u64);

        InventoryContract::initialize(env.clone(), admin.clone()).unwrap();
        InventoryContract::authorize_bank(env.clone(), admin.clone(), bank.clone(), true).unwrap();
        InventoryContract::grant_role(env.clone(), admin.clone(), rider.clone(), Role::Rider)
            .unwrap();

        let unit_id = InventoryContract::register_blood(
            env.clone(),
            bank.clone(),
            String::from_str(&env, "SN-RIDER-002"),
            BloodType::BPositive,
            450,
            None,
        )
        .unwrap();

        InventoryContract::update_status(
            env.clone(),
            unit_id,
            BloodStatus::Reserved,
            bank.clone(),
            None,
        )
        .unwrap();
        InventoryContract::update_status(
            env.clone(),
            unit_id,
            BloodStatus::InTransit,
            bank.clone(),
            None,
        )
        .unwrap();

        // Rider tries to mark Delivered — assert_can_transition should reject this
        let result = InventoryContract::update_status(
            env.clone(),
            unit_id,
            BloodStatus::Delivered,
            rider.clone(),
            None,
        );
        assert!(
            result.is_err(),
            "Rider must not be allowed to mark unit Delivered"
        );
    }
}
