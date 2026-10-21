#![no_std]
#![deny(deprecated)]

use soroban_sdk::{
    contract, contracterror, contractevent, contractimpl, contracttype, Address, BytesN, Env,
    String, Vec,
};

mod verification;

mod request_client {
    use soroban_sdk::{contractclient, contracttype, Address, Env, String, Vec};

    #[derive(Clone, Copy, Debug, Eq, PartialEq)]
    #[contracttype]
    pub enum RequestStatus {
        Pending,
        Approved,
        InProgress,
        Fulfilled,
        Cancelled,
        Rejected,
    }

    #[derive(Clone, Copy, Debug, Eq, PartialEq)]
    #[contracttype]
    pub enum BloodType {
        APositive,
        ANegative,
        BPositive,
        BNegative,
        ABPositive,
        ABNegative,
        OPositive,
        ONegative,
    }

    #[derive(Clone, Copy, Debug, Eq, PartialEq)]
    #[contracttype]
    pub enum BloodComponent {
        WholeBlood,
        RedCells,
        Plasma,
        Platelets,
        Cryoprecipitate,
    }

    #[derive(Clone, Copy, Debug, Eq, PartialEq)]
    #[contracttype]
    pub enum Urgency {
        Critical,
        Urgent,
        Routine,
        Scheduled,
    }

    #[derive(Clone, Debug, Eq, PartialEq)]
    #[contracttype]
    pub struct RequestHistoryEntry {
        pub previous_status: RequestStatus,
        pub is_initial_transition: bool,
        pub new_status: RequestStatus,
        pub actor: Address,
        pub reason: String,
        pub fulfilled_delta_ml: u32,
        pub released_reservation: bool,
        pub timestamp: u64,
    }

    #[derive(Clone, Debug, Eq, PartialEq)]
    #[contracttype]
    pub struct BloodRequest {
        pub id: u64,
        pub hospital_id: Address,
        pub blood_type: BloodType,
        pub component: BloodComponent,
        pub quantity_ml: u32,
        pub urgency: Urgency,
        pub created_timestamp: u64,
        pub required_by_timestamp: u64,
        pub status: RequestStatus,
        pub assigned_units: Vec<u64>,
        pub fulfilled_quantity_ml: u32,
        pub reservation_id: Option<u64>,
        pub fulfilled_by: Option<Address>,
        pub history: Vec<RequestHistoryEntry>,
    }

    #[contractclient(name = "RequestContractClient")]
    #[allow(dead_code)]
    pub trait RequestContractInterface {
        fn get_request(env: Env, request_id: u64) -> BloodRequest;
    }
}

/// Persistent storage TTL constants (ledgers; one ledger ≈ 5 s on mainnet).
const TTL_THRESHOLD: u32 = 518_400; // ~30 days
const TTL_EXTEND_TO: u32 = 1_036_800; // ~60 days
const CONTRACT_VERSION: u32 = 1;

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
    InvalidRating = 205,
    AlreadyRated = 206,
    OrganizationNotFound = 207,
    BadgeAlreadyAwarded = 208,
    BadgeNotFound = 209,
    InvalidDeliveryProof = 210,
    AlreadyVerified = 211,
    AlreadyUnverified = 212,
    ContractPaused = 213,
    DeliveryAlreadyVerified = 214,
    /// The owner address already has a registered organization.
    OrganizationAlreadyRegistered = 215,
    /// The primary admin's `Admin` role cannot be revoked, so one admin always remains.
    CannotRevokeLastAdmin = 216,
    /// No admin transfer has been proposed.
    NoPendingAdmin = 217,
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

/// Fine-grained permission scopes that map to on-chain actions (Issue #374).
/// These mirror the backend `Permission` enum for actions that require
/// on-chain enforcement (e.g. settlement release, verification admin).
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
pub enum PermissionScope {
    InventoryWrite,
    DispatchOverride,
    RequestApprove,
    DisputeResolve,
    VerificationAdmin,
    SettlementRelease,
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
    pub rating_sum: u64,
    pub location_hash: BytesN<32>,
}

/// One page of `get_verified_organizations`. `next_start` is the index to
/// pass as `start` for the following page, or None once the list is exhausted.
#[contracttype]
#[derive(Clone, Debug)]
pub struct VerifiedOrgPage {
    pub items: Vec<Organization>,
    pub next_start: Option<u32>,
}

