#![cfg(test)]

use super::*;
use soroban_sdk::{testutils::Address as _, testutils::Ledger as _, vec, Address, BytesN, Env, String};

// ---------------------------------------------------------------------------
// IdentityContract tests
// ---------------------------------------------------------------------------

#[test]
fn test_register_organization() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(IdentityContract, ());
    let client = IdentityContractClient::new(&env, &contract_id);

    let owner = Address::generate(&env);
    let name = String::from_str(&env, "City Blood Bank");
    let license = String::from_str(&env, "L12345");
    let location_hash = BytesN::from_array(&env, &[0u8; 32]);
    let doc_hashes = vec![&env, BytesN::from_array(&env, &[1u8; 32])];

    let org_id = client.register_organization(
        &owner,
        &OrgType::BloodBank,
        &name,
        &license,
        &location_hash,
        &doc_hashes,
    );

    assert_eq!(org_id, owner);

    let org = client.get_organization(&org_id).unwrap();
    assert_eq!(org.name, name);
    assert_eq!(org.license_number, license);
    assert_eq!(org.org_type, OrgType::BloodBank);
    assert_eq!(org.verified, false);

    let role = client.get_role(&org_id).unwrap();
    assert_eq!(role, Role::BloodBank);
}

#[test]
fn test_register_duplicate_license() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(IdentityContract, ());
    let client = IdentityContractClient::new(&env, &contract_id);

    let owner1 = Address::generate(&env);
    let owner2 = Address::generate(&env);
    let name = String::from_str(&env, "Org");
    let license = String::from_str(&env, "DUP123");
    let location_hash = BytesN::from_array(&env, &[0u8; 32]);
    let doc_hashes = vec![&env];

    client.register_organization(
        &owner1,
        &OrgType::BloodBank,
        &name,
        &license,
        &location_hash,
        &doc_hashes,
    );

    let result = client.try_register_organization(
        &owner2,
        &OrgType::Hospital,
        &name,
        &license,
        &location_hash,
        &doc_hashes,
    );

    assert_eq!(result, Err(Ok(Error::LicenseAlreadyRegistered)));
}

#[test]
fn test_register_invalid_input() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(IdentityContract, ());
    let client = IdentityContractClient::new(&env, &contract_id);

    let owner = Address::generate(&env);
    let empty_name = String::from_str(&env, "");
    let license = String::from_str(&env, "L123");
    let location_hash = BytesN::from_array(&env, &[0u8; 32]);
    let doc_hashes = vec![&env];

    let result = client.try_register_organization(
        &owner,
        &OrgType::BloodBank,
        &empty_name,
        &license,
        &location_hash,
        &doc_hashes,
    );

    assert_eq!(result, Err(Ok(Error::InvalidInput)));
}

#[test]
fn test_has_role() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(IdentityContract, ());
    let client = IdentityContractClient::new(&env, &contract_id);

    let owner = Address::generate(&env);
    let name = String::from_str(&env, "Hospital A");
    let license = String::from_str(&env, "H001");
    let location_hash = BytesN::from_array(&env, &[0u8; 32]);

    client.register_organization(
        &owner,
        &OrgType::Hospital,
        &name,
        &license,
        &location_hash,
        &vec![&env],
    );

    assert!(client.has_role(&owner, &Role::Hospital));
    assert!(!client.has_role(&owner, &Role::BloodBank));
}

#[test]
fn test_get_organizations_by_type() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(IdentityContract, ());
    let client = IdentityContractClient::new(&env, &contract_id);

    let loc = BytesN::from_array(&env, &[0u8; 32]);

    let bb1 = Address::generate(&env);
    client.register_organization(
        &bb1,
        &OrgType::BloodBank,
        &String::from_str(&env, "BB1"),
        &String::from_str(&env, "BB001"),
        &loc,
        &vec![&env],
    );

    let h1 = Address::generate(&env);
    client.register_organization(
        &h1,
        &OrgType::Hospital,
        &String::from_str(&env, "H1"),
        &String::from_str(&env, "H001"),
        &loc,
        &vec![&env],
    );

    let bb2 = Address::generate(&env);
    client.register_organization(
        &bb2,
        &OrgType::BloodBank,
        &String::from_str(&env, "BB2"),
        &String::from_str(&env, "BB002"),
        &loc,
        &vec![&env],
    );

    let banks = client.get_organizations_by_type(&OrgType::BloodBank, &10);
    assert_eq!(banks.len(), 2);

    let hospitals = client.get_organizations_by_type(&OrgType::Hospital, &10);
    assert_eq!(hospitals.len(), 1);
}

