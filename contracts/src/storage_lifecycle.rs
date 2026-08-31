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
//! | `DataKey::BloodBankState(a)` | Persistent | Per-bank lifecycle state; grows with onboarding       |
//! | `DataKey::Unit(id)`           | Persistent | Per-unit records; highest rent risk                   |
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
//! | `DataKey::HospitalUnits`     | Persistent | Hospital index; units allocated/in-transit/delivered   |
//! | `DataKey::UnitCustodyIndex`  | Persistent | Per-unit pending custody event lookup (O(1) confirm)   |
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
//! shared registry keys (`NEXT_ID`, `PAYMENT_STATS`, `MULTISIG_CONFIG`).
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

use soroban_sdk::{contracttype, symbol_short, Address, Env, Symbol, Vec};

use crate::{
    BloodStatus, BloodUnit, CustodyEvent, CustodyStatus, DataKey, Error, StatusChangeEvent,
    HISTORY, MULTISIG_CONFIG, NEXT_ID, NEXT_REQUEST_ID, PAYMENT_STATS,
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
#[derive(Clone, Debug, PartialEq, Eq)]
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
#[derive(Clone, Debug, PartialEq, Eq)]
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
    if env.storage().persistent().has(key) {
        env.storage()
            .persistent()
            .extend_ttl(key, MIN_TTL_LEDGERS, EXTENDED_TTL_LEDGERS);
    }
}

/// Bump TTL for all per-unit storage keys associated with `unit_id`.
///
/// `unit` should be the current `BloodUnit` record so that the secondary
/// index keys (BankUnits, DonorUnits, HospitalUnits, StatusUnits) can also
/// be extended.  Pass `None` when the unit record is not yet available (e.g.
/// mid-write), in which case only the core keys are bumped.
///
/// Should be called after any write that touches a blood unit or its history.
pub fn bump_rent_for_unit(env: &Env, unit_id: u64, unit: Option<&BloodUnit>) {
    // Blood unit record
    bump_persistent(env, &DataKey::Unit(unit_id));

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

    // Secondary index keys — only bumpable when we have the unit record.
    if let Some(u) = unit {
        // BankUnits index for the owning bank.
        let bank_key = DataKey::BankUnits(u.bank_id.clone());
        env.storage()
            .persistent()
            .extend_ttl(&bank_key, MIN_TTL_LEDGERS, EXTENDED_TTL_LEDGERS);

        // DonorUnits per-bank index.
        let donor_key = DataKey::DonorUnits(u.bank_id.clone(), u.donor_id.clone());
        env.storage()
            .persistent()
            .extend_ttl(&donor_key, MIN_TTL_LEDGERS, EXTENDED_TTL_LEDGERS);

        // DonorUnits global cross-bank index (sentinel = current contract address).
        let sentinel = env.current_contract_address();
        let global_donor_key = DataKey::DonorUnits(sentinel, u.donor_id.clone());
        env.storage().persistent().extend_ttl(
            &global_donor_key,
            MIN_TTL_LEDGERS,
            EXTENDED_TTL_LEDGERS,
        );

        // HospitalUnits index — only present after allocation.
        if let Some(ref hospital) = u.recipient_hospital {
            let hosp_key = DataKey::HospitalUnits(hospital.clone());
            env.storage()
                .persistent()
                .extend_ttl(&hosp_key, MIN_TTL_LEDGERS, EXTENDED_TTL_LEDGERS);
        }

        // StatusUnits index for the unit's current status.
        let status_key = DataKey::StatusUnits(u.status);
        env.storage()
            .persistent()
            .extend_ttl(&status_key, MIN_TTL_LEDGERS, EXTENDED_TTL_LEDGERS);
    }
}

/// Bump TTL for all shared registry maps.
///
/// These are the highest-risk keys because they are large and shared across
/// all operations. Call this periodically (e.g., from an admin cron job).
///
/// Also extends TTL for all secondary index keys (BankUnits, DonorUnits,
/// HospitalUnits, StatusUnits) keys.
pub fn bump_all_registries(env: &Env) {
    // Bump shared singleton/config keys (counters, stats, multisig config).
    for key in &[NEXT_ID, NEXT_REQUEST_ID, PAYMENT_STATS, MULTISIG_CONFIG] {
        bump_persistent(env, key);
    }

    // Bump all StatusUnits variants — these are fixed and enumerable.
    for status in &[
        BloodStatus::Available,
        BloodStatus::Reserved,
        BloodStatus::InTransit,
        BloodStatus::Delivered,
        BloodStatus::Quarantined,
        BloodStatus::Expired,
        BloodStatus::Discarded,
    ] {
        let key = DataKey::StatusUnits(*status);
        env.storage()
            .persistent()
            .extend_ttl(&key, MIN_TTL_LEDGERS, EXTENDED_TTL_LEDGERS);
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
    let unit: BloodUnit = env
        .storage()
        .persistent()
        .get(&DataKey::Unit(unit_id))
        .ok_or(Error::UnitNotFound)?;

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
    use soroban_sdk::String as SorobanString;

    let unit: BloodUnit = env
        .storage()
        .persistent()
        .get(&DataKey::Unit(unit_id))
        .ok_or(Error::UnitNotFound)?;

    if !is_terminal_status(unit.status) {
        return Ok(false);
    }

    let current_time = env.ledger().timestamp();
    // Derive the terminal timestamp from the unit's last actual history event,
    // matching the approach used by archive_unit_history.  Using
    // delivery_timestamp / transfer_timestamp is wrong for Discarded/Expired
    // units — those fields are never set, causing terminal_timestamp to fall
    // back to 0 and the guard to be bypassed entirely (current_time is always
    // >> ARCHIVE_AFTER_DAYS * SECONDS_PER_DAY for any real timestamp).
    let history_key = (HISTORY, unit_id);
    let history: Vec<StatusChangeEvent> = env
        .storage()
        .persistent()
        .get(&history_key)
        .unwrap_or(Vec::new(env));
    let terminal_timestamp = if history.is_empty() {
        0u64
    } else {
        history.get(history.len() - 1).unwrap().timestamp
    };
    if current_time < terminal_timestamp.saturating_add(ARCHIVE_AFTER_DAYS * SECONDS_PER_DAY) {
        return Ok(false);
    }

    // Use the per-unit index to find only this unit's event_ids — O(k) where k = events
    // for this unit, avoiding an O(n) scan over all custody events across all units.
    let unit_events_key = DataKey::UnitCustodyEvents(unit_id);
    let event_ids: Vec<SorobanString> = env
        .storage()
        .persistent()
        .get(&unit_events_key)
        .unwrap_or(Vec::new(env));

    if event_ids.is_empty() {
        return Ok(false);
    }

    let mut confirmed: u32 = 0;
    let mut cancelled: u32 = 0;
    let mut last_event_at: u64 = 0;

    for i in 0..event_ids.len() {
        let event_id = event_ids.get(i).unwrap();
        let record_key = DataKey::CustodyRecord(event_id.clone());
        if let Some(event) = env
            .storage()
            .persistent()
            .get::<DataKey, CustodyEvent>(&record_key)
        {
            match event.status {
                CustodyStatus::Confirmed => confirmed += 1,
                CustodyStatus::Cancelled => cancelled += 1,
                CustodyStatus::Pending | CustodyStatus::Recovered => {}
            }
            if event.initiated_at > last_event_at {
                last_event_at = event.initiated_at;
            }
            env.storage().persistent().remove(&record_key);
        }
    }

    // Clear the per-unit index now that its events have been archived
    env.storage().persistent().remove(&unit_events_key);

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
