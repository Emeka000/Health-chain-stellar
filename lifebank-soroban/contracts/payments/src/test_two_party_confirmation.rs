//! Test for issue #848: Two-party confirmation for payment release

#[cfg(test)]
mod confirmation_tests {
    use crate::{PaymentContract, PaymentContractClient, PaymentStatus};
    use soroban_sdk::{
        testutils::{Address as _, MockAuth, MockAuthInvoke},
        Address, Env, IntoVal,
    };

    #[test]
    fn test_payment_requires_both_confirmations() {
        let env = Env::default();
        let contract_id = env.register_contract(None, PaymentContract);
        let client = PaymentContractClient::new(&env, &contract_id);

        let admin = Address::generate(&env);
        let hospital = Address::generate(&env);
        let blood_bank = Address::generate(&env);
        let token = Address::generate(&env);

        // Initialize contract
        env.mock_auths(&[MockAuth {
            address: &admin,
            invoke: &MockAuthInvoke {
                contract: &contract_id,
                fn_name: "initialize",
                args: (&admin, &None::<Address>).into_val(&env),
                sub_invokes: &[],
            },
        }]);
        client.initialize(&admin, &None);

        // Create escrow payment (hospital pays blood bank)
        env.mock_auths(&[MockAuth {
            address: &hospital,
            invoke: &MockAuthInvoke {
                contract: &contract_id,
                fn_name: "create_escrow",
                args: (&1u64, &hospital, &blood_bank, &1000i128, &token).into_val(&env),
                sub_invokes: &[],
            },
        }]);
        
        // Mock token transfer
        env.mock_auths(&[MockAuth {
            address: &token,
            invoke: &MockAuthInvoke {
                contract: &token,
                fn_name: "transfer",
                args: (&hospital, &contract_id, &1000i128).into_val(&env),
                sub_invokes: &[],
            },
        }]);

        let payment_id = client
            .create_escrow(&1u64, &hospital, &blood_bank, &1000i128, &token)
            .unwrap();

        // Verify payment is locked
        let payment = client.get_payment(&payment_id).unwrap();
        assert_eq!(payment.status, PaymentStatus::Locked);

        // Coordinator confirms delivery (admin calls release_escrow)
        env.mock_auths(&[MockAuth {
            address: &admin,
            invoke: &MockAuthInvoke {
                contract: &contract_id,
                fn_name: "release_escrow",
                args: (&admin, &payment_id).into_val(&env),
                sub_invokes: &[],
            },
        }]);
        client.release_escrow(&admin, &payment_id).unwrap();

        // Payment should STILL be locked (waiting for hospital confirmation)
        let payment = client.get_payment(&payment_id).unwrap();
        assert_eq!(
            payment.status,
            PaymentStatus::Locked,
            "Payment released with only coordinator confirmation!"
        );

        // Hospital confirms receipt
        env.mock_auths(&[MockAuth {
            address: &hospital,
            invoke: &MockAuthInvoke {
                contract: &contract_id,
                fn_name: "confirm_receipt",
                args: (&payment_id, &hospital).into_val(&env),
                sub_invokes: &[],
            },
        }]);
        
        // Mock token transfer for release
        env.mock_auths(&[MockAuth {
            address: &token,
            invoke: &MockAuthInvoke {
                contract: &token,
                fn_name: "transfer",
                args: (&contract_id, &blood_bank, &1000i128).into_val(&env),
                sub_invokes: &[],
            },
        }]);

        client.confirm_receipt(&payment_id, &hospital).unwrap();

        // NOW payment should be released (both parties confirmed)
        let payment = client.get_payment(&payment_id).unwrap();
        assert_eq!(
            payment.status,
            PaymentStatus::Released,
            "Payment not released after both confirmations"
        );
    }

    #[test]
    fn test_hospital_confirms_first() {
        let env = Env::default();
        let contract_id = env.register_contract(None, PaymentContract);
        let client = PaymentContractClient::new(&env, &contract_id);

        let admin = Address::generate(&env);
        let hospital = Address::generate(&env);
        let blood_bank = Address::generate(&env);
        let token = Address::generate(&env);

        env.mock_auths(&[MockAuth {
            address: &admin,
            invoke: &MockAuthInvoke {
                contract: &contract_id,
                fn_name: "initialize",
                args: (&admin, &None::<Address>).into_val(&env),
                sub_invokes: &[],
            },
        }]);
        client.initialize(&admin, &None);

        env.mock_auths(&[MockAuth {
            address: &hospital,
            invoke: &MockAuthInvoke {
                contract: &contract_id,
                fn_name: "create_escrow",
                args: (&1u64, &hospital, &blood_bank, &500i128, &token).into_val(&env),
                sub_invokes: &[],
            },
        }]);
        
        env.mock_auths(&[MockAuth {
            address: &token,
            invoke: &MockAuthInvoke {
                contract: &token,
                fn_name: "transfer",
                args: (&hospital, &contract_id, &500i128).into_val(&env),
                sub_invokes: &[],
            },
        }]);

        let payment_id = client
            .create_escrow(&1u64, &hospital, &blood_bank, &500i128, &token)
            .unwrap();

        // Hospital confirms FIRST
        env.mock_auths(&[MockAuth {
            address: &hospital,
            invoke: &MockAuthInvoke {
                contract: &contract_id,
                fn_name: "confirm_receipt",
                args: (&payment_id, &hospital).into_val(&env),
                sub_invokes: &[],
            },
        }]);
        client.confirm_receipt(&payment_id, &hospital).unwrap();

        // Payment should still be locked
        let payment = client.get_payment(&payment_id).unwrap();
        assert_eq!(payment.status, PaymentStatus::Locked);

        // Coordinator confirms SECOND
        env.mock_auths(&[MockAuth {
            address: &admin,
            invoke: &MockAuthInvoke {
                contract: &contract_id,
                fn_name: "release_escrow",
                args: (&admin, &payment_id).into_val(&env),
                sub_invokes: &[],
            },
        }]);
        
        env.mock_auths(&[MockAuth {
            address: &token,
            invoke: &MockAuthInvoke {
                contract: &token,
                fn_name: "transfer",
                args: (&contract_id, &blood_bank, &500i128).into_val(&env),
                sub_invokes: &[],
            },
        }]);

        client.release_escrow(&admin, &payment_id).unwrap();

        // NOW payment should be released
        let payment = client.get_payment(&payment_id).unwrap();
        assert_eq!(payment.status, PaymentStatus::Released);
    }
}