#[test]
fn test_get_verified_organizations() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(IdentityContract, ());
    let client = IdentityContractClient::new(&env, &contract_id);

    let loc = BytesN::from_array(&env, &[0u8; 32]);

    // Register two orgs — neither verified yet
    let bb1 = Address::generate(&env);
    client.register_organization(
        &bb1,
        &OrgType::BloodBank,
        &String::from_str(&env, "BB1"),
        &String::from_str(&env, "VBB001"),
        &loc,
        &vec![&env],
    );

    let verified = client.get_verified_organizations(&OrgType::BloodBank, &10);
    assert_eq!(verified.len(), 0);
}

// ---------------------------------------------------------------------------
// Rating tests
// ---------------------------------------------------------------------------

#[test]
fn test_rate_organization_valid() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(IdentityContract, ());
    let client = IdentityContractClient::new(&env, &contract_id);

    let owner = Address::generate(&env);
    let loc = BytesN::from_array(&env, &[0u8; 32]);
    client.register_organization(
        &owner,
        &OrgType::BloodBank,
        &String::from_str(&env, "Test Bank"),
        &String::from_str(&env, "RORG001"),
        &loc,
        &vec![&env],
    );

    let rater = Address::generate(&env);
    client.rate_organization(&rater, &owner, &4, &1_u64);

    let org = client.get_organization(&owner).unwrap();
    assert_eq!(org.rating, 4);
    assert_eq!(org.total_ratings, 1);
}

#[test]
fn test_rate_organization_average() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(IdentityContract, ());
    let client = IdentityContractClient::new(&env, &contract_id);

    let owner = Address::generate(&env);
    let loc = BytesN::from_array(&env, &[0u8; 32]);
    client.register_organization(
        &owner,
        &OrgType::BloodBank,
        &String::from_str(&env, "Avg Bank"),
        &String::from_str(&env, "AVGB001"),
        &loc,
        &vec![&env],
    );

    let rater1 = Address::generate(&env);
    let rater2 = Address::generate(&env);

    client.rate_organization(&rater1, &owner, &4, &1_u64);
    client.rate_organization(&rater2, &owner, &2, &2_u64);

    let org = client.get_organization(&owner).unwrap();
    assert_eq!(org.total_ratings, 2);
    // (4 + 2) / 2 = 3
    assert_eq!(org.rating, 3);
}

#[test]
fn test_rate_organization_invalid_rating_zero() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(IdentityContract, ());
    let client = IdentityContractClient::new(&env, &contract_id);

    let owner = Address::generate(&env);
    let loc = BytesN::from_array(&env, &[0u8; 32]);
    client.register_organization(
        &owner,
        &OrgType::BloodBank,
        &String::from_str(&env, "Bank"),
        &String::from_str(&env, "INV001"),
        &loc,
        &vec![&env],
    );

    let rater = Address::generate(&env);
    let result = client.try_rate_organization(&rater, &owner, &0, &1_u64);
    assert_eq!(result, Err(Ok(Error::InvalidRating)));
}

#[test]
fn test_rate_organization_invalid_rating_six() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(IdentityContract, ());
    let client = IdentityContractClient::new(&env, &contract_id);

    let owner = Address::generate(&env);
    let loc = BytesN::from_array(&env, &[0u8; 32]);
    client.register_organization(
        &owner,
        &OrgType::BloodBank,
        &String::from_str(&env, "Bank"),
        &String::from_str(&env, "INV002"),
        &loc,
        &vec![&env],
    );

    let rater = Address::generate(&env);
    let result = client.try_rate_organization(&rater, &owner, &6, &1_u64);
    assert_eq!(result, Err(Ok(Error::InvalidRating)));
}

