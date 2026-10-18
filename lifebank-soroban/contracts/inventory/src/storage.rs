use crate::types::{BloodStatus, BloodUnit, DataKey, StatusChangeHistory};
use soroban_sdk::{Address, Env, String, Vec};

pub const SECONDS_PER_DAY: u64 = 86400;
pub const BLOOD_SHELF_LIFE_DAYS: u64 = 35;

/// Persistent storage TTL constants (ledgers; one ledger ≈ 5 s on mainnet).
/// Entries whose remaining TTL falls below TTL_THRESHOLD are extended to TTL_EXTEND_TO.
pub const TTL_THRESHOLD: u32 = 518_400; // ~30 days
pub const TTL_EXTEND_TO: u32 = 1_036_800; // ~60 days

/// Approximate ledger close time used for TTL conversions.
/// Soroban uses ~5 seconds per ledger on mainnet and testnets.
/// Rounding up (integer ceiling) is intentional: a slightly-too-long TTL is safe;
/// a slightly-too-short TTL could purge the entry before it logically expires.
pub const LEDGER_CLOSE_SECS: u64 = 5;

/// Minimum TTL (ledgers) applied to every reservation entry.
/// Even a 1-second reservation gets this floor so the entry survives at least
/// a few ledgers after creation and is readable in the same ledger batch.
pub const RESERVATION_TTL_MIN_LEDGERS: u32 = 60; // ~5 minutes

/// Grace period (ledgers) a reservation stays in storage after its expiry, so
/// `expire_reservation` can return its units to `Available`. ~30 days.
pub const RESERVATION_EXPIRY_GRACE_LEDGERS: u32 = 518_400;

pub fn extend_instance_ttl(env: &Env) {
    env.storage()
        .instance()
        .extend_ttl(TTL_THRESHOLD, TTL_EXTEND_TO);
}

/// Extend a persistent index/history entry when it exists. Full-scan reads call
/// this so pages that are never written again stay live while still being read.
/// Skips missing keys because `extend_ttl` traps on an absent entry.
pub fn extend_page_ttl(env: &Env, key: &DataKey) {
    if env.storage().persistent().has(key) {
        env.storage()
            .persistent()
            .extend_ttl(key, TTL_THRESHOLD, TTL_EXTEND_TO);
    }
}

/// Maximum history entries per storage page. Keeps each page small so
/// a single read never loads the entire history of a high-traffic unit.
const HISTORY_PAGE_SIZE: u32 = 50;

/// Maximum index entries per page (Issue #1142 fix).
/// Following the same pattern as custody events (MAX_EVENTS_PER_PAGE = 20),
/// we limit index pages to prevent unbounded storage growth for BankIndex,
/// DonorIndex, BloodTypeIndex, and StatusIndex.
const INDEX_PAGE_SIZE: u32 = 20;

// ── Admin ──────────────────────────────────────────────────────────────────────

pub fn get_admin(env: &Env) -> Address {
    let admin = env
        .storage()
        .instance()
        .get(&DataKey::Admin)
        .expect("Admin not initialized");
    extend_instance_ttl(env);
    admin
}

pub fn set_admin(env: &Env, admin: &Address) {
    env.storage().instance().set(&DataKey::Admin, admin);
    extend_instance_ttl(env);
}

// ── Authorization ──────────────────────────────────────────────────────────────

pub fn is_authorized_bank(env: &Env, bank: &Address) -> bool {
    let key = DataKey::AuthorizedBank(bank.clone());
    extend_page_ttl(env, &key);
    env.storage().persistent().has(&key)
}

pub fn set_authorized_bank(env: &Env, bank: &Address, authorized: bool) {
    let key = DataKey::AuthorizedBank(bank.clone());
    if authorized {
        env.storage().persistent().set(&key, &true);
        env.storage()
            .persistent()
            .extend_ttl(&key, TTL_THRESHOLD, TTL_EXTEND_TO);
    } else {
        env.storage().persistent().remove(&key);
    }
}

// ── Blood unit counter ─────────────────────────────────────────────────────────

pub fn get_blood_unit_counter(env: &Env) -> u64 {
    let counter = env
        .storage()
        .instance()
        .get(&DataKey::BloodUnitCounter)
        .unwrap_or(0);
    extend_instance_ttl(env);
    counter
}

pub fn increment_blood_unit_id(env: &Env) -> u64 {
    let next_id = get_blood_unit_counter(env) + 1;
    env.storage()
        .instance()
        .set(&DataKey::BloodUnitCounter, &next_id);
    extend_instance_ttl(env);
    next_id
}

