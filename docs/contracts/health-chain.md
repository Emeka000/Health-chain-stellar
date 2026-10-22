# HealthChain Registry Contract

**Location:** `contracts/src/lib.rs`  
**Purpose:** The root Soroban contract for the HealthDonor Protocol. It maintains a verified registry of blood banks and hospitals, tracks individual blood unit lifecycles, and records payment and dispute state on-chain.

---

## Public Interface

### Lifecycle & Metadata

| Function | Parameters | Returns | Auth |
|---|---|---|---|
| `initialize` | `env, admin: Address` | `Symbol` | `admin` |
| `version` | `env` | `u32` | Public |
| `get_metadata` | `env` | `Map<Symbol, String>` | Public |
| `is_feature_supported` | `env, feature: Symbol` | `bool` | Public |

### Actor Registry

| Function | Parameters | Returns | Auth |
|---|---|---|---|
| `register_blood_bank` | `env, bank_id: Address` | `Result<(), Error>` | Admin |
| `register_hospital` | `env, hospital_id: Address` | `Result<(), Error>` | Admin |
| `activate_blood_bank` | `env, bank_id: Address` | `Result<(), Error>` | Admin |
| `deactivate_blood_bank` | `env, bank_id: Address` | `Result<(), Error>` | Admin |
| `activate_hospital` | `env, hospital_id: Address` | `Result<(), Error>` | Admin |
| `deactivate_hospital` | `env, hospital_id: Address` | `Result<(), Error>` | Admin |
| `is_blood_bank` | `env, bank_id: Address` | `bool` | Public |
| `get_blood_bank_state` | `env, bank_id: Address` | `LifecycleState` | Public |
| `get_hospital_state` | `env, hospital_id: Address` | `LifecycleState` | Public |
| `get_organization_state` | `env, org_id: Address` | `LifecycleState` | Public |

### Blood Unit Operations

| Function | Parameters | Returns | Auth |
|---|---|---|---|
| `register_blood` | `env, bank_id, unit_id, blood_type, quantity_ml, expiration_date` | `Result<(), Error>` | Blood Bank |
| `batch_register_blood` | `env, bank_id, units: Vec<...>` | `Result<(), Error>` | Blood Bank |
| `allocate_blood` | `env, bank_id, unit_id, hospital_id` | `Result<(), Error>` | Blood Bank |
| `batch_allocate_blood` | `env, bank_id, unit_ids, hospital_id` | `Result<(), Error>` | Blood Bank |
| `cancel_allocation` | `env, bank_id, unit_id` | `Result<(), Error>` | Blood Bank |
| `initiate_transfer` | `env, bank_id, unit_id` | `Result<String, Error>` | Blood Bank |
| `confirm_delivery` | `env, hospital, unit_id` | `Result<(), Error>` | Hospital |
| `confirm_transfer` | `env, hospital, event_id` | `Result<(), Error>` | Hospital |
| `cancel_transfer` | `env, bank_id, event_id` | `Result<String, Error>` | Blood Bank |
| `withdraw_blood` | `env, bank_id, unit_id, reason` | `Result<(), Error>` | Blood Bank |
| `quarantine_blood` | `env, bank_id, unit_id, reason` | `Result<(), Error>` | Blood Bank |
| `finalize_quarantine` | `env, bank_id, unit_id, disposition` | `Result<(), Error>` | Blood Bank |
| `get_blood_unit` | `env, unit_id` | `Result<BloodUnit, Error>` | Public |
| `get_blood_status` | `env, unit_id` | `Result<BloodStatus, Error>` | Public |
| `is_expired` | `env, unit_id` | `Result<bool, Error>` | Public |
| `get_units_by_donor` | `env, donor_id: Symbol` | `Vec<BloodUnit>` | Public |

### Payments & Disputes

See `contracts/src/payments.rs` for `initiate_payment`, `release_payment`, `refund_payment`, `open_dispute`, `resolve_dispute`.

---

## Storage Layout

| Key Type | Storage Tier | Description |
|---|---|---|
| `Admin` | Instance | Contract admin address |
| `BloodBank(Address)` | Persistent | Blood bank registry entry |
| `Hospital(Address)` | Persistent | Hospital registry entry |
| `BloodUnit(u64)` | Persistent | Individual unit state |
| `Payment(u64)` | Persistent | Payment record |
| `Dispute(u64)` | Persistent | Dispute record |
| `UnitCounter` | Instance | Auto-increment unit ID |
| `PaymentCounter` | Instance | Auto-increment payment ID |

---

## Events

| Topic | Data | When |
|---|---|---|
| `["register", "bank"]` | `bank_id: Address` | Blood bank registered |
| `["register", "hospital"]` | `hospital_id: Address` | Hospital registered |
| `["register", "blood"]` | `{unit_id, bank_id, blood_type}` | Blood unit registered |
| `["transfer", "initiated"]` | `{event_id, unit_id, bank_id}` | Transfer started |
| `["transfer", "confirmed"]` | `{event_id, unit_id, hospital}` | Delivery confirmed |
| `["payment", "released"]` | `{payment_id, amount}` | Payment settled |
| `["dispute", "opened"]` | `{dispute_id, payment_id}` | Dispute raised |
| `["dispute", "resolved"]` | `{dispute_id, outcome}` | Dispute resolved |

---

## Error Codes

| Code | Name | Meaning |
|---|---|---|
| 1 | `Unauthorized` | Caller is not authorised for this action |
| 2 | `InvalidQuantity` | Blood quantity is zero or negative |
| 3 | `InvalidExpiration` | Expiration date is in the past |
| 4 | `DuplicateRegistration` | Unit or actor already registered |
| 5 | `StorageError` | Internal storage failure |
| 6 | `InvalidStatus` | Operation not valid in current status |
| 7 | `UnitNotFound` | Blood unit does not exist |
| 8 | `UnitExpired` | Blood unit has passed its expiration date |
| 9 | `UnauthorizedHospital` | Hospital is not in the verified registry |
| 10 | `InvalidTransition` | Status transition is not permitted |
| 11 | `AlreadyAllocated` | Unit is already allocated to a hospital |
| 12 | `BatchSizeExceeded` | Batch exceeds the maximum allowed size |
| 13 | `DuplicateRequest` | Identical request already exists |
| 14 | `InvalidDeliveryAddress` | Delivery address is missing or malformed |
| 15 | `InvalidRequiredBy` | Required-by timestamp is invalid |
| 16 | `TransferExpired` | Transfer window has elapsed |
| 17 | `TransferNotExpired` | Transfer window has not yet elapsed |
| 18 | `PaymentNotFound` | Payment record does not exist |
| 19 | `DisputeNotFound` | Dispute record does not exist |
| 20 | `InvalidDisputeStatus` | Operation invalid for dispute's current status |
| 21 | `DisputeAlreadyExists` | A dispute already exists for this payment |
| 22 | `InvalidPaymentStatus` | Operation invalid for payment's current status |
| 25 | `UnitIdTooLong` | Unit ID string exceeds maximum length |