#[test]
fn test_rate_organization_duplicate_prevented() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(IdentityContract, ());
    let client = IdentityContractClient::new(&env, &contract_id);

    let owner = Address::generate(&env);
    let loc = BytesN::from_array(&env, &[0u8; 32]);
    client.register_organization(
        &owner,
        &OrgType::BloodBank,
        &String::from_str(&env, "Bank"),
        &String::from_str(&env, "DUP001"),
        &loc,
        &vec![&env],
    );

    let rater = Address::generate(&env);
    client.rate_organization(&rater, &owner, &5, &1_u64);

    let result = client.try_rate_organization(&rater, &owner, &3, &1_u64);
    assert_eq!(result, Err(Ok(Error::AlreadyRated)));
}

#[test]
fn test_rate_organization_not_found() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(IdentityContract, ());
    let client = IdentityContractClient::new(&env, &contract_id);

    let rater = Address::generate(&env);
    let ghost = Address::generate(&env);

    let result = client.try_rate_organization(&rater, &ghost, &3, &1_u64);
    assert_eq!(result, Err(Ok(Error::OrganizationNotFound)));
}

#[test]
fn test_rating_record_stored() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(IdentityContract, ());
    let client = IdentityContractClient::new(&env, &contract_id);

    let owner = Address::generate(&env);
    let loc = BytesN::from_array(&env, &[0u8; 32]);
    client.register_organization(
        &owner,
        &OrgType::BloodBank,
        &String::from_str(&env, "Bank"),
        &String::from_str(&env, "REC001"),
        &loc,
        &vec![&env],
    );

    let rater = Address::generate(&env);
    client.rate_organization(&rater, &owner, &5, &42_u64);

    let rec = client.get_rating_record(&42_u64, &rater).unwrap();
    assert_eq!(rec.rating, 5);
    assert_eq!(rec.request_id, 42);
}

#[test]
fn test_get_organization_rating() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(IdentityContract, ());
    let client = IdentityContractClient::new(&env, &contract_id);

    let owner = Address::generate(&env);
    let loc = BytesN::from_array(&env, &[0u8; 32]);
    client.register_organization(
        &owner,
        &OrgType::BloodBank,
        &String::from_str(&env, "Bank"),
        &String::from_str(&env, "GR001"),
        &loc,
        &vec![&env],
    );

    assert_eq!(client.get_organization_rating(&owner), 0);

    let rater = Address::generate(&env);
    client.rate_organization(&rater, &owner, &5, &1_u64);
    assert_eq!(client.get_organization_rating(&owner), 5);
}

// ---------------------------------------------------------------------------
// Badge tests
// ---------------------------------------------------------------------------

#[test]
fn test_award_badge() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(IdentityContract, ());
    let client = IdentityContractClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    client.initialize(&admin);

    let owner = Address::generate(&env);
    let loc = BytesN::from_array(&env, &[0u8; 32]);
    client.register_organization(
        &owner,
        &OrgType::BloodBank,
        &String::from_str(&env, "Bank"),
        &String::from_str(&env, "BADGE001"),
        &loc,
        &vec![&env],
    );

    client.award_badge(&admin, &owner, &BadgeType::TopRated);

    let badges = client.get_badges(&owner);
    assert_eq!(badges.len(), 1);
    assert_eq!(badges.get(0).unwrap().badge_type, BadgeType::TopRated);
}

#[test]
fn test_award_badge_duplicate_prevented() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(IdentityContract, ());
    let client = IdentityContractClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    client.initialize(&admin);

    let owner = Address::generate(&env);
    let loc = BytesN::from_array(&env, &[0u8; 32]);
    client.register_organization(
        &owner,
        &OrgType::BloodBank,
        &String::from_str(&env, "Bank"),
        &String::from_str(&env, "BADGE002"),
        &loc,
        &vec![&env],
    );

    client.award_badge(&admin, &owner, &BadgeType::TopRated);
    let result = client.try_award_badge(&admin, &owner, &BadgeType::TopRated);
    assert_eq!(result, Err(Ok(Error::BadgeAlreadyAwarded)));
}

#[test]
fn test_revoke_badge() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(IdentityContract, ());
    let client = IdentityContractClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    client.initialize(&admin);

    let owner = Address::generate(&env);
    let loc = BytesN::from_array(&env, &[0u8; 32]);
    client.register_organization(
        &owner,
        &OrgType::BloodBank,
        &String::from_str(&env, "Bank"),
        &String::from_str(&env, "BADGE003"),
        &loc,
        &vec![&env],
    );

    client.award_badge(&admin, &owner, &BadgeType::FastResponse);
    client.revoke_badge(&admin, &owner, &BadgeType::FastResponse);

    let badges = client.get_badges(&owner);
    assert_eq!(badges.len(), 0);
}