// ── Blood unit CRUD ────────────────────────────────────────────────────────────

pub fn set_blood_unit(env: &Env, blood_unit: &BloodUnit) {
    let key = DataKey::BloodUnit(blood_unit.id);
    env.storage().persistent().set(&key, blood_unit);
    env.storage()
        .persistent()
        .extend_ttl(&key, TTL_THRESHOLD, TTL_EXTEND_TO);
}

pub fn get_blood_unit(env: &Env, id: u64) -> Option<BloodUnit> {
    env.storage().persistent().get(&DataKey::BloodUnit(id))
}

pub fn blood_unit_exists(env: &Env, id: u64) -> bool {
    env.storage().persistent().has(&DataKey::BloodUnit(id))
}

// ── Indexes ────────────────────────────────────────────────────────────────────
// Issue #1142 fix: All indexes now use pagination to prevent unbounded growth.
// Each index has a metadata key storing the current page number, and page keys
// storing vectors of up to INDEX_PAGE_SIZE unit IDs. When a page is full, a new
// page is created. This mirrors the pattern already used for StatusHistory.

pub fn add_to_blood_type_index(env: &Env, blood_unit: &BloodUnit) {
    let meta_key = DataKey::BloodTypeIndexMeta(blood_unit.blood_type);
    let current_page: u32 = env.storage().persistent().get(&meta_key).unwrap_or(0);

    let page_key = DataKey::BloodTypeIndexPage(blood_unit.blood_type, current_page);
    let mut page: Vec<u64> = env
        .storage()
        .persistent()
        .get(&page_key)
        .unwrap_or(Vec::new(env));

    if page.len() >= INDEX_PAGE_SIZE {
        // Current page is full — start a new one
        let next_page = current_page + 1;
        env.storage().persistent().set(&meta_key, &next_page);
        env.storage()
            .persistent()
            .extend_ttl(&meta_key, TTL_THRESHOLD, TTL_EXTEND_TO);

        let new_page_key = DataKey::BloodTypeIndexPage(blood_unit.blood_type, next_page);
        let mut new_page: Vec<u64> = Vec::new(env);
        new_page.push_back(blood_unit.id);
        env.storage().persistent().set(&new_page_key, &new_page);
        env.storage()
            .persistent()
            .extend_ttl(&new_page_key, TTL_THRESHOLD, TTL_EXTEND_TO);
    } else {
        page.push_back(blood_unit.id);
        env.storage().persistent().set(&page_key, &page);
        env.storage()
            .persistent()
            .extend_ttl(&page_key, TTL_THRESHOLD, TTL_EXTEND_TO);
    }
}

pub fn add_to_bank_index(env: &Env, blood_unit: &BloodUnit) {
    let meta_key = DataKey::BankIndexMeta(blood_unit.bank_id.clone());
    let current_page: u32 = env.storage().persistent().get(&meta_key).unwrap_or(0);

    let page_key = DataKey::BankIndexPage(blood_unit.bank_id.clone(), current_page);
    let mut page: Vec<u64> = env
        .storage()
        .persistent()
        .get(&page_key)
        .unwrap_or(Vec::new(env));

    if page.len() >= INDEX_PAGE_SIZE {
        // Current page is full — start a new one
        let next_page = current_page + 1;
        env.storage().persistent().set(&meta_key, &next_page);
        env.storage()
            .persistent()
            .extend_ttl(&meta_key, TTL_THRESHOLD, TTL_EXTEND_TO);

        let new_page_key = DataKey::BankIndexPage(blood_unit.bank_id.clone(), next_page);
        let mut new_page: Vec<u64> = Vec::new(env);
        new_page.push_back(blood_unit.id);
        env.storage().persistent().set(&new_page_key, &new_page);
        env.storage()
            .persistent()
            .extend_ttl(&new_page_key, TTL_THRESHOLD, TTL_EXTEND_TO);
    } else {
        page.push_back(blood_unit.id);
        env.storage().persistent().set(&page_key, &page);
        env.storage()
            .persistent()
            .extend_ttl(&page_key, TTL_THRESHOLD, TTL_EXTEND_TO);
    }
}

