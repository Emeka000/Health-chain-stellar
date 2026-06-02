# Event Schema for Off-Chain Indexers

Soroban events are emitted as `(topics, data)` pairs. Topics are used for filtering; data carries the payload. All events below use `symbol_short!` for topic components, which are 1–8 character ASCII strings encoded as `Symbol`.

To subscribe to events, use the Stellar Horizon API or a Soroban RPC node:

```
GET /v1/events?contract_id=<CONTRACT_ID>&topic[0]=<TOPIC>
```

---

## Coordinator events

Contract: `coordinator_contract`

### coord:init:v1

Emitted when the coordinator is initialized.

| Field | Type | Description |
|---|---|---|
| topics | `(Symbol("coord"), Symbol("init"), Symbol("v1"))` | |
| data | `Address` | Admin address |

### coord:alloc:v1

Emitted when `allocate_units` succeeds.

| Field | Type | Description |
|---|---|---|
| topics | `(Symbol("coord"), Symbol("alloc"), Symbol("v1"))` | |
| data | `(u64, u32)` | `(request_id, unit_count)` |

### coord:dlvrd:v1

Emitted when `confirm_delivery` succeeds.

| Field | Type | Description |
|---|---|---|
| topics | `(Symbol("coord"), Symbol("dlvrd"), Symbol("v1"))` | |
| data | `(u64, String)` | `(request_id, delivery_location)` |

### coord:settld:v1

Emitted when `settle_payment` succeeds.

| Field | Type | Description |
|---|---|---|
| topics | `(Symbol("coord"), Symbol("settld"), Symbol("v1"))` | |
| data | `(u64, u64)` | `(request_id, payment_id)` |

### coord:rollbk:v1

Emitted when `rollback` succeeds.

| Field | Type | Description |
|---|---|---|
| topics | `(Symbol("coord"), Symbol("rollbk"), Symbol("v1"))` | |
| data | `u64` | `request_id` |

### coord:emrghlt:v1

Emitted when `emergency_halt` is activated.

| Field | Type | Description |
|---|---|---|
| topics | `(Symbol("coord"), Symbol("emrghlt"), Symbol("v1"))` | |
| data | `Address` | Admin address |

### coord:tmp_brch

Emitted when a temperature breach is flagged.

| Field | Type | Description |
|---|---|---|
| topics | `(Symbol("coord"), Symbol("tmp_brch"))` | |
| data | `(u64, u64, u64)` | `(payment_id, unit_id, ledger_timestamp)` |

---

## Inventory events

Contract: `inventory_contract`

### blood_registered:v1

Emitted when a blood unit is registered.

| Field | Type | Description |
|---|---|---|
| topics | `(Symbol("blood_registered"), Symbol("v1"))` | |
| data | `BloodRegisteredEvent` | See struct below |

```
BloodRegisteredEvent {
    blood_unit_id: u64,
    bank_id: Address,
    blood_type: BloodType,
    quantity_ml: u32,
    expiration_timestamp: u64,
    registered_at: u64,
}
```

### status_changed:v1

Legacy status change event (kept for backwards compatibility).

| Field | Type | Description |
|---|---|---|
| topics | `(Symbol("status_changed"), Symbol("v1"))` | |
| data | `StatusChangeEvent` | See struct below |

```
StatusChangeEvent {
    blood_unit_id: u64,
    from_status: BloodStatus,
    to_status: BloodStatus,
    authorized_by: Address,
    changed_at: u64,
    reason: Option<String>,
}
```

### bld_unit_chg:v1

Canonical audit event for every status transition. Prefer this over `status_changed` for new indexers.

| Field | Type | Description |
|---|---|---|
| topics | `(Symbol("bld_unit_chg"), Symbol("v1"))` | |
| data | `AuditEvent` | See struct below |

```
AuditEvent {
    unit_id: u64,
    previous_status: BloodStatus,
    new_status: BloodStatus,
    actor: Address,
    timestamp: u64,
}
```

### blood_reserved:v1

Emitted when a reservation is created.

| Field | Type | Description |
|---|---|---|
| topics | `(Symbol("blood_reserved"), Symbol("v1"))` | |
| data | `(u64, Address, u32)` | `(reservation_id, requester, unit_count)` |

### reservation_released:v1

Emitted when a reservation is released.

| Field | Type | Description |
|---|---|---|
| topics | `(Symbol("reservation_released"), Symbol("v1"))` | |
| data | `u64` | `reservation_id` |

### invalid_transition:v1

Emitted when an invalid status transition is attempted (for debugging).

| Field | Type | Description |
|---|---|---|
| topics | `(Symbol("invalid_transition"), Symbol("v1"))` | |
| data | `(u64, u32, u32)` | `(blood_unit_id, from_status as u32, to_status as u32)` |

---

## Payments events

Contract: `payments_contract`

### payment:created:v1

Emitted when a non-escrow payment is created.

| Field | Type | Description |
|---|---|---|
| topics | `(Symbol("payment"), Symbol("created"), Symbol("v1"))` | |
| data | `u64` | `payment_id` |

### payment:escrowed:v1

Emitted when an escrow payment is created and funds are locked.

| Field | Type | Description |
|---|---|---|
| topics | `(Symbol("payment"), Symbol("escrowed"), Symbol("v1"))` | |
| data | `u64` | `payment_id` |

### payment:status

Emitted on every status transition via `update_status`.

