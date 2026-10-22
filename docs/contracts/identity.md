# Identity Contract

The Identity Contract manages organization registration, verification, roles with expiry, permissions, ratings, badges, and delivery proof verification on the Stellar Soroban network.

## Quick Start: Organization Lifecycle

1. **Register**: Owner calls `register_organization()` to create an org entry
2. **Roles**: The org receives a role (BloodBank or Hospital) automatically; admin can assign additional roles
3. **Verify**: Admin calls `verify_organization()` to mark org as verified
4. **Rate**: After verified delivery, raters submit ratings via `rate_organization()`
5. **Badges**: Admin awards badges via `award_badge()` for performance milestones
6. **Delivery**: Verifier calls `verify_delivery()` to record and verify delivery proofs

## Entrypoints

### Lifecycle & Initialization

#### `initialize(env, admin) → Result<(), Error>`
- **Description**: Initialize the contract with an admin
- **Auth required**: None (first call only)
- **Parameters**:
  - `admin: Address` — The admin address that will manage the contract
- **Returns**: `Ok(())` on success; `Err(AlreadyInitialized)` if already initialized
- **Side effects**: Sets admin, creates org counter, grants Admin role to admin
- **Events**: Publishes `("init", "v1")` event with admin address
- **Access Control**: None (executed once during deployment)

#### `is_initialized(env) → bool`
- **Description**: Check whether the contract has been initialized
- **Auth required**: No
- **Returns**: `true` if admin exists; `false` otherwise
- **Side effects**: None

#### `get_admin(env) → Result<Address, Error>`
- **Description**: Return the current admin address
- **Auth required**: No
- **Returns**: Admin address or `Err(Unauthorized)` if not initialized

#### `get_org_counter(env) → Result<u32, Error>`
- **Description**: Return the number of organizations registered
- **Auth required**: No
- **Returns**: Organization count or error if not initialized

### Control & Pause

#### `pause(env, admin) → Result<(), Error>`
- **Description**: Pause all state-mutating functions (admin only)
- **Auth required**: Yes, signer must be admin
- **Parameters**:
  - `admin: Address` — The admin calling the function
- **Returns**: `Ok(())` on success; `Err(Unauthorized)` if caller is not the stored admin
- **Side effects**: Sets `Paused` flag to `true`
- **Access Control**: Admin only

#### `unpause(env, admin) → Result<(), Error>`
- **Description**: Unpause the contract (admin only)
- **Auth required**: Yes, signer must be admin
- **Parameters**:
  - `admin: Address` — The admin calling the function
- **Returns**: `Ok(())` on success; `Err(Unauthorized)` if caller is not the stored admin
- **Side effects**: Sets `Paused` flag to `false`
- **Access Control**: Admin only

#### `is_paused(env) → bool`
- **Description**: Check if the contract is currently paused
- **Auth required**: No
- **Returns**: `true` if paused; `false` otherwise

### Organization Management

#### `register_organization(env, owner, org_type, name, license_number, location_hash, document_hashes) → Result<Address, Error>`
- **Description**: Register a new organization
- **Auth required**: Yes, signer must be `owner`
- **Parameters**:
  - `owner: Address` — The owner/signer of the organization (becomes org_id)
  - `org_type: OrgType` — Either `BloodBank` or `Hospital`
  - `name: String` — Organization name (non-empty)
  - `license_number: String` — Unique license number (non-empty, must not already exist)
  - `location_hash: BytesN<32>` — 32-byte hash of location data
  - `document_hashes: Vec<BytesN<32>>` — Vector of document hashes for compliance
