//! Fuzz tests for payments contract (issue #844)

use proptest::prelude::*;
use soroban_sdk::{testutils::Address as _, Address, Env, String as SorobanString};
use payment_contract::{PaymentContract, PaymentContractClient};

proptest! {
    /// Issue #844: Fuzz test - payment amounts should handle edge cases
    #[test]
    fn create_payment_handles_amount_edge_cases(
        amount in any::<i128>(),
    ) {
        let env = Env::default();
        env.mock_all_auths();
        
        let contract_id = env.register_contract(None, PaymentContract);
        let client = PaymentContractClient::new(&env, &contract_id);
        
        let admin = Address::generate(&env);
        let payer = Address::generate(&env);
        let payee = Address::generate(&env);
        
        client.initialize(&admin, &None);
        
        let result = client.try_create_payment(&1u64, &payer, &payee, &amount);
        
        match result {
            Ok(_) => {
                assert!(amount > 0, "Negative or zero amount accepted");
            }
            Err(_) => {
                // Expected for invalid amounts
            }
        }
    }
}