pub fn add_to_status_index(env: &Env, blood_unit: &BloodUnit) {
    let meta_key = DataKey::StatusIndexMeta(blood_unit.status);
    let current_page: u32 = env.storage().persistent().get(&meta_key).unwrap_or(0);

    let page_key = DataKey::StatusIndexPage(blood_unit.status, current_page);
    let mut page: Vec<u64> = env
        .storage()
        .persistent()
        .get(&page_key)
        .unwrap_or(Vec::new(env));

    if page.len() >= INDEX_PAGE_SIZE {
        // Current page is full — start a new one
        let next_page = current_page + 1;
        env.storage().persistent().set(&meta_key, &next_page);
        env.storage()
            .persistent()
            .extend_ttl(&meta_key, TTL_THRESHOLD, TTL_EXTEND_TO);

        let new_page_key = DataKey::StatusIndexPage(blood_unit.status, next_page);
        let mut new_page: Vec<u64> = Vec::new(env);
        new_page.push_back(blood_unit.id);
        env.storage().persistent().set(&new_page_key, &new_page);
        env.storage()
            .persistent()
            .extend_ttl(&new_page_key, TTL_THRESHOLD, TTL_EXTEND_TO);
        set_status_index_slot(env, blood_unit.id, next_page, 0);
    } else {
        let slot = page.len();
        page.push_back(blood_unit.id);
        env.storage().persistent().set(&page_key, &page);
        env.storage()
            .persistent()
            .extend_ttl(&page_key, TTL_THRESHOLD, TTL_EXTEND_TO);
        set_status_index_slot(env, blood_unit.id, current_page, slot);
    }
}

fn set_status_index_slot(env: &Env, blood_unit_id: u64, page: u32, slot: u32) {
    let slot_key = DataKey::StatusIndexSlot(blood_unit_id);
    env.storage().persistent().set(&slot_key, &(page, slot));
    env.storage()
        .persistent()
        .extend_ttl(&slot_key, TTL_THRESHOLD, TTL_EXTEND_TO);
}

/// Remove a single ID from a status index bucket in O(1) reads.
/// The unit's (page, slot) position is looked up directly and the hole is
/// filled by swap-removing the page's last element.
/// Units indexed before positions were tracked fall back to a page scan.
pub fn remove_from_status_index(env: &Env, blood_unit_id: u64, old_status: BloodStatus) {
    let slot_key = DataKey::StatusIndexSlot(blood_unit_id);
    let (page, slot): (u32, u32) = match env.storage().persistent().get(&slot_key) {
        Some(position) => position,
        None => return remove_from_status_index_scan(env, blood_unit_id, old_status),
    };

    let page_key = DataKey::StatusIndexPage(old_status, page);
    let mut units: Vec<u64> = env
        .storage()
        .persistent()
        .get(&page_key)
        .unwrap_or(Vec::new(env));

    let last_slot = units.len() - 1;
    if slot != last_slot {
        let moved_id = units.get(last_slot).unwrap();
        units.set(slot, moved_id);
        set_status_index_slot(env, moved_id, page, slot);
    }
    units.pop_back();

    env.storage().persistent().set(&page_key, &units);
    env.storage()
        .persistent()
        .extend_ttl(&page_key, TTL_THRESHOLD, TTL_EXTEND_TO);
    env.storage().persistent().remove(&slot_key);
}

/// Legacy removal for units with no recorded slot: scans all pages from 0.
fn remove_from_status_index_scan(env: &Env, blood_unit_id: u64, old_status: BloodStatus) {
    let meta_key = DataKey::StatusIndexMeta(old_status);
    let last_page: u32 = env.storage().persistent().get(&meta_key).unwrap_or(0);
    extend_page_ttl(env, &meta_key);

    for p in 0..=last_page {
        let page_key = DataKey::StatusIndexPage(old_status, p);
        let units: Vec<u64> = env
            .storage()
            .persistent()
            .get(&page_key)
            .unwrap_or(Vec::new(env));
        extend_page_ttl(env, &page_key);

        let mut updated: Vec<u64> = Vec::new(env);
        let mut found = false;
        for i in 0..units.len() {
            let id = units.get(i).unwrap();
            if id != blood_unit_id {
                updated.push_back(id);
            } else {
                found = true;
            }
        }

        if found {
            env.storage().persistent().set(&page_key, &updated);
            env.storage()
                .persistent()
                .extend_ttl(&page_key, TTL_THRESHOLD, TTL_EXTEND_TO);
            return;
        }
    }
}

