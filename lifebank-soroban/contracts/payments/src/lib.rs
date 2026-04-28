#![no_std]
use soroban_sdk::token;
use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, symbol_short, Address, Env, Map, String,
    Vec,
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
    /// The associated request is not in a state that permits payment.
    RequestNotPayable = 512,
    /// The request referenced by this payment does not exist.
    RequestNotFound = 513,
    /// Payment has no escrowed token — cannot release or refund funds.
    NotEscrowPayment = 514,
    /// Payment is not in the Locked state required for settlement.
    PaymentNotLocked = 515,
    /// Dispute timeout has not yet elapsed.
    DisputeNotExpired = 516,
}

// ── Storage keys ───────────────────────────────────────────────────────────────

const PAYMENT_COUNTER: soroban_sdk::Symbol = symbol_short!("PAY_CTR");
const PLEDGE_COUNTER: soroban_sdk::Symbol = symbol_short!("PLG_CTR");
const ADMIN_KEY: soroban_sdk::Symbol = symbol_short!("ADMIN");
const PAUSED_KEY: soroban_sdk::Symbol = symbol_short!("PAUSED");
const REWARD_TOKEN_KEY: soroban_sdk::Symbol = symbol_short!("RWD_TOK");
/// Instance-level map: request_id (u64) → payment_id (u64).
const REQ_IDX: soroban_sdk::Symbol = symbol_short!("REQ_IDX");
/// Instance-level aggregate stats.
const STATS_KEY: soroban_sdk::Symbol = symbol_short!("STATS");
/// Instance storage key for the requests contract address (optional).
const REQ_CONTRACT: soroban_sdk::Symbol = symbol_short!("REQ_CTR");
/// Default dispute auto-refund timeout in seconds (7 days).
const DEFAULT_DISPUTE_TIMEOUT_SECS: u64 = 7 * 24 * 3600;
/// Instance storage key for the dispute timeout override.
const DISPUTE_TIMEOUT: soroban_sdk::Symbol = symbol_short!("DISP_TO");

fn payment_key(id: u64) -> (u64, &'static str) {
    (id, "pay")
}

fn pledge_key(id: u64) -> (u64, &'static str) {
    (id, "plg")
}

fn payer_index_key(payer: &Address) -> (Address, &'static str) {
    (payer.clone(), "pi")
}

fn payee_index_key(payee: &Address) -> (Address, &'static str) {
    (payee.clone(), "pyi")
}

fn status_index_key(status: PaymentStatus) -> (u32, &'static str) {
    let code = match status {
        PaymentStatus::Pending => 0u32,
        PaymentStatus::Locked => 1,
        PaymentStatus::Released => 2,
        PaymentStatus::Refunded => 3,
        PaymentStatus::Disputed => 4,
        PaymentStatus::Cancelled => 5,
    };
    (code, "si")
}

fn get_counter(env: &Env) -> u64 {
    env.storage()
        .instance()
        .get(&PAYMENT_COUNTER)
        .unwrap_or(0u64)
}

fn set_counter(env: &Env, val: u64) {
    env.storage().instance().set(&PAYMENT_COUNTER, &val);
}

fn get_pledge_counter(env: &Env) -> u64 {
    env.storage()
        .instance()
        .get(&PLEDGE_COUNTER)
        .unwrap_or(0u64)
}

fn set_pledge_counter(env: &Env, val: u64) {
    env.storage().instance().set(&PLEDGE_COUNTER, &val);
}

fn store_payment(env: &Env, payment: &Payment) {
    env.storage()
        .persistent()
        .set(&payment_key(payment.id), payment);
}

fn load_payment(env: &Env, id: u64) -> Option<Payment> {
    env.storage().persistent().get(&payment_key(id))
}

fn store_pledge(env: &Env, pledge: &DonationPledge) {
    env.storage()
        .persistent()
        .set(&pledge_key(pledge.id), pledge);
}

fn load_pledge(env: &Env, id: u64) -> Option<DonationPledge> {
    env.storage().persistent().get(&pledge_key(id))
}