/// Maximum number of type-index entries one `get_verified_organizations` call
/// inspects, verified or not. Bounds the call's cost regardless of list size.
const MAX_VERIFIED_SCAN: u32 = 200;
/// Maximum number of organizations one `get_verified_organizations` call returns.
const MAX_VERIFIED_RESULTS: u32 = 50;

#[contractevent(topics = ["org_registered"], data_format = "vec")]
#[derive(Clone, Debug)]
pub struct OrganizationRegistered {
    pub org_id: Address,
    pub org_type: OrgType,
    pub name: String,
}

#[contractevent(topics = ["identity", "init"], data_format = "single-value")]
pub struct IdentityInitialized {
    pub admin: Address,
}

#[contractevent(topics = ["org_verified"], data_format = "vec")]
pub struct OrgVerified {
    pub org_id: Address,
    pub admin: Address,
    pub timestamp: u64,
}

#[contractevent(topics = ["org_unverified"], data_format = "vec")]
pub struct OrgUnverified {
    pub org_id: Address,
    pub reason: String,
}

#[contractevent(topics = ["org_rated"], data_format = "vec")]
pub struct OrgRated {
    pub org_id: Address,
    pub rater: Address,
    pub rating: u32,
}

#[contractevent(topics = ["badge_awarded"], data_format = "vec")]
pub struct BadgeAwarded {
    pub org_id: Address,
    pub admin: Address,
}

#[contractevent(topics = ["badge_revoked"], data_format = "vec")]
pub struct BadgeRevoked {
    pub org_id: Address,
    pub badge_type: BadgeType,
}

#[contractevent(topics = ["delivery_proof"], data_format = "vec")]
pub struct DeliveryProofRecorded {
    pub request_id: u64,
    pub org_id: Address,
    pub recipient: Address,
    pub temperature_ok: bool,
}

#[contractevent(topics = ["role_granted"], data_format = "vec")]
pub struct RoleGranted {
    pub address: Address,
    pub role: Role,
    pub expires_at: Option<u64>,
}

#[contractevent(topics = ["role_revoked"], data_format = "vec")]
pub struct RoleRevoked {
    pub address: Address,
    pub role: Role,
}

#[contractevent(topics = ["scope_granted"], data_format = "vec")]
pub struct ScopeGranted {
    pub address: Address,
    pub scope: PermissionScope,
}

#[contractevent(topics = ["scope_revoked"], data_format = "vec")]
pub struct ScopeRevoked {
    pub address: Address,
    pub scope: PermissionScope,
}

#[contractevent(topics = ["admin", "proposed"], data_format = "vec")]
pub struct AdminTransferProposed {
    pub current_admin: Address,
    pub new_admin: Address,
}

#[contractevent(topics = ["admin", "transferred"], data_format = "vec")]
pub struct AdminTransferred {
    pub previous_admin: Address,
    pub new_admin: Address,
}

#[contractevent(topics = ["upgraded"], data_format = "single-value")]
pub struct ContractUpgraded {
    pub new_wasm_hash: BytesN<32>,
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
    OrgCounter,
    Admin,
    PendingAdmin,
    OrgTypeList(OrgType),
    OrgVerifier(Address),
    OrgUnverifyReason(Address),
    // Verification
    VerificationMetadata(Address),
    VerificationEvents(Address),
    // Rating
    RatedFlag(u64, Address),
    RatingRecord(u64, Address),
    // Badges
    OrgBadges(Address),
    // Delivery
    Delivery(u64),
    // IdentityContract role storage
    AddressRoles(Address),
    // Fine-grained permission scopes (Issue #374)
    AddressScopes(Address),
    Paused,
    // Address of the requests contract used to verify interactions before rating
    RequestsContract,
}

// ---------------------------------------------------------------------------
// IdentityContract
// ---------------------------------------------------------------------------

#[contract]
pub struct IdentityContract;

impl IdentityContract {
    /// Check whether an address has a given non-expired role.
    fn has_role_internal(env: Env, account: Address, role: Role) -> bool {
        let key = DataKey::AddressRoles(account);
        let roles: Vec<RoleGrant> = env
            .storage()
            .persistent()
            .get(&key)
            .unwrap_or(Vec::new(&env));
        let now = env.ledger().timestamp();
        for i in 0..roles.len() {
            let grant = roles.get(i).unwrap();
            let active = match grant.expires_at {
                Some(expires_at) => now < expires_at,
                None => true,
            };
            if grant.role == role && active {
                return true;
            }
        }
        false
    }