pub fn add_to_donor_index(env: &Env, blood_unit: &BloodUnit) {
    if let Some(donor) = &blood_unit.donor_id {
        let meta_key = DataKey::DonorIndexMeta(donor.clone());
        let current_page: u32 = env.storage().persistent().get(&meta_key).unwrap_or(0);

        let page_key = DataKey::DonorIndexPage(donor.clone(), current_page);
        let mut page: Vec<u64> = env
            .storage()
            .persistent()
            .get(&page_key)
            .unwrap_or(Vec::new(env));

        if page.len() >= INDEX_PAGE_SIZE {
            // Current page is full — start a new one
            let next_page = current_page + 1;
            env.storage().persistent().set(&meta_key, &next_page);
            env.storage()
                .persistent()
                .extend_ttl(&meta_key, TTL_THRESHOLD, TTL_EXTEND_TO);

            let new_page_key = DataKey::DonorIndexPage(donor.clone(), next_page);
            let mut new_page: Vec<u64> = Vec::new(env);
            new_page.push_back(blood_unit.id);
            env.storage().persistent().set(&new_page_key, &new_page);
            env.storage()
                .persistent()
                .extend_ttl(&new_page_key, TTL_THRESHOLD, TTL_EXTEND_TO);
        } else {
            page.push_back(blood_unit.id);
            env.storage().persistent().set(&page_key, &page);
            env.storage()
                .persistent()
                .extend_ttl(&page_key, TTL_THRESHOLD, TTL_EXTEND_TO);
        }
    }
}

// ── Paginated status history ───────────────────────────────────────────────────
//
// History is stored as a sequence of fixed-size pages:
//   DataKey::StatusHistory(unit_id)        → current page number (u32)
//   DataKey::StatusHistoryPage(unit_id, p) → Vec<StatusChangeHistory> for page p
//
// Each page holds at most HISTORY_PAGE_SIZE entries. When a page is full a new
// page is started. Reads for the full history iterate pages; reads for the
// latest N entries only load the last page(s).

/// Append one history record. Starts a new page when the current one is full.
pub fn record_status_change(
    env: &Env,
    blood_unit_id: u64,
    from_status: BloodStatus,
    to_status: BloodStatus,
    authorized_by: &Address,
    reason: Option<String>,
) {
    let changed_at = env.ledger().timestamp();
    let history_id = increment_status_history_counter(env);

    let entry = StatusChangeHistory {
        id: history_id,
        blood_unit_id,
        from_status,
        to_status,
        authorized_by: authorized_by.clone(),
        changed_at,
        reason,
    };

    // Determine which page to append to
    let page_key = DataKey::StatusHistory(blood_unit_id); // stores current page number
    let current_page: u32 = env.storage().persistent().get(&page_key).unwrap_or(0);

    let page_data_key = DataKey::StatusHistoryPage(blood_unit_id, current_page);
    let mut page: Vec<StatusChangeHistory> = env
        .storage()
        .persistent()
        .get(&page_data_key)
        .unwrap_or(Vec::new(env));

    if page.len() >= HISTORY_PAGE_SIZE {
        // Current page is full — start a new one
        let next_page = current_page + 1;
        env.storage().persistent().set(&page_key, &next_page);
        env.storage()
            .persistent()
            .extend_ttl(&page_key, TTL_THRESHOLD, TTL_EXTEND_TO);
        let new_page_key = DataKey::StatusHistoryPage(blood_unit_id, next_page);
        let mut new_page: Vec<StatusChangeHistory> = Vec::new(env);
        new_page.push_back(entry);
        env.storage().persistent().set(&new_page_key, &new_page);
        env.storage()
            .persistent()
            .extend_ttl(&new_page_key, TTL_THRESHOLD, TTL_EXTEND_TO);
    } else {
        page.push_back(entry);
        env.storage().persistent().set(&page_data_key, &page);
        env.storage()
            .persistent()
            .extend_ttl(&page_data_key, TTL_THRESHOLD, TTL_EXTEND_TO);
    }

    // Increment change count
    let count_key = DataKey::BloodUnitStatusChangeCount(blood_unit_id);
    let count = get_blood_unit_status_change_count(env, blood_unit_id);
    env.storage().persistent().set(&count_key, &(count + 1));
    env.storage()
        .persistent()
        .extend_ttl(&count_key, TTL_THRESHOLD, TTL_EXTEND_TO);
}