- **Returns**: `Ok(org_id)` (which equals owner's address) on success
- **Errors**:
  - `InvalidInput` — If name or license_number is empty
  - `LicenseAlreadyRegistered` — If license_number already used
  - `ContractPaused` — If contract is paused
- **Side effects**:
  - Creates Organization entry with verified=false
  - Stores license_number → org_id mapping
  - Stores document hashes
  - Assigns org a role (BloodBank or Hospital)
  - Increments org counter
  - Adds org to type index
- **Events**: Publishes `("org_reg", "v1")` with org details
- **Access Control**: Any address (must sign as owner)

#### `get_organization(env, org_id) → Option<Organization>`
- **Description**: Retrieve organization by ID
- **Auth required**: No
- **Returns**: Organization struct or `None` if not found
- **Side effects**: None

#### `get_organizations_by_type(env, org_type, max_results) → Vec<Organization>`
- **Description**: Get organizations of a specific type (up to max_results)
- **Auth required**: No
- **Parameters**:
  - `org_type: OrgType` — Filter by type
  - `max_results: u32` — Maximum number to return
- **Returns**: Vec of Organization structs (limited by max_results)
- **Side effects**: None

#### `get_verified_organizations(env, org_type, max_results) → Vec<Organization>`
- **Description**: Get verified organizations of a specific type (up to max_results)
- **Auth required**: No
- **Parameters**:
  - `org_type: OrgType` — Filter by type
  - `max_results: u32` — Maximum number to return
- **Returns**: Vec of verified Organization structs
- **Side effects**: None

#### `get_organization_rating(env, org_id) → u32`
- **Description**: Get the current rating of an organization
- **Auth required**: No
- **Returns**: Rating (0 if organization not found)
- **Side effects**: None

#### `get_top_rated_organizations(env, org_type, limit) → Vec<Organization>`
- **Description**: Get top-rated verified organizations of a given type
- **Auth required**: No
- **Parameters**:
  - `org_type: OrgType` — Filter by type
  - `limit: u32` — How many top results to return
- **Returns**: Vec of Organization structs sorted by rating (descending)
- **Side effects**: None

### Verification (Org Status)

#### `verify_organization(env, admin, org_id) → Result<(), Error>`
- **Description**: Verify an organization (admin only)
- **Auth required**: Yes, signer must be admin
- **Parameters**:
  - `admin: Address` — The admin calling the function
  - `org_id: Address` — Organization to verify
- **Returns**: `Ok(())` on success
- **Errors**:
  - `Unauthorized` — If caller is not admin or org not found
  - `AlreadyVerified` — If org is already verified
  - `ContractPaused` — If contract is paused
  - `OrganizationNotFound` — If org_id doesn't exist
- **Side effects**:
  - Sets `verified = true` and `verified_timestamp` on organization
  - Stores verifier address
- **Events**: Publishes `("org_verified", "v1")` with org_id, admin, timestamp
- **Access Control**: Admin only

#### `unverify_organization(env, admin, org_id, reason) → Result<(), Error>`
- **Description**: Unverify an organization with a reason (admin only)
- **Auth required**: Yes, signer must be admin
- **Parameters**:
  - `admin: Address` — The admin calling the function
  - `org_id: Address` — Organization to unverify
  - `reason: String` — Reason for unverification
- **Returns**: `Ok(())` on success
- **Errors**:
  - `Unauthorized` — If caller is not admin
  - `AlreadyUnverified` — If org is already unverified
  - `ContractPaused` — If contract is paused
  - `OrganizationNotFound` — If org_id doesn't exist
- **Side effects**:
  - Sets `verified = false` and clears `verified_timestamp` on organization
  - Stores unverification reason
- **Events**: Publishes `("org_unverified", "v1")` with org_id and reason
- **Access Control**: Admin only

### Roles & Permissions

Roles are stored per-address in a deduplicated, sorted `Vec<RoleGrant>`. Each grant tracks the role, when it was granted, and optional expiry time.

#### `grant_role(env, address, role) → ()`
- **Description**: Grant a role to an address (indefinitely, no expiry)
- **Auth required**: Internal use only (called by `initialize()` and `register_organization()`)
- **Parameters**:
  - `env: Env` — Soroban environment
  - `address: Address` — Recipient of the role
  - `role: Role` — Role to grant (Admin, BloodBank, Hospital, Donor, Rider, or Custom)
- **Side effects**:
  - Inserts role into sorted Vec<RoleGrant> for the address
  - Deduplicates existing role of same type
  - Maintains sorted order by role type
- **Access Control**: Internal (callable from other contract functions)

#### `grant_role_with_expiry(env, address, role, expires_at) → ()`
- **Description**: Grant a role to an address with optional expiry time
- **Auth required**: Yes, signer must be admin (see AccessControlContract)
- **Parameters**:
  - `env: Env` — Soroban environment
  - `address: Address` — Recipient of the role
  - `role: Role` — Role to grant
  - `expires_at: Option<u64>` — Unix timestamp when role expires (None = no expiry)
- **Side effects**:
  - Cleans up expired roles for the address first
  - Inserts new grant with expiry time into sorted Vec<RoleGrant>
  - Deduplicates existing role of same type
- **Access Control**: Admin only (enforced by Soroban's require_auth)
- **Note**: Part of AccessControlContract

#### `revoke_role(env, address, role) → ()`
- **Description**: Revoke a role from an address
- **Auth required**: Yes, signer must be admin (see AccessControlContract)
- **Parameters**:
  - `env: Env` — Soroban environment
  - `address: Address` — Address to revoke from
  - `role: Role` — Role to revoke
- **Side effects**:
  - Removes role from the address's Vec<RoleGrant>
  - If no roles remain, deletes the entry
- **Access Control**: Admin only
- **Note**: Part of AccessControlContract

#### `has_role(env, address, role) → bool`
- **Description**: Check if an address has a specific (non-expired) role
- **Auth required**: No
- **Parameters**:
  - `env: Env` — Soroban environment
  - `address: Address` — Address to check
  - `role: Role` — Role to look for
- **Returns**: `true` if address has the non-expired role; `false` otherwise
- **Side effects**: Cleans up expired roles as a side effect
- **Note**: Part of AccessControlContract

#### `get_role(env, address) → Option<Role>`
- **Description**: Get the primary (first) role of an address
- **Auth required**: No
- **Parameters**:
  - `env: Env` — Soroban environment
  - `address: Address` — Address to check
- **Returns**: First role in the sorted Vec if any; None otherwise
- **Side effects**: None

#### `get_roles(env, address) → Vec<RoleGrant>`
- **Description**: Get all role grants for an address (including expired)
- **Auth required**: No
- **Parameters**:
  - `env: Env` — Soroban environment
  - `address: Address` — Address to query
- **Returns**: Vec of all RoleGrant records
- **Side effects**: None
- **Note**: Part of AccessControlContract; includes expired roles

#### `cleanup_expired_roles(env, address) → u32`
- **Description**: Proactively clean up all expired roles for an address (admin only)
- **Auth required**: Yes, signer must be admin
- **Parameters**:
  - `env: Env` — Soroban environment
  - `address: Address` — Address to clean up
- **Returns**: Count of roles removed
- **Side effects**: Removes all expired role grants from storage
- **Access Control**: Admin only
- **Note**: Part of AccessControlContract

### Fine-Grained Permission Scopes

Permission scopes (Issue #374) represent specific on-chain actions. Scopes are independent of roles and apply to specific operations requiring authorization.

**Available scopes:**
- `InventoryWrite` — Can write inventory changes
- `DispatchOverride` — Can override dispatch decisions
- `RequestApprove` — Can approve requests
- `DisputeResolve` — Can resolve disputes
- `VerificationAdmin` — Can perform verifications
- `SettlementRelease` — Can release settlement funds

#### `grant_scope(env, address, scope) → ()`
- **Description**: Grant a permission scope to an address (admin only)
- **Auth required**: Yes, signer must be admin (see AccessControlContract)
- **Parameters**:
  - `env: Env` — Soroban environment
  - `address: Address` — Recipient of the scope
  - `scope: PermissionScope` — Scope to grant
- **Side effects**:
  - Appends scope to Vec<PermissionScope> for the address
  - Deduplicates if scope already held
- **Access Control**: Admin only
- **Note**: Part of AccessControlContract

#### `revoke_scope(env, address, scope) → ()`
- **Description**: Revoke a permission scope from an address (admin only)
- **Auth required**: Yes, signer must be admin
- **Parameters**:
  - `env: Env` — Soroban environment
  - `address: Address` — Address to revoke from
  - `scope: PermissionScope` — Scope to revoke
- **Side effects**:
  - Removes scope from the address's Vec<PermissionScope>
- **Access Control**: Admin only
- **Note**: Part of AccessControlContract

#### `has_scope(env, address, scope) → bool`
- **Description**: Check if an address holds a specific permission scope
- **Auth required**: No
- **Parameters**:
  - `env: Env` — Soroban environment
  - `address: Address` — Address to check
  - `scope: PermissionScope` — Scope to check for
- **Returns**: `true` if address has the scope; `false` otherwise
- **Side effects**: None
- **Note**: Part of AccessControlContract

#### `get_scopes(env, address) → Vec<PermissionScope>`
- **Description**: Get all permission scopes granted to an address
- **Auth required**: No
- **Parameters**:
  - `env: Env` — Soroban environment
  - `address: Address` — Address to query
- **Returns**: Vec of all PermissionScope values held
- **Side effects**: None
- **Note**: Part of AccessControlContract

### Ratings & Reputation

#### `rate_organization(env, rater, org_id, rating, request_id) → Result<(), Error>`
- **Description**: Rate an organization (1–5). Each (request_id, rater) pair can only rate once.
- **Auth required**: Yes, signer must be `rater`
- **Parameters**:
  - `rater: Address` — The address submitting the rating
  - `org_id: Address` — Organization being rated
  - `rating: u32` — Rating score (1–5 inclusive)
  - `request_id: u64` — ID of the completed request/delivery (used for deduplication)
- **Returns**: `Ok(())` on success
- **Errors**:
  - `InvalidRating` — If rating is not 1–5
  - `AlreadyRated` — If (request_id, rater) has already rated
  - `ContractPaused` — If contract is paused
  - `OrganizationNotFound` — If org_id doesn't exist
- **Side effects**:
  - Updates organization's running average rating and total_ratings count
  - Marks (request_id, rater) as rated
  - Stores RatingRecord with timestamp
- **Events**: Publishes `("rated", "v1")` with org_id, rater, rating
- **Access Control**: The rater must sign
- **Note**: Stub verification (always succeeds); wire to request contract in production

#### `get_rating_record(env, request_id, rater) → Option<RatingRecord>`
- **Description**: Get a specific rating record
- **Auth required**: No
- **Parameters**:
  - `request_id: u64` — Request ID
  - `rater: Address` — Rater address
- **Returns**: RatingRecord or None if not found
- **Side effects**: None

### Badges

#### `award_badge(env, admin, org_id, badge_type) → Result<(), Error>`
- **Description**: Award a badge to an organization (admin only, no duplicates)
- **Auth required**: Yes, signer must be admin
- **Parameters**:
  - `admin: Address` — Admin calling the function
  - `org_id: Address` — Organization to award badge to
  - `badge_type: BadgeType` — One of: TopRated, HighCompliance, FastResponse, LongService, VerifiedProvider
- **Returns**: `Ok(())` on success
- **Errors**:
  - `Unauthorized` — If caller is not admin
  - `ContractPaused` — If contract is paused
  - `OrganizationNotFound` — If org_id doesn't exist
  - `BadgeAlreadyAwarded` — If org already has this badge type
- **Side effects**:
  - Appends BadgeRecord to organization's badges vector
- **Events**: Publishes `("badge", "v1")` with org_id, admin
- **Access Control**: Admin only

#### `revoke_badge(env, admin, org_id, badge_type) → Result<(), Error>`
- **Description**: Revoke a badge from an organization (admin only)
- **Auth required**: Yes, signer must be admin
- **Parameters**:
  - `admin: Address` — Admin calling the function
  - `org_id: Address` — Organization to revoke badge from
  - `badge_type: BadgeType` — Badge type to remove
- **Returns**: `Ok(())` on success
- **Errors**:
  - `Unauthorized` — If caller is not admin
  - `ContractPaused` — If contract is paused
  - `BadgeNotFound` — If badge type not found for this org
- **Side effects**:
  - Removes BadgeRecord with matching badge_type from org
- **Access Control**: Admin only

#### `get_badges(env, org_id) → Vec<BadgeRecord>`
- **Description**: Get all badges for an organization
- **Auth required**: No
- **Parameters**:
  - `org_id: Address` — Organization to query
- **Returns**: Vec of BadgeRecord structs
- **Side effects**: None

### Delivery Verification

#### `verify_delivery(env, verifier, request_id, org_id, recipient, quantity_delivered, temperature_ok) → Result<(), Error>`
- **Description**: Record and verify a delivery proof
- **Auth required**: Yes, signer must be `verifier`
- **Parameters**:
  - `verifier: Address` — Address authorizing the delivery verification
  - `request_id: u64` — Unique ID for this delivery/request
  - `org_id: Address` — Organization that performed the delivery
  - `recipient: Address` — Recipient of the delivery
  - `quantity_delivered: u32` — Amount delivered (must be > 0)
  - `temperature_ok: bool` — Whether temperature conditions were maintained
- **Returns**: `Ok(())` on success
- **Errors**:
  - `ContractPaused` — If contract is paused
  - `InvalidDeliveryProof` — If quantity_delivered == 0
  - `OrganizationNotFound` — If org_id doesn't exist
- **Side effects**:
  - Creates and stores DeliveryProof with verified=true and verified_at=now
- **Events**: Publishes `("delivery", "v1")` with request_id, org_id, recipient, temperature_ok
- **Access Control**: The verifier must sign

#### `get_delivery(env, request_id) → Option<DeliveryProof>`
- **Description**: Retrieve a delivery proof by request ID
- **Auth required**: No
- **Parameters**:
  - `request_id: u64` — Delivery request ID
- **Returns**: DeliveryProof struct or None if not found
- **Side effects**: None

---

## Data Structures

### Organization
```rust
pub struct Organization {
    pub id: Address,                           // Organization address
    pub org_type: OrgType,                     // BloodBank or Hospital
    pub name: String,                          // Org name
    pub license_number: String,                // Unique license
    pub verified: bool,                        // Verification status
    pub verified_timestamp: Option<u64>,       // When verified (Unix timestamp)
    pub rating: u32,                           // Average rating (0–100 scale)
    pub total_ratings: u32,                    // Count of ratings submitted
    pub location_hash: BytesN<32>,             // 32-byte location hash
}
```

### RoleGrant
```rust
pub struct RoleGrant {
    pub role: Role,                    // Admin, BloodBank, Hospital, Donor, Rider, Custom(u32)
    pub granted_at: u64,               // Unix timestamp when granted
    pub expires_at: Option<u64>,       // Unix timestamp when expires (None = never)
}
```

### RatingRecord
```rust
pub struct RatingRecord {
    pub rater: Address,                // Who submitted the rating
    pub org_id: Address,               // Organization rated
    pub rating: u32,                   // Score (1–5)
    pub request_id: u64,               // Associated request/delivery ID
    pub timestamp: u64,                // When rating was submitted
}
```

### BadgeRecord
```rust
pub struct BadgeRecord {
    pub org_id: Address,               // Organization holding badge
    pub badge_type: BadgeType,         // TopRated, HighCompliance, etc.
    pub awarded_at: u64,               // Unix timestamp
    pub awarded_by: Address,           // Admin who awarded it
}
```

### DeliveryProof
```rust
pub struct DeliveryProof {
    pub request_id: u64,               // Unique delivery ID
    pub org_id: Address,               // Organization that delivered
    pub recipient: Address,            // Recipient address
    pub quantity_delivered: u32,       // Amount delivered
    pub temperature_ok: bool,          // Temperature compliance
    pub delivered_at: u64,             // Delivery timestamp
    pub verified: bool,                // Verification status (always true once recorded)
    pub verified_at: Option<u64>,      // Verification timestamp
}
```

---

## Error Codes

| Code | Name | Cause |
|------|------|-------|
| 200 | `InvalidInput` | Empty input string or invalid parameters |
| 201 | `LicenseAlreadyRegistered` | License number already in use |
| 202 | `InvalidOrgType` | Invalid organization type |
| 203 | `AlreadyInitialized` | Contract already initialized |
| 204 | `Unauthorized` | Caller lacks required permissions |
| 205 | `InvalidRating` | Rating outside 1–5 range |
| 206 | `AlreadyRated` | (request_id, rater) pair already rated |
| 207 | `OrganizationNotFound` | Organization does not exist |
| 208 | `BadgeAlreadyAwarded` | Badge type already awarded to org |
| 209 | `BadgeNotFound` | Badge not found for this org |
| 210 | `InvalidDeliveryProof` | Quantity is 0 or other proof issue |
| 211 | `AlreadyVerified` | Organization already verified |
| 212 | `AlreadyUnverified` | Organization already unverified |
| 213 | `ContractPaused` | Contract is paused, no mutations allowed |

---

## Event Types

### Initialization
- `("init", "v1")` → `(admin_address: Address)`

### Organization Events
- `("org_reg", "v1")` → `(org_id: Address, org_type: OrgType, name: String)`
- `("org_verified", "v1")` → `(org_id: Address, admin: Address, timestamp: u64)`
- `("org_unverified", "v1")` → `(org_id: Address, reason: String)`

### Rating Events
- `("rated", "v1")` → `(org_id: Address, rater: Address, rating: u32)`

### Badge Events
- `("badge", "v1")` → `(org_id: Address, admin: Address)`

### Delivery Events
- `("delivery", "v1")` → `(request_id: u64, org_id: Address, recipient: Address, temperature_ok: bool)`

---

## Usage Patterns

### Workflow: From Registration to Verified Delivery

1. **Owner registers org:**
   ```
   register_organization(owner, BloodBank, "RedCross", "LIC-123", location_hash, doc_hashes)
   → Returns org_id (same as owner address)
   → Org created with verified=false, rating=0
   → Owner automatically gets BloodBank role
   ```

2. **Admin verifies org:**
   ```
   verify_organization(admin, org_id)
   → Org is now marked verified; timestamps recorded
   ```

3. **Verifier confirms delivery:**
   ```
   verify_delivery(verifier, request_id=1001, org_id, recipient, qty=10, temp_ok=true)
   → DeliveryProof recorded and verified
   ```

4. **Rater submits rating:**
   ```
   rate_organization(rater, org_id, rating=5, request_id=1001)
   → Org rating updated: (0×0 + 5) / 1 = 5
   → Cannot rate again for request_id=1001
   ```

5. **Admin awards badge:**
   ```
   award_badge(admin, org_id, TopRated)
   → BadgeRecord stored; prevents duplicate TopRated badges
   ```

### Workflow: Role Expiry

1. **Admin grants temporary role:**
   ```
   grant_role_with_expiry(address, Hospital, expires_at=1700000000)
   ```

2. **Check role before expiry:**
   ```
   has_role(address, Hospital) → true
   ```

3. **After expiry time:**
   ```
   has_role(address, Hospital) → false (cleaned up automatically)
   ```

4. **Manual cleanup (optional):**
   ```
   cleanup_expired_roles(address) → returns count of expired roles removed
   ```

### Workflow: Permission-Based Action Control

1. **Admin grants settlement release permission:**
   ```
   grant_scope(settlement_agent, SettlementRelease)
   ```

2. **Settlement contract checks permission:**
   ```
   if has_scope(settlement_agent, SettlementRelease) {
       // Proceed with settlement
   }
   ```

3. **Revoke when no longer needed:**
   ```
   revoke_scope(settlement_agent, SettlementRelease)
   ```

---

## Key Design Notes

- **Org ID is Address**: An organization's ID is the owner's address. No separate ID generation needed.
- **Deduplication**: Roles per address are stored in a single sorted Vec, preventing duplicate role assignments.
- **Rating Accumulation**: Organization ratings are running averages updated on each `rate_organization()` call.
- **Delivery Prerequisite**: Delivery proofs must be recorded before ratings can be submitted (enforced at application layer).
- **Permission Scopes**: Independent of roles; used for fine-grained authorization (e.g., settlement release).
- **Pause Mechanism**: All state-mutating operations check the paused flag; read operations are unaffected.
