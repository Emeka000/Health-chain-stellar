# TODO

## Health Record Implementation

The health-record backend module is tracked in `.kiro/specs/health-record-implementation/`.
None of the tasks below are started yet.

### Contract layer (`contracts/src/`)

The existing contract (`contracts/src/lib.rs`) implements a **blood unit registry** —
not a patient record registry. There is no `patient-registry` contract.
`update_record` and `get_record_history` do **not** exist in the codebase.

- [ ] Create `patient-registry` Soroban contract (or extend `contracts/src/lib.rs`)
- [ ] Implement `store_record(patient_id, encrypted_ref, metadata)` entry point
- [ ] Implement `update_record(patient_id, new_encrypted_ref, metadata)` with version bump
- [ ] Implement `get_record_history(patient_id)` returning ordered version list
- [ ] Add `RecordVersion` struct (version number, encrypted_ref, timestamp, actor)
- [ ] Emit `record_stored` / `record_updated` events
- [ ] Write Soroban unit tests for versioning invariants

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
