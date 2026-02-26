#![no_std]
use soroban_sdk::{contract, contractimpl, contracttype, Address, Env, Vec};

/// Represents a role in the access control system
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq, Ord, PartialOrd)]
pub enum Role {
    Admin,
    Hospital,
    Donor,
    Rider,
    BloodBank,
    Custom(u32),
}

/// Represents a role grant with metadata
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct RoleGrant {
    pub role: Role,
    pub granted_at: u64,
    pub expires_at: Option<u64>,
}

/// Storage keys for the access control contract
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum DataKey {
    /// Consolidated storage: one entry per address containing all roles
    AddressRoles(Address),
    /// Admin address
    Admin,
}

#[contract]
pub struct AccessControlContract;

#[contractimpl]
impl AccessControlContract {
    /// Initialize the contract with an administrator
    pub fn initialize(env: Env, admin: Address) {
        if env.storage().persistent().has(&DataKey::Admin) {
            panic!("Already initialized");
        }
        env.storage().persistent().set(&DataKey::Admin, &admin);
    }

    /// Grant a role to an address
    ///
    /// # Arguments
    /// * `address` - The address to grant the role to
    /// * `role` - The role to grant
    /// * `expires_at` - Optional expiration timestamp
    pub fn grant_role_with_expiry(env: Env, address: Address, role: Role, expires_at: Option<u64>) {
        let admin: Address = env
            .storage()
            .persistent()
            .get(&DataKey::Admin)
            .expect("Not initialized");
        admin.require_auth();

        // Proactive cleanup: remove expired roles for this address first
        Self::cleanup_expired_roles_internal(&env, &address);

        let key = DataKey::AddressRoles(address.clone());
        let mut roles: Vec<RoleGrant> = env
            .storage()
            .persistent()
            .get(&key)
            .unwrap_or(Vec::new(&env));

        let granted_at = env.ledger().timestamp();
        let new_grant = RoleGrant {
            role: role.clone(),
            granted_at,
            expires_at,
        };

        // Remove any existing grant for this role to avoid duplicates
        roles = Self::remove_role_from_vec(&env, roles, &role);

        // Insert the new grant in sorted order
        roles = Self::insert_sorted(&env, roles, new_grant);

        env.storage().persistent().set(&key, &roles);
    }

    /// Revoke a role from an address
    ///
    /// # Arguments
    /// * `address` - The address to revoke the role from
    /// * `role` - The role to revoke
    pub fn revoke_role(env: Env, address: Address, role: Role) {
        let admin: Address = env
            .storage()
            .persistent()
            .get(&DataKey::Admin)
            .expect("Not initialized");
        admin.require_auth();

        let key = DataKey::AddressRoles(address.clone());

        if let Some(mut roles) = env
            .storage()
            .persistent()
            .get::<DataKey, Vec<RoleGrant>>(&key)
        {
            roles = Self::remove_role_from_vec(&env, roles, &role);

            if roles.is_empty() {
                env.storage().persistent().remove(&key);
            } else {
                env.storage().persistent().set(&key, &roles);
            }
        }
    }

    /// Check if an address has a specific role
    ///
    /// # Arguments
    /// * `address` - The address to check
    /// * `role` - The role to check for
    ///
    /// # Returns
    /// `true` if the address has the role and it hasn't expired, `false` otherwise
    ///
    /// Implementation Note
    /// This function implements lazy deletion: if it encounters ANY expired role grants
    /// for the user, it will remove them all from storage before returning.
    pub fn has_role(env: Env, address: Address, role: Role) -> bool {
        // Full lazy deletion: clean up ALL expired roles for this address
        Self::cleanup_expired_roles_internal(&env, &address);

        let key = DataKey::AddressRoles(address);

        if let Some(roles) = env
            .storage()
            .persistent()
            .get::<DataKey, Vec<RoleGrant>>(&key)
        {
            for i in 0..roles.len() {
                let grant = roles.get(i).unwrap();
                if grant.role == role {
                    // We already performed cleanup, so if it's here, it's valid
                    return true;
                }
            }
        }

        false
    }

    /// Get all roles for an address
    ///
    /// # Arguments
    /// * `address` - The address to get roles for
    ///
    /// # Returns
    /// A vector of all role grants for the address (including expired ones)
    pub fn get_roles(env: Env, address: Address) -> Vec<RoleGrant> {
        let key = DataKey::AddressRoles(address);
        env.storage()
            .persistent()
            .get(&key)
            .unwrap_or(Vec::new(&env))
    }

    /// Clean up all expired role grants for an address
    ///
    /// This function proactively removes all expired role grants from storage for a given address.
    /// It's useful for batch cleanup operations to reduce storage footprint.
    ///
    /// # Arguments
    /// * `address` - The address to clean up expired roles for
    ///
    /// Returns
    /// The number of expired roles that were removed
    pub fn cleanup_expired_roles(env: Env, address: Address) -> u32 {
        let admin: Address = env
            .storage()
            .persistent()
            .get(&DataKey::Admin)
            .expect("Not initialized");
        admin.require_auth();

        Self::cleanup_expired_roles_internal(&env, &address)
    }

    /// Internal helper for cleaning up expired roles
    fn cleanup_expired_roles_internal(env: &Env, address: &Address) -> u32 {
        let key = DataKey::AddressRoles(address.clone());

        if let Some(roles) = env
            .storage()
            .persistent()
            .get::<DataKey, Vec<RoleGrant>>(&key)
        {
            let current_time = env.ledger().timestamp();
            let mut new_roles = Vec::new(env);
            let mut removed_count = 0u32;

            // Filter out expired roles
            for i in 0..roles.len() {
                let grant = roles.get(i).unwrap();
                let is_expired = if let Some(expires_at) = grant.expires_at {
                    current_time >= expires_at
                } else {
                    false
                };

                if is_expired {
                    removed_count += 1;
                } else {
                    new_roles.push_back(grant);
                }
            }

            // Update storage
            if removed_count > 0 {
                if new_roles.is_empty() {
                    env.storage().persistent().remove(&key);
                } else {
                    env.storage().persistent().set(&key, &new_roles);
                }
            }

            removed_count
        } else {
            0
        }
    }

    /// Helper function to remove a role from a vector
    fn remove_role_from_vec(env: &Env, roles: Vec<RoleGrant>, role: &Role) -> Vec<RoleGrant> {
        let mut new_roles = Vec::new(env);
        for i in 0..roles.len() {
            let grant = roles.get(i).unwrap();
            if &grant.role != role {
                new_roles.push_back(grant);
            }
        }
        new_roles
    }

    /// Helper function to insert a role grant in sorted order
    fn insert_sorted(env: &Env, roles: Vec<RoleGrant>, new_grant: RoleGrant) -> Vec<RoleGrant> {
        let mut new_roles = Vec::new(env);
        let mut inserted = false;

        for i in 0..roles.len() {
            let grant = roles.get(i).unwrap();
            if !inserted && new_grant.role < grant.role {
                new_roles.push_back(new_grant.clone());
                inserted = true;
            }
            new_roles.push_back(grant);
        }

        if !inserted {
            new_roles.push_back(new_grant);
        }

        new_roles
    }
}

mod test;
