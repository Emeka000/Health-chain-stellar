# Delivery Contract

**Location:** `lifebank-soroban/contracts/delivery/src/lib.rs`  
**Purpose:** Records compliance attestations for blood-unit deliveries. Stores temperature thresholds, proof requirements (photo, signature, temperature log), and links to the Requests contract to validate delivery IDs. Each delivery can have one attestation (immutable once recorded).

---

## Public Interface

### Initialization & Admin

| Function | Parameters | Returns | Auth |
|---|---|---|---|
| `initialize` | `env, admin: Address, request_contract: Address` | `Result<(), Error>` | Signed by `admin` |
| `version` | `env` | `u32` | Public |
| `is_initialized` | `env` | `bool` | Public |
| `get_admin` | `env` | `Result<Address, Error>` | Public |
| `propose_admin` | `env, admin: Address, new_admin: Address` | `Result<(), Error>` | Signed by Admin |
| `accept_admin` | `env, new_admin: Address` | `Result<(), Error>` | Signed by proposed admin |
| `get_pending_admin` | `env` | `Option<Address>` | Public |
| `upgrade` | `env, admin: Address, new_wasm_hash: Bytes` | `Result<(), Error>` | Signed by Admin |

### Configuration

| Function | Parameters | Returns | Auth |
|---|---|---|---|
| `set_temperature_thresholds` | `env, admin: Address, thresholds: TemperatureThresholds` | `Result<(), Error>` | Signed by Admin |
| `set_proof_requirements` | `env, admin: Address, requirements: ProofRequirements` | `Result<(), Error>` | Signed by Admin |
| `get_temperature_thresholds` | `env` | `Result<TemperatureThresholds, Error>` | Public |
| `get_proof_requirements` | `env` | `Result<ProofRequirements, Error>` | Public |

### Attestation

| Function | Parameters | Returns | Auth |
|---|---|---|---|
| `record_compliance_attestation` | `env, admin: Address, delivery_id: u64, compliance_hash: Bytes, is_compliant: bool` | `Result<(), Error>` | Signed by Admin. Rejects if delivery_id is 0, exceeds request counter, or already has an attestation. |
| `get_compliance_attestation` | `env, delivery_id: u64` | `Result<(Bytes, bool), Error>` | Public. Returns `(compliance_hash, is_compliant)` tuple or `DeliveryNotFound`. |
| `get_delivery_counter` | `env` | `Result<u64, Error>` | Public (mirrors highest delivery_id seen) |

### Query

| Function | Parameters | Returns | Auth |
|---|---|---|---|
| `get_request_contract` | `env` | `Result<Address, Error>` | Public |

---

## Storage Layout

| Key | Storage Tier | Description |
|---|---|---|
| `DataKey::Admin` | Instance | Admin address |
| `DataKey::PendingAdmin` | Instance | Proposed new admin (for two-step transfer) |
| `DataKey::RequestContract` | Instance | Linked requests contract address |
| `DataKey::DeliveryCounter` | Instance | Highest delivery_id seen (syncs with request counter) |
| `DataKey::TemperatureThresholds` | Instance | `TemperatureThresholds` config |
| `DataKey::ProofRequirements` | Instance | `ProofRequirements` config |
| `DataKey::ComplianceAttestation(u64)` | Persistent | `(Bytes, bool)` tuple per delivery ID |

### TTL Constants

- Instance storage bumped on every operation (standard practice)
- Persistent attestation entries bumped on write
- Default thresholds: 2–6 °C (standard blood storage)

---

## Types

### `TemperatureThresholds`
```rust
pub struct TemperatureThresholds {
    pub min_celsius: i32,          // Default: 2
    pub max_celsius: i32,          // Default: 6
}
```

### `ProofRequirements`
```rust
pub struct ProofRequirements {
    pub requires_photo_proof: bool,           // Default: true
    pub requires_recipient_signature: bool,   // Default: true
    pub requires_temperature_log: bool,       // Default: true
}
```

---

## Delivery ID Validation

When `record_compliance_attestation` is called:
1. **Non-zero check**: `delivery_id` must not be 0 (delivery IDs start at 1)
2. **Counter check**: `delivery_id` must not exceed the current request counter on the linked requests contract (prevents attestations for non-existent deliveries)
3. **Uniqueness check**: No prior attestation for this `delivery_id` exists (immutable once recorded); if so, returns `AlreadyAttested` error

---

## Events

| Topics | Data Format | When |
|---|---|---|
| `["delivery", "init"]` | `[admin: Address, request_contract: Address]` | Contract initialized |
| `["delivery", "complied"]` | `[delivery_id: u64, compliance_hash: Bytes, is_compliant: bool]` | Compliance attested |
| `["delivery", "temps"]` | `[min_celsius: i32, max_celsius: i32]` | Temperature thresholds updated |
| `["delivery", "proofs"]` | `[requires_photo_proof: bool, requires_recipient_signature: bool, requires_temperature_log: bool]` | Proof requirements updated |
| `["admin", "proposed"]` | `[current_admin: Address, new_admin: Address]` | Admin transfer proposed |
| `["admin", "transferred"]` | `[old_admin: Address, new_admin: Address]` | Admin transfer accepted |
| `["delivery", "upgraded"]` | `[new_wasm_hash: Bytes]` | Contract upgraded |

---

## Error Codes

| Name | Meaning |
|---|---|
| `NotInitialized` | `initialize` not called or instance storage expired |
| `DeliveryNotFound` | `delivery_id` is 0, exceeds request counter, or does not correspond to a valid request |
| `AlreadyAttested` | A compliance attestation for this `delivery_id` already exists (immutable) |
| `Unauthorized` | Caller does not match the stored admin or is not the proposed admin |
| `ContractPaused` | (If pause mechanism added in future versions) |

---

## Cross-Contract Calls

`record_compliance_attestation` calls:
- `RequestsContractClient::try_get_request_counter(env)` — to validate `delivery_id` does not exceed the counter

---

## Compliance Hash Storage

The `compliance_hash` is stored as-is (opaque bytes). The contract does not interpret its contents. Callers are responsible for:
- Computing a cryptographic hash of the compliance proof data (photo, signature, temperature logs, etc.)
- Verifying the hash off-chain or in a separate verification contract
- Determining whether the delivery `is_compliant` based on custom business logic

The contract merely records the attestation as a timestamped fact.