fn vesting_key(donor: &Address) -> (Address, &'static str) {
    (donor.clone(), "vest")
}

fn store_vesting(env: &Env, schedule: &VestingSchedule) {
    env.storage()
        .persistent()
        .set(&vesting_key(&schedule.donor), schedule);
}

fn load_vesting(env: &Env, donor: &Address) -> Option<VestingSchedule> {
    env.storage().persistent().get(&vesting_key(donor))
}

// ── Index helpers ──────────────────────────────────────────────────────────────

fn index_by_payer(env: &Env, payer: &Address, id: u64) {
    let key = payer_index_key(payer);
    let mut ids: Vec<u64> = env
        .storage()
        .persistent()
        .get(&key)
        .unwrap_or(Vec::new(env));
    ids.push_back(id);
    env.storage().persistent().set(&key, &ids);
}

fn index_by_payee(env: &Env, payee: &Address, id: u64) {
    let key = payee_index_key(payee);
    let mut ids: Vec<u64> = env
        .storage()
        .persistent()
        .get(&key)
        .unwrap_or(Vec::new(env));
    ids.push_back(id);
    env.storage().persistent().set(&key, &ids);
}

fn index_by_status(env: &Env, status: PaymentStatus, id: u64) {
    let key = status_index_key(status);
    let mut ids: Vec<u64> = env
        .storage()
        .persistent()
        .get(&key)
        .unwrap_or(Vec::new(env));
    ids.push_back(id);
    env.storage().persistent().set(&key, &ids);
}

fn index_by_request(env: &Env, request_id: u64, payment_id: u64) {
    let mut map: Map<u64, u64> = env
        .storage()
        .instance()
        .get(&REQ_IDX)
        .unwrap_or(Map::new(env));
    map.set(request_id, payment_id);
    env.storage().instance().set(&REQ_IDX, &map);
}

/// Remove `id` from the persistent Vec stored under the given status index key.
fn remove_from_status_index(env: &Env, status: PaymentStatus, id: u64) {
    let key = status_index_key(status);
    let ids: Vec<u64> = env
        .storage()
        .persistent()
        .get(&key)
        .unwrap_or(Vec::new(env));
    let mut new_ids: Vec<u64> = Vec::new(env);
    for i in 0..ids.len() {
        let existing = ids.get(i).unwrap();
        if existing != id {
            new_ids.push_back(existing);
        }
    }
    env.storage().persistent().set(&key, &new_ids);
}

// ── Stats helpers ──────────────────────────────────────────────────────────────

fn load_stats(env: &Env) -> PaymentStats {
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
}

fn update_stats_on_transition(env: &Env, amount: i128, old: PaymentStatus, new: PaymentStatus) {
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
            stats.total_locked += amount;
            stats.count_locked += 1;
        }
        PaymentStatus::Released => {
            stats.total_released += amount;
            stats.count_released += 1;
        }
        PaymentStatus::Refunded => {
            stats.total_refunded += amount;
            stats.count_refunded += 1;
        }
        _ => {}
    }
    store_stats(env, &stats);
}

// ── Request-contract cross-contract interface (minimal) ────────────────────────

mod request_client {
    use soroban_sdk::{contractclient, contracttype, Env};

    #[contracttype]
    #[derive(Clone, Copy, Debug, PartialEq, Eq)]
    pub enum RequestStatus {
        Pending,
        Approved,
        Fulfilled,
        Cancelled,
    }

    #[contracttype]
    #[derive(Clone, Debug)]
    pub struct BloodRequest {
        pub id: u64,
        pub status: RequestStatus,
    }

    #[contractclient(name = "RequestContractClient")]
    pub trait RequestContractInterface {
        fn get_request(env: Env, request_id: u64) -> BloodRequest;
        fn update_request_status(
            env: Env,
            caller: soroban_sdk::Address,
            request_id: u64,
            new_status: RequestStatus,
        ) -> Result<(), soroban_sdk::Error>;
    }
}

use request_client::{RequestContractClient, RequestStatus as ReqStatus};

