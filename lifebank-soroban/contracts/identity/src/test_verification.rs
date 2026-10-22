#[cfg(test)]
mod tests {
    use soroban_sdk::{testutils::Address as _, Address, BytesN, Env, String, Vec};

    use crate::{
        verification::{VerificationImpl, VerificationTrait},
        Error, IdentityContract, IdentityContractClient, OrgType,
    };

    struct Setup<'a> {
        env: Env,
        contract_id: Address,
        client: IdentityContractClient<'a>,
        admin: Address,
    }

    fn setup<'a>() -> Setup<'a> {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let contract_id = env.register(IdentityContract, ());
        let client = IdentityContractClient::new(&env, &contract_id);
        client.initialize(&admin);

        Setup {
            env,
            contract_id,
            client,
            admin,
        }
    }

    /// Registers an organization owned by a fresh address. The returned
    /// org_id is that owner address.
    fn register_org(s: &Setup, org_type: OrgType, name: &str, license: &str) -> Address {
        let owner = Address::generate(&s.env);
        s.client.register_organization(
            &owner,
            &org_type,
            &String::from_str(&s.env, name),
            &String::from_str(&s.env, license),
            &BytesN::from_array(&s.env, &[0u8; 32]),
            &Vec::new(&s.env),
        )
    }

    #[test]
    fn test_verify_organization_success() {
        let s = setup();
        let org_id = register_org(&s, OrgType::BloodBank, "Blood Bank Alpha", "LIC-001");

        let metadata = s.env.as_contract(&s.contract_id, || {
            VerificationImpl::verify_organization(s.env.clone(), s.admin.clone(), org_id.clone())
        })
        .unwrap();

        assert!(metadata.verified);
        assert!(metadata.verified_at.is_some());
        assert_eq!(metadata.verified_by, Some(s.admin.clone()));
        assert!(metadata.revoked_at.is_none());
    }

    #[test]
    fn test_verify_organization_already_verified() {
        let s = setup();
        let org_id = register_org(&s, OrgType::Hospital, "Hospital Beta", "LIC-002");

        s.client.verify_organization(&s.admin, &org_id);

        let result = s.client.try_verify_organization(&s.admin, &org_id);
        assert_eq!(result, Err(Ok(Error::AlreadyVerified)));
    }

    #[test]
    fn test_unverify_organization_success() {
        let s = setup();
        let org_id = register_org(&s, OrgType::BloodBank, "Blood Bank Gamma", "LIC-003");

        s.client.verify_organization(&s.admin, &org_id);

        let reason = String::from_str(&s.env, "Compliance violation");
        let metadata = s.env.as_contract(&s.contract_id, || {
            VerificationImpl::unverify_organization(
                s.env.clone(),
                s.admin.clone(),
                org_id.clone(),
                reason.clone(),
            )
        })
        .unwrap();

        assert!(!metadata.verified);
        assert!(metadata.verified_at.is_none());
        assert!(metadata.revoked_at.is_some());
        assert_eq!(metadata.revocation_reason, Some(reason));
    }

    #[test]
    fn test_get_verification_metadata() {
        let s = setup();
        let org_id = register_org(&s, OrgType::Hospital, "Hospital Delta", "LIC-004");

        s.client.verify_organization(&s.admin, &org_id);

        let metadata = s.env.as_contract(&s.contract_id, || {
            VerificationImpl::get_verification_metadata(s.env.clone(), org_id.clone())
        })
        .unwrap();

        assert!(metadata.verified);
        assert_eq!(metadata.org_id, org_id);
    }

    #[test]
    fn test_is_organization_verified() {
        let s = setup();
        let org_id = register_org(&s, OrgType::BloodBank, "Blood Bank Epsilon", "LIC-005");
        let is_verified = || {
            s.env.as_contract(&s.contract_id, || {
                VerificationImpl::is_organization_verified(s.env.clone(), org_id.clone())
            })
            .unwrap()
        };

        // Before verification
        assert!(!is_verified());

        // After verification
        s.client.verify_organization(&s.admin, &org_id);
        assert!(is_verified());

        // After revocation
        s.client
            .unverify_organization(&s.admin, &org_id, &String::from_str(&s.env, "Test"));
        assert!(!is_verified());
    }

    #[test]
    fn test_get_verification_timestamp() {
        let s = setup();
        let org_id = register_org(&s, OrgType::Hospital, "Hospital Zeta", "LIC-006");
        let timestamp = || {
            s.env.as_contract(&s.contract_id, || {
                VerificationImpl::get_verification_timestamp(s.env.clone(), org_id.clone())
            })
            .unwrap()
        };

        // Before verification
        assert!(timestamp().is_none());

        // After verification
        s.client.verify_organization(&s.admin, &org_id);
        assert!(timestamp().is_some());
    }

    #[test]
    fn test_batch_verify_organizations() {
        let s = setup();
        let mut org_ids = Vec::new(&s.env);
        org_ids.push_back(register_org(&s, OrgType::BloodBank, "Bank 0", "LIC-100"));
        org_ids.push_back(register_org(&s, OrgType::BloodBank, "Bank 1", "LIC-101"));
        org_ids.push_back(register_org(&s, OrgType::BloodBank, "Bank 2", "LIC-102"));

        let verified_count = s.env.as_contract(&s.contract_id, || {
            VerificationImpl::batch_verify_organizations(
                s.env.clone(),
                s.admin.clone(),
                org_ids.clone(),
            )
        });
        assert_eq!(verified_count, Ok(3));

        for org_id in org_ids.iter() {
            let org = s.client.get_organization(&org_id).unwrap();
            assert!(org.verified);
        }
    }

    #[test]
    fn test_batch_revoke_organizations() {
        let s = setup();
        let mut org_ids = Vec::new(&s.env);
        for (name, license) in [
            ("Hospital 0", "LIC-200"),
            ("Hospital 1", "LIC-201"),
            ("Hospital 2", "LIC-202"),
        ] {
            let org_id = register_org(&s, OrgType::Hospital, name, license);
            s.client.verify_organization(&s.admin, &org_id);
            org_ids.push_back(org_id);
        }

        let reason = String::from_str(&s.env, "Batch revocation test");
        let revoked_count = s.env.as_contract(&s.contract_id, || {
            VerificationImpl::batch_revoke_organizations(
                s.env.clone(),
                s.admin.clone(),
                org_ids.clone(),
                reason,
            )
        });
        assert_eq!(revoked_count, Ok(3));

        for org_id in org_ids.iter() {
            let org = s.client.get_organization(&org_id).unwrap();
            assert!(!org.verified);
        }
    }

    #[test]
    fn test_verification_events_recorded() {
        let s = setup();
        let org_id = register_org(&s, OrgType::BloodBank, "Blood Bank Eta", "LIC-007");

        s.client.verify_organization(&s.admin, &org_id);

        let events = s.env.as_contract(&s.contract_id, || {
            VerificationImpl::get_verification_events(s.env.clone(), org_id.clone(), 10)
        })
        .unwrap();
        assert_eq!(events.len(), 1);

        let first_event = events.get(0).unwrap();
        assert_eq!(first_event.event_type, String::from_str(&s.env, "verified"));
    }

    #[test]
    fn test_unauthorized_verification() {
        let s = setup();
        let org_id = register_org(&s, OrgType::Hospital, "Hospital Theta", "LIC-008");
        let other_admin = Address::generate(&s.env);

        let result = s.client.try_verify_organization(&other_admin, &org_id);
        assert_eq!(result, Err(Ok(Error::Unauthorized)));
    }

    /// Issue #1449: pause() must block every verification mutation.
    #[test]
    fn test_pause_blocks_verification_paths() {
        let s = setup();
        let unverified = register_org(&s, OrgType::Hospital, "Hospital Iota", "LIC-009");
        let verified = register_org(&s, OrgType::BloodBank, "Blood Bank Kappa", "LIC-010");
        s.client.verify_organization(&s.admin, &verified);

        s.client.pause(&s.admin);

        let reason = String::from_str(&s.env, "paused");
        assert_eq!(
            s.client.try_verify_organization(&s.admin, &unverified),
            Err(Ok(Error::ContractPaused))
        );
        assert_eq!(
            s.client.try_unverify_organization(&s.admin, &verified, &reason),
            Err(Ok(Error::ContractPaused))
        );

        let mut to_verify = Vec::new(&s.env);
        to_verify.push_back(unverified.clone());
        let mut to_revoke = Vec::new(&s.env);
        to_revoke.push_back(verified.clone());
        let batch_verify = s.env.as_contract(&s.contract_id, || {
            VerificationImpl::batch_verify_organizations(s.env.clone(), s.admin.clone(), to_verify)
        });
        assert_eq!(batch_verify, Err(Error::ContractPaused));

        let batch_revoke = s.env.as_contract(&s.contract_id, || {
            VerificationImpl::batch_revoke_organizations(
                s.env.clone(),
                s.admin.clone(),
                to_revoke,
                reason,
            )
        });
        assert_eq!(batch_revoke, Err(Error::ContractPaused));

        assert!(!s.client.get_organization(&unverified).unwrap().verified);
        assert!(s.client.get_organization(&verified).unwrap().verified);
    }
}
