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
    env.storage()
        .instance()
        .get(&DataKey::Admin)
        .expect("Admin not initialized")
}

pub fn set_admin(env: &Env, admin: &Address) {
    env.storage().instance().set(&DataKey::Admin, admin);
}

// ── Authorization ──────────────────────────────────────────────────────────────

pub fn is_authorized_bank(env: &Env, bank: &Address) -> bool {
    env.storage()
        .persistent()
        .has(&DataKey::AuthorizedBank(bank.clone()))
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
    env.storage()
        .instance()
        .get(&DataKey::BloodUnitCounter)
        .unwrap_or(0)
}

pub fn increment_blood_unit_id(env: &Env) -> u64 {
    let next_id = get_blood_unit_counter(env) + 1;
    env.storage()
        .instance()
        .set(&DataKey::BloodUnitCounter, &next_id);
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
    } else {
        page.push_back(blood_unit.id);
        env.storage().persistent().set(&page_key, &page);
        env.storage()
            .persistent()
            .extend_ttl(&page_key, TTL_THRESHOLD, TTL_EXTEND_TO);
    }
}

/// Remove a single ID from a status index bucket.
/// Scans all pages until the ID is found, rebuilds that page without it.
pub fn remove_from_status_index(env: &Env, blood_unit_id: u64, old_status: BloodStatus) {
    let meta_key = DataKey::StatusIndexMeta(old_status);
    let last_page: u32 = env.storage().persistent().get(&meta_key).unwrap_or(0);
    
    for p in 0..=last_page {
        let page_key = DataKey::StatusIndexPage(old_status, p);
        let units: Vec<u64> = env
            .storage()
            .persistent()
            .get(&page_key)
            .unwrap_or(Vec::new(env));
        
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

    let mut all: Vec<StatusChangeHistory> = Vec::new(env);
    for p in 0..=last_page {
        let page_data_key = DataKey::StatusHistoryPage(blood_unit_id, p);
        let page: Vec<StatusChangeHistory> = env
            .storage()
            .persistent()
            .get(&page_data_key)
            .unwrap_or(Vec::new(env));
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
    next_id
}

// ── Reservation ────────────────────────────────────────────────────────────────

pub fn increment_reservation_id(env: &Env) -> u64 {
    let key = DataKey::ReservationCounter;
    let current: u64 = env.storage().instance().get(&key).unwrap_or(0);
    let next_id = current + 1;
    env.storage().instance().set(&key, &next_id);
    next_id
}

/// Store a reservation in temporary storage and extend its TTL to cover `duration_seconds`.
///
/// # Why we extend TTL here
/// Soroban temporary-storage entries are assigned a network-default TTL at creation
/// time (currently ~1 ledger on testnet, a few ledgers on mainnet). That default is
/// far shorter than the maximum reservation duration (7 days). Without an explicit
/// bump the entry would be archived/purged long before it logically expires, causing
/// `get_reservation` to return `None` and leaving all reserved units permanently
/// stuck in `Reserved` status with no automated recovery path.
///
/// We convert `duration_seconds` to ledgers (ceiling division, rounding up) and
/// apply a small safety buffer (`RESERVATION_TTL_BUFFER_LEDGERS`) so that the entry
/// is still readable at the exact moment `expiration_timestamp` is reached.
/// The threshold is set to the same value so the entry is bumped unconditionally
/// (i.e., `extend_ttl` always sets the TTL to `ttl_ledgers`).
pub fn set_reservation(
    env: &Env,
    id: u64,
    reservation: &crate::types::Reservation,
    duration_seconds: u64,
) {
    let key = DataKey::Reservation(id);
    env.storage().temporary().set(&key, reservation);

    // Convert duration to ledgers (ceiling division so we never under-extend).
    // Add a small buffer so the entry remains readable at the exact expiry instant.
    const BUFFER_LEDGERS: u32 = 120; // ~10 minutes of headroom
    let duration_ledgers = (duration_seconds
        .saturating_add(LEDGER_CLOSE_SECS - 1)
        / LEDGER_CLOSE_SECS) as u32;
    let ttl_ledgers = duration_ledgers
        .saturating_add(BUFFER_LEDGERS)
        .max(RESERVATION_TTL_MIN_LEDGERS);

    // threshold == ttl_ledgers forces an unconditional bump regardless of the
    // current remaining TTL (which is unknown / network-default at creation).
    env.storage()
        .temporary()
        .extend_ttl(&key, ttl_ledgers, ttl_ledgers);
}

pub fn get_reservation(env: &Env, id: u64) -> Option<crate::types::Reservation> {
    env.storage().temporary().get(&DataKey::Reservation(id))
}

pub fn remove_reservation(env: &Env, id: u64) {
    env.storage().temporary().remove(&DataKey::Reservation(id));
}
