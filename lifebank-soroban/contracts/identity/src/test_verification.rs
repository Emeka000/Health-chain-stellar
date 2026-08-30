#[cfg(test)]
mod tests {
    use soroban_sdk::{testutils::Address as _, Address, Env, String};

    use crate::{
        verification::{VerificationImpl, VerificationTrait},
        IdentityContract, IdentityContractClient, OrgType,
    };

    fn setup() -> (Env, Address, Address, Address) {
        let env = Env::default();
        let admin = Address::random(&env);
        let org_owner = Address::random(&env);
        let other_admin = Address::random(&env);

        let contract_id = env.register_contract(None, IdentityContract);
        let client = IdentityContractClient::new(&env, &contract_id);

        client.initialize(&admin);

        (env, admin, org_owner, other_admin)
    }

    #[test]
    fn test_verify_organization_success() {
        let (env, admin, org_owner, _) = setup();
        let contract_id = env.register_contract(None, IdentityContract);
        let client = IdentityContractClient::new(&env, &contract_id);

        // Register organization
        let org_id = client.register_organization(
            &org_owner,
            &OrgType::BloodBank,
            &String::from_str(&env, "Blood Bank Alpha"),
            &String::from_str(&env, "LIC-001"),
            &[0u8; 32].into(),
            &soroban_sdk::Vec::new(&env),
        );

        // Verify organization
        let metadata = client.verify_organization(&admin, &org_id);

        assert!(metadata.verified);
        assert!(metadata.verified_at.is_some());
        assert_eq!(metadata.verified_by, Some(admin.clone()));
        assert!(metadata.revoked_at.is_none());
    }

