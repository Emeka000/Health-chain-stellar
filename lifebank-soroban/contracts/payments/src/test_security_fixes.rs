#[cfg(test)]
mod security_tests {
    use crate::{DisputeReason, Error, PaymentContract, PaymentContractClient, PaymentStatus};
    use request_contract::{
        BloodComponent, BloodType, RequestContract, RequestContractClient, Urgency,
    };
    use soroban_sdk::{testutils::Address as _, Address, Env, String};

    /// Payment contract wired to a live request contract, with one Pending
    /// payment between a fresh payer and payee.
    fn setup_with_payment<'a>() -> (Env, PaymentContractClient<'a>, u64, Address, Address) {
        let env = Env::default();
        env.mock_all_auths();

        let requests_id = env.register(RequestContract, ());
        let requests = RequestContractClient::new(&env, &requests_id);
        requests.initialize(&Address::generate(&env), &Address::generate(&env));
        let hospital = Address::generate(&env);
        requests.authorize_hospital(&hospital);
        let request_id = requests.create_request(
            &hospital,
            &BloodType::OPositive,
            &BloodComponent::WholeBlood,
            &250u32,
            &Urgency::Routine,
            &(env.ledger().timestamp() + 3_600),
        );

        let cid = env.register(PaymentContract, ());
        let client = PaymentContractClient::new(&env, &cid);
        client.initialize(&Address::generate(&env), &Some(requests_id));

        // The payer must be the request's hospital (see #1619).
        let payee = Address::generate(&env);
        let payment_id = client.create_payment(&request_id, &hospital, &payee, &100i128);
        (env, client, payment_id, hospital, payee)
    }

    /// #1619: create_payment rejects a payer that isn't the request's hospital.
    #[test]
    fn test_create_payment_rejects_non_hospital_payer() {
        let env = Env::default();
        env.mock_all_auths();

        let requests_id = env.register(RequestContract, ());
        let requests = RequestContractClient::new(&env, &requests_id);
        requests.initialize(&Address::generate(&env), &Address::generate(&env));
        let hospital = Address::generate(&env);
        requests.authorize_hospital(&hospital);
        let request_id = requests.create_request(
            &hospital,
            &BloodType::OPositive,
            &BloodComponent::WholeBlood,
            &250u32,
            &Urgency::Routine,
            &(env.ledger().timestamp() + 3_600),
        );

        let cid = env.register(PaymentContract, ());
        let client = PaymentContractClient::new(&env, &cid);
        client.initialize(&Address::generate(&env), &Some(requests_id));

        let impostor = Address::generate(&env);
        let payee = Address::generate(&env);
        let result = client.try_create_payment(&request_id, &impostor, &payee, &100i128);

        assert_eq!(result, Err(Ok(Error::Unauthorized)));
    }

    /// #1619: create_escrow rejects a payer that isn't the request's hospital.
    #[test]
    fn test_create_escrow_rejects_non_hospital_payer() {
        let env = Env::default();
        env.mock_all_auths();

        let requests_id = env.register(RequestContract, ());
        let requests = RequestContractClient::new(&env, &requests_id);
        requests.initialize(&Address::generate(&env), &Address::generate(&env));
        let hospital = Address::generate(&env);
        requests.authorize_hospital(&hospital);
        let request_id = requests.create_request(
            &hospital,
            &BloodType::OPositive,
            &BloodComponent::WholeBlood,
            &250u32,
            &Urgency::Routine,
            &(env.ledger().timestamp() + 3_600),
        );

        let cid = env.register(PaymentContract, ());
        let client = PaymentContractClient::new(&env, &cid);
        client.initialize(&Address::generate(&env), &Some(requests_id));

        let impostor = Address::generate(&env);
        let payee = Address::generate(&env);
        let result = client.try_create_escrow(&request_id, &impostor, &payee, &100i128);

        assert_eq!(result, Err(Ok(Error::Unauthorized)));
    }

    /// #1152: Verify record_dispute requires caller to be payer or payee.
    /// A third party cannot open disputes on payments they're not part of.
    #[test]
    fn test_record_dispute_requires_party_involvement() {
        let (env, client, payment_id, _payer, _payee) = setup_with_payment();
        let third_party = Address::generate(&env);

        let result = client.try_record_dispute(
            &payment_id,
            &DisputeReason::PaymentContested,
            &String::from_str(&env, "case123"),
            &third_party,
        );

        assert_eq!(result, Err(Ok(Error::Unauthorized)));
    }

    /// #1152: Verify record_dispute succeeds when called by payer.
    #[test]
    fn test_record_dispute_by_payer_succeeds() {
        let (env, client, payment_id, payer, _payee) = setup_with_payment();

        client.record_dispute(
            &payment_id,
            &DisputeReason::PaymentContested,
            &String::from_str(&env, "case123"),
            &payer,
        );

        assert_eq!(
            client.get_payment(&payment_id).status,
            PaymentStatus::Disputed
        );
    }

    /// #1152: Verify record_dispute succeeds when called by payee.
    #[test]
    fn test_record_dispute_by_payee_succeeds() {
        let (env, client, payment_id, _payer, payee) = setup_with_payment();

        client.record_dispute(
            &payment_id,
            &DisputeReason::PaymentContested,
            &String::from_str(&env, "case123"),
            &payee,
        );

        assert_eq!(
            client.get_payment(&payment_id).status,
            PaymentStatus::Disputed
        );
    }
}