    /// Drop expired grants for an address. Returns the number removed.
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
                    env.storage()
                        .persistent()
                        .extend_ttl(&key, TTL_THRESHOLD, TTL_EXTEND_TO);
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

#[contractimpl]
impl IdentityContract {
    /// Initialize the contract with an admin
    pub fn initialize(env: Env, admin: Address) -> Result<(), Error> {
        admin.require_auth();
        if Self::is_initialized(env.clone()) {
            return Err(Error::AlreadyInitialized);
        }

        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().set(&DataKey::OrgCounter, &0u32);
        Self::grant_role_internal(&env, admin.clone(), Role::Admin);

        IdentityInitialized { admin }.publish(&env);

        Ok(())
    }

    /// Get contract version
    pub fn version(_env: Env) -> u32 {
        CONTRACT_VERSION
    }

    /// Upgrade the contract to a new WASM hash. Admin only.
    pub fn upgrade(
        env: Env,
        admin: Address,
        new_wasm_hash: BytesN<32>,
    ) -> Result<(), Error> {
        admin.require_auth();
        Self::require_role(&env, &admin, Role::Admin)?;

        env.deployer().update_current_contract_wasm(new_wasm_hash.clone());

        ContractUpgraded { new_wasm_hash }.publish(&env);

        Ok(())
    }

    /// Propose a new admin. The current admin must authorize this call; the
    /// proposed admin must then call `accept_admin` to complete the transfer.
    pub fn propose_admin(env: Env, admin: Address, new_admin: Address) -> Result<(), Error> {
        admin.require_auth();
        Self::require_role(&env, &admin, Role::Admin)?;

        env.storage()
            .instance()
            .set(&DataKey::PendingAdmin, &new_admin);

        AdminTransferProposed {
            current_admin: admin,
            new_admin,
        }
        .publish(&env);

        Ok(())
    }

    /// Accept a pending admin transfer. Only the proposed admin may call this.
    pub fn accept_admin(env: Env, new_admin: Address) -> Result<(), Error> {
        new_admin.require_auth();

        let pending: Address = env
            .storage()
            .instance()
            .get(&DataKey::PendingAdmin)
            .ok_or(Error::NoPendingAdmin)?;

        if pending != new_admin {
            return Err(Error::Unauthorized);
        }

        let previous_admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(Error::Unauthorized)?;

        env.storage().instance().set(&DataKey::Admin, &new_admin);
        env.storage().instance().remove(&DataKey::PendingAdmin);

        // Grant the Admin role to the new admin and drop it from the previous
        // admin so the role set stays consistent with the primary admin key.
        Self::grant_role_internal(&env, new_admin.clone(), Role::Admin);
        Self::revoke_admin_role_internal(&env, &previous_admin);

        AdminTransferred {
            previous_admin,
            new_admin,
        }
        .publish(&env);

        Ok(())
    }

    /// Return the pending admin, if any.
    pub fn get_pending_admin(env: Env) -> Option<Address> {
        env.storage().instance().get(&DataKey::PendingAdmin)
    }

    /// Pause all state-mutating functions. Admin only.
    pub fn pause(env: Env, admin: Address) -> Result<(), Error> {
        admin.require_auth();
        Self::require_role(&env, &admin, Role::Admin)?;
        env.storage().instance().set(&DataKey::Paused, &true);
        Ok(())
    }

    /// Unpause the contract. Admin only.
    pub fn unpause(env: Env, admin: Address) -> Result<(), Error> {
        admin.require_auth();
        Self::require_role(&env, &admin, Role::Admin)?;
        env.storage().instance().set(&DataKey::Paused, &false);
        Ok(())
    }

    /// Returns whether the contract is currently paused.
    pub fn is_paused(env: Env) -> bool {
        env.storage()
            .instance()
            .get(&DataKey::Paused)
            .unwrap_or(false)
    }

    fn require_not_paused(env: &Env) -> Result<(), Error> {
        if env
            .storage()
            .instance()
            .get(&DataKey::Paused)
            .unwrap_or(false)
        {
            return Err(Error::ContractPaused);
        }
        Ok(())
    }

    pub fn is_initialized(env: Env) -> bool {
        env.storage().instance().has(&DataKey::Admin)
    }

    pub fn get_admin(env: Env) -> Result<Address, Error> {
        env.storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(Error::Unauthorized)
    }

    /// Admin-only: configure the requests contract address used by verify_interaction.
    pub fn set_requests_contract(
        env: Env,
        admin: Address,
        requests_contract: Address,
    ) -> Result<(), Error> {
        admin.require_auth();
        Self::require_role(&env, &admin, Role::Admin)?;
        env.storage()
            .instance()
            .set(&DataKey::RequestsContract, &requests_contract);
        Ok(())
    }

