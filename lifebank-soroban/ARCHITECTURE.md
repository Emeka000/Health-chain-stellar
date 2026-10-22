# Architecture

## Contract dependency graph

```
                        ┌─────────────────────────────────────────────────────┐
                        │                   COORDINATOR                        │
                        │  Enforces workflow state machine.                    │
                        │  Holds addresses of requests, inventory, payments.   │
                        └──────────┬──────────────┬──────────────┬────────────┘
                                   │              │              │
                    calls          │              │              │          calls
              get_request()        │              │   update_status()      get_payment()
              (read-only)          │              │   mark_delivered()     update_status()
                                   ▼              ▼              ▼         record_dispute()
                          ┌──────────────┐ ┌──────────────┐ ┌──────────────┐
                          │   REQUESTS   │ │  INVENTORY   │ │   PAYMENTS   │
                          │              │ │              │ │              │
                          │ Hospital     │ │ Blood unit   │ │ Escrow,      │
                          │ blood        │ │ lifecycle,   │ │ pledges,     │
                          │ requests     │ │ reservations │ │ disputes     │
                          └──────────────┘ └──────┬───────┘ └──────────────┘
                                                  │
                                          reads unit index
                                                  │
                                                  ▼
                          ┌──────────────┐ ┌──────────────┐
                          │   MATCHING   │ │ TEMPERATURE  │──────────────────┐
                          │              │ │              │                  │
                          │ ABO/Rh       │ │ IoT readings,│  flag_temperature│
                          │ compatibility│ │ excursion    │  _breach()       │
                          │ + FIFO sort  │ │ detection    │──────────────────┘
                          └──────────────┘ └──────────────┘     calls coordinator
                                                                 when 3 consecutive
                                                                 violations detected

          ┌──────────────┐ ┌──────────────┐ ┌──────────────┐
          │   IDENTITY   │ │  REPUTATION  │ │  ANALYTICS   │
          │              │ │              │ │              │
          │ Org registry,│ │ Weighted     │ │ Periodic     │
          │ roles, badges│ │ score with   │ │ metrics      │
          │ delivery     │ │ decay +      │ │ snapshots    │
          │ verification │ │ penalties    │ │              │
          └──────────────┘ └──────────────┘ └──────────────┘

          ┌──────────────┐
          │   DELIVERY   │
          │              │
          │ Compliance   │
          │ attestation  │
          │ hashes       │
          └──────────────┘
```

## Core workflow: blood delivery lifecycle

The coordinator enforces a strict three-step state machine. Each step is a separate transaction; the coordinator rejects any step that arrives out of order.

```
Hospital creates request          Blood bank creates escrow payment
        │                                       │
        ▼                                       ▼
  RequestStatus::Pending              PaymentStatus::Locked
        │                                       │
        └──────────────────┬────────────────────┘
                           │
                    Step 1: allocate_units()
                    ─────────────────────────
                    • Verifies request is Pending
                    • Marks each blood unit Reserved
                    • Creates WorkflowRecord (Allocated)
                           │
                           ▼
                  WorkflowStatus::Allocated
                  BloodStatus::Reserved (all units)
                           │
                    Step 2: confirm_delivery()
                    ──────────────────────────
                    • Transitions units: Reserved → InTransit → Delivered
                    • Records delivery location
                    • Sets delivery_confirmed = true
                           │
                           ▼
                  WorkflowStatus::Delivered
                  BloodStatus::Delivered (all units)
                           │
                    Step 3: settle_payment()
                    ──────────────────────────
                    • Requires delivery_confirmed == true
                    • Transitions payment: Locked → Released
                           │
                           ▼
                  WorkflowStatus::Settled
                  PaymentStatus::Released
```

### Rollback path

Admin can call `rollback()` on any workflow that has not yet reached `Settled`:

```
rollback()
  • Returns all units to Available
  • If payment is Locked → transitions to Refunded
  • WorkflowStatus → RolledBack
```

### Temperature excursion path

```
IoT oracle / admin calls temperature.report_excursion_to_coordinator()
  │
  ▼
temperature contract calls coordinator.flag_temperature_breach()
  │
  ▼
coordinator calls payments.record_dispute(TemperatureExcursion)
  │
  ▼
PaymentStatus → Disputed
```

## Storage tiers

Soroban has three storage tiers. Each contract uses them as follows:

| Tier | TTL | Used for |
|---|---|---|
| **Instance** | Tied to contract instance | Admin address, contract addresses, counters, config |
| **Persistent** | Explicit TTL bump required | Blood units, payments, requests, history, indexes |
| **Temporary** | Auto-expires | Reservations (inventory contract) |

Persistent entries in the payments contract are bumped to ~60 days whenever their remaining TTL falls below ~30 days (`PERSISTENT_BUMP_THRESHOLD = 518_400 ledgers`, `PERSISTENT_BUMP_TO = 1_036_800 ledgers`).

## Circuit breakers

Every contract exposes `pause()` / `unpause()` (admin only). The coordinator additionally has `emergency_halt()` / `clear_emergency_halt()`:

- `pause()` — blocks new allocations and state mutations
- `emergency_halt()` — blocks `confirm_delivery` and `settle_payment` on all in-flight workflows without blocking new allocations; designed for active incident containment

## Cross-contract call pattern

The coordinator defines minimal proxy types (`BloodRequest {id, status}`, `BloodUnit {id, status}`, `Payment {id, request_id, status}`) that mirror only the fields it needs. Domain contracts must keep these fields in sync. This avoids importing compiled WASMs and keeps the coordinator's footprint small.

All cross-contract calls use `try_*` variants so failures return typed errors rather than panicking.