#[test]
fn test_revoke_badge_not_found() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(IdentityContract, ());
    let client = IdentityContractClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    client.initialize(&admin);

    let owner = Address::generate(&env);
    let loc = BytesN::from_array(&env, &[0u8; 32]);
    client.register_organization(
        &owner,
        &OrgType::BloodBank,
        &String::from_str(&env, "Bank"),
        &String::from_str(&env, "BADGE004"),
        &loc,
        &vec![&env],
    );

    let result = client.try_revoke_badge(&admin, &owner, &BadgeType::LongService);
    assert_eq!(result, Err(Ok(Error::BadgeNotFound)));
}

// ---------------------------------------------------------------------------
// Delivery verification tests
// ---------------------------------------------------------------------------

#[test]
fn test_verify_delivery() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(IdentityContract, ());
    let client = IdentityContractClient::new(&env, &contract_id);

    let owner = Address::generate(&env);
    let loc = BytesN::from_array(&env, &[0u8; 32]);
    client.register_organization(
        &owner,
        &OrgType::BloodBank,
        &String::from_str(&env, "Bank"),
        &String::from_str(&env, "DEL001"),
        &loc,
        &vec![&env],
    );

    let verifier = Address::generate(&env);
    let recipient = Address::generate(&env);

    client.verify_delivery(&verifier, &1_u64, &owner, &recipient, &500_u32, &true);

    let proof = client.get_delivery(&1_u64).unwrap();
    assert_eq!(proof.request_id, 1);
    assert_eq!(proof.quantity_delivered, 500);
    assert!(proof.temperature_ok);
    assert!(proof.verified);
}

#[test]
fn test_verify_delivery_invalid_quantity() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(IdentityContract, ());
    let client = IdentityContractClient::new(&env, &contract_id);

    let owner = Address::generate(&env);
    let loc = BytesN::from_array(&env, &[0u8; 32]);
    client.register_organization(
        &owner,
        &OrgType::BloodBank,
        &String::from_str(&env, "Bank"),
        &String::from_str(&env, "DEL002"),
        &loc,
        &vec![&env],
    );

    let verifier = Address::generate(&env);
    let recipient = Address::generate(&env);
    let result = client.try_verify_delivery(&verifier, &1_u64, &owner, &recipient, &0_u32, &true);
    assert_eq!(result, Err(Ok(Error::InvalidDeliveryProof)));
}

#[test]
fn test_verify_delivery_org_not_found() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(IdentityContract, ());
    let client = IdentityContractClient::new(&env, &contract_id);

    let verifier = Address::generate(&env);
    let ghost = Address::generate(&env);
    let recipient = Address::generate(&env);

    let result = client.try_verify_delivery(&verifier, &1_u64, &ghost, &recipient, &100_u32, &true);
    assert_eq!(result, Err(Ok(Error::OrganizationNotFound)));
}

// ---------------------------------------------------------------------------
// Top-rated query tests
// ---------------------------------------------------------------------------

#[test]
fn test_get_top_rated_organizations() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(IdentityContract, ());
    let client = IdentityContractClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    client.initialize(&admin);

    let loc = BytesN::from_array(&env, &[0u8; 32]);

    // Register 3 blood banks
    let bb1 = Address::generate(&env);
    client.register_organization(
        &bb1,
        &OrgType::BloodBank,
        &String::from_str(&env, "BB1"),
        &String::from_str(&env, "TOP001"),
        &loc,
        &vec![&env],
    );
    let bb2 = Address::generate(&env);
    client.register_organization(
        &bb2,
        &OrgType::BloodBank,
        &String::from_str(&env, "BB2"),
        &String::from_str(&env, "TOP002"),
        &loc,
        &vec![&env],
    );
    let bb3 = Address::generate(&env);
    client.register_organization(
        &bb3,
        &OrgType::BloodBank,
        &String::from_str(&env, "BB3"),
        &String::from_str(&env, "TOP003"),
        &loc,
        &vec![&env],
    );

    // None are verified → top-rated returns empty
    let top = client.get_top_rated_organizations(&OrgType::BloodBank, &3);
    assert_eq!(top.len(), 0);
}

