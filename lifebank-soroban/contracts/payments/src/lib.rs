#![no_std]
#![deny(deprecated)]

use soroban_sdk::token;
use soroban_sdk::{
    contract, contracterror, contractevent, contractimpl, contracttype, symbol_short, Address, Env,
    String, Vec,
};

// ── Types ──────────────────────────────────────────────────────────────────────

#[contracttype]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum PaymentStatus {
    Pending,
    Locked,
    Released,
    Refunded,
    Disputed,
    Cancelled,
}

#[contracttype]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum DisputeReason {
    FailedDelivery,
    TemperatureExcursion,
    PaymentContested,
    WrongItem,
    DamagedGoods,
    LateDelivery,
    Other,
}

#[contracttype]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Payment {
    pub id: u64,
    pub request_id: u64,
    pub payer: Address,
    pub payee: Address,
    pub amount: i128,
    pub status: PaymentStatus,
    pub created_at: u64,
    pub updated_at: u64,
    pub dispute_reason_code: Option<u32>,
    pub dispute_case_id: Option<String>,
    pub dispute_resolved: bool,
    /// Token contract address — set only for escrow-backed payments.
    pub token: Option<Address>,
}

/// Direction for dispute resolution — determines whether escrowed funds
/// are released to the payee or refunded to the payer.
#[contracttype]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum DisputeResolution {
    ReleaseToPayee,
    RefundToPayer,
}

fn dispute_reason_to_code(reason: DisputeReason) -> u32 {
    match reason {
        DisputeReason::FailedDelivery => 1,
        DisputeReason::TemperatureExcursion => 2,
        DisputeReason::PaymentContested => 3,
        DisputeReason::WrongItem => 4,
        DisputeReason::DamagedGoods => 5,
        DisputeReason::LateDelivery => 6,
        DisputeReason::Other => 7,
    }
}

#[contracttype]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct PaymentStats {
    pub total_locked: i128,
    pub total_released: i128,
    pub total_refunded: i128,
    pub count_locked: u32,
    pub count_released: u32,
    pub count_refunded: u32,
}

#[contracttype]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct PaymentPage {
    pub items: Vec<Payment>,
    pub total: u64,
    pub page: u32,
    pub page_size: u32,
}

#[contracttype]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct DonationPledge {
    pub id: u64,
    pub donor: Address,
    pub amount_per_period: i128,
    pub interval_secs: u64,
    pub payee_pool: String,
    pub cause: String,
    pub region: String,
    pub emergency_pool: bool,
    pub active: bool,
    pub created_at: u64,
}

/// On-chain vesting schedule for donor reward tokens.
#[contracttype]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct VestingSchedule {
    pub donor: Address,
    pub reward_token: Address,
    pub total_amount: i128,
    pub cliff_timestamp: u64,
    pub vest_end_timestamp: u64,
    pub claimed: i128,
}

#[contracterror]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[repr(u32)]
pub enum Error {
    PaymentNotFound = 500,
    InvalidAmount = 501,
    SamePayerPayee = 502,
    InvalidPage = 503,
    NotPledgeDonor = 504,
    InsufficientEscrowFunds = 505,
    Unauthorized = 506,
    ContractPaused = 507,
    CliffNotReached = 508,
    VestingNotFound = 509,
    NothingToClaim = 510,
    /// A payment already exists for this request.
    DuplicatePayment = 511,
    /// Donor already has an active vesting schedule that has not been fully claimed.
    ActiveVestingExists = 517,
    /// The associated request is not in a state that permits payment.
    RequestNotPayable = 512,
    /// Payment is not in Disputed status — cannot resolve.
    PaymentNotDisputed = 521,
    /// The request referenced by this payment does not exist.
    RequestNotFound = 513,
    /// Payment has no escrowed token — cannot release or refund funds.
    NotEscrowPayment = 514,
    /// Payment is not in the Locked state required for settlement.
    PaymentNotLocked = 515,
    /// Dispute timeout has not yet elapsed.
    DisputeNotExpired = 516,
    /// Vesting end timestamp must be strictly greater than cliff timestamp.
    InvalidVestingSchedule = 518,
    /// Arithmetic overflow detected in running totals.
    Overflow = 519,
    /// Escrow payments must be settled via release_escrow/refund_escrow.
    /// update_status cannot move funds and would corrupt accounting invariants.
    EscrowSettlementRequired = 520,
    /// Payment is not in a disputable state (must be Pending or Locked).
    InvalidStatus = 522,
    /// Dispute timeout exceeds the maximum allowed value.
    InvalidTimeout = 524,
    /// update_status cannot move a payment out of a terminal status
    /// (Released/Refunded/Cancelled) back into a non-terminal one — doing so
    /// would leave req_idx_key deleted while a live payment still exists,
    /// letting a duplicate payment slip past the DuplicatePayment guard.
    InvalidStatusTransition = 523,
    /// The supplied token address is not on the admin-managed allowlist.
    TokenNotAllowed = 525,
    /// No requests contract is configured; request validation cannot run.
    RequestsContractNotSet = 526,
    /// Batch exceeds `MAX_BATCH_SIZE` entries.
    BatchTooLarge = 527,
    /// A disputed payment can only be closed by resolve_dispute or
    /// process_expired_disputes; update_status must not skip the resolution.
    DisputeResolutionRequired = 528,
}

// ── Storage keys ───────────────────────────────────────────────────────────────

const CONTRACT_VERSION: u32 = 1;
const PAYMENT_COUNTER: soroban_sdk::Symbol = symbol_short!("PAY_CTR");
const PLEDGE_COUNTER: soroban_sdk::Symbol = symbol_short!("PLG_CTR");
const ADMIN_KEY: soroban_sdk::Symbol = symbol_short!("ADMIN");
const PAUSED_KEY: soroban_sdk::Symbol = symbol_short!("PAUSED");
/// Instance-level aggregate stats.
const STATS_KEY: soroban_sdk::Symbol = symbol_short!("STATS");
/// Instance storage key for the requests contract address. Required by
/// `create_payment`/`create_escrow`; set via `initialize` or `set_requests_contract`.
const REQ_CONTRACT: soroban_sdk::Symbol = symbol_short!("REQ_CTR");
/// Maximum number of entries accepted by `batch_create_payments` and
/// `process_expired_disputes`. Mirrors the sibling contracts' `MAX_BATCH_SIZE`
/// so callers hit a dedicated error instead of the instruction or write limit.
const MAX_BATCH_SIZE: u32 = 50;
/// Default dispute auto-refund timeout in seconds (7 days).
const DEFAULT_DISPUTE_TIMEOUT_SECS: u64 = 7 * 24 * 3600;
/// Maximum allowed dispute timeout (365 days). Bounds the value admins can set
/// so `payment.updated_at + timeout` can never overflow u64.
const MAX_DISPUTE_TIMEOUT_SECS: u64 = 365 * 24 * 3600;
/// Instance storage key for the dispute timeout override.
const DISPUTE_TIMEOUT: soroban_sdk::Symbol = symbol_short!("DISP_TO");
/// Instance storage key for the admin-managed set of allowed token addresses.
const ALLOWED_TOKENS: soroban_sdk::Symbol = symbol_short!("ALWD_TOK");
/// Upper bound for a vesting schedule's cliff and duration (10 years). Keeps
/// `now + duration` far from u64::MAX and rejects schedules that would lock
/// reward tokens effectively forever.
const MAX_VESTING_DURATION_SECS: u64 = 10 * 365 * 24 * 3600;
/// Maximum number of items a single paginated query may return.
const MAX_PAGE_SIZE: u32 = 100;

/// Persistent storage TTL constants (in ledgers; one ledger ≈ 5 s).
/// Entries are bumped to PERSISTENT_BUMP_TO whenever their remaining TTL
/// falls below PERSISTENT_BUMP_THRESHOLD, preventing silent expiry.
const PERSISTENT_BUMP_THRESHOLD: u32 = 518_400; // ~30 days
const PERSISTENT_BUMP_TO: u32 = 1_036_800; // ~60 days

/// Extend instance-storage TTL using the same threshold/extend-to as persistent
/// writes. Instance storage holds admin/config/stats keys; without an explicit
/// bump the entire contract instance can archive and become unusable.
fn extend_instance_ttl(env: &Env) {
    env.storage()
        .instance()
        .extend_ttl(PERSISTENT_BUMP_THRESHOLD, PERSISTENT_BUMP_TO);
}

fn payment_key(id: u64) -> (u64, &'static str) {
    (id, "pay")
}

