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
    use crate::types::{BloodStatus, BloodUnit, Reservation, Role};
    use crate::{BloodType, ContractError, InventoryContract, InventoryContractClient};
    use soroban_sdk::{
        testutils::{Address as _, Ledger as _},
        vec, Address, Env, String,
    };

    /// Flatten a generated `try_*` result into the contract's own error type.
    /// Conversion or host failures are bugs in the test and panic.
    trait IntoContractResult<T> {
        fn into_contract(self) -> Result<T, ContractError>;
    }

    impl<T, C: core::fmt::Debug, I: core::fmt::Debug> IntoContractResult<T>
        for Result<Result<T, C>, Result<ContractError, I>>
    {
        fn into_contract(self) -> Result<T, ContractError> {
            match self {
                Ok(Ok(v)) => Ok(v),
                Err(Ok(e)) => Err(e),
                Ok(Err(e)) => panic!("conversion error: {:?}", e),
                Err(Err(e)) => panic!("invoke error: {:?}", e),
            }
        }
    }

    struct TestInventoryClient<'a> {
        client: InventoryContractClient<'a>,
    }

    fn create_client(env: &Env) -> TestInventoryClient<'_> {
        let contract_id = env.register(InventoryContract, ());
        TestInventoryClient {
            client: InventoryContractClient::new(env, &contract_id),
        }
    }

    impl TestInventoryClient<'_> {
        fn initialize(&self, _env: Env, admin: Address) -> Result<(), ContractError> {
            self.client.try_initialize(&admin).into_contract()
        }

        fn authorize_bank(
            &self,
            _env: Env,
            admin: Address,
            bank: Address,
            authorized: bool,
        ) -> Result<(), ContractError> {
            self.client
                .try_authorize_bank(&admin, &bank, &authorized)
                .into_contract()
        }

        fn register_blood(
            &self,
            _env: Env,
            bank: Address,
            serial_number: String,
            blood_type: BloodType,
            quantity_ml: u32,
            donor_id: Option<Address>,
        ) -> Result<u64, ContractError> {
            self.client
                .try_register_blood(&bank, &serial_number, &blood_type, &quantity_ml, &donor_id)
                .into_contract()
        }

        fn reserve_blood(
            &self,
            _env: Env,
            requester: Address,
            unit_ids: soroban_sdk::Vec<u64>,
            request_id: u64,
            duration_seconds: u64,
        ) -> Result<u64, ContractError> {
            self.client
                .try_reserve_blood(&requester, &requester, &unit_ids, &request_id, &duration_seconds)
                .into_contract()
        }

        fn batch_reserve_blood(
            &self,
            _env: Env,
            requester: Address,
            batch: soroban_sdk::Vec<(soroban_sdk::Vec<u64>, u64, u64)>,
        ) -> Result<soroban_sdk::Vec<u64>, ContractError> {
            self.client
                .try_batch_reserve_blood(&requester, &requester, &batch)
                .into_contract()
        }

        fn get_reservation(
            &self,
            _env: Env,
            reservation_id: u64,
        ) -> Result<Reservation, ContractError> {
            self.client
                .try_get_reservation(&reservation_id)
                .into_contract()
        }

        fn release_reservation_by_contract(
            &self,
            _env: Env,
            authorized_contract: Address,
            reservation_id: u64,
        ) -> Result<(), ContractError> {
            self.client
                .try_release_reservation_by_contract(&authorized_contract, &reservation_id)
                .into_contract()
        }

        fn grant_role(
            &self,
            _env: Env,
            admin: Address,
            grantee: Address,
            role: Role,
        ) -> Result<(), ContractError> {
            self.client
                .try_grant_role(&admin, &grantee, &role)
                .into_contract()
        }

        fn update_status(
            &self,
            _env: Env,
            unit_id: u64,
            new_status: BloodStatus,
            authorized_by: Address,
            reason: Option<String>,
        ) -> Result<BloodUnit, ContractError> {
            self.client
                .try_update_status(&unit_id, &new_status, &authorized_by, &reason)
                .into_contract()
        }
    }

    /// #1150: Verify reserve_blood enforces bank_id ownership check.
    /// Bank B cannot reserve blood units that belong to Bank A.
    #[test]
    fn test_reserve_blood_prevents_cross_bank_allocation() {
        let env = Env::default();
        let admin = Address::generate(&env);
        let bank_a = Address::generate(&env);
        let bank_b = Address::generate(&env);

        env.mock_all_auths();
        let client = create_client(&env);

        client.initialize(env.clone(), admin.clone()).unwrap();
        client
            .authorize_bank(env.clone(), admin.clone(), bank_a.clone(), true)
            .unwrap();
        client
            .authorize_bank(env.clone(), admin.clone(), bank_b.clone(), true)
            .unwrap();

        // Bank A registers a blood unit
        let unit_id = client
            .register_blood(
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
        let result = client.reserve_blood(env.clone(), bank_b.clone(), bank_b.clone(), unit_ids, 1, 3600);

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
        let client = create_client(&env);

        client.initialize(env.clone(), admin.clone()).unwrap();
        client
            .authorize_bank(env.clone(), admin.clone(), bank_a.clone(), true)
            .unwrap();

        // Bank A registers a blood unit
        let unit_id = client
            .register_blood(
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
        let result = client.reserve_blood(env.clone(), bank_a.clone(), bank_a.clone(), unit_ids, 1, 3600);

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
        let client = create_client(&env);

        client.initialize(env.clone(), admin.clone()).unwrap();
        client
            .authorize_bank(env.clone(), admin.clone(), bank_a.clone(), true)
            .unwrap();
        client
            .authorize_bank(env.clone(), admin.clone(), bank_b.clone(), true)
            .unwrap();

        // Bank A registers units
        let unit_1 = client
            .register_blood(
                env.clone(),
                bank_a.clone(),
                String::from_str(&env, "SN001"),
                BloodType::OPositive,
                500,
                None,
            )
            .unwrap();

        let unit_2 = client
            .register_blood(
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

        let result = client.batch_reserve_blood(env.clone(), bank_b.clone(), bank_b.clone(), batch);

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
        let client = create_client(&env);

        client.initialize(env.clone(), admin.clone()).unwrap();

        // Unauthorized bank attempts to register blood
        let result = client.register_blood(
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
        let client = create_client(&env);

        client.initialize(env.clone(), admin.clone()).unwrap();
        client
            .authorize_bank(env.clone(), admin.clone(), authorized_bank.clone(), true)
            .unwrap();

        let result = client.register_blood(
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
        let client = create_client(&env);

        client.initialize(env.clone(), admin.clone()).unwrap();
        client
            .authorize_bank(env.clone(), admin.clone(), bank.clone(), true)
            .unwrap();

        let unit_id = client
            .register_blood(
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
        let result = client.reserve_blood(
            env.clone(),
            bank.clone(),
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
        let client = create_client(&env);

        client.initialize(env.clone(), admin.clone()).unwrap();
        client
            .authorize_bank(env.clone(), admin.clone(), bank.clone(), true)
            .unwrap();

        let unit_id = client
            .register_blood(
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
        let result = client.reserve_blood(env.clone(), bank.clone(), bank, unit_ids, 1, max_allowed);

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
        let client = create_client(&env);

        client.initialize(env.clone(), admin.clone()).unwrap();
        client
            .authorize_bank(env.clone(), admin.clone(), bank.clone(), true)
            .unwrap();

        let unit_id = client
            .register_blood(
                env.clone(),
                bank.clone(),
                String::from_str(&env, "SN001"),
                BloodType::OPositive,
                500,
                None,
            )
            .unwrap();

        let unit_ids = vec![&env, unit_id];
        let reservation_id = client
            .reserve_blood(env.clone(), bank.clone(), bank.clone(), unit_ids, 1, 3600)
            .unwrap();

        // Verify reservation exists before release
        let reservation = client.get_reservation(env.clone(), reservation_id).unwrap();
        assert_eq!(reservation.unit_ids.len(), 1);

        // Only the stored requests contract may release through this entry point.
        client
            .client
            .set_requests_contract(&admin, &authorized_contract);

        // Call release_reservation_by_contract with the public signature
        let result = client.release_reservation_by_contract(
            env.clone(),
            authorized_contract,
            reservation_id,
        );

        // Should succeed (authorized_contract auth is mocked)
        assert!(result.is_ok());

        // Verify reservation was released.
        // Reservation does not implement PartialEq, so use unwrap_err() (issue #1317).
        let result = client.get_reservation(env.clone(), reservation_id);
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
        let client = create_client(&env);
        env.ledger().set_timestamp(1000u64);

        client.initialize(env.clone(), admin.clone()).unwrap();
        client
            .authorize_bank(env.clone(), admin.clone(), bank.clone(), true)
            .unwrap();
        client
            .grant_role(env.clone(), admin.clone(), rider.clone(), Role::Rider)
            .unwrap();

        let unit_id = client
            .register_blood(
                env.clone(),
                bank.clone(),
                String::from_str(&env, "SN-RIDER-001"),
                BloodType::OPositive,
                450,
                None,
            )
            .unwrap();

        // Move to Reserved (by bank owner) before rider picks up
        client
            .update_status(
                env.clone(),
                unit_id,
                BloodStatus::Reserved,
                bank.clone(),
                None,
            )
            .unwrap();

        // Rider marks as InTransit — must succeed (issue #1316 fix)
        let result = client.update_status(
            env.clone(),
            unit_id,
            BloodStatus::InTransit,
            rider.clone(),
            None,
        );
        assert!(
            result.is_ok(),
            "Rider should be able to mark unit InTransit"
        );
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
        let client = create_client(&env);
        env.ledger().set_timestamp(1000u64);

        client.initialize(env.clone(), admin.clone()).unwrap();
        client
            .authorize_bank(env.clone(), admin.clone(), bank.clone(), true)
            .unwrap();
        client
            .grant_role(env.clone(), admin.clone(), hospital.clone(), Role::Hospital)
            .unwrap();

        let unit_id = client
            .register_blood(
                env.clone(),
                bank.clone(),
                String::from_str(&env, "SN-HOSP-001"),
                BloodType::APositive,
                450,
                None,
            )
            .unwrap();

        // Advance to InTransit (by bank owner)
        client
            .update_status(
                env.clone(),
                unit_id,
                BloodStatus::Reserved,
                bank.clone(),
                None,
            )
            .unwrap();
        client
            .update_status(
                env.clone(),
                unit_id,
                BloodStatus::InTransit,
                bank.clone(),
                None,
            )
            .unwrap();

        // Hospital marks as Delivered — must succeed (issue #1316 fix)
        let result = client.update_status(
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
        let client = create_client(&env);
        env.ledger().set_timestamp(1000u64);

        client.initialize(env.clone(), admin.clone()).unwrap();
        client
            .authorize_bank(env.clone(), admin.clone(), bank.clone(), true)
            .unwrap();
        client
            .grant_role(env.clone(), admin.clone(), rider.clone(), Role::Rider)
            .unwrap();

        let unit_id = client
            .register_blood(
                env.clone(),
                bank.clone(),
                String::from_str(&env, "SN-RIDER-002"),
                BloodType::BPositive,
                450,
                None,
            )
            .unwrap();

        client
            .update_status(
                env.clone(),
                unit_id,
                BloodStatus::Reserved,
                bank.clone(),
                None,
            )
            .unwrap();
        client
            .update_status(
                env.clone(),
                unit_id,
                BloodStatus::InTransit,
                bank.clone(),
                None,
            )
            .unwrap();

        // Rider tries to mark Delivered — assert_can_transition should reject this
        let result = client.update_status(
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