// ---------------------------------------------------------------------------
// AccessControlContract tests (unchanged logic, updated role variants)
// ---------------------------------------------------------------------------

#[test]
fn test_grant_and_has_role() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let contract_id = env.register(AccessControlContract, ());
    let client = AccessControlContractClient::new(&env, &contract_id);
    client.initialize(&admin);

    let address = Address::generate(&env);

    client.grant_role_with_expiry(&address, &Role::Admin, &None);

    assert!(client.has_role(&address, &Role::Admin));
    assert!(!client.has_role(&address, &Role::Hospital));
}

#[test]
fn test_revoke_role() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let contract_id = env.register(AccessControlContract, ());
    let client = AccessControlContractClient::new(&env, &contract_id);
    client.initialize(&admin);

    let address = Address::generate(&env);

    client.grant_role_with_expiry(&address, &Role::Donor, &None);
    assert!(client.has_role(&address, &Role::Donor));

    client.revoke_role(&address, &Role::Donor);
    assert!(!client.has_role(&address, &Role::Donor));
}

#[test]
fn test_multiple_roles_single_entry() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let contract_id = env.register(AccessControlContract, ());
    let client = AccessControlContractClient::new(&env, &contract_id);
    client.initialize(&admin);

    let address = Address::generate(&env);

    client.grant_role_with_expiry(&address, &Role::Admin, &None);
    client.grant_role_with_expiry(&address, &Role::Hospital, &None);
    client.grant_role_with_expiry(&address, &Role::Donor, &None);

    assert!(client.has_role(&address, &Role::Admin));
    assert!(client.has_role(&address, &Role::Hospital));
    assert!(client.has_role(&address, &Role::Donor));

    let roles = client.get_roles(&address);
    assert_eq!(roles.len(), 3);
}

#[test]
fn test_no_duplicate_roles() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let contract_id = env.register(AccessControlContract, ());
    let client = AccessControlContractClient::new(&env, &contract_id);
    client.initialize(&admin);

    let address = Address::generate(&env);

    client.grant_role_with_expiry(&address, &Role::Admin, &None);
    client.grant_role_with_expiry(&address, &Role::Admin, &None);

    let roles = client.get_roles(&address);
    assert_eq!(roles.len(), 1);
    assert_eq!(roles.get(0).unwrap().role, Role::Admin);
}

#[test]
fn test_roles_sorted() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let contract_id = env.register(AccessControlContract, ());
    let client = AccessControlContractClient::new(&env, &contract_id);
    client.initialize(&admin);

    let address = Address::generate(&env);

    client.grant_role_with_expiry(&address, &Role::Rider, &None);
    client.grant_role_with_expiry(&address, &Role::Admin, &None);
    client.grant_role_with_expiry(&address, &Role::Hospital, &None);

    let roles = client.get_roles(&address);

    for i in 0..(roles.len() - 1) {
        let current = roles.get(i).unwrap();
        let next = roles.get(i + 1).unwrap();
        assert!(current.role < next.role);
    }
}

#[test]
fn test_role_expiration() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let contract_id = env.register(AccessControlContract, ());
    let client = AccessControlContractClient::new(&env, &contract_id);
    client.initialize(&admin);

    let address = Address::generate(&env);

    env.ledger().with_mut(|li| {
        li.timestamp = 1000;
    });

    client.grant_role_with_expiry(&address, &Role::Donor, &Some(2000));
    assert!(client.has_role(&address, &Role::Donor));

    env.ledger().with_mut(|li| {
        li.timestamp = 2001;
    });

    assert!(!client.has_role(&address, &Role::Donor));

    let roles = client.get_roles(&address);
    assert_eq!(
        roles.len(),
        0,
        "Expired role should be removed via lazy deletion"
    );
}

#[test]
fn test_get_roles_empty() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let contract_id = env.register(AccessControlContract, ());
    let client = AccessControlContractClient::new(&env, &contract_id);
    client.initialize(&admin);

    let address = Address::generate(&env);
    let roles = client.get_roles(&address);
    assert_eq!(roles.len(), 0);
}

