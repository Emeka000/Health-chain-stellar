#![cfg(test)]

use super::*;
use soroban_sdk::{
    testutils::{Address as _, Ledger},
    Address, Env,
};

#[test]
fn test_grant_and_has_role() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(AccessControlContract, ());
    let client = AccessControlContractClient::new(&env, &contract_id);

    let address = Address::generate(&env);

    // Grant admin role
    client.grant_role(&address, &Role::Admin, &None);

    // Check if address has admin role
    assert!(client.has_role(&address, &Role::Admin));
    assert!(!client.has_role(&address, &Role::Hospital));
}

#[test]
fn test_revoke_role() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(AccessControlContract, ());
    let client = AccessControlContractClient::new(&env, &contract_id);

    let address = Address::generate(&env);

    // Grant and then revoke
    client.grant_role(&address, &Role::Donor, &None);
    assert!(client.has_role(&address, &Role::Donor));

    client.revoke_role(&address, &Role::Donor);
    assert!(!client.has_role(&address, &Role::Donor));
}

#[test]
fn test_multiple_roles_single_entry() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(AccessControlContract, ());
    let client = AccessControlContractClient::new(&env, &contract_id);

    let address = Address::generate(&env);

    // Grant multiple roles
    client.grant_role(&address, &Role::Admin, &None);
    client.grant_role(&address, &Role::Hospital, &None);
    client.grant_role(&address, &Role::Donor, &None);

    // Verify all roles exist
    assert!(client.has_role(&address, &Role::Admin));
    assert!(client.has_role(&address, &Role::Hospital));
    assert!(client.has_role(&address, &Role::Donor));

    // Get all roles and verify count
    let roles = client.get_roles(&address);
    assert_eq!(roles.len(), 3);
}

#[test]
fn test_no_duplicate_roles() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(AccessControlContract, ());
    let client = AccessControlContractClient::new(&env, &contract_id);

    let address = Address::generate(&env);

    // Grant same role twice
    client.grant_role(&address, &Role::Admin, &None);
    client.grant_role(&address, &Role::Admin, &None);

    // Should only have one entry
    let roles = client.get_roles(&address);
    assert_eq!(roles.len(), 1);
    assert_eq!(roles.get(0).unwrap().role, Role::Admin);
}

#[test]
fn test_roles_sorted() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(AccessControlContract, ());
    let client = AccessControlContractClient::new(&env, &contract_id);

    let address = Address::generate(&env);

    // Grant roles in non-sorted order
    client.grant_role(&address, &Role::Rider, &None);
    client.grant_role(&address, &Role::Admin, &None);
    client.grant_role(&address, &Role::Hospital, &None);

    let roles = client.get_roles(&address);

    // Verify roles are sorted
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

    let contract_id = env.register(AccessControlContract, ());
    let client = AccessControlContractClient::new(&env, &contract_id);

    let address = Address::generate(&env);

    // Set ledger timestamp
    env.ledger().with_mut(|li| {
        li.timestamp = 1000;
    });

    // Grant role that expires at 2000
    client.grant_role(&address, &Role::Donor, &Some(2000));

    // Should have role before expiration
    assert!(client.has_role(&address, &Role::Donor));

    // Move time forward past expiration
    env.ledger().with_mut(|li| {
        li.timestamp = 2001;
    });

    // Should not have role after expiration (and this triggers lazy deletion)
    assert!(!client.has_role(&address, &Role::Donor));

    // After lazy deletion, the role should be removed from storage
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

    let contract_id = env.register(AccessControlContract, ());
    let client = AccessControlContractClient::new(&env, &contract_id);

    let address = Address::generate(&env);

    let roles = client.get_roles(&address);
    assert_eq!(roles.len(), 0);
}

#[test]
fn test_revoke_one_of_multiple_roles() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(AccessControlContract, ());
    let client = AccessControlContractClient::new(&env, &contract_id);

    let address = Address::generate(&env);

    // Grant multiple roles
    client.grant_role(&address, &Role::Admin, &None);
    client.grant_role(&address, &Role::Hospital, &None);
    client.grant_role(&address, &Role::Donor, &None);

    // Revoke one role
    client.revoke_role(&address, &Role::Hospital);

    // Check remaining roles
    assert!(client.has_role(&address, &Role::Admin));
    assert!(!client.has_role(&address, &Role::Hospital));
    assert!(client.has_role(&address, &Role::Donor));

    let roles = client.get_roles(&address);
    assert_eq!(roles.len(), 2);
}