/// Return all history entries for a unit by iterating pages.
/// Callers that only need recent entries should use `get_status_history_page`.
pub fn get_status_history(env: &Env, blood_unit_id: u64) -> Vec<StatusChangeHistory> {
    let page_key = DataKey::StatusHistory(blood_unit_id);
    let last_page: u32 = env.storage().persistent().get(&page_key).unwrap_or(0);
    extend_page_ttl(env, &page_key);

    let mut all: Vec<StatusChangeHistory> = Vec::new(env);
    for p in 0..=last_page {
        let page_data_key = DataKey::StatusHistoryPage(blood_unit_id, p);
        let page: Vec<StatusChangeHistory> = env
            .storage()
            .persistent()
            .get(&page_data_key)
            .unwrap_or(Vec::new(env));
        extend_page_ttl(env, &page_data_key);
        for i in 0..page.len() {
            all.push_back(page.get(i).unwrap());
        }
    }
    all
}

/// Return a single page of history. O(1) storage reads.
pub fn get_status_history_page(
    env: &Env,
    blood_unit_id: u64,
    page: u32,
) -> Vec<StatusChangeHistory> {
    let page_data_key = DataKey::StatusHistoryPage(blood_unit_id, page);
    env.storage()
        .persistent()
        .get(&page_data_key)
        .unwrap_or(Vec::new(env))
}

/// Return the current (last) page number for a unit's history.
pub fn get_history_page_count(env: &Env, blood_unit_id: u64) -> u32 {
    let page_key = DataKey::StatusHistory(blood_unit_id);
    env.storage().persistent().get(&page_key).unwrap_or(0)
}

pub fn get_blood_unit_status_change_count(env: &Env, blood_unit_id: u64) -> u64 {
    env.storage()
        .persistent()
        .get(&DataKey::BloodUnitStatusChangeCount(blood_unit_id))
        .unwrap_or(0)
}

fn increment_status_history_counter(env: &Env) -> u64 {
    let key = DataKey::StatusHistoryCounter;
    let current: u64 = env.storage().instance().get(&key).unwrap_or(0u64);
    let next_id = current + 1;
    env.storage().instance().set(&key, &next_id);
    extend_instance_ttl(env);
    next_id
}

// ── Reservation ────────────────────────────────────────────────────────────────

pub fn increment_reservation_id(env: &Env) -> u64 {
    let key = DataKey::ReservationCounter;
    let current: u64 = env.storage().instance().get(&key).unwrap_or(0);
    let next_id = current + 1;
    env.storage().instance().set(&key, &next_id);
    extend_instance_ttl(env);
    next_id
}

/// Store a reservation in persistent storage and extend its TTL to cover
/// `duration_seconds` plus a grace period.
///
/// # Why persistent storage
/// Temporary entries are deleted permanently once their TTL lapses. If a reservation
/// were purged, its unit IDs would be unrecoverable and the units would stay stuck in
/// `Reserved` forever. Persistent entries survive past expiry, so `expire_reservation`
/// can still find them and return the units to `Available`.
///
/// # Why we extend TTL here
/// The TTL covers the full reservation duration plus `RESERVATION_EXPIRY_GRACE_LEDGERS`
/// so the entry is still readable after `expiration_timestamp` long enough for anyone
/// to call `expire_reservation`. The threshold is set to the same value so the entry is
/// bumped unconditionally (i.e., `extend_ttl` always sets the TTL to `ttl_ledgers`).
pub fn set_reservation(
    env: &Env,
    id: u64,
    reservation: &crate::types::Reservation,
    duration_seconds: u64,
) {
    let key = DataKey::Reservation(id);
    env.storage().persistent().set(&key, reservation);

    // Convert duration to ledgers (ceiling division so we never under-extend).
    let duration_ledgers =
        (duration_seconds.saturating_add(LEDGER_CLOSE_SECS - 1) / LEDGER_CLOSE_SECS) as u32;
    let ttl_ledgers = duration_ledgers
        .saturating_add(RESERVATION_EXPIRY_GRACE_LEDGERS)
        .max(RESERVATION_TTL_MIN_LEDGERS);

    // threshold == ttl_ledgers forces an unconditional bump regardless of the
    // current remaining TTL (which is unknown / network-default at creation).
    env.storage()
        .persistent()
        .extend_ttl(&key, ttl_ledgers, ttl_ledgers);
}

pub fn get_reservation(env: &Env, id: u64) -> Option<crate::types::Reservation> {
    env.storage().persistent().get(&DataKey::Reservation(id))
}

pub fn remove_reservation(env: &Env, id: u64) {
    env.storage().persistent().remove(&DataKey::Reservation(id));
}
