# Delivery Contract

Soroban smart contract for verifying and tracking medical supply deliveries on Stellar.

## Overview

Handles the full delivery lifecycle: creation, in-transit tracking, and confirmed delivery with proof requirements.

## Initialize

```rust
initialize(
    admin: Address,
    request_contract: Address,
    min_temp_x100: i32,      // e.g. 200  = 2°C
    max_temp_x100: i32,      // e.g. 600  = 6°C
    photo_required: bool,
    signature_required: bool,
)
```

- Sets contract admin
- Links the requests contract
- Initializes delivery counter
- Sets temperature thresholds (celsius × 100)
- Configures proof requirements (photo, signature)

## Storage

| Key | Type | Description |
|-----|------|-------------|
| `Admin` | `Address` | Contract administrator |
| `RequestContract` | `Address` | Linked requests contract |
| `DeliveryCounter` | `u64` | Auto-incrementing delivery ID |
| `TempThresholds` | `TemperatureThresholds` | Min/max transport temperature |
| `PhotoProofRequired` | `bool` | Photo proof flag |
| `SignatureRequired` | `bool` | Signature proof flag |
| `Delivery(u64)` | `DeliveryRecord` | Delivery record by ID |

## Errors

| Code | Name | Description |
|------|------|-------------|
| 1 | `AlreadyInitialized` | Contract initialized more than once |
| 2 | `NotInitialized` | Contract not yet initialized |
| 3 | `Unauthorized` | Caller lacks required privileges |
| 4 | `DeliveryNotFound` | No delivery with given ID |
| 5 | `InvalidStatusTransition` | Invalid status change or wrong courier |
| 6 | `InvalidTemperatureThreshold` | min >= max |
| 7 | `ProofAlreadySubmitted` | Proof submitted more than once |
| 8 | `MissingProof` | Required proof not provided |

## Running Tests

```bash
cd lifebank-soroban
cargo test -p delivery
```
