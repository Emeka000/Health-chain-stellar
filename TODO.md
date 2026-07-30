# TODO

## Health Record Implementation

The health-record backend module is tracked in `.kiro/specs/health-record-implementation/`.

### Contract layer (`contracts/src/`)

The legacy stubbed health-record methods — `store_record`, `get_record`, `verify_access` —
have been fully implemented with proper storage, access control, authentication, and events.
They live in `contracts/src/lib.rs` alongside the blood-unit registry.

- [x] Implement `store_record(patient_id, encrypted_ref)` entry point with patient auth and auto-grant
- [x] Implement `get_record(caller, patient_id)` with access control enforcement
- [x] Implement `verify_access(patient_id, provider_id)` returning authorization status
- [x] Add `grant_access` / `revoke_access` methods for patient-controlled sharing
- [x] Emit `HealthRecordStoredEvent` and `HealthRecordAccessEvent` events
- [x] Write Soroban unit tests for access denial and retrieval correctness
- [ ] Create `patient-registry` Soroban contract (or extend further)
- [ ] Implement `update_record(patient_id, new_encrypted_ref, metadata)` with version bump
- [ ] Implement `get_record_history(patient_id)` returning ordered version list
- [ ] Add `RecordVersion` struct (version number, encrypted_ref, timestamp, actor)

### Backend layer (`backend/src/`)

- [ ] Implement `CryptoReferenceService` (hash generation, encrypt/decrypt, key rotation)
- [ ] Implement `AccessControlService` (checkAccess, grantAccess, revokeAccess, audit log)
- [ ] Implement `HealthRecordService` (storeRecord, getRecord, verifyAccess, updatePermissions)
- [ ] Create `HealthRecordController` with REST endpoints and DTOs
- [ ] Add `HealthRecordModule` and wire into `AppModule`
- [ ] Create database entities: `HealthRecordReferenceEntity`, `HealthRecordAclEntity`, `HealthRecordAccessLogEntity`
- [ ] Write database migration for health record tables
- [ ] Write property-based and integration tests (see spec tasks 2.2, 3.2, 5.2, 5.3, 6.2, 6.3)

### Documentation

- [ ] OpenAPI/Swagger docs for all health record endpoints
- [ ] Migration guide for clients once stubbed methods are removed
