# Identity Contract

**Location:** `lifebank-soroban/contracts/identity/src/lib.rs`  
**Purpose:** Manages verified organization identities (blood banks and hospitals), role-based access control with optional expiry, fine-grained permission scopes, ratings, performance badges, and delivery proofs. Supports pause/unpause for emergency governance.

---

## Dependency Order & Workflows

Integrators must respect these dependencies when designing client workflows:

1. **Registration & Verification**: Organizations are registered (by owner) then verified (by admin).
2. **Roles & Expiry**: Roles (e.g., Admin, BloodBank) can be granted with optional expiry. Expired roles are automatically cleaned up on access.
3. **Ratings**: Only allowed after the rater and rated organization have completed a delivery together (verified via `request_id`). One rating per request.
4. **Delivery Proofs**: A delivery proof is recorded once per request; corrections require `correct_delivery_proof`. Proofs link riders and recipients to organizations.
5. **Badges**: Awards and revocations are independent of ratings but reflect organizational performance.

---

## Public Interface

### Initialization & Admin

| Function | Parameters | Returns | Auth |
|---|---|---|---|
| `initialize` | `env, admin: Address` | `Result<(), Error>` | Signed by `admin` |
| `version` | `env` | `u32` | Public |
| `pause` | `env, admin` | `Result<(), Error>` | Signed by Admin |
| `unpause` | `env, admin` | `Result<(), Error>` | Signed by Admin |
| `is_paused` | `env` | `bool` | Public |
| `get_admin` | `env` | `Result<Address, Error>` | Public |
| `propose_admin` | `env, admin, new_admin: Address` | `Result<(), Error>` | Signed by current Admin |
| `accept_admin` | `env, new_admin: Address` | `Result<(), Error>` | Signed by proposed admin |
| `get_pending_admin` | `env` | `Option<Address>` | Public |
| `upgrade` | `env, admin, new_wasm_hash: BytesN<32>` | `Result<(), Error>` | Signed by Admin |
| `is_initialized` | `env` | `bool` | Public |

### Organization Management

| Function | Parameters | Returns | Auth |
|---|---|---|---|
| `register_organization` | `env, owner: Address, org_type: OrgType, name: String, license_number: String, location_hash: BytesN<32>, document_hashes: Vec<BytesN<32>>` | `Result<Address, Error>` | Signed by owner (returns `org_id`) |
| `verify_organization` | `env, admin: Address, org_id: Address` | `Result<(), Error>` | Signed by Admin |
| `unverify_organization` | `env, admin: Address, org_id: Address` | `Result<(), Error>` | Signed by Admin |
| `is_organization_verified` | `env, org_id: Address` | `Result<bool, Error>` | Public |
| `get_verification_timestamp` | `env, org_id: Address` | `Result<Option<u64>, Error>` | Public |
| `get_verification_metadata` | `env, org_id: Address` | `Option<(u64, Address)>` | Public |
| `get_verification_events` | `env, org_id: Address` | `Vec<(bool, u64)>` | Public (latest first) |
| `batch_verify_organizations` | `env, admin: Address, org_ids: Vec<Address>` | `Result<u32, Error>` | Signed by Admin |
| `batch_revoke_organizations` | `env, admin: Address, org_ids: Vec<Address>` | `Result<u32, Error>` | Signed by Admin |
| `get_organization` | `env, org_id: Address` | `Option<Organization>` | Public |
| `get_org_counter` | `env` | `Result<u32, Error>` | Public |
| `get_organizations_by_type` | `env, org_type: OrgType, start_index: u32, limit: u32` | `Vec<Organization>` | Public |
| `get_verified_organizations` | `env, org_type: OrgType, start_index: u32, limit: u32` | `VerifiedOrgPage` | Public |
| `get_top_rated_organizations` | `env, org_type: OrgType, limit: u32` | `Vec<Organization>` | Public (capped at 50) |

### Roles & Role Expiry

| Function | Parameters | Returns | Auth |
|---|---|---|---|
| `grant_role` | `env, admin: Address, address: Address, role: Role` | `Result<(), Error>` | Signed by Admin |
| `grant_role_with_expiry` | `env, admin: Address, address: Address, role: Role, expires_at: Option<u64>` | `Result<(), Error>` | Signed by Admin |
| `revoke_role` | `env, admin: Address, address: Address, role: Role` | `Result<(), Error>` | Signed by Admin |
| `get_role` | `env, address: Address` | `Option<Role>` | Public |
| `get_roles` | `env, address: Address` | `Vec<RoleGrant>` | Public |
| `has_role` | `env, account: Address, role: Role` | `bool` | Public |
| `cleanup_expired_roles` | `env, address: Address` | `Result<u32, Error>` | Public (returns count cleaned) |