| Field | Type | Description |
|---|---|---|
| topics | `(Symbol("payment"), Symbol("status"))` | |
| data | `(u64, PaymentStatus, PaymentStatus)` | `(payment_id, old_status, new_status)` |

### payment:released

Emitted when escrow funds are released to the payee.

| Field | Type | Description |
|---|---|---|
| topics | `(Symbol("payment"), Symbol("released"))` | |
| data | `(u64, Address, i128)` | `(payment_id, payee, amount)` |

### payment:refunded

Emitted when escrow funds are refunded to the payer.

| Field | Type | Description |
|---|---|---|
| topics | `(Symbol("payment"), Symbol("refunded"))` | |
| data | `(u64, Address, i128)` | `(payment_id, payer, amount)` |

### payment:disputed:v1

Emitted when a dispute is recorded.

| Field | Type | Description |
|---|---|---|
| topics | `(Symbol("payment"), Symbol("disputed"), Symbol("v1"))` | |
| data | `(u64, u32, String)` | `(payment_id, reason_code, case_id)` |

Reason codes: 1=FailedDelivery, 2=TemperatureExcursion, 3=PaymentContested, 4=WrongItem, 5=DamagedGoods, 6=LateDelivery, 7=Other

### payment:resolved:v1

Emitted when a dispute is resolved.

| Field | Type | Description |
|---|---|---|
| topics | `(Symbol("payment"), Symbol("resolved"), Symbol("v1"))` | |
| data | `u64` | `payment_id` |

---

## Requests events

Contract: `requests_contract`

### request_created

Emitted when a blood request is created.

| Field | Type | Description |
|---|---|---|
| topics | `(Symbol("req_created"), Symbol("v1"))` | |
| data | `RequestCreatedEvent` | See struct below |

```
RequestCreatedEvent {
    request_id: u64,
    hospital: Address,
    blood_type: BloodType,
    quantity_ml: u32,
    urgency: u32,   // 1=Scheduled, 2=Routine, 3=Urgent, 4=Critical
    timestamp: u64,
}
```

### request_status_updated

Emitted on every status transition.

| Field | Type | Description |
|---|---|---|
| topics | `(Symbol("req_updated"), Symbol("v1"))` | |
| data | `(u64, Address, RequestStatus, RequestStatus, u64)` | `(request_id, actor, old_status, new_status, timestamp)` |

### request_cancelled

Emitted when a request is cancelled.

| Field | Type | Description |
|---|---|---|
| topics | `(Symbol("req_cancel"), Symbol("v1"))` | |
| data | `(u64, Address, u64)` | `(request_id, actor, timestamp)` |

---

## Temperature events

Contract: `temperature_contract`

### tmp_excur

Emitted when an excursion is reported to the coordinator.

| Field | Type | Description |
|---|---|---|
| topics | `(Symbol("tmp_excur"),)` | |
| data | `(u64, u64, u32)` | `(unit_id, payment_id, violation_count)` |

---

## Reputation events

Contract: `reputation_contract`

### rep:updated:v1

Emitted when a reputation score is recalculated.

| Field | Type | Description |
|---|---|---|
| topics | `(Symbol("rep"), Symbol("updated"), Symbol("v1"))` | |
| data | `(u64, i64)` | `(entity_id, final_score_x100)` |

Score is ×100 (e.g. `7823` = 78.23 / 100).

### Reputation: update_from_event

The reputation contract exposes an indexer-friendly entrypoint `update_from_event`
which backend indexers can call after observing payments or dispute events. This
avoids tight cross-contract coupling and keeps per-transaction compute low.

Call signature (indexer -> contract): `(event_kind: u32, entity_id: u64, completed: bool, response_secs: u64, timestamp: u64)`

`event_kind` values:
- `0` = `payment_complete` — record a successful completion for `entity_id`.
- `1` = `dispute_resolved_in_favor` — treat as a positive outcome (counts as completion).
- `2` = `dispute_resolved_against` — treat as a negative outcome; increments fraud flags.

Suggested indexer behavior:
- Subscribe to `payment:released` / `payment:refunded` / `payment:resolved` events.
- Map the on-chain addresses/payment IDs to the internal `entity_id` (u64) used by the reputation contract.
- Call `update_from_event` with the appropriate `event_kind` and `timestamp` derived from the event payload.


---

## Analytics events

Contract: `analytics_contract`

### anlytcs:init:v1

Emitted when the analytics contract is initialized.

| Field | Type | Description |
|---|---|---|
| topics | `(Symbol("anlytcs"), Symbol("init"), Symbol("v1"))` | |
| data | `Address` | Admin address |

---

## Indexer recommendations

- Subscribe to `bld_unit_chg:v1` (not `status_changed:v1`) for blood unit state — it is the canonical audit event.
- Subscribe to `payment:status` for all payment transitions; it fires on every `update_status` call including coordinator-driven ones.
- Subscribe to `coord:settld:v1` to trigger downstream settlement logic (e.g. updating the backend database).
- Subscribe to `coord:tmp_brch` to alert operations teams of cold-chain incidents.
- The `BloodStatus` and `PaymentStatus` enums are encoded as their XDR discriminant integers in events. Map them as follows:

**BloodStatus integers** (from `BloodStatus as u32` in `invalid_transition` events):
`0=Available, 1=Reserved, 2=InTransit, 3=Delivered, 4=Expired, 5=Compromised, 6=Disposed`

**PaymentStatus integers** (from `status_index_key` in payments):
`0=Pending, 1=Locked, 2=Released, 3=Refunded, 4=Disputed, 5=Cancelled`
