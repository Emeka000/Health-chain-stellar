//! # Storage Lifecycle Management
//!
//! ## Storage Tier Classification
//!
//! | Key                          | Tier       | Rationale                                              |
//! |------------------------------|------------|--------------------------------------------------------|
//! | `ADMIN`                      | Instance   | Single value, lives with contract, no rent risk        |
//! | `NEXT_ID`, `NEXT_REQUEST_ID` | Persistent | Monotonic counters; must survive ledger gaps           |
//! | `NEXT_PAYMENT_ID`            | Instance   | Low-frequency, small; kept in instance                 |
//! | `NEXT_DISPUTE_ID`            | Instance   | Low-frequency, small; kept in instance                 |
//! | `DISPUTE_TIMEOUT`            | Instance   | Config value; lives with contract                      |
//! | `MULTISIG_CONFIG`            | Persistent | May be updated; needs long-lived storage               |
//! | `BLOOD_BANKS`, `HOSPITALS`   | Persistent | Registry maps; grow with onboarding, rent-sensitive    |
//! | `BLOOD_UNITS`                | Persistent | Core inventory map; **highest rent risk**              |
//! | `REQUESTS`                   | Persistent | Request map; grows with usage, rent-sensitive          |
//! | `REQUEST_KEYS`               | Persistent | Dedup index; grows with requests                       |
//! | `PAYMENTS`                   | Persistent | Payment map; grows with usage                          |
//! | `DISPUTES`                   | Persistent | Dispute map; grows with usage                          |
//! | `DISPUTE_METADATA`           | Persistent | Deadline index; grows with disputes                    |
//! | `CUSTODY_EVENTS`             | Persistent | Event map; grows with transfers — **archival target**  |
//! | `(HISTORY, unit_id)`         | Persistent | Per-unit status history — **archival target**          |
//! | `UnitTrailPage(id, page)`    | Persistent | Paginated custody trail — **archival target**          |
//! | `UnitTrailMeta(id)`          | Persistent | Trail metadata; small, kept permanently                |
//! | `PAYMENT_STATS`              | Persistent | Aggregate counters; small, kept permanently            |
//! | `PENDING_APPROVALS`          | Persistent | Active multisig votes; cleaned up on execution         |
//! | `OrgKey::Org(addr)`          | Persistent | Organization records; permanent registry               |
//! | `DataKey::DonorUnits`        | Persistent | Donor index; grows with donations                      |
//!
//! ## Retention / Archival Strategy
//!
//! ### Permanently on-chain (never archived)
//! - `ADMIN`, counters, config keys (instance storage — no per-entry rent)
//! - `BloodUnit` records: the canonical inventory state is always needed for
//!   allocation, expiry checks, and audit. Terminal units (Delivered, Discarded,
//!   Expired) are compacted to a `ArchivedUnitSummary` after `ARCHIVE_AFTER_DAYS`.
//! - `OrgKey::Org` records: verified status must remain queryable.
//! - `UnitTrailMeta`: tiny metadata struct, kept permanently.
//! - `PAYMENT_STATS`: aggregate counters, kept permanently.
//!
//! ### Archived after finalization
//! - `(HISTORY, unit_id)` Vec: replaced by `ArchivedHistorySummary` once the
//!   unit reaches a terminal status. The summary stores the first/last event and
//!   a count; full history is reconstructable from emitted events indexed off-chain.
//! - `CUSTODY_EVENTS` entries: individual `CustodyEvent` records for
//!   Confirmed/Cancelled transfers are removed from the map after the unit is
//!   terminal; the event_id remains in the `UnitTrailPage` for off-chain lookup.
//! - `UnitTrailPage(id, page)` pages: kept for active units; for terminal units
//!   all pages are collapsed into a single summary page (page 0) containing only
//!   the event_id list, which is already compact.
//!
//! ### Temporary storage (auto-expiring)
//! - `Reservation` records in the lifebank-soroban inventory contract already
//!   use `env.storage().temporary()` — no action needed here.
//!
//! ## Rent Bump Policy
//! Persistent entries must have their TTL extended before they expire.
//! Call `bump_rent_for_unit` after any write to a blood unit and its history.
//! The `bump_all_registries` admin function extends the TTL of the shared
//! registry maps (`BLOOD_BANKS`, `HOSPITALS`, `BLOOD_UNITS`, `REQUESTS`, etc.)
//! which are the highest-risk keys for rent expiry.
//!
//! ## Off-chain Consistency After Archival
//! All state transitions emit Soroban events. Indexers (see
//! `backend/src/contract-event-indexer/`) must:
//! 1. Index `(status, change)` events to reconstruct full history.
//! 2. Index `(custody, confirm)` / `(custody, cancel)` events to reconstruct
//!    the custody trail.
//! 3. Treat an `ArchivedHistorySummary` on-chain as a signal that the full
//!    history lives in the event log, not in contract storage.
//! 4. Use `get_archived_history_summary` to obtain the first/last timestamps
//!    and total count for display without loading the full history.