fn pledge_key(id: u64) -> (u64, &'static str) {
    (id, "plg")
}

/// Secondary-index storage keys.
///
/// Each index is stored as a length entry plus one persistent entry per
/// position, rather than as a single `Vec<u64>`. A single Vec grows without
/// bound (every payment a busy hospital ever made, every payment ever
/// Released) until reading or rewriting it exceeds the ledger entry size or
/// the transaction budget, at which point creating or settling payments fails.
#[contracttype]
#[derive(Clone)]
enum IndexKey {
    PayerLen(Address),
    PayerAt(Address, u32),
    PayeeLen(Address),
    PayeeAt(Address, u32),
    StatusLen(u32),
    StatusAt(u32, u32),
    /// Position of a payment id inside its status index, for O(1) removal.
    StatusPos(u32, u64),
}

fn status_code(status: PaymentStatus) -> u32 {
    match status {
        PaymentStatus::Pending => 0u32,
        PaymentStatus::Locked => 1,
        PaymentStatus::Released => 2,
        PaymentStatus::Refunded => 3,
        PaymentStatus::Disputed => 4,
        PaymentStatus::Cancelled => 5,
    }
}

fn get_counter(env: &Env) -> u64 {
    extend_instance_ttl(env);
    env.storage()
        .instance()
        .get(&PAYMENT_COUNTER)
        .unwrap_or(0u64)
}

fn set_counter(env: &Env, val: u64) {
    env.storage().instance().set(&PAYMENT_COUNTER, &val);
    extend_instance_ttl(env);
}

fn get_pledge_counter(env: &Env) -> u64 {
    extend_instance_ttl(env);
    env.storage()
        .instance()
        .get(&PLEDGE_COUNTER)
        .unwrap_or(0u64)
}

fn set_pledge_counter(env: &Env, val: u64) {
    env.storage().instance().set(&PLEDGE_COUNTER, &val);
    extend_instance_ttl(env);
}

fn store_payment(env: &Env, payment: &Payment) {
    let key = payment_key(payment.id);
    env.storage().persistent().set(&key, payment);
    env.storage()
        .persistent()
        .extend_ttl(&key, PERSISTENT_BUMP_THRESHOLD, PERSISTENT_BUMP_TO);
}

fn load_payment(env: &Env, id: u64) -> Option<Payment> {
    env.storage().persistent().get(&payment_key(id))
}

fn store_pledge(env: &Env, pledge: &DonationPledge) {
    let key = pledge_key(pledge.id);
    env.storage().persistent().set(&key, pledge);
    env.storage()
        .persistent()
        .extend_ttl(&key, PERSISTENT_BUMP_THRESHOLD, PERSISTENT_BUMP_TO);
}

fn load_pledge(env: &Env, id: u64) -> Option<DonationPledge> {
    env.storage().persistent().get(&pledge_key(id))
}

fn vesting_key(donor: &Address) -> (Address, &'static str) {
    (donor.clone(), "vest")
}

fn store_vesting(env: &Env, schedule: &VestingSchedule) {
    let key = vesting_key(&schedule.donor);
    env.storage().persistent().set(&key, schedule);
    env.storage()
        .persistent()
        .extend_ttl(&key, PERSISTENT_BUMP_THRESHOLD, PERSISTENT_BUMP_TO);
}

fn load_vesting(env: &Env, donor: &Address) -> Option<VestingSchedule> {
    env.storage().persistent().get(&vesting_key(donor))
}

fn remove_vesting(env: &Env, donor: &Address) {
    env.storage().persistent().remove(&vesting_key(donor));
}

// ── Per-token reserves ─────────────────────────────────────────────────────────
//
// Vesting rewards and escrowed payments sit in the same contract balance when
// they use the same token. Each side's outstanding liability is tracked per
// token, and every outgoing transfer is followed by a check that the balance
// still covers both. One side can therefore never be paid out of funds owed
// to the other.

fn vesting_reserve_key(token: &Address) -> (Address, &'static str) {
    (token.clone(), "vres")
}

fn escrow_reserve_key(token: &Address) -> (Address, &'static str) {
    (token.clone(), "eres")
}

