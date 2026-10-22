# Delivery Contract

The Delivery Contract records delivery completions with compliance attestations (including temperature and proof verification), and manages delivery proof requirements.

## Quick Start

Delivery tracking captures:
- **Delivery Records** — One per completed delivery/request fulfillment
- **Compliance Attestations** — Off-chain computed compliance hash + pass/fail status
- **Temperature Thresholds** — Cold-chain validation min/max (default: 2–6°C)
- **Proof Requirements** — What proofs are required (photo, signature, temperature log)

All compliance data is stored on-chain and linked to the requests contract.

## Entrypoints

### Lifecycle & Initialization

#### `initialize(env, admin, request_contract) → Result<(), Error>`
- **Description**: Initialize the delivery contract
- **Auth required**: Yes, signer must be `admin`
- **Parameters**:
  - `admin: Address` — Admin address
  - `request_contract: Address` — Requests contract ID (for delivery tracking)
- **Returns**: `Ok(())` on success; `Err(AlreadyInitialized)` if already initialized
- **Side effects**:
  - Sets admin
  - Stores request_contract address
  - Initializes delivery counter to 0
  - Sets default temperature thresholds (2–6°C)
  - Sets default proof requirements (all enabled)
- **Events**: Publishes `("init", "v1")` with (admin, request_contract)
- **Access Control**: Any address (must sign as admin)

#### `is_initialized(env) → bool`
- **Description**: Check if contract has been initialized
- **Returns**: `true` if admin exists; `false` otherwise

### Admin Queries

#### `get_admin(env) → Result<Address, Error>`
- **Description**: Return the admin address
- **Returns**: Admin address or `Err(NotInitialized)` if not initialized

#### `get_request_contract(env) → Result<Address, Error>`
- **Description**: Return the stored request contract ID
- **Returns**: Request contract address or `Err(NotInitialized)`

#### `get_delivery_counter(env) → Result<u64, Error>`
- **Description**: Return the current delivery counter (how many deliveries have been recorded)
- **Returns**: Current counter value or `Err(NotInitialized)`

#### `get_temperature_thresholds(env) → Result<TemperatureThresholds, Error>`
- **Description**: Return the current temperature thresholds
- **Returns**: `Ok(TemperatureThresholds {min_celsius, max_celsius})` or error if not initialized

#### `get_proof_requirements(env) → Result<ProofRequirements, Error>`
- **Description**: Return the current proof requirements
- **Returns**: `Ok(ProofRequirements {...})` with boolean flags for photo, signature, temperature log

### Compliance Recording

#### `record_compliance_attestation(env, admin, delivery_id, compliance_hash, is_compliant) → Result<(), Error>`
- **Description**: Record a compliance attestation for a delivery
- **Auth required**: Yes, signer must be `admin`
- **Parameters**:
  - `admin: Address` — The admin calling this function
  - `delivery_id: u64` — Delivery ID (from requests contract)
  - `compliance_hash: Bytes` — Hash of compliance evaluation (computed off-chain by backend)
  - `is_compliant: bool` — Whether delivery passed compliance checks
- **Returns**: `Ok(())` on success
- **Errors**:
  - `NotInitialized` — If contract not initialized
- **Side effects**:
  - Stores (compliance_hash, is_compliant) tuple indexed by delivery_id
  - Publishes `("comply", "v1")` event with (delivery_id, compliance_hash, is_compliant)
- **Access Control**: Admin only

### Compliance Queries

#### `get_compliance_attestation(env, delivery_id) → Result<(Bytes, bool), Error>`
- **Description**: Retrieve the compliance attestation for a delivery
- **Auth required**: No
- **Parameters**:
  - `delivery_id: u64` — Delivery ID to look up
- **Returns**: `Ok((compliance_hash, is_compliant))` if attestation exists; `Err(DeliveryNotFound)` otherwise
- **Side effects**: None

---

## Data Structures

### TemperatureThresholds
```rust
pub struct TemperatureThresholds {
    pub min_celsius: i32,               // Minimum acceptable temperature
    pub max_celsius: i32,               // Maximum acceptable temperature
}
```

**Default:** min=2°C, max=6°C (standard blood storage)

### ProofRequirements
```rust
pub struct ProofRequirements {
    pub requires_photo_proof: bool,              // Photo documentation required
    pub requires_recipient_signature: bool,      // Recipient signature required
    pub requires_temperature_log: bool,          // Temperature log required
}
```

**Default:** All `true` (all proofs required)

### Compliance Attestation (Storage)
Stored as: `(Bytes, bool)` tuple
- **Bytes** — compliance_hash (off-chain computed)
- **bool** — is_compliant (true if passed all checks)

### DataKey (Storage Keys)
- `Admin` → Address
- `RequestContract` → Address (request contract ID)
- `DeliveryCounter` → u64
- `TemperatureThresholds` → TemperatureThresholds
- `ProofRequirements` → ProofRequirements
- `ComplianceAttestation(delivery_id: u64)` → (Bytes, bool) tuple

---

## Error Codes

| Code | Name | Cause |
|------|------|-------|
| 700 | `AlreadyInitialized` | Contract already initialized |
| 701 | `NotInitialized` | Contract not yet initialized |
| 702 | `DeliveryNotFound` | No attestation exists for delivery_id |

---

## Event Types

- `("init", "v1")` → `(admin_address: Address, request_contract: Address)`
- `("comply", "v1")` → `(delivery_id: u64, compliance_hash: Bytes, is_compliant: bool)`

---

## Usage Patterns

### Initialize Delivery

```
initialize(admin, request_contract)
→ Delivery counter = 0
→ Temperature thresholds = 2–6°C
→ Proof requirements = all enabled
```

### Record Compliance After Delivery

```
record_compliance_attestation(admin, delivery_id=1001, hash=0xabc123..., is_compliant=true)
→ Attestation stored
→ Event published
```

### Query Compliance

```
get_compliance_attestation(delivery_id=1001)
→ (0xabc123..., true)  — Hash and pass/fail status
```

---

## Key Design Notes

- **Off-chain attestation**: The backend computes compliance_hash by evaluating telemetry (photos, temperature logs, signatures) and submits it on-chain. The contract stores it but doesn't validate the hash itself.
- **No delivery counter increment**: Despite its name, `get_delivery_counter()` is not incremented by this contract. It's initialized to 0 and can be used as a placeholder for future tracking.
- **Admin-only attestation**: Only admin can record compliance attestations, preventing non-authorized observers from polluting the record.
- **No second attestation check**: The contract allows overwriting an existing attestation for the same delivery_id without error (update is silent).
- **Proof requirements static**: ProofRequirements are initialized and stored but not actively checked by this contract (future integration with digital signatures/photo storage).
- **Linked to requests**: The request_contract address is stored during initialization and used by external systems to correlate deliveries with requests.