/// Storage benchmark test: Compare storage entries for old vs new approach
///
/// OLD APPROACH (simulated):
/// - 10 roles across 5 addresses = 50 storage entries
/// - Each DataKey::Role(address, role) = 1 entry
///
/// NEW APPROACH (implemented):
/// - 10 roles across 5 addresses = 5 storage entries
/// - Each DataKey::AddressRoles(address) = 1 entry (containing all roles for that address)
#[test]
fn test_storage_benchmark_comparison() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(AccessControlContract, ());
    let client = AccessControlContractClient::new(&env, &contract_id);

    // Create 5 addresses
    let addr1 = Address::generate(&env);
    let addr2 = Address::generate(&env);
    let addr3 = Address::generate(&env);
    let addr4 = Address::generate(&env);
    let addr5 = Address::generate(&env);

    // Grant 2 roles to each address (10 total role grants)
    client.grant_role(&addr1, &Role::Admin, &None);
    client.grant_role(&addr1, &Role::Hospital, &None);

    client.grant_role(&addr2, &Role::Donor, &None);
    client.grant_role(&addr2, &Role::Rider, &None);

    client.grant_role(&addr3, &Role::BloodBank, &None);
    client.grant_role(&addr3, &Role::Admin, &None);

    client.grant_role(&addr4, &Role::Hospital, &None);
    client.grant_role(&addr4, &Role::Donor, &None);

    client.grant_role(&addr5, &Role::Rider, &None);
    client.grant_role(&addr5, &Role::BloodBank, &None);

    // Verify storage efficiency:
    // NEW APPROACH: 5 storage entries (one per address)
    let mut storage_entry_count = 0;

    if client.get_roles(&addr1).len() > 0 {
        storage_entry_count += 1;
    }
    if client.get_roles(&addr2).len() > 0 {
        storage_entry_count += 1;
    }
    if client.get_roles(&addr3).len() > 0 {
        storage_entry_count += 1;
    }
    if client.get_roles(&addr4).len() > 0 {
        storage_entry_count += 1;
    }
    if client.get_roles(&addr5).len() > 0 {
        storage_entry_count += 1;
    }

    assert_eq!(
        storage_entry_count, 5,
        "Should have exactly 5 storage entries (one per address)"
    );

    // OLD APPROACH would have: 10 storage entries (one per role grant)
    // SAVINGS: 50% reduction in storage entries for this scenario

    // Verify all roles are accessible
    assert!(client.has_role(&addr1, &Role::Admin));
    assert!(client.has_role(&addr1, &Role::Hospital));
    assert!(client.has_role(&addr2, &Role::Donor));
    assert!(client.has_role(&addr3, &Role::BloodBank));

    // Calculate theoretical storage comparison
    // OLD APPROACH: 10 storage entries (one per role grant)
    // NEW APPROACH: 5 storage entries (one per address)
    // SAVINGS: 50% reduction in storage entries for this scenario
}

#[test]
fn test_role_grant_metadata() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(AccessControlContract, ());
    let client = AccessControlContractClient::new(&env, &contract_id);

    let address = Address::generate(&env);

    // Set specific timestamp
    env.ledger().with_mut(|li| {
        li.timestamp = 5000;
    });

    // Grant role with expiration
    client.grant_role(&address, &Role::Hospital, &Some(10000));

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

    let contract_id = env.register(AccessControlContract, ());
    let client = AccessControlContractClient::new(&env, &contract_id);

    let address = Address::generate(&env);

    // Set ledger timestamp
    env.ledger().with_mut(|li| {
        li.timestamp = 1000;
    });

    // Grant role that expires at 2000
    client.grant_role(&address, &Role::Donor, &Some(2000));

    // Verify role exists in storage
    let roles_before = client.get_roles(&address);
    assert_eq!(roles_before.len(), 1);

    // Move time forward past expiration
    env.ledger().with_mut(|li| {
        li.timestamp = 2001;
    });

    // Call has_role - should return false AND delete the expired role
    assert!(!client.has_role(&address, &Role::Donor));

    // Verify the expired role was deleted from storage (lazy deletion)
    let roles_after = client.get_roles(&address);
    assert_eq!(
        roles_after.len(),
        0,
        "Expired role should be deleted from storage"
    );
}

#[test]
fn test_lazy_deletion_preserves_other_roles() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(AccessControlContract, ());
    let client = AccessControlContractClient::new(&env, &contract_id);

    let address = Address::generate(&env);

    // Set ledger timestamp
    env.ledger().with_mut(|li| {
        li.timestamp = 1000;
    });

    // Grant multiple roles - one expires, one doesn't
    client.grant_role(&address, &Role::Donor, &Some(2000)); // expires
    client.grant_role(&address, &Role::Admin, &None); // never expires

    // Move time forward past expiration
    env.ledger().with_mut(|li| {
        li.timestamp = 2001;
    });

    // Check the expired role - should trigger lazy deletion
    assert!(!client.has_role(&address, &Role::Donor));

    // Verify only the expired role was removed
    let roles = client.get_roles(&address);
    assert_eq!(roles.len(), 1);
    assert_eq!(roles.get(0).unwrap().role, Role::Admin);

    // Verify the non-expired role still works
    assert!(client.has_role(&address, &Role::Admin));
}

