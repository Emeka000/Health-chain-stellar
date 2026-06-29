# Delivery Contract

**Location:** `lifebank-soroban/contracts/delivery/src/lib.rs`  
**Purpose:** Records compliance attestations for blood-unit deliveries, including temperature compliance, photo proof, and recipient signature requirements. Linked to a Requests contract that governs which deliveries are valid.

---

## Public Interface

| Function | Parameters | Returns | Auth |
|---|---|---|---|
| `initialize` | `env, admin: Address, request_contract: Address` | `Result<(), Error>` | `admin` |
| `set_temperature_thresholds` | `env, admin, min_celsius: i32, max_celsius: i32` | `Result<(), Error>` | Admin |
| `set_proof_requirements` | `env, admin, requirements: ProofRequirements` | `Result<(), Error>` | Admin |
| `attest_compliance` | `env, delivery_id: u64, compliance_hash: Bytes, is_compliant: bool` | `Result<(), Error>` | Any caller |
| `get_compliance` | `env, delivery_id: u64` | `Result<ComplianceAttestation, Error>` | Public |
| `is_initialized` | `env` | `bool` | Public |

---

## Storage Layout

| Key | Storage Tier | Description |
|---|---|---|
| `DataKey::Admin` | Instance | Admin address |
| `DataKey::RequestContract` | Instance | Linked requests contract address |
| `DataKey::DeliveryCounter` | Instance | Auto-increment delivery ID |
| `DataKey::TemperatureThresholds` | Instance | `TemperatureThresholds` struct |
| `DataKey::ProofRequirements` | Instance | `ProofRequirements` struct |
| `DataKey::ComplianceAttestation(u64)` | Persistent | Attestation record per delivery ID |

---

## Types

### `TemperatureThresholds`
```rust
pub struct TemperatureThresholds {
    pub min_celsius: i32,  // default: 2
    pub max_celsius: i32,  // default: 6
}
```

### `ProofRequirements`
```rust
pub struct ProofRequirements {
    pub requires_photo_proof: bool,           // default: true
    pub requires_recipient_signature: bool,   // default: true
    pub requires_temperature_log: bool,       // default: true
}
```

---

## Events

| Topics | Data Format | When |
|---|---|---|
| `["delivery", "init"]` | `[admin, request_contract]` | Contract initialized |
| `["comply"]` | `[delivery_id, compliance_hash, is_compliant]` | Compliance attested |

---

## Error Codes

| Code | Name | Meaning |
|---|---|---|
| 700 | `AlreadyInitialized` | `initialize` called more than once |
| 701 | `NotInitialized` | `initialize` has not been called |
| 702 | `DeliveryNotFound` | No delivery with the given ID |

---

## Default Values

Temperature range is set to 2–6 °C (standard blood storage) on `initialize`. All three proof requirements default to `true`.