#![allow(dead_code)]

use soroban_sdk::{contracttype, symbol_short, Env, Vec};

use crate::{
    BloodStatus, BloodUnit, CustodyEvent, CustodyStatus, DataKey, Error, StatusChangeEvent,
    BLOOD_BANKS, BLOOD_UNITS, CUSTODY_EVENTS, DISPUTES, DISPUTE_METADATA, HISTORY, HOSPITALS,
    PAYMENTS, PAYMENT_STATS, PENDING_APPROVALS, REQUESTS, REQUEST_KEYS,
};

// ── Constants ──────────────────────────────────────────────────────────────────

/// Minimum TTL (in ledgers) to maintain for rent-sensitive persistent keys.
/// At ~5s/ledger, 535_680 ledgers ≈ 31 days.
pub const MIN_TTL_LEDGERS: u32 = 535_680;

/// Extended TTL for active/hot keys (≈ 90 days).
pub const EXTENDED_TTL_LEDGERS: u32 = 1_555_200;

/// Number of days after a unit reaches a terminal status before its detailed
/// history is eligible for on-chain compaction.
/// Off-chain indexers must have ingested all events before this window closes.
pub const ARCHIVE_AFTER_DAYS: u64 = 30;

pub const SECONDS_PER_DAY: u64 = 86_400;

// ── Archival marker types ──────────────────────────────────────────────────────

/// Compact summary stored in place of a full `Vec<StatusChangeEvent>` after
/// the unit's history has been archived off-chain.
#[contracttype]
#[derive(Clone, Debug)]
pub struct ArchivedHistorySummary {
    /// Total number of status-change events that existed before archival.
    pub total_events: u32,
    /// Timestamp of the first recorded status change.
    pub first_event_at: u64,
    /// Timestamp of the last recorded status change.
    pub last_event_at: u64,
    /// Terminal status at the time of archival.
    pub terminal_status: BloodStatus,
    /// Ledger sequence at which archival was performed.
    pub archived_at_ledger: u32,
}

/// Storage key for the archival summary of a unit's status history.
#[contracttype]
#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub enum ArchiveKey {
    /// Archived status-history summary for a blood unit.
    HistorySummary(u64),
    /// Archived custody-event summary for a blood unit.
    CustodySummary(u64),
}

/// Compact summary stored after custody events for a terminal unit have been
/// pruned from the `CUSTODY_EVENTS` map.
#[contracttype]
#[derive(Clone, Debug)]
pub struct ArchivedCustodySummary {
    /// Total confirmed custody transfers.
    pub total_confirmed: u32,
    /// Total cancelled custody transfers.
    pub total_cancelled: u32,
    /// Timestamp of the last custody event.
    pub last_event_at: u64,
    /// Ledger sequence at which archival was performed.
    pub archived_at_ledger: u32,
}

// ── TTL / Rent bump helpers ────────────────────────────────────────────────────

/// Extend the TTL of a single persistent key to at least `MIN_TTL_LEDGERS`.
///
/// Call this after every write to a persistent key to prevent rent expiry.
/// No-op if the key does not exist.
pub fn bump_persistent<K>(env: &Env, key: &K)
where
    K: soroban_sdk::IntoVal<Env, soroban_sdk::Val>,
{
    env.storage()
        .persistent()
        .extend_ttl(key, MIN_TTL_LEDGERS, EXTENDED_TTL_LEDGERS);
}