### Permissions & Scopes

| Function | Parameters | Returns | Auth |
|---|---|---|---|
| `grant_scope` | `env, admin: Address, address: Address, scope: PermissionScope` | `Result<(), Error>` | Signed by Admin |
| `revoke_scope` | `env, admin: Address, address: Address, scope: PermissionScope` | `Result<(), Error>` | Signed by Admin |
| `has_scope` | `env, address: Address, scope: PermissionScope` | `bool` | Public |
| `get_scopes` | `env, address: Address` | `Vec<PermissionScope>` | Public |

### Organization Ratings

| Function | Parameters | Returns | Auth |
|---|---|---|---|
| `rate_organization` | `env, rater: Address, org_id: Address, rating: u32, request_id: u64` | `Result<(), Error>` | Signed by rater. Requires verified delivery for `request_id`. Rating must be 1–5. One rating per request. |
| `get_organization_rating` | `env, org_id: Address` | `u32` | Public (average; 0 if no ratings) |
| `get_rating_record` | `env, request_id: u64, rater: Address` | `Option<RatingRecord>` | Public |

### Badges

| Function | Parameters | Returns | Auth |
|---|---|---|---|
| `award_badge` | `env, admin: Address, org_id: Address, badge: BadgeType` | `Result<(), Error>` | Signed by Admin |
| `revoke_badge` | `env, admin: Address, org_id: Address, badge: BadgeType` | `Result<(), Error>` | Signed by Admin |
| `get_badges` | `env, org_id: Address` | `Vec<BadgeRecord>` | Public |

### Delivery Proofs

| Function | Parameters | Returns | Auth |
|---|---|---|---|
| `verify_delivery` | `env, verifier: Address, request_id: u64, org_id: Address, recipient: Address, quantity_delivered: u32, temperature_ok: bool` | `Result<(), Error>` | Signed by verifier (must be assigned rider or recipient). One proof per request. Cannot exceed request quantity. |
| `correct_delivery_proof` | `env, corrector: Address, request_id: u64, org_id: Address, recipient: Address, quantity_delivered: u32, temperature_ok: bool` | `Result<(), Error>` | Signed by corrector (must be admin or original verifier). Replaces prior proof once only. |
| `get_delivery` | `env, request_id: u64` | `Option<DeliveryProof>` | Public (current verified proof) |
| `get_delivery_history` | `env, request_id: u64` | `Vec<DeliveryProof>` | Public (includes corrections, latest first) |
| `set_requests_contract` | `env, admin: Address, requests_contract: Address` | `Result<(), Error>` | Signed by Admin |

---

## Storage Layout

| Key | Storage Tier | TTL (ledgers) | Description |
|---|---|---|---|
| `DataKey::Admin` | Instance | Instance lifetime | Admin address |
| `DataKey::Paused` | Instance | Instance lifetime | Pause flag |
| `DataKey::RequestsContract` | Instance | Instance lifetime | Address of requests contract (for delivery verification) |
| `DataKey::Org(Address)` | Persistent | Bumped on access | Organization record |
| `DataKey::License(String)` | Persistent | Bumped on access | License number → org_id mapping (uniqueness check) |
| `DataKey::Docs(Address)` | Persistent | Bumped on access | Document hashes for org |
| `DataKey::OrgTypeList(OrgType)` | Persistent | Bumped on access | Paginated list of orgs by type |
| `DataKey::OrgCounter` | Instance | Instance lifetime | Counter for pagination |
| `DataKey::AddressRoles(Address)` | Persistent | Bumped on access | `Vec<RoleGrant>` with role, grant time, optional expiry |
| `DataKey::Scopes(Address)` | Persistent | Bumped on access | `Vec<PermissionScope>` for address |
| `DataKey::RatingRecord(u64, Address)` | Persistent | Bumped on access | Single rating by rater for request_id |
| `DataKey::RatedFlag(u64, Address)` | Persistent | Bumped on access | Uniqueness check: "request_id + rater has rated" |
| `DataKey::Badges(Address)` | Persistent | Bumped on access | `Vec<BadgeRecord>` for org |
| `DataKey::Delivery(u64)` | Persistent | Bumped on access | Current verified delivery proof for request_id |
| `DataKey::DeliveryHistory(u64)` | Persistent | Bumped on access | All delivery proofs (original + corrections) for request_id |
| `DataKey::VerificationEvents(Address)` | Persistent | Bumped on access | `Vec<(verified: bool, timestamp)>` history |
| `DataKey::VerificationTimestamp(Address)` | Persistent | Bumped on access | Latest verification timestamp (None if unverified) |