fn load_reserve(env: &Env, key: &(Address, &'static str)) -> i128 {
    env.storage().persistent().get(key).unwrap_or(0i128)
}

fn add_reserve(env: &Env, key: &(Address, &'static str), amount: i128) -> Result<(), Error> {
    let next = load_reserve(env, key)
        .checked_add(amount)
        .ok_or(Error::Overflow)?;
    env.storage().persistent().set(key, &next);
    env.storage()
        .persistent()
        .extend_ttl(key, PERSISTENT_BUMP_THRESHOLD, PERSISTENT_BUMP_TO);
    Ok(())
}

/// Floors at zero so liabilities created before reserves were tracked can
/// still be settled.
fn release_reserve(env: &Env, key: &(Address, &'static str), amount: i128) {
    let next = load_reserve(env, key).saturating_sub(amount).max(0);
    env.storage().persistent().set(key, &next);
    env.storage()
        .persistent()
        .extend_ttl(key, PERSISTENT_BUMP_THRESHOLD, PERSISTENT_BUMP_TO);
}

/// After an outgoing transfer of `token`, the contract must still hold enough
/// to cover every outstanding vesting schedule and every unsettled escrow in
/// that token. Returning Err reverts the transfer.
fn ensure_reserves_covered(env: &Env, token: &Address) -> Result<(), Error> {
    let required = load_reserve(env, &vesting_reserve_key(token))
        .checked_add(load_reserve(env, &escrow_reserve_key(token)))
        .ok_or(Error::Overflow)?;
    let balance = token::Client::new(env, token).balance(&env.current_contract_address());
    if balance < required {
        return Err(Error::InsufficientEscrowFunds);
    }
    Ok(())
}

/// Pay an escrowed amount out to `to`, releasing it from the escrow reserve.
fn pay_out_escrow(env: &Env, token: &Address, to: &Address, amount: i128) -> Result<(), Error> {
    release_reserve(env, &escrow_reserve_key(token), amount);
    token::Client::new(env, token).transfer(&env.current_contract_address(), to, &amount);
    ensure_reserves_covered(env, token)
}

// ── Index helpers ──────────────────────────────────────────────────────────────

fn set_index_entry<V: soroban_sdk::IntoVal<Env, soroban_sdk::Val>>(
    env: &Env,
    key: &IndexKey,
    val: &V,
) {
    env.storage().persistent().set(key, val);
    env.storage()
        .persistent()
        .extend_ttl(key, PERSISTENT_BUMP_THRESHOLD, PERSISTENT_BUMP_TO);
}

fn index_len(env: &Env, len_key: &IndexKey) -> u32 {
    env.storage().persistent().get(len_key).unwrap_or(0u32)
}

/// Append `id` at the end of an index and return the position it was stored at.
fn index_push(
    env: &Env,
    len_key: &IndexKey,
    entry_key: impl FnOnce(u32) -> IndexKey,
    id: u64,
) -> u32 {
    let pos = index_len(env, len_key);
    set_index_entry(env, &entry_key(pos), &id);
    set_index_entry(env, len_key, &(pos + 1));
    pos
}

fn index_by_payer(env: &Env, payer: &Address, id: u64) {
    let len_key = IndexKey::PayerLen(payer.clone());
    index_push(env, &len_key, |i| IndexKey::PayerAt(payer.clone(), i), id);
}

fn index_by_payee(env: &Env, payee: &Address, id: u64) {
    let len_key = IndexKey::PayeeLen(payee.clone());
    index_push(env, &len_key, |i| IndexKey::PayeeAt(payee.clone(), i), id);
}

fn index_by_status(env: &Env, status: PaymentStatus, id: u64) {
    let code = status_code(status);
    let pos = index_push(
        env,
        &IndexKey::StatusLen(code),
        |i| IndexKey::StatusAt(code, i),
        id,
    );
    set_index_entry(env, &IndexKey::StatusPos(code, id), &pos);
}

fn req_idx_key(request_id: u64) -> (u64, &'static str) {
    (request_id, "ri")
}

/// Store a single request_id → payment_id mapping in persistent storage.
/// Each entry is independent, preventing unbounded instance-storage growth.
fn index_by_request(env: &Env, request_id: u64, payment_id: u64) {
    let key = req_idx_key(request_id);
    env.storage().persistent().set(&key, &payment_id);
    // Without a bump this entry archives on the default TTL while the payment
    // is still live; the DuplicatePayment guard then stops seeing it and a
    // second payment for the same request is accepted.
    env.storage()
        .persistent()
        .extend_ttl(&key, PERSISTENT_BUMP_THRESHOLD, PERSISTENT_BUMP_TO);
}

/// Remove the request index entry once the payment reaches a terminal state
/// (Released, Refunded, Cancelled) to avoid retaining stale entries.
fn remove_from_request_index(env: &Env, request_id: u64) {
    env.storage().persistent().remove(&req_idx_key(request_id));
}

/// A terminal status is one from which req_idx_key has already been removed;
/// only Released, Refunded, and Cancelled are terminal.
fn is_terminal_status(status: PaymentStatus) -> bool {
    matches!(
        status,
        PaymentStatus::Released | PaymentStatus::Refunded | PaymentStatus::Cancelled
    )
}

/// Persistent key for the ordered list of payment IDs associated with a request.
/// Separate from req_idx_key (which maps request → current active payment).
fn request_timeline_key(request_id: u64) -> (u64, &'static str) {
    (request_id, "rt")
}

/// Append `payment_id` to the per-request timeline index.
/// The list is insertion-ordered; no sort is needed on read because payments
/// for a given request are appended in creation order.
fn timeline_append(env: &Env, request_id: u64, payment_id: u64) {
    let key = request_timeline_key(request_id);
    let mut ids: Vec<u64> = env
        .storage()
        .persistent()
        .get(&key)
        .unwrap_or(Vec::new(env));
    ids.push_back(payment_id);
    env.storage().persistent().set(&key, &ids);
    env.storage()
        .persistent()
        .extend_ttl(&key, PERSISTENT_BUMP_THRESHOLD, PERSISTENT_BUMP_TO);
}

/// Remove `id` from the status index in O(1) by moving the last entry into
/// its slot. Order within a status index is therefore not insertion order.
fn remove_from_status_index(env: &Env, status: PaymentStatus, id: u64) {
    let code = status_code(status);
    let pos_key = IndexKey::StatusPos(code, id);
    let pos: u32 = match env.storage().persistent().get(&pos_key) {
        Some(p) => p,
        None => return,
    };
    let len_key = IndexKey::StatusLen(code);
    let last = index_len(env, &len_key).saturating_sub(1);
    if pos != last {
        let moved: u64 = env
            .storage()
            .persistent()
            .get(&IndexKey::StatusAt(code, last))
            .unwrap();
        set_index_entry(env, &IndexKey::StatusAt(code, pos), &moved);
        set_index_entry(env, &IndexKey::StatusPos(code, moved), &pos);
    }
    env.storage()
        .persistent()
        .remove(&IndexKey::StatusAt(code, last));
    env.storage().persistent().remove(&pos_key);
    set_index_entry(env, &len_key, &last);
}

// ── Stats helpers ──────────────────────────────────────────────────────────────

fn load_stats(env: &Env) -> PaymentStats {
    extend_instance_ttl(env);
    env.storage()
        .instance()
        .get(&STATS_KEY)
        .unwrap_or(PaymentStats {
            total_locked: 0,
            total_released: 0,
            total_refunded: 0,
            count_locked: 0,
            count_released: 0,
            count_refunded: 0,
        })
}

fn store_stats(env: &Env, stats: &PaymentStats) {
    env.storage().instance().set(&STATS_KEY, stats);
    extend_instance_ttl(env);
}

fn update_stats_on_transition(
    env: &Env,
    amount: i128,
    old: PaymentStatus,
    new: PaymentStatus,
) -> Result<(), Error> {
    let mut stats = load_stats(env);
    match old {
        PaymentStatus::Locked => {
            stats.total_locked -= amount;
            stats.count_locked = stats.count_locked.saturating_sub(1);
        }
        PaymentStatus::Released => {
            stats.total_released -= amount;
            stats.count_released = stats.count_released.saturating_sub(1);
        }
        PaymentStatus::Refunded => {
            stats.total_refunded -= amount;
            stats.count_refunded = stats.count_refunded.saturating_sub(1);
        }
        _ => {}
    }
    match new {
        PaymentStatus::Locked => {
            stats.total_locked = stats
                .total_locked
                .checked_add(amount)
                .ok_or(Error::Overflow)?;
            stats.count_locked += 1;
        }
        PaymentStatus::Released => {
            stats.total_released = stats
                .total_released
                .checked_add(amount)
                .ok_or(Error::Overflow)?;
            stats.count_released += 1;
        }
        PaymentStatus::Refunded => {
            stats.total_refunded = stats
                .total_refunded
                .checked_add(amount)
                .ok_or(Error::Overflow)?;
            stats.count_refunded += 1;
        }
        _ => {}
    }
    store_stats(env, &stats);
    Ok(())
}

// ── Request-contract cross-contract interface (minimal) ────────────────────────

mod request_client {
    use soroban_sdk::{contractclient, contracttype, Address, Env, Vec};

    #[contracttype]
    #[derive(Clone, Copy, Debug, PartialEq, Eq)]
    pub enum RequestStatus {
        Pending,
        Approved,
        InProgress,
        Fulfilled,
        Cancelled,
        Rejected,
    }

    #[contracttype]
    #[derive(Clone, Copy, Debug, PartialEq, Eq)]
    pub enum BloodType {
        APositive,
        ANegative,
        BPositive,
        BNegative,
        ABPositive,
        ABNegative,
        OPositive,
        ONegative,
    }

    #[contracttype]
    #[derive(Clone, Copy, Debug, PartialEq, Eq)]
    pub enum BloodComponent {
        WholeBlood,
        RedCells,
        Plasma,
        Platelets,
        Cryoprecipitate,
    }

    #[contracttype]
    #[derive(Clone, Copy, Debug, PartialEq, Eq)]
    pub enum Urgency {
        Critical,
        Urgent,
        Routine,
        Scheduled,
    }

    #[contracttype]
    #[derive(Clone, Debug)]
    pub struct BloodRequest {
        pub id: u64,
        pub hospital_id: Address,
        pub blood_type: BloodType,
        pub component: BloodComponent,
        pub quantity_ml: u32,
        pub urgency: Urgency,
        pub created_timestamp: u64,
        pub required_by_timestamp: u64,
        pub status: RequestStatus,
        pub assigned_units: Vec<u64>,
        pub fulfilled_quantity_ml: u32,
        pub reservation_id: Option<u64>,
        pub fulfilled_by: Option<Address>,
        pub history: Vec<RequestHistoryEntry>,
    }

    #[contracttype]
    #[derive(Clone, Debug)]
    pub struct RequestHistoryEntry {
        pub previous_status: RequestStatus,
        pub is_initial_transition: bool,
        pub new_status: RequestStatus,
        pub actor: Address,
        pub reason: soroban_sdk::String,
        pub fulfilled_delta_ml: u32,
        pub released_reservation: bool,
        pub timestamp: u64,
    }

    #[contractclient(name = "RequestContractClient")]
    #[allow(dead_code)]
    pub trait RequestContractInterface {
        fn get_request(env: Env, request_id: u64) -> BloodRequest;
        fn cancel_request_by_contract(
            env: Env,
            caller_contract: Address,
            request_id: u64,
            reason: soroban_sdk::String,
        ) -> Result<(), soroban_sdk::Error>;
    }
}

use request_client::{RequestContractClient, RequestStatus as ReqStatus};

/// Returns the decoded request when `request_id` exists, is in Pending or
/// Approved status, and is being paid for by the requesting hospital.
///
/// The payer check is what stops a third party from squatting a `request_id`:
/// both `create_payment` and `create_escrow` take a per-request index, so
/// without it an attacker could lock the request with a minimal escrow and make
/// the real hospital's payment fail with `DuplicatePayment`.
fn validate_request_payable(
    env: &Env,
    requests_contract: &Address,
    request_id: u64,
    payer: &Address,
) -> Result<request_client::BloodRequest, Error> {
    let client = RequestContractClient::new(env, requests_contract);
    let req = client
        .try_get_request(&request_id)
        .map_err(|_| Error::RequestNotFound)?
        .map_err(|_| Error::RequestNotFound)?;
    match req.status {
        ReqStatus::Pending | ReqStatus::Approved => {}
        _ => return Err(Error::RequestNotPayable),
    }
    // Only the hospital that raised the request may fund it.
    if req.hospital_id != *payer {
        return Err(Error::Unauthorized);
    }
    Ok(req)
}

/// Attempt to move the linked request to Cancelled via the requests contract's
/// `cancel_request_by_contract`, which trusts this contract's address.
/// Best-effort so the payment refund is never blocked; returns whether the
/// request was actually cancelled so callers only emit events on success.
fn try_cancel_request(env: &Env, requests_contract: &Address, request_id: u64) -> bool {
    let client = RequestContractClient::new(env, requests_contract);
    matches!(
        client.try_cancel_request_by_contract(
            &env.current_contract_address(),
            &request_id,
            &String::from_str(env, "Dispute expired; escrow auto-refunded"),
        ),
        Ok(Ok(()))
    )
}

/// Load the configured requests contract address, failing if unset.
fn require_requests_contract(env: &Env) -> Result<Address, Error> {
    env.storage()
        .instance()
        .get::<_, Address>(&REQ_CONTRACT)
        .ok_or(Error::RequestsContractNotSet)
}

fn coord_ok_key(payment_id: u64) -> (u64, &'static str) {
    (payment_id, "coord_ok")
}

fn hosp_ok_key(payment_id: u64) -> (u64, &'static str) {
    (payment_id, "hosp_ok")
}

/// Drop both two-party release confirmations. Called on every transition out
/// of Locked so a stale pre-dispute confirmation can never release funds later.
fn clear_confirmations(env: &Env, payment_id: u64) {
    env.storage().persistent().remove(&coord_ok_key(payment_id));
    env.storage().persistent().remove(&hosp_ok_key(payment_id));
}

// ── Contract events ───────────────────────────────────────────────────────────

#[contractevent(topics = ["payment", "created"], data_format = "single-value")]
pub struct PaymentCreated {
    pub payment_id: u64,
}

#[contractevent(topics = ["payment", "escrowed"], data_format = "single-value")]
pub struct PaymentEscrowed {
    pub payment_id: u64,
}

#[contractevent(topics = ["payment", "coord_ok"], data_format = "single-value")]
pub struct PaymentCoordConfirmed {
    pub payment_id: u64,
}

#[contractevent(topics = ["payment", "released"], data_format = "vec")]
pub struct PaymentReleased {
    pub payment_id: u64,
    pub payee: Address,
    pub amount: i128,
}

#[contractevent(topics = ["payment", "hosp_ok"], data_format = "single-value")]
pub struct PaymentHospConfirmed {
    pub payment_id: u64,
}

#[contractevent(topics = ["payment", "status"], data_format = "vec")]
pub struct PaymentStatusChanged {
    pub payment_id: u64,
    pub old_status: PaymentStatus,
    pub new_status: PaymentStatus,
}

#[contractevent(topics = ["payment", "disputed"], data_format = "vec")]
pub struct PaymentDisputed {
    pub payment_id: u64,
    pub reason_code: u32,
    pub case_id: String,
}

#[contractevent(topics = ["payment", "resolved"], data_format = "single-value")]
pub struct PaymentResolved {
    pub payment_id: u64,
}

#[contractevent(topics = ["payment", "refunded"], data_format = "vec")]
pub struct PaymentRefunded {
    pub payment_id: u64,
    pub payer: Address,
    pub amount: i128,
}

#[contractevent(topics = ["pledge", "create"], data_format = "single-value")]
pub struct PledgeCreated {
    pub pledge_id: u64,
}

#[contractevent(topics = ["vest", "created"], data_format = "vec")]
pub struct VestingCreated {
    pub donor: Address,
    pub total_amount: i128,
    pub cliff_timestamp: u64,
    pub vest_end_timestamp: u64,
}

#[contractevent(topics = ["vest", "claimed"], data_format = "vec")]
pub struct VestingClaimed {
    pub donor: Address,
    pub claimable: i128,
    pub new_claimed: i128,
}

#[contractevent(topics = ["payment", "req_ctr"], data_format = "single-value")]
pub struct RequestsContractSet {
    pub requests_contract: Address,
}

#[contractevent(topics = ["request", "cancelled"], data_format = "vec")]
pub struct RequestCancelledByPayment {
    pub request_id: u64,
    pub payment_id: u64,
    pub timestamp: u64,
}

// ── Contract ───────────────────────────────────────────────────────────────────

#[contract]
pub struct PaymentContract;

#[contractimpl]
impl PaymentContract {
    /// Initialize the contract. Optionally provide the address of the requests
    /// contract so that payment creation can validate request state; it can
    /// also be set or rotated later via `set_requests_contract`. Payment
    /// creation fails with `RequestsContractNotSet` until it is configured.
    pub fn initialize(
        env: Env,
        admin: Address,
        requests_contract: Option<Address>,
    ) -> Result<(), Error> {
        admin.require_auth();
        if env.storage().instance().has(&ADMIN_KEY) {
            return Err(Error::Unauthorized);
        }
        env.storage().instance().set(&ADMIN_KEY, &admin);
        if let Some(rc) = requests_contract {
            env.storage().instance().set(&REQ_CONTRACT, &rc);
        }
        extend_instance_ttl(&env);
        Ok(())
    }

    pub fn version(_env: Env) -> u32 {
        CONTRACT_VERSION
    }

    /// Set or rotate the requests contract used to validate payable requests
    /// and to cancel requests after auto-refunds. Admin only.
    pub fn set_requests_contract(
        env: Env,
        admin: Address,
        requests_contract: Address,
    ) -> Result<(), Error> {
        admin.require_auth();
        Self::require_admin(&env, &admin)?;
        env.storage()
            .instance()
            .set(&REQ_CONTRACT, &requests_contract);
        RequestsContractSet { requests_contract }.publish(&env);
        Ok(())
    }

    /// Returns the configured requests contract address, if any.
    pub fn get_requests_contract(env: Env) -> Option<Address> {
        env.storage().instance().get::<_, Address>(&REQ_CONTRACT)
    }

    pub fn pause(env: Env, admin: Address) -> Result<(), Error> {
        admin.require_auth();
        let stored: Address = env
            .storage()
            .instance()
            .get(&ADMIN_KEY)
            .ok_or(Error::Unauthorized)?;
        if admin != stored {
            return Err(Error::Unauthorized);
        }
        env.storage().instance().set(&PAUSED_KEY, &true);
        extend_instance_ttl(&env);
        Ok(())
    }

    pub fn unpause(env: Env, admin: Address) -> Result<(), Error> {
        admin.require_auth();
        let stored: Address = env
            .storage()
            .instance()
            .get(&ADMIN_KEY)
            .ok_or(Error::Unauthorized)?;
        if admin != stored {
            return Err(Error::Unauthorized);
        }
        env.storage().instance().set(&PAUSED_KEY, &false);
        extend_instance_ttl(&env);
        Ok(())
    }

    pub fn is_paused(env: Env) -> bool {
        extend_instance_ttl(&env);
        env.storage().instance().get(&PAUSED_KEY).unwrap_or(false)
    }

    fn require_not_paused(env: &Env) -> Result<(), Error> {
        extend_instance_ttl(env);
        if env.storage().instance().get(&PAUSED_KEY).unwrap_or(false) {
            return Err(Error::ContractPaused);
        }
        Ok(())
    }

    fn require_admin(env: &Env, caller: &Address) -> Result<(), Error> {
        extend_instance_ttl(env);
        let stored: Address = env
            .storage()
            .instance()
            .get(&ADMIN_KEY)
            .ok_or(Error::Unauthorized)?;
        if *caller != stored {
            return Err(Error::Unauthorized);
        }
        Ok(())
    }

    #[allow(dead_code)]
    fn is_admin(env: &Env, caller: &Address) -> bool {
        env.storage()
            .instance()
            .get::<_, Address>(&ADMIN_KEY)
            .map(|a| a == *caller)
            .unwrap_or(false)
    }

    pub fn create_payment(
        env: Env,
        request_id: u64,
        payer: Address,
        payee: Address,
        amount: i128,
    ) -> Result<u64, Error> {
        Self::require_not_paused(&env)?;
        if amount <= 0 {
            return Err(Error::InvalidAmount);
        }
        if payer == payee {
            return Err(Error::SamePayerPayee);
        }
        payer.require_auth();

        // Reject if a payment for this request already exists.
        if env.storage().persistent().has(&req_idx_key(request_id)) {
            return Err(Error::DuplicatePayment);
        }

        let rc = require_requests_contract(&env)?;
        validate_request_payable(&env, &rc, request_id, &payer)?;

        let id = get_counter(&env) + 1;
        set_counter(&env, id);

        let now = env.ledger().timestamp();
        let payment = Payment {
            id,
            request_id,
            payer: payer.clone(),
            payee: payee.clone(),
            amount,
            status: PaymentStatus::Pending,
            created_at: now,
            updated_at: now,
            dispute_reason_code: None,
            dispute_case_id: None,
            dispute_resolved: false,
            token: None,
        };

        store_payment(&env, &payment);
        index_by_payer(&env, &payer, id);
        index_by_payee(&env, &payee, id);
        index_by_status(&env, PaymentStatus::Pending, id);
        index_by_request(&env, request_id, id);
        timeline_append(&env, request_id, id);

        PaymentCreated { payment_id: id }.publish(&env);

        Ok(id)
    }

    /// Batch-create multiple payments in a single transaction.
    pub fn batch_create_payments(
        env: Env,
        payments: Vec<(u64, Address, Address, i128)>,
    ) -> Result<Vec<u64>, Error> {
        Self::require_not_paused(&env)?;
        if payments.len() > MAX_BATCH_SIZE {
            return Err(Error::BatchTooLarge);
        }
        let mut ids: Vec<u64> = Vec::new(&env);
        for i in 0..payments.len() {
            let (request_id, payer, payee, amount) = payments.get(i).unwrap();
            let id = Self::create_payment(env.clone(), request_id, payer, payee, amount)?;
            ids.push_back(id);
        }
        Ok(ids)
    }

    /// Create an escrow-backed payment: transfers `amount` of `token` from
    /// `hospital` into the contract immediately, locking the funds on-chain.
    pub fn create_escrow(
        env: Env,
        request_id: u64,
        hospital: Address,
        payee: Address,
        amount: i128,
        token: Address,
    ) -> Result<u64, Error> {
        Self::require_not_paused(&env)?;
        if amount <= 0 {
            return Err(Error::InvalidAmount);
        }
        if hospital == payee {
            return Err(Error::SamePayerPayee);
        }
        // Both the payer (hospital) and the payee must authorize this escrow.
        // Requiring payee consent prevents a payer from unilaterally locking a
        // worthless or attacker-controlled token as the settlement asset.
        hospital.require_auth();
        payee.require_auth();

        // Reject tokens that are not on the admin-managed allowlist.
        // This prevents a payer from choosing an arbitrary or malicious token
        // as the settlement asset that the payee will later receive.
        if !Self::is_allowed_token(env.clone(), token.clone()) {
            return Err(Error::TokenNotAllowed);
        }

        // Reject if a payment for this request already exists.
        if env.storage().persistent().has(&req_idx_key(request_id)) {
            return Err(Error::DuplicatePayment);
        }

        // Validate request state; mandatory, same as create_payment.
        let rc = require_requests_contract(&env)?;
        validate_request_payable(&env, &rc, request_id, &hospital)?;

        let id = get_counter(&env) + 1;
        set_counter(&env, id);

        let now = env.ledger().timestamp();
        let payment = Payment {
            id,
            request_id,
            payer: hospital.clone(),
            payee: payee.clone(),
            amount,
            status: PaymentStatus::Locked,
            created_at: now,
            updated_at: now,
            dispute_reason_code: None,
            dispute_case_id: None,
            dispute_resolved: false,
            token: Some(token.clone()),
        };

        // ── Checks-Effects-Interactions ────────────────────────────────────────
        // Write all state (payment record, indexes, stats) BEFORE the external
        // token transfer.  If the transfer re-enters this contract and attempts
        // to create a second escrow for the same request_id, the DuplicatePayment
        // guard above will already see req_idx_key and reject the call.
        store_payment(&env, &payment);
        index_by_payer(&env, &hospital, id);
        index_by_payee(&env, &payee, id);
        index_by_status(&env, PaymentStatus::Locked, id);
        index_by_request(&env, request_id, id);
        timeline_append(&env, request_id, id);
        update_stats_on_transition(&env, amount, PaymentStatus::Pending, PaymentStatus::Locked)?;
        add_reserve(&env, &escrow_reserve_key(&token), amount)?;

        // External call last — any failure here will revert the entire transaction,
        // including the state writes above, so no inconsistency can persist.
        let token_client = token::Client::new(&env, &token);
        token_client.transfer(&hospital, env.current_contract_address(), &amount);

        PaymentEscrowed { payment_id: id }.publish(&env);

        Ok(id)
    }

    /// Release escrowed funds to the payee. Requires two-party confirmation.
    /// Transfers the locked amount from the contract to the payee and marks
    /// the payment as Released.
    ///
    /// Issue #848 fix: Two-step confirmation process
    /// - Coordinator (admin) confirms delivery via release_escrow
    /// - Hospital (payer) confirms receipt via confirm_receipt
    /// - Payment only releases when both parties have confirmed
    pub fn release_escrow(env: Env, caller: Address, payment_id: u64) -> Result<(), Error> {
        caller.require_auth();
        Self::require_not_paused(&env)?;
        Self::require_admin(&env, &caller)?;

        let mut payment = load_payment(&env, payment_id).ok_or(Error::PaymentNotFound)?;

        if payment.status != PaymentStatus::Locked {
            return Err(Error::PaymentNotLocked);
        }

        // Mark coordinator confirmation
        let coord_key = coord_ok_key(payment_id);
        env.storage().persistent().set(&coord_key, &true);
        env.storage().persistent().extend_ttl(
            &coord_key,
            PERSISTENT_BUMP_THRESHOLD,
            PERSISTENT_BUMP_TO,
        );

        // Check if hospital has also confirmed
        let hosp_key = hosp_ok_key(payment_id);
        let hospital_confirmed: bool = env.storage().persistent().get(&hosp_key).unwrap_or(false);

        if !hospital_confirmed {
            // Coordinator confirmed but waiting for hospital
            PaymentCoordConfirmed { payment_id }.publish(&env);
            return Ok(());
        }

        // Both parties confirmed - release payment
        let token_addr = payment.token.clone().ok_or(Error::NotEscrowPayment)?;
        pay_out_escrow(&env, &token_addr, &payment.payee, payment.amount)?;

        let old_status = payment.status;
        payment.status = PaymentStatus::Released;
        payment.updated_at = env.ledger().timestamp();
        store_payment(&env, &payment);

        remove_from_status_index(&env, old_status, payment_id);
        index_by_status(&env, PaymentStatus::Released, payment_id);
        update_stats_on_transition(&env, payment.amount, old_status, PaymentStatus::Released)?;
        remove_from_request_index(&env, payment.request_id);

        // Clean up confirmation flags
        clear_confirmations(&env, payment_id);

        PaymentReleased {
            payment_id,
            payee: payment.payee.clone(),
            amount: payment.amount,
        }
        .publish(&env);
        Ok(())
    }

    /// Hospital confirms receipt of blood units (issue #848 fix).
    /// Payment is only released when both coordinator and hospital confirm.
    pub fn confirm_receipt(env: Env, payment_id: u64, hospital: Address) -> Result<(), Error> {
        hospital.require_auth();
        Self::require_not_paused(&env)?;

        let mut payment = load_payment(&env, payment_id).ok_or(Error::PaymentNotFound)?;

        if payment.status != PaymentStatus::Locked {
            return Err(Error::PaymentNotLocked);
        }

        if payment.payer != hospital {
            return Err(Error::Unauthorized);
        }

        // Mark hospital confirmation
        let hosp_key = hosp_ok_key(payment_id);
        env.storage().persistent().set(&hosp_key, &true);
        env.storage().persistent().extend_ttl(
            &hosp_key,
            PERSISTENT_BUMP_THRESHOLD,
            PERSISTENT_BUMP_TO,
        );

        // Check if coordinator has also confirmed
        let coord_key = coord_ok_key(payment_id);
        let coordinator_confirmed: bool =
            env.storage().persistent().get(&coord_key).unwrap_or(false);

        if !coordinator_confirmed {
            // Hospital confirmed but waiting for coordinator
            PaymentHospConfirmed { payment_id }.publish(&env);
            return Ok(());
        }

        // Both parties confirmed - release payment
        let token_addr = payment.token.clone().ok_or(Error::NotEscrowPayment)?;
        pay_out_escrow(&env, &token_addr, &payment.payee, payment.amount)?;

        let old_status = payment.status;
        payment.status = PaymentStatus::Released;
        payment.updated_at = env.ledger().timestamp();
        store_payment(&env, &payment);

        remove_from_status_index(&env, old_status, payment_id);
        index_by_status(&env, PaymentStatus::Released, payment_id);
        update_stats_on_transition(&env, payment.amount, old_status, PaymentStatus::Released)?;
        remove_from_request_index(&env, payment.request_id);

        // Clean up confirmation flags
        clear_confirmations(&env, payment_id);

        PaymentReleased {
            payment_id,
            payee: payment.payee.clone(),
            amount: payment.amount,
        }
        .publish(&env);
        Ok(())
    }

    /// Refund escrowed funds to the payer. Admin only.
    /// Transfers the locked amount from the contract back to the payer and
    /// marks the payment as Refunded.
    pub fn refund_escrow(env: Env, caller: Address, payment_id: u64) -> Result<(), Error> {
        caller.require_auth();
        Self::require_not_paused(&env)?;
        Self::require_admin(&env, &caller)?;

        let mut payment = load_payment(&env, payment_id).ok_or(Error::PaymentNotFound)?;

        if payment.status != PaymentStatus::Locked {
            return Err(Error::PaymentNotLocked);
        }

        let token_addr = payment.token.clone().ok_or(Error::NotEscrowPayment)?;
        pay_out_escrow(&env, &token_addr, &payment.payer, payment.amount)?;

        let old_status = payment.status;
        payment.status = PaymentStatus::Refunded;
        payment.updated_at = env.ledger().timestamp();
        store_payment(&env, &payment);

        remove_from_status_index(&env, old_status, payment_id);
        index_by_status(&env, PaymentStatus::Refunded, payment_id);
        update_stats_on_transition(&env, payment.amount, old_status, PaymentStatus::Refunded)?;
        remove_from_request_index(&env, payment.request_id);
        clear_confirmations(&env, payment_id);

        PaymentRefunded {
            payment_id,
            payer: payment.payer.clone(),
            amount: payment.amount,
        }
        .publish(&env);
        Ok(())
    }

    pub fn update_status(
        env: Env,
        payment_id: u64,
        status: PaymentStatus,
        caller: Address,
    ) -> Result<(), Error> {
        caller.require_auth();
        Self::require_not_paused(&env)?;
        Self::require_admin(&env, &caller)?;
        let mut payment = load_payment(&env, payment_id).ok_or(Error::PaymentNotFound)?;

        // Security fix: prevent escrow bypass via update_status
        // Released/Refunded require actual token transfer, which must go through
        // release_escrow/refund_escrow. update_status cannot move funds.
        // Cancelled is included: cancelling an escrow here would strand the
        // locked tokens in the contract with no path back to either party.
        if matches!(
            status,
            PaymentStatus::Released | PaymentStatus::Refunded | PaymentStatus::Cancelled
        ) && payment.token.is_some()
        {
            return Err(Error::EscrowSettlementRequired);
        }

        let old_status = payment.status;

        // A dispute is closed only by resolve_dispute / process_expired_disputes.
        // Letting update_status move it on would skip the resolution record
        // (dispute_resolved) and, for escrows, the settlement transfer.
        if old_status == PaymentStatus::Disputed && status != PaymentStatus::Disputed {
            return Err(Error::DisputeResolutionRequired);
        }

        // Security fix: a terminal payment (Released/Refunded/Cancelled) must
        // never move back to a non-terminal status. remove_from_request_index
        // is only called when *entering* a terminal status, so resurrecting a
        // terminal payment would leave req_idx_key deleted while this payment
        // is live again, letting a fresh create_payment for the same request
        // slip past the DuplicatePayment guard.
        if is_terminal_status(old_status) && !is_terminal_status(status) {
            return Err(Error::InvalidStatusTransition);
        }

        payment.status = status;
        payment.updated_at = env.ledger().timestamp();
        store_payment(&env, &payment);
        remove_from_status_index(&env, old_status, payment_id);
        index_by_status(&env, status, payment_id);
        update_stats_on_transition(&env, payment.amount, old_status, status)?;
        if old_status == PaymentStatus::Locked && status != PaymentStatus::Locked {
            clear_confirmations(&env, payment_id);
        }
        if matches!(
            status,
            PaymentStatus::Released | PaymentStatus::Refunded | PaymentStatus::Cancelled
        ) {
            remove_from_request_index(&env, payment.request_id);
        }

        // Emit event on every status transition so off-chain indexers can stay
        // in sync without polling. Topics: ("payment", "status") so indexers can
        // filter by contract + topic pair.
        PaymentStatusChanged {
            payment_id,
            old_status,
            new_status: status,
        }
        .publish(&env);

        Ok(())
    }

    pub fn record_dispute(
        env: Env,
        payment_id: u64,
        reason: DisputeReason,
        case_id: String,
        caller: Address,
    ) -> Result<(), Error> {
        caller.require_auth();
        Self::require_not_paused(&env)?;
        let mut payment = load_payment(&env, payment_id).ok_or(Error::PaymentNotFound)?;
        // The payer and payee may dispute a payment they are party to; the
        // contract admin (e.g. the coordinator, which has the workflow context
        // needed to attribute a temperature excursion to this payment) may also
        // open a dispute on their behalf.
        if caller != payment.payer && caller != payment.payee && !Self::is_admin(&env, &caller) {
            return Err(Error::Unauthorized);
        }
        // Only Pending or Locked payments may be disputed.  Raising a dispute
        // on an already-Released or Refunded payment has no token backing and
        // would silently corrupt aggregate statistics.
        match payment.status {
            PaymentStatus::Pending | PaymentStatus::Locked => {}
            _ => return Err(Error::InvalidStatus),
        }
        let old_status = payment.status;
        payment.status = PaymentStatus::Disputed;
        payment.dispute_reason_code = Some(dispute_reason_to_code(reason));
        payment.dispute_case_id = Some(case_id.clone());
        payment.dispute_resolved = false;
        payment.updated_at = env.ledger().timestamp();
        store_payment(&env, &payment);
        remove_from_status_index(&env, old_status, payment_id);
        index_by_status(&env, PaymentStatus::Disputed, payment_id);
        update_stats_on_transition(&env, payment.amount, old_status, PaymentStatus::Disputed)?;
        // A dispute supersedes any earlier release confirmation.
        clear_confirmations(&env, payment_id);
        PaymentDisputed {
            payment_id,
            reason_code: dispute_reason_to_code(reason),
            case_id,
        }
        .publish(&env);
        Ok(())
    }

    /// Resolve a disputed payment: either release funds to the payee or refund
    /// them to the payer, depending on `resolution`. For escrow-backed payments
    /// the actual token transfer is executed atomically within this call.
    /// For bookkeeping-only (non-escrow) payments the status is updated without
    /// any token transfer — off-chain settlement is assumed.
    pub fn resolve_dispute(
        env: Env,
        payment_id: u64,
        resolution: DisputeResolution,
        caller: Address,
    ) -> Result<(), Error> {
        caller.require_auth();
        Self::require_not_paused(&env)?;
        Self::require_admin(&env, &caller)?;

        let mut payment = load_payment(&env, payment_id).ok_or(Error::PaymentNotFound)?;

        if payment.status != PaymentStatus::Disputed {
            return Err(Error::PaymentNotDisputed);
        }

        // ── Escrow: execute the token transfer ────────────────────────────
        if let Some(ref token_addr) = payment.token {
            let to = match resolution {
                DisputeResolution::ReleaseToPayee => &payment.payee,
                DisputeResolution::RefundToPayer => &payment.payer,
            };
            pay_out_escrow(&env, token_addr, to, payment.amount)?;
        }

        // ── Update payment state ──────────────────────────────────────────
        let old_status = payment.status;
        let new_status = match resolution {
            DisputeResolution::ReleaseToPayee => PaymentStatus::Released,
            DisputeResolution::RefundToPayer => PaymentStatus::Refunded,
        };

        payment.status = new_status;
        payment.dispute_resolved = true;
        payment.updated_at = env.ledger().timestamp();
        store_payment(&env, &payment);

        remove_from_status_index(&env, old_status, payment_id);
        index_by_status(&env, new_status, payment_id);
        update_stats_on_transition(&env, payment.amount, old_status, new_status)?;
        remove_from_request_index(&env, payment.request_id);
        clear_confirmations(&env, payment_id);

        // ── Emit events ───────────────────────────────────────────────────
        PaymentResolved { payment_id }.publish(&env);

        match resolution {
            DisputeResolution::ReleaseToPayee => {
                PaymentReleased {
                    payment_id,
                    payee: payment.payee.clone(),
                    amount: payment.amount,
                }
                .publish(&env);
            }
            DisputeResolution::RefundToPayer => {
                PaymentRefunded {
                    payment_id,
                    payer: payment.payer.clone(),
                    amount: payment.amount,
                }
                .publish(&env);
            }
        }

        Ok(())
    }

    // ── Query functions ────────────────────────────────────────────────────────

    pub fn get_payment(env: Env, payment_id: u64) -> Result<Payment, Error> {
        load_payment(&env, payment_id).ok_or(Error::PaymentNotFound)
    }

    pub fn get_payment_by_request(env: Env, request_id: u64) -> Result<Payment, Error> {
        let payment_id: u64 = env
            .storage()
            .persistent()
            .get(&req_idx_key(request_id))
            .ok_or(Error::PaymentNotFound)?;
        load_payment(&env, payment_id).ok_or(Error::PaymentNotFound)
    }

    pub fn get_payments_by_payer(
        env: Env,
        payer: Address,
        page: u32,
        page_size: u32,
    ) -> PaymentPage {
        let total = index_len(&env, &IndexKey::PayerLen(payer.clone()));
        Self::load_page(
            &env,
            total,
            |i| IndexKey::PayerAt(payer.clone(), i),
            page,
            page_size,
        )
    }

    pub fn get_payments_by_payee(
        env: Env,
        payee: Address,
        page: u32,
        page_size: u32,
    ) -> PaymentPage {
        let total = index_len(&env, &IndexKey::PayeeLen(payee.clone()));
        Self::load_page(
            &env,
            total,
            |i| IndexKey::PayeeAt(payee.clone(), i),
            page,
            page_size,
        )
    }

    pub fn get_payments_by_status(
        env: Env,
        status: PaymentStatus,
        page: u32,
        page_size: u32,
    ) -> PaymentPage {
        let code = status_code(status);
        let total = index_len(&env, &IndexKey::StatusLen(code));
        Self::load_page(
            &env,
            total,
            |i| IndexKey::StatusAt(code, i),
            page,
            page_size,
        )
    }

    pub fn get_payment_statistics(env: Env) -> PaymentStats {
        load_stats(&env)
    }

    /// Returns the ordered payment history for a specific request.
    ///
    /// Uses the per-request timeline index written at payment creation — no
    /// full scan and no sort on the read path.  `offset` is a zero-based item
    /// index; `limit` caps the number of items returned (clamped to 100).
    pub fn get_payment_timeline(
        env: Env,
        request_id: u64,
        offset: u32,
        limit: u32,
    ) -> Vec<Payment> {
        let limit = limit.clamp(1, 100);
        let ids: Vec<u64> = env
            .storage()
            .persistent()
            .get(&request_timeline_key(request_id))
            .unwrap_or(Vec::new(&env));
        let total = ids.len();
        let start = offset;
        // saturating: offset near u32::MAX must not overflow and panic.
        let end = start.saturating_add(limit).min(total);
        let mut items: Vec<Payment> = Vec::new(&env);
        if start < total {
            for i in start..end {
                let id = ids.get(i).unwrap();
                if let Some(p) = load_payment(&env, id) {
                    items.push_back(p);
                }
            }
        }
        items
    }

    pub fn get_payment_count(env: Env) -> u64 {
        get_counter(&env)
    }

    #[allow(clippy::too_many_arguments)]
    pub fn create_pledge(
        env: Env,
        donor: Address,
        amount_per_period: i128,
        interval_secs: u64,
        payee_pool: String,
        cause: String,
        region: String,
        emergency_pool: bool,
    ) -> Result<u64, Error> {
        Self::require_not_paused(&env)?;
        donor.require_auth();
        if amount_per_period <= 0 {
            return Err(Error::InvalidAmount);
        }
        if interval_secs == 0 {
            return Err(Error::InvalidAmount);
        }

        let id = get_pledge_counter(&env) + 1;
        set_pledge_counter(&env, id);

        let pledge = DonationPledge {
            id,
            donor: donor.clone(),
            amount_per_period,
            interval_secs,
            payee_pool,
            cause,
            region,
            emergency_pool,
            active: true,
            created_at: env.ledger().timestamp(),
        };
        store_pledge(&env, &pledge);

        PledgeCreated { pledge_id: id }.publish(&env);

        Ok(id)
    }

    pub fn get_pledge(env: Env, pledge_id: u64) -> Result<DonationPledge, Error> {
        load_pledge(&env, pledge_id).ok_or(Error::PaymentNotFound)
    }

    pub fn set_pledge_active(
        env: Env,
        pledge_id: u64,
        donor: Address,
        active: bool,
    ) -> Result<(), Error> {
        Self::require_not_paused(&env)?;
        donor.require_auth();
        let mut p = load_pledge(&env, pledge_id).ok_or(Error::PaymentNotFound)?;
        if p.donor != donor {
            return Err(Error::NotPledgeDonor);
        }
        p.active = active;
        store_pledge(&env, &p);
        Ok(())
    }

    // ── Vesting ────────────────────────────────────────────────────────────────

    pub fn create_vesting(
        env: Env,
        admin: Address,
        donor: Address,
        reward_token: Address,
        total_amount: i128,
        cliff_secs: u64,
        duration_secs: u64,
    ) -> Result<(), Error> {
        admin.require_auth();
        Self::require_not_paused(&env)?;

        let stored_admin: Address = env
            .storage()
            .instance()
            .get(&ADMIN_KEY)
            .ok_or(Error::Unauthorized)?;
        if admin != stored_admin {
            return Err(Error::Unauthorized);
        }

        if total_amount <= 0 {
            return Err(Error::InvalidAmount);
        }
        if duration_secs == 0 {
            return Err(Error::InvalidAmount);
        }
        if duration_secs <= cliff_secs {
            return Err(Error::InvalidVestingSchedule);
        }
        if duration_secs > MAX_VESTING_DURATION_SECS {
            return Err(Error::InvalidVestingSchedule);
        }

        // Reject if donor already has an active (uncompleted) vesting schedule.
        // Overwriting it would silently destroy unclaimed rewards.
        if let Some(existing) = load_vesting(&env, &donor) {
            if existing.claimed < existing.total_amount {
                return Err(Error::ActiveVestingExists);
            }
        }

        if load_vesting(&env, &donor).is_some() {
            return Err(Error::ActiveVestingExists);
        }

        // Overflow is an error: clamping to `now` would make the whole amount
        // claimable immediately.
        let now = env.ledger().timestamp();
        let cliff_timestamp = now.checked_add(cliff_secs).ok_or(Error::Overflow)?;
        let vest_end_timestamp = now.checked_add(duration_secs).ok_or(Error::Overflow)?;

        add_reserve(&env, &vesting_reserve_key(&reward_token), total_amount)?;
        let token_client = token::Client::new(&env, &reward_token);
        token_client.transfer(&admin, env.current_contract_address(), &total_amount);

        let schedule = VestingSchedule {
            donor: donor.clone(),
            reward_token: reward_token.clone(),
            total_amount,
            cliff_timestamp,
            vest_end_timestamp,
            claimed: 0,
        };

        store_vesting(&env, &schedule);

        VestingCreated {
            donor,
            total_amount,
            cliff_timestamp,
            vest_end_timestamp,
        }
        .publish(&env);

        Ok(())
    }

    pub fn claim_vested(env: Env, donor: Address) -> Result<i128, Error> {
        donor.require_auth();
        Self::require_not_paused(&env)?;

        // The payout token is the one bound to the schedule at creation
        // (#1154); it is never caller-supplied.
        let mut schedule = load_vesting(&env, &donor).ok_or(Error::VestingNotFound)?;

        let now = env.ledger().timestamp();

        if now < schedule.cliff_timestamp {
            return Err(Error::CliffNotReached);
        }

        let vested = if now >= schedule.vest_end_timestamp {
            schedule.total_amount
        } else {
            let elapsed = now.saturating_sub(schedule.cliff_timestamp);
            let duration = schedule
                .vest_end_timestamp
                .checked_sub(schedule.cliff_timestamp)
                .unwrap_or(1);
            (schedule
                .total_amount
                .checked_mul(elapsed as i128)
                .unwrap_or(0))
            .checked_div(duration as i128)
            .unwrap_or(0)
        };

        let claimable = vested.checked_sub(schedule.claimed).unwrap_or(0);
        if claimable <= 0 {
            return Err(Error::NothingToClaim);
        }

        let new_claimed = schedule
            .claimed
            .checked_add(claimable)
            .unwrap_or(schedule.claimed);
        if new_claimed > schedule.total_amount {
            return Err(Error::NothingToClaim);
        }

        schedule.claimed = new_claimed;

        if schedule.claimed == schedule.total_amount {
            remove_vesting(&env, &donor);
        } else {
            store_vesting(&env, &schedule);
        }

        release_reserve(
            &env,
            &vesting_reserve_key(&schedule.reward_token),
            claimable,
        );
        let token_client = token::Client::new(&env, &schedule.reward_token);
        token_client.transfer(&env.current_contract_address(), &donor, &claimable);
        ensure_reserves_covered(&env, &schedule.reward_token)?;

        VestingClaimed {
            donor,
            claimable,
            new_claimed,
        }
        .publish(&env);

        Ok(claimable)
    }

    pub fn get_vesting(env: Env, donor: Address) -> Result<VestingSchedule, Error> {
        load_vesting(&env, &donor).ok_or(Error::VestingNotFound)
    }

    /// Total unclaimed vesting rewards denominated in `token`.
    pub fn get_vesting_reserve(env: Env, token: Address) -> i128 {
        load_reserve(&env, &vesting_reserve_key(&token))
    }

    /// Total unsettled (Locked or Disputed) escrow denominated in `token`.
    pub fn get_escrow_reserve(env: Env, token: Address) -> i128 {
        load_reserve(&env, &escrow_reserve_key(&token))
    }

    // ── Dispute timeout (#595) ─────────────────────────────────────────────────

    /// Override the dispute auto-refund timeout. Admin only.
    pub fn set_dispute_timeout(env: Env, admin: Address, timeout_secs: u64) -> Result<(), Error> {
        admin.require_auth();
        Self::require_admin(&env, &admin)?;
        if timeout_secs > MAX_DISPUTE_TIMEOUT_SECS {
            return Err(Error::InvalidTimeout);
        }
        env.storage()
            .instance()
            .set(&DISPUTE_TIMEOUT, &timeout_secs);
        extend_instance_ttl(&env);
        Ok(())
    }

    // ── Token allowlist ────────────────────────────────────────────────────────

    /// Add a token address to the escrow allowlist. Admin only.
    /// Only allowlisted tokens may be used as the settlement asset in
    /// `create_escrow`, preventing a payer from escrowing a worthless or
    /// attacker-controlled token.
    pub fn add_allowed_token(env: Env, admin: Address, token: Address) -> Result<(), Error> {
        admin.require_auth();
        Self::require_admin(&env, &admin)?;
        let mut list: Vec<Address> = env
            .storage()
            .instance()
            .get(&ALLOWED_TOKENS)
            .unwrap_or(Vec::new(&env));
        // Idempotent: skip if already present.
        for i in 0..list.len() {
            if list.get(i).unwrap() == token {
                return Ok(());
            }
        }
        list.push_back(token);
        env.storage().instance().set(&ALLOWED_TOKENS, &list);
        extend_instance_ttl(&env);
        Ok(())
    }

    /// Remove a token address from the escrow allowlist. Admin only.
    /// Existing locked escrows that already used this token are unaffected;
    /// only future `create_escrow` calls are rejected.
    pub fn remove_allowed_token(env: Env, admin: Address, token: Address) -> Result<(), Error> {
        admin.require_auth();
        Self::require_admin(&env, &admin)?;
        let list: Vec<Address> = env
            .storage()
            .instance()
            .get(&ALLOWED_TOKENS)
            .unwrap_or(Vec::new(&env));
        let mut new_list: Vec<Address> = Vec::new(&env);
        for i in 0..list.len() {
            let t = list.get(i).unwrap();
            if t != token {
                new_list.push_back(t);
            }
        }
        env.storage().instance().set(&ALLOWED_TOKENS, &new_list);
        extend_instance_ttl(&env);
        Ok(())
    }

    /// Returns true if the given token address is on the escrow allowlist.
    pub fn is_allowed_token(env: Env, token: Address) -> bool {
        let list: Vec<Address> = env
            .storage()
            .instance()
            .get(&ALLOWED_TOKENS)
            .unwrap_or(Vec::new(&env));
        for i in 0..list.len() {
            if list.get(i).unwrap() == token {
                return true;
            }
        }
        false
    }

    /// Refund all Disputed+escrowed payments whose dispute has exceeded the
    /// timeout window, cancel the linked request, and emit events so off-chain
    /// projections can reconcile request state. Admin only.
    pub fn process_expired_disputes(
        env: Env,
        admin: Address,
        payment_ids: Vec<u64>,
    ) -> Result<Vec<u64>, Error> {
        admin.require_auth();
        Self::require_not_paused(&env)?;
        Self::require_admin(&env, &admin)?;
        if payment_ids.len() > MAX_BATCH_SIZE {
            return Err(Error::BatchTooLarge);
        }

        let timeout: u64 = env
            .storage()
            .instance()
            .get(&DISPUTE_TIMEOUT)
            .unwrap_or(DEFAULT_DISPUTE_TIMEOUT_SECS);
        let now = env.ledger().timestamp();
        let req_contract: Option<Address> =
            env.storage().instance().get::<_, Address>(&REQ_CONTRACT);

        let mut refunded: Vec<u64> = Vec::new(&env);

        for i in 0..payment_ids.len() {
            let pid = payment_ids.get(i).unwrap();
            let mut payment = match load_payment(&env, pid) {
                Some(p) => p,
                None => continue,
            };
            if payment.status != PaymentStatus::Disputed {
                continue;
            }
            if payment.token.is_none() {
                continue;
            }
            let expires_at = payment
                .updated_at
                .checked_add(timeout)
                .ok_or(Error::Overflow)?;
            if now < expires_at {
                continue;
            }

            let token_addr = payment.token.clone().unwrap();
            pay_out_escrow(&env, &token_addr, &payment.payer, payment.amount)?;

            let old_status = payment.status;
            payment.status = PaymentStatus::Refunded;
            payment.updated_at = now;
            store_payment(&env, &payment);
            remove_from_status_index(&env, old_status, pid);
            index_by_status(&env, PaymentStatus::Refunded, pid);
            update_stats_on_transition(&env, payment.amount, old_status, PaymentStatus::Refunded)?;
            remove_from_request_index(&env, payment.request_id);
            clear_confirmations(&env, pid);

            let request_cancelled = match req_contract {
                Some(ref rc) => try_cancel_request(&env, rc, payment.request_id),
                None => false,
            };

            PaymentRefunded {
                payment_id: pid,
                payer: payment.payer.clone(),
                amount: payment.amount,
            }
            .publish(&env);
            // Only announce the cancellation when the requests contract
            // actually recorded it, so off-chain projections stay in sync.
            if request_cancelled {
                RequestCancelledByPayment {
                    request_id: payment.request_id,
                    payment_id: pid,
                    timestamp: now,
                }
                .publish(&env);
            }

            refunded.push_back(pid);
        }

        Ok(refunded)
    }

    // ── Internal helpers ───────────────────────────────────────────────────────

    /// Load one page of an index. `page_size` 0 means the default of 20 and
    /// is capped at MAX_PAGE_SIZE so a single call cannot read an entire index.
    fn load_page(
        env: &Env,
        total: u32,
        entry_key: impl Fn(u32) -> IndexKey,
        page: u32,
        page_size: u32,
    ) -> PaymentPage {
        let page_size = if page_size == 0 {
            20
        } else {
            page_size.min(MAX_PAGE_SIZE)
        };
        let start = (page as u64) * (page_size as u64);
        let mut items: Vec<Payment> = Vec::new(env);

        if start < total as u64 {
            let end = (start + page_size as u64).min(total as u64);
            for i in start..end {
                let id: Option<u64> = env.storage().persistent().get(&entry_key(i as u32));
                if let Some(p) = id.and_then(|id| load_payment(env, id)) {
                    items.push_back(p);
                }
            }
        }

        PaymentPage {
            items,
            total: total as u64,
            page,
            page_size,
        }
    }

    /// Upgrade the contract to a new WASM hash. Only admin can call this.
    ///
    /// # Arguments
    /// * `admin` - Admin address that must authorize the upgrade
    /// * `new_wasm_hash` - Hash of the new WASM code to upgrade to
    ///
    /// # Errors
    /// * `Unauthorized` - If caller is not the admin
    pub fn upgrade(
        env: Env,
        admin: Address,
        new_wasm_hash: soroban_sdk::BytesN<32>,
    ) -> Result<(), Error> {
        admin.require_auth();
        extend_instance_ttl(&env);
        let stored_admin: Address = env
            .storage()
            .instance()
            .get(&ADMIN_KEY)
            .ok_or(Error::Unauthorized)?;
        if admin != stored_admin {
            return Err(Error::Unauthorized);
        }
        env.deployer().update_current_contract_wasm(new_wasm_hash);
        Ok(())
    }
}

mod test;
mod test_security_fixes;
mod test_settlement_fixes;
