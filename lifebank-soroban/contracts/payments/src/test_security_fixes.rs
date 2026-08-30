#[cfg(test)]
mod security_tests {
    use crate::{Error, PaymentStatus, PaymentContract, DisputeResolution};
    use soroban_sdk::{testutils::Address as _, Address, Env};

    /// #1152: Verify record_dispute requires caller to be payer or payee.
    /// A third party cannot open disputes on payments they're not part of.
    #[test]
    fn test_record_dispute_requires_party_involvement() {
        let env = Env::default();
        let admin = Address::random(&env);
        let payer = Address::random(&env);
        let payee = Address::random(&env);
        let third_party = Address::random(&env);

        env.mock_all_auths();

        PaymentContract::initialize(&env, admin).unwrap();

        let payment_id = PaymentContract::create_payment(
            env.clone(),
            1,
            payer.clone(),
            payee.clone(),
            100,
        )
        .unwrap();

        let dispute_result = PaymentContract::record_dispute(
            env.clone(),
            payment_id,
            crate::DisputeReason::PaymentContested,
            String::from_slice(&env, "case123"),
            third_party,
        );

        assert_eq!(dispute_result, Err(Error::Unauthorized));
    }

    /// #1152: Verify record_dispute succeeds when called by payer.
    #[test]
    fn test_record_dispute_by_payer_succeeds() {
        let env = Env::default();
        let admin = Address::random(&env);
        let payer = Address::random(&env);
        let payee = Address::random(&env);

        env.mock_all_auths();

        PaymentContract::initialize(&env, admin).unwrap();

        let payment_id = PaymentContract::create_payment(
            env.clone(),
            1,
            payer.clone(),
            payee.clone(),
            100,
        )
        .unwrap();

        let result = PaymentContract::record_dispute(
            env.clone(),
            payment_id,
            crate::DisputeReason::PaymentContested,
            String::from_slice(&env, "case123"),
            payer,
        );

        assert!(result.is_ok());
    }

    /// #1152: Verify record_dispute succeeds when called by payee.
    #[test]
    fn test_record_dispute_by_payee_succeeds() {
        let env = Env::default();
        let admin = Address::random(&env);
        let payer = Address::random(&env);
        let payee = Address::random(&env);

        env.mock_all_auths();

        PaymentContract::initialize(&env, admin).unwrap();

        let payment_id = PaymentContract::create_payment(
            env.clone(),
            1,
            payer.clone(),
            payee.clone(),
            100,
        )
        .unwrap();

        let result = PaymentContract::record_dispute(
            env.clone(),
            payment_id,
            crate::DisputeReason::PaymentContested,
            String::from_slice(&env, "case123"),
            payee,
        );

        assert!(result.is_ok());
    }
}