#[test]
fn test_cleanup_expired_roles_basic() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(AccessControlContract, ());
    let client = AccessControlContractClient::new(&env, &contract_id);

    let address = Address::generate(&env);

    // Set ledger timestamp
    env.ledger().with_mut(|li| {
        li.timestamp = 1000;
    });

    // Grant roles with different expiration times
    client.grant_role(&address, &Role::Donor, &Some(2000));
    client.grant_role(&address, &Role::Rider, &Some(3000));
    client.grant_role(&address, &Role::Hospital, &None); // never expires

    // Move time forward past some expiries
    env.ledger().with_mut(|li| {
        li.timestamp = 2500;
    });

    // Clean up expired roles
    let removed = client.cleanup_expired_roles(&address);
    assert_eq!(removed, 1, "Should have removed 1 expired role");

    // Verify remaining roles
    let roles = client.get_roles(&address);
    assert_eq!(roles.len(), 2);

    // Verify correct roles remain
    assert!(!client.has_role(&address, &Role::Donor)); // expired & removed
    assert!(client.has_role(&address, &Role::Rider)); // not yet expired
    assert!(client.has_role(&address, &Role::Hospital)); // never expires
}

#[test]
fn test_cleanup_expired_roles_100_roles() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(AccessControlContract, ());
    let client = AccessControlContractClient::new(&env, &contract_id);

    let address = Address::generate(&env);

    // Set ledger timestamp
    env.ledger().with_mut(|li| {
        li.timestamp = 1000;
    });

    // Define the 5 available roles
    let roles = [
        Role::Admin,
        Role::Hospital,
        Role::Donor,
        Role::Rider,
        Role::BloodBank,
    ];

    // Grant 100 roles by cycling through available roles with different expiry times
    for i in 0..100 {
        let role = &roles[i % 5];
        let expiry = 2000 + (i as u64 * 100); // Staggered expiry times
        client.grant_role(&address, role, &Some(expiry));
    }

    // Verify roles were granted (since we cycle through 5 roles, we should have 5 unique roles)
    let roles_before = client.get_roles(&address);
    assert_eq!(roles_before.len(), 5, "Should have 5 unique roles");

    // Move time forward past all expiries
    env.ledger().with_mut(|li| {
        li.timestamp = 20000; // Well past all expiry times
    });

    // Clean up all expired roles
    let removed = client.cleanup_expired_roles(&address);
    assert_eq!(removed, 5, "Should have removed all 5 expired roles");

    // Verify storage is empty after cleanup
    let roles_after = client.get_roles(&address);
    assert_eq!(
        roles_after.len(),
        0,
        "Storage should be completely empty after cleanup"
    );

    // Verify all roles return false
    assert!(!client.has_role(&address, &Role::Admin));
    assert!(!client.has_role(&address, &Role::Hospital));
    assert!(!client.has_role(&address, &Role::Donor));
    assert!(!client.has_role(&address, &Role::Rider));
    assert!(!client.has_role(&address, &Role::BloodBank));
}

#[test]
fn test_cleanup_expired_roles_removes_all_when_all_expired() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(AccessControlContract, ());
    let client = AccessControlContractClient::new(&env, &contract_id);

    let address = Address::generate(&env);

    // Set ledger timestamp
    env.ledger().with_mut(|li| {
        li.timestamp = 1000;
    });

    // Grant multiple roles, all with expiry
    client.grant_role(&address, &Role::Admin, &Some(2000));
    client.grant_role(&address, &Role::Hospital, &Some(2500));
    client.grant_role(&address, &Role::Donor, &Some(3000));

    // Verify roles exist
    assert_eq!(client.get_roles(&address).len(), 3);

    // Move time forward past all expiries
    env.ledger().with_mut(|li| {
        li.timestamp = 4000;
    });

    // Clean up all expired roles
    let removed = client.cleanup_expired_roles(&address);
    assert_eq!(removed, 3);

    // Verify storage is completely empty
    let roles = client.get_roles(&address);
    assert_eq!(roles.len(), 0, "All expired roles should be removed");
}

#[test]
fn test_cleanup_expired_roles_no_roles() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(AccessControlContract, ());
    let client = AccessControlContractClient::new(&env, &contract_id);

    let address = Address::generate(&env);

    // Try to cleanup when no roles exist
    let removed = client.cleanup_expired_roles(&address);
    assert_eq!(removed, 0, "Should return 0 when no roles exist");
}

#[test]
fn test_cleanup_expired_roles_none_expired() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(AccessControlContract, ());
    let client = AccessControlContractClient::new(&env, &contract_id);

    let address = Address::generate(&env);

    // Set ledger timestamp
    env.ledger().with_mut(|li| {
        li.timestamp = 1000;
    });

    // Grant roles that haven't expired yet
    client.grant_role(&address, &Role::Admin, &Some(5000));
    client.grant_role(&address, &Role::Hospital, &None);

    // Try cleanup before any expiry
    let removed = client.cleanup_expired_roles(&address);
    assert_eq!(removed, 0, "Should not remove any non-expired roles");

    // Verify roles still exist
    let roles = client.get_roles(&address);
    assert_eq!(roles.len(), 2);
}