#[test]
fn test_revoke_one_of_multiple_roles() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let contract_id = env.register(AccessControlContract, ());
    let client = AccessControlContractClient::new(&env, &contract_id);
    client.initialize(&admin);

    let address = Address::generate(&env);

    client.grant_role_with_expiry(&address, &Role::Admin, &None);
    client.grant_role_with_expiry(&address, &Role::Hospital, &None);
    client.grant_role_with_expiry(&address, &Role::Donor, &None);

    client.revoke_role(&address, &Role::Hospital);

    assert!(client.has_role(&address, &Role::Admin));
    assert!(!client.has_role(&address, &Role::Hospital));
    assert!(client.has_role(&address, &Role::Donor));

    let roles = client.get_roles(&address);
    assert_eq!(roles.len(), 2);
}

#[test]
fn test_storage_benchmark_comparison() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let contract_id = env.register(AccessControlContract, ());
    let client = AccessControlContractClient::new(&env, &contract_id);
    client.initialize(&admin);

    let addr1 = Address::generate(&env);
    let addr2 = Address::generate(&env);
    let addr3 = Address::generate(&env);
    let addr4 = Address::generate(&env);
    let addr5 = Address::generate(&env);

    client.grant_role_with_expiry(&addr1, &Role::Admin, &None);
    client.grant_role_with_expiry(&addr1, &Role::Hospital, &None);

    client.grant_role_with_expiry(&addr2, &Role::Donor, &None);
    client.grant_role_with_expiry(&addr2, &Role::Rider, &None);

    client.grant_role_with_expiry(&addr3, &Role::BloodBank, &None);
    client.grant_role_with_expiry(&addr3, &Role::Admin, &None);

    client.grant_role_with_expiry(&addr4, &Role::Hospital, &None);
    client.grant_role_with_expiry(&addr4, &Role::Donor, &None);

    client.grant_role_with_expiry(&addr5, &Role::Rider, &None);
    client.grant_role_with_expiry(&addr5, &Role::BloodBank, &None);

    let mut storage_entry_count = 0;
    if client.get_roles(&addr1).len() > 0 { storage_entry_count += 1; }
    if client.get_roles(&addr2).len() > 0 { storage_entry_count += 1; }
    if client.get_roles(&addr3).len() > 0 { storage_entry_count += 1; }
    if client.get_roles(&addr4).len() > 0 { storage_entry_count += 1; }
    if client.get_roles(&addr5).len() > 0 { storage_entry_count += 1; }

    assert_eq!(storage_entry_count, 5);

    assert!(client.has_role(&addr1, &Role::Admin));
    assert!(client.has_role(&addr1, &Role::Hospital));
    assert!(client.has_role(&addr2, &Role::Donor));
    assert!(client.has_role(&addr3, &Role::BloodBank));
}

#[test]
fn test_role_grant_metadata() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let contract_id = env.register(AccessControlContract, ());
    let client = AccessControlContractClient::new(&env, &contract_id);
    client.initialize(&admin);

    let address = Address::generate(&env);

    env.ledger().with_mut(|li| {
        li.timestamp = 5000;
    });

    client.grant_role_with_expiry(&address, &Role::Hospital, &Some(10000));

    let roles = client.get_roles(&address);
    assert_eq!(roles.len(), 1);

    let grant = roles.get(0).unwrap();
    assert_eq!(grant.role, Role::Hospital);
    assert_eq!(grant.granted_at, 5000);
    assert_eq!(grant.expires_at, Some(10000));
}

#[test]
fn test_lazy_deletion_in_has_role() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let contract_id = env.register(AccessControlContract, ());
    let client = AccessControlContractClient::new(&env, &contract_id);
    client.initialize(&admin);

    let address = Address::generate(&env);

    env.ledger().with_mut(|li| {
        li.timestamp = 1000;
    });

    client.grant_role_with_expiry(&address, &Role::Donor, &Some(2000));

    let roles_before = client.get_roles(&address);
    assert_eq!(roles_before.len(), 1);

    env.ledger().with_mut(|li| {
        li.timestamp = 2001;
    });

    assert!(!client.has_role(&address, &Role::Donor));

    let roles_after = client.get_roles(&address);
    assert_eq!(roles_after.len(), 0, "Expired role should be deleted from storage");
}