/// Returns Ok(()) if `request_id` exists and is in Pending or Approved status.
fn validate_request_payable(
    env: &Env,
    requests_contract: &Address,
    request_id: u64,
) -> Result<(), Error> {
    let client = RequestContractClient::new(env, requests_contract);
    let req = client
        .try_get_request(&request_id)
        .map_err(|_| Error::RequestNotFound)?
        .map_err(|_| Error::RequestNotFound)?;
    match req.status {
        ReqStatus::Pending | ReqStatus::Approved => Ok(()),
        _ => Err(Error::RequestNotPayable),
    }
}

/// Attempt to move the linked request to Cancelled via the requests contract.
/// Silently ignores failures (request may already be terminal or contract not configured).
fn try_cancel_request(env: &Env, requests_contract: &Address, request_id: u64) {
    let client = RequestContractClient::new(env, requests_contract);
    // Best-effort: ignore errors so the payment refund is never blocked.
    let _ = client.try_update_request_status(
        &env.current_contract_address(),
        &request_id,
        &ReqStatus::Cancelled,
    );
}

// ── Contract ───────────────────────────────────────────────────────────────────

#[contract]
pub struct PaymentContract;

#[contractimpl]
impl PaymentContract {
    /// Initialize the contract. Optionally provide the address of the requests
    /// contract so that payment creation can validate request state.
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
        Ok(())
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
        Ok(())
    }

    pub fn is_paused(env: Env) -> bool {
        env.storage().instance().get(&PAUSED_KEY).unwrap_or(false)
    }

    fn require_not_paused(env: &Env) -> Result<(), Error> {
        if env.storage().instance().get(&PAUSED_KEY).unwrap_or(false) {
            return Err(Error::ContractPaused);
        }
        Ok(())
    }

    fn require_admin(env: &Env, caller: &Address) -> Result<(), Error> {
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
        let existing_map: Map<u64, u64> = env
            .storage()
            .instance()
            .get(&REQ_IDX)
            .unwrap_or(Map::new(&env));
        if existing_map.contains_key(request_id) {
            return Err(Error::DuplicatePayment);
        }

        // Validate request state if the requests contract is configured.
        if let Some(rc) = env.storage().instance().get::<_, Address>(&REQ_CONTRACT) {
            validate_request_payable(&env, &rc, request_id)?;
        }

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

        env.events().publish(
            (
                symbol_short!("payment"),
                symbol_short!("created"),
                symbol_short!("v1"),
            ),
            id,
        );

        Ok(id)
    }

    /// Batch-create multiple payments in a single transaction.
    pub fn batch_create_payments(
        env: Env,
        payments: Vec<(u64, Address, Address, i128)>,
    ) -> Result<Vec<u64>, Error> {
        Self::require_not_paused(&env)?;
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
        hospital.require_auth();

        // Reject if a payment for this request already exists.
        let existing_map: Map<u64, u64> = env
            .storage()
            .instance()
            .get(&REQ_IDX)
            .unwrap_or(Map::new(&env));
        if existing_map.contains_key(request_id) {
            return Err(Error::DuplicatePayment);
        }

        // Validate request state if the requests contract is configured.
        if let Some(rc) = env.storage().instance().get::<_, Address>(&REQ_CONTRACT) {
            validate_request_payable(&env, &rc, request_id)?;
        }

        let token_client = token::Client::new(&env, &token);
        let available = token_client.balance(&hospital);
        if available < amount {
            return Err(Error::InsufficientEscrowFunds);
        }
        token_client.transfer(&hospital, &env.current_contract_address(), &amount);

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

        store_payment(&env, &payment);
        index_by_payer(&env, &hospital, id);
        index_by_payee(&env, &payee, id);
        index_by_status(&env, PaymentStatus::Locked, id);
        index_by_request(&env, request_id, id);
        update_stats_on_transition(&env, amount, PaymentStatus::Pending, PaymentStatus::Locked);

        env.events().publish(
            (
                symbol_short!("payment"),
                symbol_short!("escrowed"),
                symbol_short!("v1"),
            ),
            id,
        );

        Ok(id)
    }

    /// Release escrowed funds to the payee. Admin only.
    /// Transfers the locked amount from the contract to the payee and marks
    /// the payment as Released.
    pub fn release_escrow(env: Env, caller: Address, payment_id: u64) -> Result<(), Error> {
        caller.require_auth();
        Self::require_not_paused(&env)?;
        Self::require_admin(&env, &caller)?;

        let mut payment = load_payment(&env, payment_id).ok_or(Error::PaymentNotFound)?;

        if payment.status != PaymentStatus::Locked {
            return Err(Error::PaymentNotLocked);
        }

        let token_addr = payment.token.clone().ok_or(Error::NotEscrowPayment)?;
        let token_client = token::Client::new(&env, &token_addr);
        token_client.transfer(
            &env.current_contract_address(),
            &payment.payee,
            &payment.amount,
        );

        let old_status = payment.status;
        payment.status = PaymentStatus::Released;
        payment.updated_at = env.ledger().timestamp();
        store_payment(&env, &payment);

        remove_from_status_index(&env, old_status, payment_id);
        index_by_status(&env, PaymentStatus::Released, payment_id);
        update_stats_on_transition(&env, payment.amount, old_status, PaymentStatus::Released);

        env.events().publish(
            (symbol_short!("payment"), symbol_short!("released")),
            (payment_id, payment.payee.clone(), payment.amount),
        );
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
        let token_client = token::Client::new(&env, &token_addr);
        token_client.transfer(
            &env.current_contract_address(),
            &payment.payer,
            &payment.amount,
        );

        let old_status = payment.status;
        payment.status = PaymentStatus::Refunded;
        payment.updated_at = env.ledger().timestamp();
        store_payment(&env, &payment);

        remove_from_status_index(&env, old_status, payment_id);
        index_by_status(&env, PaymentStatus::Refunded, payment_id);
        update_stats_on_transition(&env, payment.amount, old_status, PaymentStatus::Refunded);

        env.events().publish(
            (symbol_short!("payment"), symbol_short!("refunded")),
            (payment_id, payment.payer.clone(), payment.amount),
        );
        Ok(())
    }

    pub fn update_status(env: Env, payment_id: u64, status: PaymentStatus) -> Result<(), Error> {
        Self::require_not_paused(&env)?;
        let mut payment = load_payment(&env, payment_id).ok_or(Error::PaymentNotFound)?;
        let old_status = payment.status;
        payment.status = status;
        payment.updated_at = env.ledger().timestamp();
        store_payment(&env, &payment);
        remove_from_status_index(&env, old_status, payment_id);
        index_by_status(&env, status, payment_id);
        update_stats_on_transition(&env, payment.amount, old_status, status);
        Ok(())
    }

    pub fn record_dispute(
        env: Env,
        payment_id: u64,
        reason: DisputeReason,
        case_id: String,
    ) -> Result<(), Error> {
        Self::require_not_paused(&env)?;
        let mut payment = load_payment(&env, payment_id).ok_or(Error::PaymentNotFound)?;
        let old_status = payment.status;
        payment.status = PaymentStatus::Disputed;
        payment.dispute_reason_code = Some(dispute_reason_to_code(reason));
        payment.dispute_case_id = Some(case_id.clone());
        payment.dispute_resolved = false;
        payment.updated_at = env.ledger().timestamp();
        store_payment(&env, &payment);
        remove_from_status_index(&env, old_status, payment_id);
        index_by_status(&env, PaymentStatus::Disputed, payment_id);
        update_stats_on_transition(&env, payment.amount, old_status, PaymentStatus::Disputed);
        env.events().publish(
            (
                symbol_short!("payment"),
                symbol_short!("disputed"),
                symbol_short!("v1"),
            ),
            (payment_id, dispute_reason_to_code(reason), case_id),
        );
        Ok(())
    }

    pub fn resolve_dispute(env: Env, payment_id: u64) -> Result<(), Error> {
        Self::require_not_paused(&env)?;
        let mut payment = load_payment(&env, payment_id).ok_or(Error::PaymentNotFound)?;
        if payment.dispute_case_id.is_some() {
            payment.dispute_resolved = true;
        }
        payment.updated_at = env.ledger().timestamp();
        store_payment(&env, &payment);
        env.events().publish(
            (
                symbol_short!("payment"),
                symbol_short!("resolved"),
                symbol_short!("v1"),
            ),
            payment_id,
        );
        Ok(())
    }

    // ── Query functions ────────────────────────────────────────────────────────

    pub fn get_payment(env: Env, payment_id: u64) -> Result<Payment, Error> {
        load_payment(&env, payment_id).ok_or(Error::PaymentNotFound)
    }

    pub fn get_payment_by_request(env: Env, request_id: u64) -> Result<Payment, Error> {
        let map: Map<u64, u64> = env
            .storage()
            .instance()
            .get(&REQ_IDX)
            .unwrap_or(Map::new(&env));
        let payment_id = map.get(request_id).ok_or(Error::PaymentNotFound)?;
        load_payment(&env, payment_id).ok_or(Error::PaymentNotFound)
    }

    pub fn get_payments_by_payer(
        env: Env,
        payer: Address,
        page: u32,
        page_size: u32,
    ) -> PaymentPage {
        let page_size = if page_size == 0 { 20 } else { page_size };
        let ids: Vec<u64> = env
            .storage()
            .persistent()
            .get(&payer_index_key(&payer))
            .unwrap_or(Vec::new(&env));
        Self::load_page(&env, ids, page, page_size)
    }

    pub fn get_payments_by_payee(
        env: Env,
        payee: Address,
        page: u32,
        page_size: u32,
    ) -> PaymentPage {
        let page_size = if page_size == 0 { 20 } else { page_size };
        let ids: Vec<u64> = env
            .storage()
            .persistent()
            .get(&payee_index_key(&payee))
            .unwrap_or(Vec::new(&env));
        Self::load_page(&env, ids, page, page_size)
    }

    pub fn get_payments_by_status(
        env: Env,
        status: PaymentStatus,
        page: u32,
        page_size: u32,
    ) -> PaymentPage {
        let page_size = if page_size == 0 { 20 } else { page_size };
        let ids: Vec<u64> = env
            .storage()
            .persistent()
            .get(&status_index_key(status))
            .unwrap_or(Vec::new(&env));
        Self::load_page(&env, ids, page, page_size)
    }

    pub fn get_payment_statistics(env: Env) -> PaymentStats {
        load_stats(&env)
    }

    pub fn get_payment_timeline(env: Env, page: u32, page_size: u32) -> PaymentPage {
        let page_size = if page_size == 0 { 20 } else { page_size };
        let total = get_counter(&env);

        let mut all: Vec<Payment> = Vec::new(&env);
        for id in 1..=total {
            if let Some(p) = load_payment(&env, id) {
                all.push_back(p);
            }
        }

        let len = all.len();
        for i in 0..len {
            for j in 0..len.saturating_sub(i + 1) {
                let current = all.get(j).unwrap();
                let next = all.get(j + 1).unwrap();
                if current.created_at > next.created_at {
                    all.set(j, next);
                    all.set(j + 1, current);
                }
            }
        }

        let start = (page as u64) * (page_size as u64);
        let end = (start + page_size as u64).min(total);
        let mut items: Vec<Payment> = Vec::new(&env);
        if start < total {
            for i in start..end {
                items.push_back(all.get(i as u32).unwrap());
            }
        }

        PaymentPage {
            items,
            total,
            page,
            page_size,
        }
    }

    pub fn get_payment_count(env: Env) -> u64 {
        get_counter(&env)
    }

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

        env.events().publish(
            (
                symbol_short!("pledge"),
                symbol_short!("create"),
                symbol_short!("v1"),
            ),
            id,
        );

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

        let now = env.ledger().timestamp();
        let schedule = VestingSchedule {
            donor: donor.clone(),
            total_amount,
            cliff_timestamp: now + cliff_secs,
            vest_end_timestamp: now + duration_secs,
            claimed: 0,
        };

        store_vesting(&env, &schedule);

        env.events().publish(
            (symbol_short!("vest"), symbol_short!("created")),
            (donor, total_amount, now + cliff_secs, now + duration_secs),
        );

        Ok(())
    }

    pub fn claim_vested(env: Env, donor: Address, reward_token: Address) -> Result<i128, Error> {
        donor.require_auth();
        Self::require_not_paused(&env)?;

        let mut schedule = load_vesting(&env, &donor).ok_or(Error::VestingNotFound)?;

        let now = env.ledger().timestamp();

        if now < schedule.cliff_timestamp {
            return Err(Error::CliffNotReached);
        }

        let vested = if now >= schedule.vest_end_timestamp {
            schedule.total_amount
        } else {
            let elapsed = now - schedule.cliff_timestamp;
            let duration = schedule.vest_end_timestamp - schedule.cliff_timestamp;
            (schedule.total_amount * elapsed as i128) / duration as i128
        };

        let claimable = vested - schedule.claimed;
        if claimable <= 0 {
            return Err(Error::NothingToClaim);
        }

        let new_claimed = schedule.claimed + claimable;
        if new_claimed > schedule.total_amount {
            return Err(Error::NothingToClaim);
        }

        schedule.claimed = new_claimed;
        store_vesting(&env, &schedule);

        let token_client = token::Client::new(&env, &reward_token);
        token_client.transfer(&env.current_contract_address(), &donor, &claimable);

        env.events().publish(
            (symbol_short!("vest"), symbol_short!("claimed")),
            (donor, claimable, new_claimed),
        );

        Ok(claimable)
    }

    pub fn get_vesting(env: Env, donor: Address) -> Result<VestingSchedule, Error> {
        load_vesting(&env, &donor).ok_or(Error::VestingNotFound)
    }

    // ── Dispute timeout (#595) ─────────────────────────────────────────────────

    /// Override the dispute auto-refund timeout. Admin only.
    pub fn set_dispute_timeout(env: Env, admin: Address, timeout_secs: u64) -> Result<(), Error> {
        admin.require_auth();
        Self::require_admin(&env, &admin)?;
        env.storage()
            .instance()
            .set(&DISPUTE_TIMEOUT, &timeout_secs);
        Ok(())
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
            if now < payment.updated_at + timeout {
                continue;
            }

            let token_client = token::Client::new(&env, payment.token.as_ref().unwrap());
            token_client.transfer(
                &env.current_contract_address(),
                &payment.payer,
                &payment.amount,
            );

            let old_status = payment.status;
            payment.status = PaymentStatus::Refunded;
            payment.updated_at = now;
            store_payment(&env, &payment);
            remove_from_status_index(&env, old_status, pid);
            index_by_status(&env, PaymentStatus::Refunded, pid);
            update_stats_on_transition(&env, payment.amount, old_status, PaymentStatus::Refunded);

            if let Some(ref rc) = req_contract {
                try_cancel_request(&env, rc, payment.request_id);
            }

            env.events().publish(
                (symbol_short!("payment"), symbol_short!("refunded")),
                (pid, payment.payer.clone(), payment.amount),
            );
            // Request-level event for off-chain projections.
            env.events().publish(
                (symbol_short!("request"), symbol_short!("cancelled")),
                (payment.request_id, pid, now),
            );

            refunded.push_back(pid);
        }

        Ok(refunded)
    }

    // ── Internal helpers ───────────────────────────────────────────────────────

    fn load_page(env: &Env, ids: Vec<u64>, page: u32, page_size: u32) -> PaymentPage {
        let total = ids.len() as u64;
        let start = (page as u64) * (page_size as u64);
        let mut items: Vec<Payment> = Vec::new(env);

        if start < total {
            let end = (start + page_size as u64).min(total);
            for i in start..end {
                let id = ids.get(i as u32).unwrap();
                if let Some(p) = load_payment(env, id) {
                    items.push_back(p);
                }
            }
        }

        PaymentPage {
            items,
            total,
            page,
            page_size,
        }
    }
}

mod test;
