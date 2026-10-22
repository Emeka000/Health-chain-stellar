# Identity Contract

**Location:** `lifebank-soroban/contracts/identity/src/lib.rs`  
**Purpose:** Manages verified organization identities (blood banks and hospitals), role-based access control, fine-grained permission scopes, and performance badges. Supports pause/unpause for emergency governance.

---

## Public Interface

### Initialization & Admin

| Function | Parameters | Returns | Auth |
|---|---|---|---|
| `initialize` | `env, admin: Address` | `Result<(), Error>` | `admin` |
| `pause` | `env, admin` | `Result<(), Error>` | Admin |
| `unpause` | `env, admin` | `Result<(), Error>` | Admin |
| `transfer_admin` | `env, current_admin, new_admin` | `Result<(), Error>` | Admin |

### Organization Management

| Function | Parameters | Returns | Auth |
|---|---|---|---|
| `register_organization` | `env, admin, org_id, license_number: String, org_type: OrgType` | `Result<(), Error>` | Admin |
| `verify_organization` | `env, admin, org_id` | `Result<(), Error>` | Admin |
| `unverify_organization` | `env, admin, org_id, reason: String` | `Result<(), Error>` | Admin |
| `get_organization` | `env, org_id` | `Result<Organization, Error>` | Public |
| `is_verified` | `env, org_id` | `bool` | Public |

### Roles & Permissions

| Function | Parameters | Returns | Auth |
|---|---|---|---|
| `assign_role` | `env, admin, target, role: Role` | `Result<(), Error>` | Admin |
| `revoke_role` | `env, admin, target` | `Result<(), Error>` | Admin |
| `grant_permission` | `env, admin, target, scope: PermissionScope` | `Result<(), Error>` | Admin |
| `revoke_permission` | `env, admin, target, scope: PermissionScope` | `Result<(), Error>` | Admin |
| `has_permission` | `env, target, scope` | `bool` | Public |
| `get_role` | `env, target` | `Option<Role>` | Public |

### Ratings & Badges

| Function | Parameters | Returns | Auth |
|---|---|---|---|
| `submit_rating` | `env, rater, org_id, score: u32` | `Result<(), Error>` | Any caller |
| `award_badge` | `env, admin, org_id, badge: BadgeType` | `Result<(), Error>` | Admin |
| `revoke_badge` | `env, admin, org_id, badge` | `Result<(), Error>` | Admin |
| `get_badges` | `env, org_id` | `Vec<BadgeType>` | Public |
| `get_average_rating` | `env, org_id` | `Option<u32>` | Public |

---

## Storage Layout

| Key | Storage Tier | TTL (ledgers) | Description |
|---|---|---|---|
| `DataKey::Admin` | Instance | Instance lifetime | Admin address |
| `DataKey::Paused` | Instance | Instance lifetime | Pause flag |
| `DataKey::Organization(Address)` | Persistent | Bumped on access | Organization record |
| `DataKey::Role(Address)` | Persistent | Bumped on access | Role assignment |
| `DataKey::Permission(Address, PermissionScope)` | Persistent | Bumped on access | Permission grant |
| `DataKey::Badge(Address, BadgeType)` | Persistent | Bumped on access | Badge award |
| `DataKey::Rating(Address)` | Persistent | Bumped on access | Rating aggregate |

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

## Error Codes

| Code | Name | Meaning |
|---|---|---|
| 200 | `InvalidInput` | Required field is empty or malformed |
| 201 | `LicenseAlreadyRegistered` | License number already in use |
| 202 | `InvalidOrgType` | Unrecognised organisation type |
| 203 | `AlreadyInitialized` | `initialize` called more than once |
| 204 | `Unauthorized` | Caller is not admin |
| 205 | `InvalidRating` | Rating score out of 1–5 range |
| 206 | `AlreadyRated` | Rater has already rated this organisation |
| 207 | `OrganizationNotFound` | No organisation with this address |
| 208 | `BadgeAlreadyAwarded` | Badge already held by this organisation |
| 209 | `BadgeNotFound` | Badge not held; cannot revoke |
| 210 | `InvalidDeliveryProof` | Proof hash is missing or malformed |
| 211 | `AlreadyVerified` | Organisation already verified |
| 212 | `AlreadyUnverified` | Organisation already unverified |
| 213 | `ContractPaused` | All state mutations blocked while paused |