#[test]
fn test_lazy_deletion_preserves_other_roles() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let contract_id = env.register(AccessControlContract, ());
    let client = AccessControlContractClient::new(&env, &contract_id);
    client.initialize(&admin);

    let address = Address::generate(&env);

    env.ledger().with_mut(|li| {
        li.timestamp = 1000;
    });

    client.grant_role_with_expiry(&address, &Role::Donor, &Some(2000));
    client.grant_role_with_expiry(&address, &Role::Admin, &None);

    env.ledger().with_mut(|li| {
        li.timestamp = 2001;
    });

    assert!(!client.has_role(&address, &Role::Donor));

    let roles = client.get_roles(&address);
    assert_eq!(roles.len(), 1);
    assert_eq!(roles.get(0).unwrap().role, Role::Admin);

    assert!(client.has_role(&address, &Role::Admin));
}

#[test]
fn test_cleanup_expired_roles_basic() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let contract_id = env.register(AccessControlContract, ());
    let client = AccessControlContractClient::new(&env, &contract_id);
    client.initialize(&admin);

    let address = Address::generate(&env);

    env.ledger().with_mut(|li| {
        li.timestamp = 1000;
    });

    client.grant_role_with_expiry(&address, &Role::Donor, &Some(2000));
    client.grant_role_with_expiry(&address, &Role::Rider, &Some(3000));
    client.grant_role_with_expiry(&address, &Role::Hospital, &None);

    env.ledger().with_mut(|li| {
        li.timestamp = 2500;
    });

    let removed = client.cleanup_expired_roles(&address);
    assert_eq!(removed, 1, "Should have removed 1 expired role");

    let roles = client.get_roles(&address);
    assert_eq!(roles.len(), 2);

    assert!(!client.has_role(&address, &Role::Donor));
    assert!(client.has_role(&address, &Role::Rider));
    assert!(client.has_role(&address, &Role::Hospital));
}

#[test]
fn test_cleanup_expired_roles_removes_all_when_all_expired() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let contract_id = env.register(AccessControlContract, ());
    let client = AccessControlContractClient::new(&env, &contract_id);
    client.initialize(&admin);

    let address = Address::generate(&env);

    env.ledger().with_mut(|li| {
        li.timestamp = 1000;
    });

    client.grant_role_with_expiry(&address, &Role::Admin, &Some(2000));
    client.grant_role_with_expiry(&address, &Role::Hospital, &Some(2500));
    client.grant_role_with_expiry(&address, &Role::Donor, &Some(3000));

    assert_eq!(client.get_roles(&address).len(), 3);

    env.ledger().with_mut(|li| {
        li.timestamp = 4000;
    });

    let removed = client.cleanup_expired_roles(&address);
    assert_eq!(removed, 3);

    let roles = client.get_roles(&address);
    assert_eq!(roles.len(), 0);
}

#[test]
fn test_cleanup_expired_roles_no_roles() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let contract_id = env.register(AccessControlContract, ());
    let client = AccessControlContractClient::new(&env, &contract_id);
    client.initialize(&admin);

    let address = Address::generate(&env);
    let removed = client.cleanup_expired_roles(&address);
    assert_eq!(removed, 0);
}

#[test]
fn test_cleanup_expired_roles_none_expired() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let contract_id = env.register(AccessControlContract, ());
    let client = AccessControlContractClient::new(&env, &contract_id);
    client.initialize(&admin);

    let address = Address::generate(&env);

    env.ledger().with_mut(|li| {
        li.timestamp = 1000;
    });

    client.grant_role_with_expiry(&address, &Role::Admin, &Some(5000));
    client.grant_role_with_expiry(&address, &Role::Hospital, &None);

    let removed = client.cleanup_expired_roles(&address);
    assert_eq!(removed, 0);

    let roles = client.get_roles(&address);
    assert_eq!(roles.len(), 2);
}

#[test]
#[should_panic(expected = "Already initialized")]
fn test_already_initialized() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let contract_id = env.register(AccessControlContract, ());
    let client = AccessControlContractClient::new(&env, &contract_id);
    client.initialize(&admin);
    client.initialize(&admin);
}

#[test]
#[should_panic(expected = "Not initialized")]
fn test_not_initialized() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(AccessControlContract, ());
    let client = AccessControlContractClient::new(&env, &contract_id);
    let address = Address::generate(&env);
    client.grant_role_with_expiry(&address, &Role::Admin, &None);
}