/// Bump TTL for all per-unit storage keys associated with `unit_id`.
///
/// Should be called after any write that touches a blood unit or its history.
pub fn bump_rent_for_unit(env: &Env, unit_id: u64) {
    // Blood unit record
    bump_persistent(env, &BLOOD_UNITS);

    // Status history
    let history_key = (HISTORY, unit_id);
    env.storage()
        .persistent()
        .extend_ttl(&history_key, MIN_TTL_LEDGERS, EXTENDED_TTL_LEDGERS);

    // Trail metadata
    let meta_key = DataKey::UnitTrailMeta(unit_id);
    env.storage()
        .persistent()
        .extend_ttl(&meta_key, MIN_TTL_LEDGERS, EXTENDED_TTL_LEDGERS);
}

/// Bump TTL for all shared registry maps.
///
/// These are the highest-risk keys because they are large and shared across
/// all operations. Call this periodically (e.g., from an admin cron job).
pub fn bump_all_registries(env: &Env) {
    for key in &[
        BLOOD_BANKS,
        HOSPITALS,
        BLOOD_UNITS,
        REQUESTS,
        REQUEST_KEYS,
        PAYMENTS,
        DISPUTES,
        DISPUTE_METADATA,
        CUSTODY_EVENTS,
        PAYMENT_STATS,
        PENDING_APPROVALS,
    ] {
        env.storage()
            .persistent()
            .extend_ttl(key, MIN_TTL_LEDGERS, EXTENDED_TTL_LEDGERS);
    }
}

// ── Archival helpers ───────────────────────────────────────────────────────────

/// Returns `true` if a blood unit is in a terminal status.
pub fn is_terminal_status(status: BloodStatus) -> bool {
    matches!(
        status,
        BloodStatus::Delivered | BloodStatus::Discarded | BloodStatus::Expired
    )
}

/// Returns `true` if the unit is eligible for history compaction.
///
/// Eligibility requires:
/// 1. The unit is in a terminal status.
/// 2. At least `ARCHIVE_AFTER_DAYS` have elapsed since the last status change,
///    giving off-chain indexers time to ingest all events.
pub fn is_eligible_for_archival(
    env: &Env,
    unit: &BloodUnit,
    history: &Vec<StatusChangeEvent>,
) -> bool {
    if !is_terminal_status(unit.status) {
        return false;
    }
    if history.is_empty() {
        return false;
    }
    let last_event = history.get(history.len() - 1).unwrap();
    let current_time = env.ledger().timestamp();
    current_time
        >= last_event
            .timestamp
            .saturating_add(ARCHIVE_AFTER_DAYS * SECONDS_PER_DAY)
}

/// Compact the status history for a terminal blood unit.
///
/// Replaces the full `Vec<StatusChangeEvent>` with an `ArchivedHistorySummary`
/// and removes the original history key to reclaim storage rent.
///
/// Returns `Ok(true)` if archival was performed, `Ok(false)` if the unit is
/// not yet eligible, and `Err` if the unit does not exist.
pub fn archive_unit_history(env: &Env, unit_id: u64) -> Result<bool, Error> {
    use soroban_sdk::Map;

    let units: Map<u64, BloodUnit> = env
        .storage()
        .persistent()
        .get(&BLOOD_UNITS)
        .unwrap_or(Map::new(env));

    let unit = units.get(unit_id).ok_or(Error::UnitNotFound)?;

    let history_key = (HISTORY, unit_id);
    let history: Vec<StatusChangeEvent> = env
        .storage()
        .persistent()
        .get(&history_key)
        .unwrap_or(Vec::new(env));

    if !is_eligible_for_archival(env, &unit, &history) {
        return Ok(false);
    }

    let first_event = history.get(0).unwrap();
    let last_event = history.get(history.len() - 1).unwrap();

    let summary = ArchivedHistorySummary {
        total_events: history.len(),
        first_event_at: first_event.timestamp,
        last_event_at: last_event.timestamp,
        terminal_status: unit.status,
        archived_at_ledger: env.ledger().sequence(),
    };

    // Store compact summary
    let summary_key = ArchiveKey::HistorySummary(unit_id);
    env.storage().persistent().set(&summary_key, &summary);
    bump_persistent(env, &summary_key);

    // Remove full history to reclaim rent
    env.storage().persistent().remove(&history_key);

    env.events().publish(
        (symbol_short!("archive"), symbol_short!("hist")),
        (unit_id, summary.total_events, summary.archived_at_ledger),
    );

    Ok(true)
}