    pub fn get_org_counter(env: Env) -> Result<u32, Error> {
        if !Self::is_initialized(env.clone()) {
            return Err(Error::Unauthorized);
        }

        Ok(env
            .storage()
            .instance()
            .get(&DataKey::OrgCounter)
            .unwrap_or(0))
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
        Self::require_not_paused(&env)?;

        if name.is_empty() || license_number.is_empty() {
            return Err(Error::InvalidInput);
        }

        let license_key = DataKey::License(license_number.clone());
        if env.storage().persistent().has(&license_key) {
            return Err(Error::LicenseAlreadyRegistered);
        }

        let org_id = owner.clone();

        // An owner maps to exactly one organization. Without this check a
        // second registration overwrote the first (resetting verified status
        // and ratings), appended a duplicate to OrgTypeList and bumped
        // OrgCounter again.
        let org_key = DataKey::Org(org_id.clone());
        if env.storage().persistent().has(&org_key) {
            return Err(Error::OrganizationAlreadyRegistered);
        }

        let organization = Organization {
            id: org_id.clone(),
            org_type: org_type.clone(),
            name: name.clone(),
            license_number: license_number.clone(),
            verified: false,
            verified_timestamp: None,
            rating: 0,
            total_ratings: 0,
            rating_sum: 0,
            location_hash,
        };

        env.storage().persistent().set(&org_key, &organization);
        env.storage()
            .persistent()
            .extend_ttl(&org_key, TTL_THRESHOLD, TTL_EXTEND_TO);
        env.storage().persistent().set(&license_key, &org_id);
        env.storage()
            .persistent()
            .extend_ttl(&license_key, TTL_THRESHOLD, TTL_EXTEND_TO);
        let docs_key = DataKey::Docs(org_id.clone());
        env.storage().persistent().set(&docs_key, &document_hashes);
        env.storage()
            .persistent()
            .extend_ttl(&docs_key, TTL_THRESHOLD, TTL_EXTEND_TO);

        // Assign role
        let role = match org_type.clone() {
            OrgType::BloodBank => Role::BloodBank,
            OrgType::Hospital => Role::Hospital,
        };
        Self::grant_role_internal(&env, org_id.clone(), role);

        // Add to type index
        let type_key = DataKey::OrgTypeList(org_type.clone());
        let mut list: Vec<Address> = env
            .storage()
            .persistent()
            .get(&type_key)
            .unwrap_or(Vec::new(&env));
        list.push_back(org_id.clone());
        env.storage().persistent().set(&type_key, &list);
        env.storage()
            .persistent()
            .extend_ttl(&type_key, TTL_THRESHOLD, TTL_EXTEND_TO);

        Self::increment_counter(&env, DataKey::OrgCounter);

        OrganizationRegistered {
            org_id: org_id.clone(),
            org_type,
            name,
        }
        .publish(&env);

        Ok(org_id)
    }

    /// Admin-only public entrypoint for granting a role to an address.
    pub fn grant_role(env: Env, admin: Address, address: Address, role: Role) -> Result<(), Error> {
        admin.require_auth();
        Self::require_role(&env, &admin, Role::Admin)?;
        Self::grant_role_internal(&env, address, role);
        Ok(())
    }

    /// Admin-only: grant a role that lapses at `expires_at` (ledger timestamp).
    /// `None` grants the role indefinitely.
    pub fn grant_role_with_expiry(
        env: Env,
        admin: Address,
        address: Address,
        role: Role,
        expires_at: Option<u64>,
    ) -> Result<(), Error> {
        admin.require_auth();
        Self::require_not_paused(&env)?;
        Self::require_role(&env, &admin, Role::Admin)?;

        Self::cleanup_expired_roles_internal(&env, &address);

        let key = DataKey::AddressRoles(address.clone());
        let roles: Vec<RoleGrant> = env
            .storage()
            .persistent()
            .get(&key)
            .unwrap_or(Vec::new(&env));

        let new_grant = RoleGrant {
            role: role.clone(),
            granted_at: env.ledger().timestamp(),
            expires_at,
        };
        let roles = Self::remove_role_from_vec(&env, roles, &role);
        let roles = Self::insert_sorted(&env, roles, new_grant);

        env.storage().persistent().set(&key, &roles);
        env.storage()
            .persistent()
            .extend_ttl(&key, TTL_THRESHOLD, TTL_EXTEND_TO);

        RoleGranted {
            address,
            role,
            expires_at,
        }
        .publish(&env);

        Ok(())
    }