    #[test]
    fn test_verify_organization_already_verified() {
        let (env, admin, org_owner, _) = setup();
        let contract_id = env.register_contract(None, IdentityContract);
        let client = IdentityContractClient::new(&env, &contract_id);

        let org_id = client.register_organization(
            &org_owner,
            &OrgType::Hospital,
            &String::from_str(&env, "Hospital Beta"),
            &String::from_str(&env, "LIC-002"),
            &[0u8; 32].into(),
            &soroban_sdk::Vec::new(&env),
        );

        // Verify once
        client.verify_organization(&admin, &org_id);

        // Try to verify again - should fail
        let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            client.verify_organization(&admin, &org_id)
        }));

        assert!(result.is_err());
    }

    #[test]
    fn test_unverify_organization_success() {
        let (env, admin, org_owner, _) = setup();
        let contract_id = env.register_contract(None, IdentityContract);
        let client = IdentityContractClient::new(&env, &contract_id);

        let org_id = client.register_organization(
            &org_owner,
            &OrgType::BloodBank,
            &String::from_str(&env, "Blood Bank Gamma"),
            &String::from_str(&env, "LIC-003"),
            &[0u8; 32].into(),
            &soroban_sdk::Vec::new(&env),
        );

        // Verify
        client.verify_organization(&admin, &org_id);

        // Unverify
        let reason = String::from_str(&env, "Compliance violation");
        let metadata = client.unverify_organization(&admin, &org_id, &reason);

        assert!(!metadata.verified);
        assert!(metadata.verified_at.is_none());
        assert!(metadata.revoked_at.is_some());
        assert_eq!(metadata.revocation_reason, Some(reason));
    }

    #[test]
    fn test_get_verification_metadata() {
        let (env, admin, org_owner, _) = setup();
        let contract_id = env.register_contract(None, IdentityContract);
        let client = IdentityContractClient::new(&env, &contract_id);

        let org_id = client.register_organization(
            &org_owner,
            &OrgType::Hospital,
            &String::from_str(&env, "Hospital Delta"),
            &String::from_str(&env, "LIC-004"),
            &[0u8; 32].into(),
            &soroban_sdk::Vec::new(&env),
        );

        client.verify_organization(&admin, &org_id);

        let metadata = client.get_verification_metadata(&org_id);

        assert!(metadata.verified);
        assert_eq!(metadata.org_id, org_id);
    }

    #[test]
    fn test_is_organization_verified() {
        let (env, admin, org_owner, _) = setup();
        let contract_id = env.register_contract(None, IdentityContract);
        let client = IdentityContractClient::new(&env, &contract_id);

        let org_id = client.register_organization(
            &org_owner,
            &OrgType::BloodBank,
            &String::from_str(&env, "Blood Bank Epsilon"),
            &String::from_str(&env, "LIC-005"),
            &[0u8; 32].into(),
            &soroban_sdk::Vec::new(&env),
        );

        // Before verification
        assert!(!client.is_organization_verified(&org_id));

        // After verification
        client.verify_organization(&admin, &org_id);
        assert!(client.is_organization_verified(&org_id));

        // After revocation
        client.unverify_organization(&admin, &org_id, &String::from_str(&env, "Test"));
        assert!(!client.is_organization_verified(&org_id));
    }

    #[test]
    fn test_get_verification_timestamp() {
        let (env, admin, org_owner, _) = setup();
        let contract_id = env.register_contract(None, IdentityContract);
        let client = IdentityContractClient::new(&env, &contract_id);

        let org_id = client.register_organization(
            &org_owner,
            &OrgType::Hospital,
            &String::from_str(&env, "Hospital Zeta"),
            &String::from_str(&env, "LIC-006"),
            &[0u8; 32].into(),
            &soroban_sdk::Vec::new(&env),
        );

        // Before verification
        let ts_before = client.get_verification_timestamp(&org_id);
        assert!(ts_before.is_none());

        // After verification
        client.verify_organization(&admin, &org_id);
        let ts_after = client.get_verification_timestamp(&org_id);
        assert!(ts_after.is_some());
    }

    #[test]
    fn test_batch_verify_organizations() {
        let (env, admin, org_owner, _) = setup();
        let contract_id = env.register_contract(None, IdentityContract);
        let client = IdentityContractClient::new(&env, &contract_id);

        // Register multiple organizations
        let mut org_ids = soroban_sdk::Vec::new(&env);
        for i in 0..3 {
            let org_id = client.register_organization(
                &org_owner,
                &OrgType::BloodBank,
                &String::from_str(&env, &format!("Bank {}", i)),
                &String::from_str(&env, &format!("LIC-{:03}", 100 + i)),
                &[0u8; 32].into(),
                &soroban_sdk::Vec::new(&env),
            );
            org_ids.push_back(org_id);
        }

        // Batch verify
        let verified_count = client.batch_verify_organizations(&admin, &org_ids);
        assert_eq!(verified_count, 3);

        // Verify all are verified
        for i in 0..org_ids.len() {
            let org_id = org_ids.get(i).unwrap();
            assert!(client.is_organization_verified(&org_id));
        }
    }

    #[test]
    fn test_batch_revoke_organizations() {
        let (env, admin, org_owner, _) = setup();
        let contract_id = env.register_contract(None, IdentityContract);
        let client = IdentityContractClient::new(&env, &contract_id);

        // Register and verify multiple organizations
        let mut org_ids = soroban_sdk::Vec::new(&env);
        for i in 0..3 {
            let org_id = client.register_organization(
                &org_owner,
                &OrgType::Hospital,
                &String::from_str(&env, &format!("Hospital {}", i)),
                &String::from_str(&env, &format!("LIC-{:03}", 200 + i)),
                &[0u8; 32].into(),
                &soroban_sdk::Vec::new(&env),
            );
            client.verify_organization(&admin, &org_id);
            org_ids.push_back(org_id);
        }

        // Batch revoke
        let reason = String::from_str(&env, "Batch revocation test");
        let revoked_count = client.batch_revoke_organizations(&admin, &org_ids, &reason);
        assert_eq!(revoked_count, 3);

        // Verify all are revoked
        for i in 0..org_ids.len() {
            let org_id = org_ids.get(i).unwrap();
            assert!(!client.is_organization_verified(&org_id));
        }
    }

    #[test]
    fn test_verification_events_recorded() {
        let (env, admin, org_owner, _) = setup();
        let contract_id = env.register_contract(None, IdentityContract);
        let client = IdentityContractClient::new(&env, &contract_id);

        let org_id = client.register_organization(
            &org_owner,
            &OrgType::BloodBank,
            &String::from_str(&env, "Blood Bank Eta"),
            &String::from_str(&env, "LIC-007"),
            &[0u8; 32].into(),
            &soroban_sdk::Vec::new(&env),
        );

        // Verify
        client.verify_organization(&admin, &org_id);

        // Get events
        let events = client.get_verification_events(&org_id, 10);
        assert!(events.len() > 0);

        let first_event = events.get(0).unwrap();
        assert_eq!(first_event.event_type, String::from_str(&env, "verified"));
    }

    #[test]
    fn test_unauthorized_verification() {
        let (env, admin, org_owner, other_admin) = setup();
        let contract_id = env.register_contract(None, IdentityContract);
        let client = IdentityContractClient::new(&env, &contract_id);

        let org_id = client.register_organization(
            &org_owner,
            &OrgType::Hospital,
            &String::from_str(&env, "Hospital Theta"),
            &String::from_str(&env, "LIC-008"),
            &[0u8; 32].into(),
            &soroban_sdk::Vec::new(&env),
        );

        // Try to verify with non-admin - should fail
        let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            client.verify_organization(&other_admin, &org_id)
        }));

        assert!(result.is_err());
    }
}
