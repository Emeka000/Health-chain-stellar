//! Test for issue #848: Two-party confirmation for payment release

#[cfg(test)]
mod confirmation_tests {
    use crate::{PaymentContract, PaymentContractClient, PaymentStatus};
    use soroban_sdk::{testutils::Address as _, Address, Env};

    fn deploy_token_with_balance(
        env: &Env,
        admin: &Address,
        recipient: &Address,
        amount: i128,
    ) -> Address {
        let token = env.register_stellar_asset_contract_v2(admin.clone());
        let token_id = token.address();
        let token_client = soroban_sdk::token::StellarAssetClient::new(env, &token_id);
        token_client.mint(recipient, &amount);
        token_id
    }

    #[test]
    fn test_payment_requires_both_confirmations() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(PaymentContract, ());
        let client = PaymentContractClient::new(&env, &contract_id);

        let admin = Address::generate(&env);
        let hospital = Address::generate(&env);
        let blood_bank = Address::generate(&env);
        let token = Address::generate(&env);

        // Initialize contract
        client.initialize(&admin, &None);

        // Create escrow payment (hospital pays blood bank)
        let payment_id = client
            .create_escrow(&1u64, &hospital, &blood_bank, &1000i128, &token);

        // Verify payment is locked
        let payment = client.get_payment(&payment_id);
        assert_eq!(payment.status, PaymentStatus::Locked);

        // Coordinator confirms delivery (admin calls release_escrow)
        client.release_escrow(&admin, &payment_id);

        // Payment should STILL be locked (waiting for hospital confirmation)
        let payment = client.get_payment(&payment_id);
        assert_eq!(
            payment.status,
            PaymentStatus::Locked,
            "Payment released with only coordinator confirmation!"
        );

        // Hospital confirms receipt
        client.confirm_receipt(&payment_id, &hospital);

        // NOW payment should be released (both parties confirmed)
        let payment = client.get_payment(&payment_id);
        assert_eq!(
            payment.status,
            PaymentStatus::Released,
            "Payment not released after both confirmations"
        );
    }

    #[test]
    fn test_hospital_confirms_first() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(PaymentContract, ());
        let client = PaymentContractClient::new(&env, &contract_id);

        let admin = Address::generate(&env);
        let hospital = Address::generate(&env);
        let blood_bank = Address::generate(&env);
        let token = Address::generate(&env);

        client.initialize(&admin, &None);

        let payment_id = client
            .create_escrow(&1u64, &hospital, &blood_bank, &500i128, &token);

        // Hospital confirms FIRST
        client.confirm_receipt(&payment_id, &hospital);

        // Payment should still be locked
        let payment = client.get_payment(&payment_id);
        assert_eq!(payment.status, PaymentStatus::Locked);

        // Coordinator confirms SECOND
        client.release_escrow(&admin, &payment_id);

        // NOW payment should be released
        let payment = client.get_payment(&payment_id);
        assert_eq!(payment.status, PaymentStatus::Released);
    }
}