    /// Admin-only: remove a role from an address. The primary admin's own
    /// `Admin` role cannot be removed, so at least one admin always remains.
    pub fn revoke_role(
        env: Env,
        admin: Address,
        address: Address,
        role: Role,
    ) -> Result<(), Error> {
        admin.require_auth();
        Self::require_not_paused(&env)?;
        Self::require_role(&env, &admin, Role::Admin)?;

        if role == Role::Admin && address == Self::get_admin(env.clone())? {
            return Err(Error::CannotRevokeLastAdmin);
        }

        let key = DataKey::AddressRoles(address.clone());
        if let Some(roles) = env
            .storage()
            .persistent()
            .get::<DataKey, Vec<RoleGrant>>(&key)
        {
            let roles = Self::remove_role_from_vec(&env, roles, &role);
            if roles.is_empty() {
                env.storage().persistent().remove(&key);
            } else {
                env.storage().persistent().set(&key, &roles);
                env.storage()
                    .persistent()
                    .extend_ttl(&key, TTL_THRESHOLD, TTL_EXTEND_TO);
            }
        }

        RoleRevoked { address, role }.publish(&env);

        Ok(())
    }

    /// Admin-only: proactively remove expired grants for an address. Returns count removed.
    pub fn cleanup_expired_roles(
        env: Env,
        admin: Address,
        address: Address,
    ) -> Result<u32, Error> {
        admin.require_auth();
        Self::require_role(&env, &admin, Role::Admin)?;

        Ok(Self::cleanup_expired_roles_internal(&env, &address))
    }

    /// Get all role grants for an address (including expired until cleaned up).
    pub fn get_roles(env: Env, address: Address) -> Vec<RoleGrant> {
        let key = DataKey::AddressRoles(address);
        env.storage()
            .persistent()
            .get(&key)
            .unwrap_or(Vec::new(&env))
    }

    /// Internal helper to grant a role to an address (no auth check).
    fn grant_role_internal(env: &Env, address: Address, role: Role) {
        let key = DataKey::AddressRoles(address.clone());
        let roles: Vec<RoleGrant> = env
            .storage()
            .persistent()
            .get(&key)
            .unwrap_or(Vec::new(env));

        // Deduplicate: remove existing grant for this role before inserting.
        let mut new_roles: Vec<RoleGrant> = Vec::new(env);
        for i in 0..roles.len() {
            let g = roles.get(i).unwrap();
            if g.role != role {
                new_roles.push_back(g);
            }
        }

        let grant = RoleGrant {
            role: role.clone(),
            granted_at: env.ledger().timestamp(),
            expires_at: None,
        };

        // Insert in sorted order to keep the vec deterministically ordered.
        let mut inserted = false;
        let mut sorted: Vec<RoleGrant> = Vec::new(env);
        for i in 0..new_roles.len() {
            let g = new_roles.get(i).unwrap();
            if !inserted && grant.role < g.role {
                sorted.push_back(grant.clone());
                inserted = true;
            }
            sorted.push_back(g);
        }
        if !inserted {
            sorted.push_back(grant);
        }

        env.storage().persistent().set(&key, &sorted);
        env.storage()
            .persistent()
            .extend_ttl(&key, TTL_THRESHOLD, TTL_EXTEND_TO);
    }

    /// Internal helper to drop the `Admin` role from an address (no auth check).
    fn revoke_admin_role_internal(env: &Env, address: &Address) {
        let key = DataKey::AddressRoles(address.clone());
        if let Some(roles) = env
            .storage()
            .persistent()
            .get::<DataKey, Vec<RoleGrant>>(&key)
        {
            let roles = Self::remove_role_from_vec(env, roles, &Role::Admin);
            if roles.is_empty() {
                env.storage().persistent().remove(&key);
            } else {
                env.storage().persistent().set(&key, &roles);
                env.storage()
                    .persistent()
                    .extend_ttl(&key, TTL_THRESHOLD, TTL_EXTEND_TO);
            }
        }
    }

    /// Get the primary role of an address (first role in the sorted vec, if any).
    pub fn get_role(env: Env, address: Address) -> Option<Role> {
        let key = DataKey::AddressRoles(address);
        let roles: Vec<RoleGrant> = env
            .storage()
            .persistent()
            .get(&key)
            .unwrap_or(Vec::new(&env));
        if roles.is_empty() {
            None
        } else {
            Some(roles.get(0).unwrap().role)
        }
    }

