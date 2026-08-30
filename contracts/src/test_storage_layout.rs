// Standalone storage layout tests. Do not add business logic tests here.

#![cfg(test)]

// ── #944: archive_custody_events per-unit index ─────────────────────────────

#[test]
fn test_initiate_transfer_populates_unit_custody_events_index() {
    use crate::{BloodComponent, BloodType, DataKey, HealthChainContract, HealthChainContractClient};
    use soroban_sdk::{testutils::Address as _, Address, Env, String, Vec};

    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(HealthChainContract, ());
    let client = HealthChainContractClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let bank = Address::generate(&env);
    let hospital = Address::generate(&env);

    client.initialize(&admin);
    client.register_blood_bank(&bank);
    client.register_hospital(&hospital);

    let expiration = env.ledger().timestamp() + 86400 * 10;
    let unit_id = client.register_blood(
        &bank,
        &BloodType::OPositive,
        &BloodComponent::WholeBlood,
        &450,
        &expiration,
        &None,
    );
    client.allocate_blood(&bank, &unit_id, &hospital);
    let event_id = client.initiate_transfer(&bank, &unit_id);

    // Verify UnitCustodyEvents index was populated with the event_id
    env.as_contract(&contract_id, || {
        let key = DataKey::UnitCustodyEvents(unit_id);
        let stored: Vec<String> = env
            .storage()
            .persistent()
            .get(&key)
            .expect("UnitCustodyEvents index must be populated after initiate_transfer");

        assert_eq!(stored.len(), 1);
        assert_eq!(stored.get(0).unwrap(), event_id);
    });
}
