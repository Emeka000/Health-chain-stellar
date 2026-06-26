use soroban_sdk::symbol_short;
//! Test for issue #845: Expired blood units should not be reservable

#[cfg(test)]
mod expiry_tests {
    use crate::{InventoryContract, InventoryContractClient};
    use soroban_sdk::{testutils::Address as _, Address, Env, String as SorobanString};

    #[test]
    fn test_expired_unit_cannot_be_reserved() {
        let env = Env::default();
        env.mock_all_auths();

        let contract_id = env.register_contract(None, InventoryContract);
        let client = InventoryContractClient::new(&env, &contract_id);

        let admin = Address::generate(&env);
        let bank = Address::generate(&env);

        // Initialize and authorize bank
        client.initialize(&admin);
        client.authorize_bank(&admin, &bank, &true);

        // Register a blood unit
        let serial = SorobanString::from_str(&env, "EXPIRY-TEST-001");
        let blood_type = soroban_sdk::symbol_short!("OPos");
        let unit_id = client
            .register_blood(&bank, &serial, &blood_type, &450, &None)
            .unwrap();

        // Verify unit is initially available
        let unit = client.get_blood_unit(&unit_id).unwrap();
        assert_eq!(unit.status, crate::types::BloodStatus::Available);

        // Fast-forward time past expiration (42 days shelf life + 1 day)
        env.ledger().with_mut(|li| {
            li.timestamp += 43 * 24 * 3600; // 43 days in seconds
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

        let contract_id = env.register_contract(None, InventoryContract);
        let client = InventoryContractClient::new(&env, &contract_id);

        let admin = Address::generate(&env);
        let bank = Address::generate(&env);

        client.initialize(&admin);
        client.authorize_bank(&admin, &bank, &true);

        let serial = SorobanString::from_str(&env, "FRESH-001");
        let blood_type = soroban_sdk::symbol_short!("ABPos");
        let unit_id = client
            .register_blood(&bank, &serial, &blood_type, &500, &None)
            .unwrap();

        // Reserve immediately (well before expiration)
        let mut unit_ids = soroban_sdk::Vec::new(&env);
        unit_ids.push_back(unit_id);

        let result = client.try_reserve_blood(&bank, &unit_ids, &1u64, &7200u64);

        // Should succeed
        assert!(result.is_ok(), "Fresh blood unit could not be reserved");
    }
}