    /// Get organization by ID
    pub fn get_organization(env: Env, org_id: Address) -> Option<Organization> {
        env.storage().persistent().get(&DataKey::Org(org_id))
    }

    /// Check if an address has a given non-expired role (lazily drops expired grants)
    pub fn has_role(env: Env, account: Address, role: Role) -> bool {
        Self::cleanup_expired_roles_internal(&env, &account);
        Self::has_role_internal(env, account, role)
    }

    /// Require that an address has a given role, return Unauthorized error if not
    fn require_role(env: &Env, account: &Address, role: Role) -> Result<(), Error> {
        if Self::has_role_internal(env.clone(), account.clone(), role) {
            Ok(())
        } else {
            Err(Error::Unauthorized)
        }
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

    /// Return verified organizations of the given type, starting at index
    /// `start` of the type list.
    ///
    /// At most MAX_VERIFIED_SCAN entries are inspected and at most
    /// min(max_results, MAX_VERIFIED_RESULTS) are returned per call, so the
    /// cost no longer grows with the number of registered organizations.
    /// Continue from `next_start` until it is None.
    pub fn get_verified_organizations(
        env: Env,
        org_type: OrgType,
        start: u32,
        max_results: u32,
    ) -> VerifiedOrgPage {
        let list: Vec<Address> = env
            .storage()
            .persistent()
            .get(&DataKey::OrgTypeList(org_type))
            .unwrap_or(Vec::new(&env));

        let take = max_results.min(MAX_VERIFIED_RESULTS);
        let end = start.saturating_add(MAX_VERIFIED_SCAN).min(list.len());
        let mut items = Vec::new(&env);
        let mut i = start;
        while i < end && items.len() < take {
            let addr = list.get(i).unwrap();
            if let Some(org) = env
                .storage()
                .persistent()
                .get::<DataKey, Organization>(&DataKey::Org(addr))
            {
                if org.verified {
                    items.push_back(org);
                }
            }
            i += 1;
        }

        VerifiedOrgPage {
            items,
            next_start: if i < list.len() { Some(i) } else { None },
        }
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
    /// Enforces a hard cap of 50 results. Walks every verified organization
    /// page by page and keeps a bounded, rating-sorted buffer of the best
    /// `take` entries, so the ranking covers the whole registry, not just the
    /// first registered organizations. Ties keep registration order.
    pub fn get_top_rated_organizations(
        env: Env,
        org_type: OrgType,
        limit: u32,
    ) -> Vec<Organization> {
        const CAP: u32 = 50;
        let take = limit.min(CAP);
        let mut results: Vec<Organization> = Vec::new(&env);
        if take == 0 {
            return results;
        }

        let mut start = 0;
        loop {
            let page =
                Self::get_verified_organizations(env.clone(), org_type.clone(), start, CAP);
            for i in 0..page.items.len() {
                let org = page.items.get(i).unwrap();
                // Insert before the first entry with a lower rating
                let mut pos = results.len();
                for j in 0..results.len() {
                    if org.rating > results.get(j).unwrap().rating {
                        pos = j;
                        break;
                    }
                }
                if pos < take {
                    results.insert(pos, org);
                    if results.len() > take {
                        results.pop_back();
                    }
                }
            }
            match page.next_start {
                Some(next) => start = next,
                None => break,
            }
        }
        results
    }

    /// Verify an organization (admin only)
    pub fn verify_organization(env: Env, admin: Address, org_id: Address) -> Result<(), Error> {
        <verification::VerificationImpl as verification::VerificationTrait>::verify_organization(
            env, admin, org_id,
        )?;
        Ok(())
    }

    /// Unverify an organization (admin only)
    pub fn unverify_organization(
        env: Env,
        admin: Address,
        org_id: Address,
        reason: String,
    ) -> Result<(), Error> {
        <verification::VerificationImpl as verification::VerificationTrait>::unverify_organization(
            env, admin, org_id, reason,
        )?;
        Ok(())
    }

    /// Get verification metadata for an organization
    pub fn get_verification_metadata(
        env: Env,
        org_id: Address,
    ) -> Result<verification::VerificationMetadata, Error> {
        <verification::VerificationImpl as verification::VerificationTrait>::get_verification_metadata(
            env, org_id,
        )
    }

    /// Check if an organization is verified
    pub fn is_organization_verified(env: Env, org