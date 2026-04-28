# Storage Lifecycle & Archival Strategy

## Storage Tier Classification

Every persistent key in the contract is classified below. "Rent-sensitive" means
the key grows unboundedly and must be actively monitored.

| Key | Tier | Growth | Rent Risk | Notes |
|-----|------|--------|-----------|-------|
| `ADMIN` | Instance | Fixed | None | Lives with contract instance |
| `NEXT_ID`, `NEXT_REQUEST_ID` | Persistent | Fixed (u64) | Low | Monotonic counters |
| `NEXT_PAYMENT_ID`, `NEXT_DISPUTE_ID` | Instance | Fixed | None | Low-frequency config |
| `DISPUTE_TIMEOUT` | Instance | Fixed | None | Config value |
| `BLOOD_BANKS` | Persistent | O(banks) | Medium | Registry map |
| `HOSPITALS` | Persistent | O(hospitals) | Medium | Registry map |
| `BLOOD_UNITS` | Persistent | O(units) | **High** | Core inventory map |
| `REQUESTS` | Persistent | O(requests) | **High** | Request map |
| `REQUEST_KEYS` | Persistent | O(requests) | **High** | Dedup index |
| `PAYMENTS` | Persistent | O(payments) | **High** | Payment map |
| `DISPUTES` | Persistent | O(disputes) | **High** | Dispute map |
| `DISPUTE_METADATA` | Persistent | O(disputes) | Medium | Deadline index |
| `CUSTODY_EVENTS` | Persistent | O(transfers) | **High** | **Archival target** |
| `(HISTORY, unit_id)` | Persistent | O(transitions/unit) | **High** | **Archival target** |
| `UnitTrailPage(id, page)` | Persistent | O(transfers/unit) | Medium | Already paginated |
| `UnitTrailMeta(id)` | Persistent | Fixed/unit | Low | Tiny struct |
| `PAYMENT_STATS` | Persistent | Fixed | Low | Aggregate counters |
| `PENDING_APPROVALS` | Persistent | O(active votes) | Low | Cleaned on execution |
| `OrgKey::Org(addr)` | Persistent | O(orgs) | Medium | Permanent registry |
| `DataKey::DonorUnits` | Persistent | O(donations/donor) | Medium | Donor index |
| `ArchiveKey::HistorySummary(id)` | Persistent | Fixed/unit | Low | Post-archival summary |
| `ArchiveKey::CustodySummary(id)` | Persistent | Fixed/unit | Low | Post-archival summary |

## Retention / Archival Strategy

### Permanently on-chain

- **Instance storage keys** (`ADMIN`, counters, config): no per-entry rent; live
  with the contract instance.
- **`OrgKey::Org`** records: verified status must remain queryable at all times.
- **`UnitTrailMeta`**: tiny two-field struct; kept permanently.
- **`PAYMENT_STATS`**: aggregate counters; kept permanently.
- **`UnitTrailPage`** entries: already paginated (20 event IDs per page); the
  event_id strings are compact and serve as the permanent off-chain lookup index.

### Archived after finalization (30-day cooling-off window)

| Data | Trigger | On-chain after archival | Off-chain source |
|------|---------|------------------------|-----------------|
| `(HISTORY, unit_id)` Vec | Unit reaches Delivered/Discarded/Expired AND 30 days elapsed | `ArchivedHistorySummary` (first/last timestamp + count) | `(status, change)` events in Stellar event log |
| `CUSTODY_EVENTS` entries for unit | Same as above | `ArchivedCustodySummary` (confirmed/cancelled counts) | `(custody, confirm/cancel)` events + `UnitTrailPage` |

The 30-day window ensures off-chain indexers (see
`backend/src/contract-event-indexer/`) have ingested all events before on-chain
data is pruned.

### Temporary storage (auto-expiring)

- `Reservation` records in the `lifebank-soroban/contracts/inventory` contract
  already use `env.storage().temporary()` — no action needed.

## Rent Bump Policy

### Automatic bumps (on every write)

`storage_lifecycle::bump_rent_for_unit(env, unit_id)` is called after any write
that touches a blood unit or its history. It extends the TTL of:
- `BLOOD_UNITS` map
- `(HISTORY, unit_id)` key
- `DataKey::UnitTrailMeta(unit_id)` key

### Periodic admin bump

`bump_registry_ttl()` (admin-only contract function) extends the TTL of all
shared registry maps to `EXTENDED_TTL_LEDGERS` (≈ 90 days). This should be
called at least monthly via an off-chain cron job or keeper bot.

TTL constants (in `storage_lifecycle.rs`):

| Constant | Ledgers | Approximate duration |
|----------|---------|---------------------|
| `MIN_TTL_LEDGERS` | 535,680 | 31 days (at 5s/ledger) |
| `EXTENDED_TTL_LEDGERS` | 1,555,200 | 90 days |

## Contract API

| Function | Auth | Description |
|----------|------|-------------|
| `bump_registry_ttl()` | Admin | Extend TTL of all shared registry maps |
| `archive_history(unit_id)` | Permissionless | Compact status history for terminal unit |
| `archive_custody(unit_id)` | Permissionless | Prune custody events for terminal unit |
| `get_history_summary(unit_id)` | Read | Get archived history summary (or None) |
| `get_custody_summary(unit_id)` | Read | Get archived custody summary (or None) |

`archive_history` and `archive_custody` are permissionless so that any keeper
bot or off-chain service can trigger compaction without requiring admin keys.

## Off-chain Consumer Consistency

After archival, off-chain consumers (indexers, APIs, dashboards) must:

1. **Check for archival before reading history**: call `get_history_summary`
   first; if it returns a value, the full history is in the event log, not
   in contract storage.

2. **Reconstruct full history from events**: the `(status, change)` event
   emitted by `record_status_change` contains the complete `StatusChangeEvent`
   struct. Indexers must store these events durably.

3. **Reconstruct custody trail from events + trail pages**: `UnitTrailPage`
   entries (event_id strings) are preserved permanently. The full `CustodyEvent`
   struct is available from the `(custody, confirm)` / `(custody, cancel)` events
   in the Stellar event log.

4. **Archival events as signals**: the `(archive, hist)` and `(archive, cust)`
   events emitted during compaction serve as explicit signals to indexers that
   on-chain data has been pruned. Indexers should mark the unit as "history
   archived" in their local database upon receiving these events.

5. **`ArchivedHistorySummary` for display**: use `first_event_at`,
   `last_event_at`, and `total_events` to render a compact timeline without
   loading the full event log.

## State Growth Budget

| Collection | Expected max size | Mitigation |
|------------|------------------|------------|
| `BLOOD_UNITS` map | ~10,000 units/year | Archive terminal units after 30 days |
| `REQUESTS` map | ~5,000/year | No archival (requests are small structs) |
| `CUSTODY_EVENTS` map | ~50,000/year | Archive per-unit after terminal + 30 days |
| `(HISTORY, unit_id)` | ~10 events/unit | Archive after terminal + 30 days |
| `UnitTrailPage` | 20 IDs/page | Already bounded; pages kept permanently |
| `PAYMENTS` map | ~5,000/year | No archival (payments are audit records) |
| `DISPUTES` map | ~500/year | No archival (disputes are audit records) |