/// Prune finalized `CustodyEvent` entries from the shared `CUSTODY_EVENTS` map
/// for a terminal blood unit, storing a compact `ArchivedCustodySummary`.
///
/// The `UnitTrailPage` entries are preserved — they contain only event_id
/// strings and are already compact. Off-chain consumers use the trail pages
/// to look up full event data from the event log.
///
/// Returns `Ok(true)` if pruning was performed, `Ok(false)` if not eligible.
pub fn archive_custody_events(env: &Env, unit_id: u64) -> Result<bool, Error> {
    use soroban_sdk::{Map, String as SorobanString};

    let units: Map<u64, BloodUnit> = env
        .storage()
        .persistent()
        .get(&BLOOD_UNITS)
        .unwrap_or(Map::new(env));

    let unit = units.get(unit_id).ok_or(Error::UnitNotFound)?;

    if !is_terminal_status(unit.status) {
        return Ok(false);
    }

    let current_time = env.ledger().timestamp();
    // Require the same cooling-off window as history archival
    let terminal_timestamp = unit
        .delivery_timestamp
        .or(unit.transfer_timestamp)
        .unwrap_or(0);
    if current_time < terminal_timestamp.saturating_add(ARCHIVE_AFTER_DAYS * SECONDS_PER_DAY) {
        return Ok(false);
    }

    let mut custody_events: Map<SorobanString, CustodyEvent> = env
        .storage()
        .persistent()
        .get(&CUSTODY_EVENTS)
        .unwrap_or(Map::new(env));

    let mut confirmed: u32 = 0;
    let mut cancelled: u32 = 0;
    let mut last_event_at: u64 = 0;
    let mut keys_to_remove: Vec<SorobanString> = Vec::new(env);

    for (event_id, event) in custody_events.iter() {
        if event.unit_id != unit_id {
            continue;
        }
        match event.status {
            CustodyStatus::Confirmed => confirmed += 1,
            CustodyStatus::Cancelled => cancelled += 1,
            CustodyStatus::Pending => {
                // Pending events for a terminal unit are stale — remove them too
            }
        }
        if event.initiated_at > last_event_at {
            last_event_at = event.initiated_at;
        }
        keys_to_remove.push_back(event_id);
    }

    if keys_to_remove.is_empty() {
        return Ok(false);
    }

    for i in 0..keys_to_remove.len() {
        let key = keys_to_remove.get(i).unwrap();
        custody_events.remove(key);
    }
    env.storage()
        .persistent()
        .set(&CUSTODY_EVENTS, &custody_events);
    bump_persistent(env, &CUSTODY_EVENTS);

    let summary = ArchivedCustodySummary {
        total_confirmed: confirmed,
        total_cancelled: cancelled,
        last_event_at,
        archived_at_ledger: env.ledger().sequence(),
    };

    let summary_key = ArchiveKey::CustodySummary(unit_id);
    env.storage().persistent().set(&summary_key, &summary);
    bump_persistent(env, &summary_key);

    env.events().publish(
        (symbol_short!("archive"), symbol_short!("cust")),
        (unit_id, confirmed, cancelled, env.ledger().sequence()),
    );

    Ok(true)
}

// ── Read helpers for archived data ─────────────────────────────────────────────

/// Retrieve the archived history summary for a unit, if it has been compacted.
pub fn get_archived_history_summary(env: &Env, unit_id: u64) -> Option<ArchivedHistorySummary> {
    env.storage()
        .persistent()
        .get(&ArchiveKey::HistorySummary(unit_id))
}

/// Retrieve the archived custody summary for a unit, if it has been compacted.
pub fn get_archived_custody_summary(env: &Env, unit_id: u64) -> Option<ArchivedCustodySummary> {
    env.storage()
        .persistent()
        .get(&ArchiveKey::CustodySummary(unit_id))
}

/// Returns `true` if the unit's history has been archived (compacted).
pub fn is_history_archived(env: &Env, unit_id: u64) -> bool {
    env.storage()
        .persistent()
        .has(&ArchiveKey::HistorySummary(unit_id))
}

/// Returns `true` if the unit's custody events have been archived (pruned).
pub fn is_custody_archived(env: &Env, unit_id: u64) -> bool {
    env.storage()
        .persistent()
        .has(&ArchiveKey::CustodySummary(unit_id))
}
