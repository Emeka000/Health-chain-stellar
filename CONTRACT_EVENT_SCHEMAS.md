# Contract Event Schemas

All contract events emitted by this repository are explicitly schema-versioned.

Rule: the final Soroban event topic is the schema marker. Current events use `v1`.
Events without a schema marker are legacy `v0`. Indexers must reject unknown future
markers instead of decoding them as `v1`.

Changing a payload field name, field type, field order, tuple arity, or topic meaning
requires a new final topic marker, for example `v2`.

## `contracts` crate

| Event | Topics | Payload schema |
| --- | --- | --- |
| Blood unit registered | `(blood, register, v1)` | `BloodRegisteredEvent { unit_id, bank_id, blood_type, component, quantity_ml, expiration_timestamp, donor_id, registration_timestamp }` |
| Unit status changed | `(status, change, v1)` | `StatusChangeEvent { blood_unit_id, old_status, new_status, actor, timestamp }` |
| Blood allocated | `(blood, allocate, v1)` | `(unit_id, hospital, timestamp)` |
| Allocation cancelled | `(blood, cancel, v1)` | `unit_id` |
| Custody transfer initiated | `(custody, initiate, v1)` | `CustodyEvent { event_id, unit_id, from_custodian, to_custodian, initiated_at, ledger_sequence, status }` |
| Custody transfer confirmed | `(custody, confirm, v1)` | `CustodyEvent { event_id, unit_id, from_custodian, to_custodian, initiated_at, ledger_sequence, status }` |
| Custody transfer cancelled | `(blood, tr_cancel, v1)` | `((unit_id, timestamp), (custody, cancel), CustodyEvent)` |
| Blood withdrawn | `(blood, withdraw, v1)` | `(unit_id, WithdrawalReason, timestamp)` |
| Quarantine placed | `(quar, place, v1)` | `QuarantineLifecycleEvent { blood_unit_id, old_status, new_status, actor, reason, disposition_code, timestamp }` |
| Quarantine finalized | `(quar, final, v1)` | `QuarantineLifecycleEvent { blood_unit_id, old_status, new_status, actor, reason, disposition_code, timestamp }` |
| Request created | `(blood, request, v1)` | `RequestCreatedEvent { request_id, hospital_id, blood_type, quantity_ml, urgency, required_by, delivery_address, created_at }` |
| Request status changed | `(request, status, v1)` | `RequestStatusChangeEvent { request_id, old_status, new_status, actor, timestamp, reason }` |
| Request approved | `(request, approve, v1)` | `RequestApprovedEvent { request_id, blood_bank, assigned_unit_ids, total_quantity_ml, fulfillment_percentage, status }` |
| Request fulfilled | `(request, fulfill, v1)` | `RequestFulfilledEvent { request_id, blood_bank, delivered_unit_ids, delivered_quantity_ml, fulfilled_at }` |
| Dispute raised | `(dispute, raised, v1)` | `DisputeRaisedEvent { dispute_id, payment_id, raised_by, reason, evidence_digest, timestamp }` |
| Dispute resolved | `(dispute, resolved, v1)` | `DisputeResolvedEvent { dispute_id, payment_id, status, resolved_at }` |
| Organization registered | `(org, reg, v1)` | `org_id` |
| Organization verified | `(org, verified, v1)` | `(org_id, admin, timestamp)` |
| Organization unverified | `(org, unverif, v1)` | `(org_id, reason)` |

## `lifebank-soroban` workspace

| Contract | Event | Topics | Payload schema |
| --- | --- | --- | --- |
| analytics | Initialized | `(anlytcs, init, v1)` | `admin` |
| coordinator | Initialized | `(coord, init, v1)` | `admin` |
| coordinator | Units allocated | `(coord, alloc, v1)` | `(request_id, unit_count)` |
| coordinator | Delivery confirmed | `(coord, dlvrd, v1)` | `request_id` |
| coordinator | Payment settled | `(coord, settld, v1)` | `(request_id, payment_id)` |
| coordinator | Rollback completed | `(coord, rollbk, v1)` | `request_id` |
| delivery | Initialized | `(init, v1)` | `(admin, request_contract)` |
| delivery | Compliance attested | `(comply, v1)` | `(delivery_id, compliance_hash, is_compliant)` |
| identity | Initialized | `(init, v1)` | `admin` |
| identity | Organization registered | `(org_reg, v1)` | `OrganizationRegistered { org_id, org_type, name }` |
| identity | Organization verified | `(org_verified, v1)` | `(org_id, admin, timestamp)` |
| identity | Organization unverified | `(org_unverified, v1)` | `(org_id, reason)` |
| identity | Organization rated | `(rated, v1)` | `(org_id, rater, rating)` |
| identity | Badge awarded | `(badge, v1)` | `(org_id, admin)` |
| identity | Delivery verified | `(delivery, v1)` | `(request_id, org_id, recipient, temperature_ok)` |
| inventory | Blood registered | `(blood_registered, v1)` | `BloodRegisteredEvent { blood_unit_id, bank_id, blood_type, quantity_ml, expiration_timestamp, registered_at }` |
| inventory | Status changed | `(status_changed, v1)` | `StatusChangeEvent { blood_unit_id, from_status, to_status, authorized_by, changed_at, reason }` |
| inventory | Invalid transition attempted | `(invalid_transition, v1)` | `(blood_unit_id, from_status_code, to_status_code)` |
| inventory | Blood reserved | `(blood_reserved, v1)` | `(reservation_id, requester, unit_count)` |
| inventory | Reservation released | `(reservation_released, v1)` | `reservation_id` |
| payments | Payment created | `(payment, created, v1)` | `payment_id` |
| payments | Escrow created | `(payment, escrowed, v1)` | `payment_id` |
| payments | Payment disputed | `(payment, disputed, v1)` | `(payment_id, case_id)` |
| payments | Dispute resolved | `(payment, resolved, v1)` | `payment_id` |
| payments | Donation pledge created | `(pledge, create, v1)` | `pledge_id` |
| reputation | Initialized | `(init, v1)` | `admin` |
| reputation | Reputation updated | `(rep, updated, v1)` | `(entity_id, final_score)` |
| requests | Initialized | `(initialized, v1)` | `(admin, inventory_contract)` |
| requests | Request created | `(request_created, blood_type, v1)` | `RequestCreatedEvent { request_id, hospital, blood_type, quantity_ml, urgency, timestamp }` |
