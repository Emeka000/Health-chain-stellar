#![no_std]
use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, symbol_short, Address, BytesN, Env,
    String, Vec,
};

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Error {
    InvalidInput = 200,
    LicenseAlreadyRegistered = 201,
    InvalidOrgType = 202,
    AlreadyInitialized = 203,
    Unauthorized = 204,
}

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum OrgType {
    BloodBank,
    Hospital,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
pub enum Role {
    Admin,
    BloodBank,
    Hospital,
    Donor,
    Rider,
    Custom(u32),
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum BadgeType {
    TopRated,
    HighCompliance,
    FastResponse,
    LongService,
    VerifiedProvider,
}

// ---------------------------------------------------------------------------
// Structs
// ---------------------------------------------------------------------------

#[contracttype]
#[derive(Clone, Debug)]
pub struct Organization {
    pub id: Address,
    pub org_type: OrgType,
    pub name: String,
    pub license_number: String,
    pub verified: bool,
    pub verified_timestamp: Option<u64>,
    pub rating: u32,
    pub total_ratings: u32,
    pub location_hash: BytesN<32>,
}

#[contracttype]
#[derive(Clone, Debug)]
pub struct OrganizationRegistered {
    pub org_id: Address,
    pub org_type: OrgType,
    pub name: String,
}

#[contracttype]
#[derive(Clone, Debug)]
pub struct RoleGrant {
    pub role: Role,
    pub granted_at: u64,
    pub expires_at: Option<u64>,
}

#[contracttype]
#[derive(Clone, Debug)]
pub struct RatingRecord {
    pub rater: Address,
    pub org_id: Address,
    pub rating: u32,
    pub request_id: u64,
    pub timestamp: u64,
}

#[contracttype]
#[derive(Clone, Debug)]
pub struct BadgeRecord {
    pub org_id: Address,
    pub badge_type: BadgeType,
    pub awarded_at: u64,
    pub awarded_by: Address,
}

#[contracttype]
#[derive(Clone, Debug)]
pub struct DeliveryProof {
    pub request_id: u64,
    pub org_id: Address,
    pub recipient: Address,
    pub quantity_delivered: u32,
    pub temperature_ok: bool,
    pub delivered_at: u64,
    pub verified: bool,
    pub verified_at: Option<u64>,
}

// ---------------------------------------------------------------------------
// Storage Keys
// ---------------------------------------------------------------------------

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum DataKey {
    // IdentityContract
    Org(Address),
    License(String),
    Docs(Address),
    Role(Address),
    OrgCounter,
    Admin,
    OrgTypeList(OrgType),
    // Rating
    RatedFlag(u64, Address),
    RatingRecord(u64, Address),
    // Badges
    OrgBadges(Address),
    // Delivery
    Delivery(u64),
    // AccessControlContract
    AddressRoles(Address),
}

// ---------------------------------------------------------------------------
// IdentityContract
// ---------------------------------------------------------------------------

#[contract]
pub struct IdentityContract;

#[contractimpl]
impl IdentityContract {
    /// Initialize the contract with an admin
    pub fn initialize(env: Env, admin: Address) -> Result<(), Error> {
        if env.storage().instance().has(&DataKey::Admin) {
            return Err(Error::AlreadyInitialized);
        }
        env.storage().instance().set(&DataKey::Admin, &admin);
        Self::grant_role(env, admin, Role::Admin);
        Ok(())
    }

    /// Register a new organization
    pub fn register_organization(
        env: Env,
        owner: Address,
        org_type: OrgType,
        name: String,
        license_number: String,
        location_hash: BytesN<32>,
        document_hashes: Vec<BytesN<32>>,
    ) -> Result<Address, Error> {
        owner.require_auth();

        if name.len() == 0 || license_number.len() == 0 {
            return Err(Error::InvalidInput);
        }

        let license_key = DataKey::License(license_number.clone());
        if env.storage().persistent().has(&license_key) {
            return Err(Error::LicenseAlreadyRegistered);
        }

        let org_id = owner.clone();

        let organization = Organization {
            id: org_id.clone(),
            org_type: org_type.clone(),
            name: name.clone(),
            license_number: license_number.clone(),
            verified: false,
            verified_timestamp: None,
            rating: 0,
            total_ratings: 0,
            location_hash,
        };

        env.storage()
            .persistent()
            .set(&DataKey::Org(org_id.clone()), &organization);
        env.storage().persistent().set(&license_key, &org_id);
        env.storage()
            .persistent()
            .set(&DataKey::Docs(org_id.clone()), &document_hashes);

        // Assign role
        let role = match org_type.clone() {
            OrgType::BloodBank => Role::BloodBank,
            OrgType::Hospital => Role::Hospital,
        };
        Self::grant_role(env.clone(), org_id.clone(), role);

        // Add to type index
        let type_key = DataKey::OrgTypeList(org_type.clone());
        let mut list: Vec<Address> = env
            .storage()
            .persistent()
            .get(&type_key)
            .unwrap_or(Vec::new(&env));
        list.push_back(org_id.clone());
        env.storage().persistent().set(&type_key, &list);

        Self::increment_counter(&env, DataKey::OrgCounter);

        env.events().publish(
            (symbol_short!("org_reg"),),
            OrganizationRegistered {
                org_id: org_id.clone(),
                org_type,
                name,
            },
        );

        Ok(org_id)
    }

    /// Internal helper to grant a role to an address
    pub fn grant_role(env: Env, address: Address, role: Role) {
        env.storage()
            .persistent()
            .set(&DataKey::Role(address), &role);
    }

    /// Get the role of an address
    pub fn get_role(env: Env, address: Address) -> Option<Role> {
        env.storage().persistent().get(&DataKey::Role(address))
    }

    /// Get organization by ID
    pub fn get_organization(env: Env, org_id: Address) -> Option<Organization> {
        env.storage().persistent().get(&DataKey::Org(org_id))
    }

    /// Check if an address has a given role
    pub fn has_role(env: Env, account: Address, role: Role) -> bool {
        let stored: Option<Role> = env.storage().persistent().get(&DataKey::Role(account));
        stored.map(|r| r == role).unwrap_or(false)
    }

    /// Return all organizations of the given type (up to max_results)
    pub fn get_organizations_by_type(
        env: Env,
        org_type: OrgType,
        max_results: u32,
    ) -> Vec<Organization> {
        let list: Vec<Address> = env
            .storage()
            .persistent()
            .get(&DataKey::OrgTypeList(org_type))
            .unwrap_or(Vec::new(&env));

        let mut results = Vec::new(&env);
        let limit = max_results.min(list.len());
        for i in 0..limit {
            let addr = list.get(i).unwrap();
            if let Some(org) = env.storage().persistent().get(&DataKey::Org(addr)) {
                results.push_back(org);
            }
        }
        results
    }

    /// Return verified organizations of the given type (up to max_results)
    pub fn get_verified_organizations(
        env: Env,
        org_type: OrgType,
        max_results: u32,
    ) -> Vec<Organization> {
        let list: Vec<Address> = env
            .storage()
            .persistent()
            .get(&DataKey::OrgTypeList(org_type))
            .unwrap_or(Vec::new(&env));

        let mut results = Vec::new(&env);
        for i in 0..list.len() {
            if results.len() >= max_results {
                break;
            }
            let addr = list.get(i).unwrap();
            if let Some(org) = env
                .storage()
                .persistent()
                .get::<DataKey, Organization>(&DataKey::Org(addr))
            {
                if org.verified {
                    results.push_back(org);
                }
            }
        }
        results
    }

    /// Return the rating of an organization (0 if not found)
    pub fn get_organization_rating(env: Env, org_id: Address) -> u32 {
        env.storage()
            .persistent()
            .get::<DataKey, Organization>(&DataKey::Org(org_id))
            .map(|o| o.rating)
            .unwrap_or(0)
    }

    /// Return up to `limit` top-rated verified organizations of the given type.
    /// Uses a simple insertion-sort over all verified orgs.
    pub fn get_top_rated_organizations(
        env: Env,
        org_type: OrgType,
        limit: u32,
    ) -> Vec<Organization> {
        let all = Self::get_verified_organizations(env.clone(), org_type, 100);

        // Insertion sort descending by rating
        let mut sorted: Vec<Organization> = Vec::new(&env);
        for i in 0..all.len() {
            let org = all.get(i).unwrap();
            let mut inserted = false;
            let mut new_sorted: Vec<Organization> = Vec::new(&env);
            for j in 0..sorted.len() {
                let s = sorted.get(j).unwrap();
                if !inserted && org.rating > s.rating {
                    new_sorted.push_back(org.clone());
                    inserted = true;
                }
                new_sorted.push_back(s);
            }
            if !inserted {
                new_sorted.push_back(org);
            }
            sorted = new_sorted;
        }

        let take = limit.min(sorted.len());
        let mut results = Vec::new(&env);
        for i in 0..take {
            results.push_back(sorted.get(i).unwrap());
        }
        results
    }

    // -----------------------------------------------------------------------
    // Rating
    // -----------------------------------------------------------------------

    /// Rate an organization (1–5). Each (request_id, rater) pair may only rate once.
    pub fn rate_organization(
        env: Env,
        rater: Address,
        org_id: Address,
        rating: u32,
        request_id: u64,
    ) -> Result<(), Error> {
        rater.require_auth();

        if rating < 1 || rating > 5 {
            return Err(Error::InvalidRating);
        }

        // Verify interaction (stub — wire to request contract in production)
        Self::verify_interaction(env.clone(), rater.clone(), org_id.clone(), request_id)?;

        // Prevent duplicate rating for this request
        let rated_key = DataKey::RatedFlag(request_id, rater.clone());
        if env.storage().persistent().has(&rated_key) {
            return Err(Error::AlreadyRated);
        }

        // Load and update organization
        let org_key = DataKey::Org(org_id.clone());
        let mut organization: Organization = env
            .storage()
            .persistent()
            .get(&org_key)
            .ok_or(Error::OrganizationNotFound)?;

        let total_rating = organization.rating * organization.total_ratings;
        organization.total_ratings += 1;
        organization.rating = (total_rating + rating) / organization.total_ratings;

        env.storage().persistent().set(&org_key, &organization);

        // Mark as rated
        env.storage().persistent().set(&rated_key, &true);

        // Store rating record
        let record = RatingRecord {
            rater: rater.clone(),
            org_id: org_id.clone(),
            rating,
            request_id,
            timestamp: env.ledger().timestamp(),
        };
        env.storage()
            .persistent()
            .set(&DataKey::RatingRecord(request_id, rater.clone()), &record);

        env.events().publish(
            (symbol_short!("rated"),),
            (org_id, rater, rating),
        );

        Ok(())
    }

    /// Get a rating record for a given request and rater
    pub fn get_rating_record(
        env: Env,
        request_id: u64,
        rater: Address,
    ) -> Option<RatingRecord> {
        env.storage()
            .persistent()
            .get(&DataKey::RatingRecord(request_id, rater))
    }

    /// Verify that `rater` had a completed interaction with `org_id` on `request_id`.
    /// Stub — always succeeds; wire to request contract in production.
    fn verify_interaction(
        _env: Env,
        _rater: Address,
        _org_id: Address,
        _request_id: u64,
    ) -> Result<(), Error> {
        Ok(())
    }

    // -----------------------------------------------------------------------
    // Badges
    // -----------------------------------------------------------------------

    /// Award a badge to an organization. Admin only, no duplicates.
    pub fn award_badge(
        env: Env,
        admin: Address,
        org_id: Address,
        badge_type: BadgeType,
    ) -> Result<(), Error> {
        admin.require_auth();

        // Verify caller is admin
        let stored_admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(Error::Unauthorized)?;
        if admin != stored_admin {
            return Err(Error::Unauthorized);
        }

        // Org must exist
        if !env.storage().persistent().has(&DataKey::Org(org_id.clone())) {
            return Err(Error::OrganizationNotFound);
        }

        // Prevent duplicate badge of same type
        let badges_key = DataKey::OrgBadges(org_id.clone());
        let mut badges: Vec<BadgeRecord> = env
            .storage()
            .persistent()
            .get(&badges_key)
            .unwrap_or(Vec::new(&env));

        for i in 0..badges.len() {
            let b = badges.get(i).unwrap();
            if b.badge_type == badge_type {
                return Err(Error::BadgeAlreadyAwarded);
            }
        }

        let record = BadgeRecord {
            org_id: org_id.clone(),
            badge_type,
            awarded_at: env.ledger().timestamp(),
            awarded_by: admin.clone(),
        };
        badges.push_back(record);
        env.storage().persistent().set(&badges_key, &badges);

        env.events().publish(
            (symbol_short!("badge"),),
            (org_id, admin),
        );

        Ok(())
    }

    /// Revoke a badge from an organization. Admin only.
    pub fn revoke_badge(
        env: Env,
        admin: Address,
        org_id: Address,
        badge_type: BadgeType,
    ) -> Result<(), Error> {
        admin.require_auth();

        let stored_admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(Error::Unauthorized)?;
        if admin != stored_admin {
            return Err(Error::Unauthorized);
        }

        let badges_key = DataKey::OrgBadges(org_id.clone());
        let badges: Vec<BadgeRecord> = env
            .storage()
            .persistent()
            .get(&badges_key)
            .unwrap_or(Vec::new(&env));

        let mut new_badges: Vec<BadgeRecord> = Vec::new(&env);
        let mut found = false;
        for i in 0..badges.len() {
            let b = badges.get(i).unwrap();
            if b.badge_type == badge_type {
                found = true;
            } else {
                new_badges.push_back(b);
            }
        }

        if !found {
            return Err(Error::BadgeNotFound);
        }

        env.storage().persistent().set(&badges_key, &new_badges);
        Ok(())
    }

    /// Return all badges for an organization
    pub fn get_badges(env: Env, org_id: Address) -> Vec<BadgeRecord> {
        env.storage()
            .persistent()
            .get(&DataKey::OrgBadges(org_id))
            .unwrap_or(Vec::new(&env))
    }

    // -----------------------------------------------------------------------
    // Delivery verification
    // -----------------------------------------------------------------------

    /// Record a delivery and verify its proof. Verifier must be authorized.
    pub fn verify_delivery(
        env: Env,
        verifier: Address,
        request_id: u64,
        org_id: Address,
        recipient: Address,
        quantity_delivered: u32,
        temperature_ok: bool,
    ) -> Result<(), Error> {
        verifier.require_auth();

        if quantity_delivered == 0 {
            return Err(Error::InvalidDeliveryProof);
        }

        // Org must exist
        if !env.storage().persistent().has(&DataKey::Org(org_id.clone())) {
            return Err(Error::OrganizationNotFound);
        }

        let now = env.ledger().timestamp();

        let proof = DeliveryProof {
            request_id,
            org_id: org_id.clone(),
            recipient: recipient.clone(),
            quantity_delivered,
            temperature_ok,
            delivered_at: now,
            verified: true,
            verified_at: Some(now),
        };

        env.storage()
            .persistent()
            .set(&DataKey::Delivery(request_id), &proof);

        env.events().publish(
            (symbol_short!("delivery"),),
            (request_id, org_id, recipient, temperature_ok),
        );

        Ok(())
    }

    /// Get a delivery proof by request ID
    pub fn get_delivery(env: Env, request_id: u64) -> Option<DeliveryProof> {
        env.storage()
            .persistent()
            .get(&DataKey::Delivery(request_id))
    }

    // -----------------------------------------------------------------------
    // Internal helpers
    // -----------------------------------------------------------------------

    fn increment_counter(env: &Env, key: DataKey) -> u32 {
        let mut count: u32 = env.storage().instance().get(&key).unwrap_or(0);
        count += 1;
        env.storage().instance().set(&key, &count);
        count
    }
}

    /// Get organization by ID
    pub fn get_organization(env: Env, org_id: Address) -> Option<Organization> {
        env.storage().persistent().get(&DataKey::Org(org_id))
    }
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

    /// Grant a role to an address with optional expiry
    pub fn grant_role_with_expiry(env: Env, address: Address, role: Role, expires_at: Option<u64>) {
        let admin: Address = env
            .storage()
            .persistent()
            .get(&DataKey::Admin)
            .expect("Not initialized");
        admin.require_auth();

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

        roles = Self::remove_role_from_vec(&env, roles, &role);
        roles = Self::insert_sorted(&env, roles, new_grant);

        env.storage().persistent().set(&key, &roles);
    }

    /// Revoke a role from an address
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

    /// Check if an address has a specific non-expired role
    pub fn has_role(env: Env, address: Address, role: Role) -> bool {
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
                    return true;
                }
            }
        }

        false
    }

    /// Get all role grants for an address (including expired)
    pub fn get_roles(env: Env, address: Address) -> Vec<RoleGrant> {
        let key = DataKey::AddressRoles(address);
        env.storage()
            .persistent()
            .get(&key)
            .unwrap_or(Vec::new(&env))
    }

    /// Proactively clean up all expired roles for an address. Returns count removed.
    pub fn cleanup_expired_roles(env: Env, address: Address) -> u32 {
        let admin: Address = env
            .storage()
            .persistent()
            .get(&DataKey::Admin)
            .expect("Not initialized");
        admin.require_auth();

        Self::cleanup_expired_roles_internal(&env, &address)
    }

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