### TTL Constants
- `TTL_THRESHOLD`: 518 400 ledgers (~30 days) — bump when remaining TTL falls below this
- `TTL_EXTEND_TO`: 1 036 800 ledgers (~60 days) — extend to this value on bump

---

## Enums

### `OrgType`
```rust
pub enum OrgType { BloodBank, Hospital }
```

### `Role`
```rust
pub enum Role { Admin, BloodBank, Hospital, Donor, Rider, Custom(u32) }
```

### `PermissionScope`
```rust
pub enum PermissionScope {
    InventoryWrite,
    DispatchOverride,
    RequestApprove,
    DisputeResolve,
    VerificationAdmin,
    SettlementRelease,
}
```

### `BadgeType`
```rust
pub enum BadgeType {
    TopRated, HighCompliance, FastResponse, LongService, VerifiedProvider,
}
```

---

## Types

### `Organization`
```rust
pub struct Organization {
    pub id: Address,
    pub org_type: OrgType,
    pub name: String,
    pub license_number: String,
    pub verified: bool,
    pub verified_timestamp: Option<u64>,
    pub rating: u32,           // Average rating (0–5)
    pub total_ratings: u64,
    pub rating_sum: u64,
    pub location_hash: BytesN<32>,
}
```

### `RoleGrant`
```rust
pub struct RoleGrant {
    pub role: Role,
    pub granted_at: u64,
    pub expires_at: Option<u64>,  // Unix timestamp; None = no expiry
}
```

### `RatingRecord`
```rust
pub struct RatingRecord {
    pub rater: Address,
    pub org_id: Address,
    pub rating: u32,       // 1–5
    pub request_id: u64,
    pub timestamp: u64,
}
```

### `BadgeRecord`
```rust
pub struct BadgeRecord {
    pub badge: BadgeType,
    pub awarded_at: u64,
    pub awarded_by: Address,
}
```

### `DeliveryProof`
```rust
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
```

### `VerifiedOrgPage`
```rust
pub struct VerifiedOrgPage {
    pub items: Vec<Organization>,
    pub next_start: Option<u32>,  // Cursor for pagination, or None if end reached
}
```

---

## Error Codes

| Code | Name | Meaning |
|---|---|---|
| 200 | `InvalidInput` | Required field is empty or malformed |
| 201 | `LicenseAlreadyRegistered` | License number already in use |
| 202 | `InvalidOrgType` | Unrecognised organisation type |
| 203 | `AlreadyInitialized` | `initialize` called more than once |
| 204 | `Unauthorized` | Caller is not permitted (not admin, not verifier, etc.) |
| 205 | `InvalidRating` | Rating score out of 1–5 range |
| 206 | `AlreadyRated` | Rater has already rated this request |
| 207 | `OrganizationNotFound` | No organisation with this address |
| 208 | `BadgeAlreadyAwarded` | Badge already held by this organisation |
| 209 | `BadgeNotFound` | Badge not held; cannot revoke |
| 210 | `InvalidDeliveryProof` | Proof data malformed or delivery already verified |
| 211 | `AlreadyVerified` | Organisation already verified |
| 212 | `AlreadyUnverified` | Organisation already unverified |
| 213 | `ContractPaused` | All state mutations blocked while paused |
| 214 | `DeliveryAlreadyVerified` | A proof for this request already exists; use `correct_delivery_proof` |
| 215 | `OrganizationAlreadyRegistered` | Owner has already registered an organisation |
| 216 | `IncorrectionNotAllowed` | Correction already applied; cannot correct twice |
| 217 | `InvalidInteraction` | Delivery unverified, or not enough time elapsed for rating |
| 218 | `UnauthorizedDeliveryVerifier` | Verifier is neither assigned rider nor recipient |
