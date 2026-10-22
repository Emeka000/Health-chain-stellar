#![no_main]

use libfuzzer_sys::fuzz_target;
use arbitrary::Arbitrary;
use soroban_sdk::{
    testutils::{Address as _, Ledger},
    vec, Address, Env, Symbol, Vec as SorobanVec,
};

use health_chain_contract::payments::{
    EscrowAccount, FeeStructure, MultiSigConfig, Payment, PaymentStatus, PendingApproval,
    ReleaseConditions, HIGH_VALUE_THRESHOLD,
};
use health_chain_contract::{DataKey, Error, HealthChainContract, HealthChainContractClient};

#[derive(Arbitrary, Debug, Clone)]
enum PaymentOperation {
    CreatePayment {
        payer_idx: u8,
        payee_idx: u8,
        caller_is_admin: bool,
        amount_kind: AmountKind,
        negative_fee: bool,
    },
    FundEscrow {
        payment_idx: u8,
        caller_idx: u8,
    },
    SatisfyEscrowConditions {
        payment_idx: u8,
        approver_idx: u8,
        verified: bool,
        min_timestamp_offset: i32, // relative to current ledger time
    },
    ConfigureMultisig {
        num_signers: u8,
        threshold: u8,
        caller_is_admin: bool,
    },
    ProposeRelease {
        payment_idx: u8,
        approver_idx: u8,
    },
    AdvanceTime {
        seconds: u32,
    },
}
/// Amount values clustered tightly around HIGH_VALUE_THRESHOLD (10_000) since
/// that boundary is exactly what gates the single-admin vs multisig path.
#[derive(Arbitrary, Debug, Clone, Copy)]
enum AmountKind {
    Tiny,
    JustBelowHigh,
    ExactlyHigh,
    JustAboveHigh,
    Large,
}

impl AmountKind {
    fn to_amount(self) -> i128 {
        match self {
            AmountKind::Tiny => 1,
            AmountKind::JustBelowHigh => HIGH_VALUE_THRESHOLD - 1,
            AmountKind::ExactlyHigh => HIGH_VALUE_THRESHOLD,
            AmountKind::JustAboveHigh => HIGH_VALUE_THRESHOLD + 1,
            AmountKind::Large => HIGH_VALUE_THRESHOLD * 50,
        }
    }
}

#[derive(Arbitrary, Debug)]
struct FuzzInput {
    operations: Vec<PaymentOperation>,
}

// Storage is per-record since the #1394 migration: payments, escrows and
// pending approvals live under DataKey::Payment(id), DataKey::EscrowAccount(id)
// and DataKey::PendingApprovalRecord(id). The legacy PAY_RECS / ESC_ACCS /
// PEND_APR maps are never written by the contract any more.
fn load_payment(env: &Env, payment_id: u64) -> Option<Payment> {
    env.storage().persistent().get(&DataKey::Payment(payment_id))
}
fn load_escrow(env: &Env, payment_id: u64) -> Option<EscrowAccount> {
    env.storage()
        .persistent()
        .get(&DataKey::EscrowAccount(payment_id))
}
fn load_approval(env: &Env, payment_id: u64) -> Option<PendingApproval> {
    env.storage()
        .persistent()
        .get(&DataKey::PendingApprovalRecord(payment_id))
}

fuzz_target!(|input: FuzzInput| {
    if input.operations.len() > 50 {
        return;
    }

    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let contract_id = env.register(HealthChainContract, ());
    let client = HealthChainContractClient::new(&env, &contract_id);
    client.initialize(&admin);

    // Fixed actor pool (payers/payees/approvers/signers all draw from this).
    let mut actors: SorobanVec<Address> = vec![&env];
    for _ in 0..8 {
        actors.push_back(Address::generate(&env));
    }
    let asset = Address::generate(&env);

    let mut payment_ids: Vec<u64> = Vec::new();
    let mut payment_payers: Vec<(u64, Address)> = Vec::new();
    // Track expected amount per payment_id so we can check the multisig vs
    // single-admin branch was taken correctly.
    let mut payment_amounts: Vec<(u64, i128)> = Vec::new();
    let mut multisig_configured = false;
    let mut configured_threshold: u32 = 0;
    // Largest signer set ever configured: configure_multisig keeps in-flight
    // votes, so a vote count is bounded by every signer ever allowed to vote.
    let mut max_signer_count: usize = 0;

    for op in input.operations.iter() {
        match op {
            PaymentOperation::CreatePayment {
                payer_idx,
                payee_idx,
                caller_is_admin,
                amount_kind,
                negative_fee,
            } => {
                let payer = actors[*payer_idx as usize % actors.len()].clone();
                let payee = actors[*payee_idx as usize % actors.len()].clone();
                if payer == payee {
                    continue;
                }

                let amount = amount_kind.to_amount();

                let fee_structure = if *negative_fee {
                    FeeStructure {
                        policy_id: Symbol::new(&env, "fz_bad"),
                        service_fee: -50,
                        network_fee: 0,
                        performance_bonus: 0,
                        fixed_fee: 0,
                    }
                } else {
                    FeeStructure {
                        policy_id: Symbol::new(&env, "fz_ok"),
                        service_fee: 0,
                        network_fee: 0,
                        performance_bonus: 0,
                        fixed_fee: 0,
                    }
                };

                let caller = if *caller_is_admin {
                    admin.clone()
                } else {
                    actors[1].clone()
                };

                let result = client.try_create_payment(
                    &1u64, &payer, &payee, &amount, &asset, &fee_structure, &caller,
                );

                if *negative_fee {
                    // INVARIANT: negative fees are always rejected, no matter
                    // what amount or caller is used.
                    assert!(
                        result.is_err(),
                        "INVARIANT VIOLATION: payment created with negative fee"
                    );
                    continue;
                }

                if !*caller_is_admin {
                    // INVARIANT: unauthorized caller must be rejected with
                    // Error::Unauthorized specifically, not just any error.
                    if let Err(Ok(e)) = &result {
                        assert_eq!(
                            *e,
                            Error::Unauthorized,
                            "INVARIANT VIOLATION: wrong error code for unauthorized create_payment"
                        );
                    }
                    continue;
                }

                if let Ok(Ok(payment_id)) = result {
                    payment_ids.push(payment_id);
                    payment_payers.push((payment_id, payer.clone()));
                    payment_amounts.push((payment_id, amount));

                    // INVARIANT: a new payment starts Pending — it must be
                    // funded via fund_escrow before it can be released (#1431).
                    let payment = read_payment(&env, &contract_id, payment_id).unwrap();
                    assert_eq!(
                        payment.status,
                        PaymentStatus::Pending,
                        "INVARIANT VIOLATION: new payment not Pending"
                    );

                    // INVARIANT: escrow account must exist immediately after
                    // creation, pre-populated with locked_amount == amount and
                    // medical_records_verified == false (per
                    // escrow_conditions_stored_at_payment_creation test).
                    env.as_contract(&contract_id, || {
                        let escrow = load_escrow(&env, payment_id)
                            .expect("INVARIANT VIOLATION: no escrow account after create_payment");
                        assert_eq!(
                            escrow.locked_amount, amount,
                            "INVARIANT VIOLATION: escrow locked_amount != payment amount"
                        );
                        assert!(
                            !escrow.release_conditions.medical_records_verified,
                            "INVARIANT VIOLATION: medical_records_verified true by default"
                        );
                    }
                }
            }

            PaymentOperation::FundEscrow {
                payment_idx,
                caller_idx,
            } => {
                if payment_ids.is_empty() {
                    continue;
                }
                let payment_id = payment_ids[(*payment_idx as usize) % payment_ids.len()];
                env.as_contract(&contract_id, || {
                    if let Some(mut payment) = load_payment(&env, payment_id) {
                        if payment.status == PaymentStatus::Pending {
                            payment.status = PaymentStatus::Escrowed;
                            env.storage()
                                .persistent()
                                .set(&DataKey::Payment(payment_id), &payment);
                        }
                    }
                });
            }

            PaymentOperation::SatisfyEscrowConditions {
                payment_idx,
                approver_idx,
                verified,
                min_timestamp_offset,
            } => {
                if payment_ids.is_empty() {
                    continue;
                }
                let payment_id = payment_ids[(*payment_idx as usize) % payment_ids.len()];
                let approver = actors[*approver_idx as usize % actors.len()].clone();

                env.as_contract(&contract_id, || {
                    if let Some(mut escrow) = load_escrow(&env, payment_id) {
                        let current = env.ledger().timestamp();
                        let min_ts = if *min_timestamp_offset >= 0 {
                            current.saturating_add(*min_timestamp_offset as u64)
                        } else {
                            current.saturating_sub((-*min_timestamp_offset) as u64)
                        };
                        escrow.release_conditions = ReleaseConditions {
                            medical_records_verified: *verified,
                            min_timestamp: min_ts,
                            authorized_approver: Some(approver.clone()),
                        };
                        env.storage()
                            .persistent()
                            .set(&DataKey::EscrowAccount(payment_id), &escrow);
                    }
                });
            }

            PaymentOperation::ConfigureMultisig {
                num_signers,
                threshold,
                caller_is_admin,
            } => {
                let n = ((*num_signers % 5) + 1) as usize; // 1..=5 signers
                let mut signers: SorobanVec<Address> = vec![&env];
                for i in 0..n {
                    signers.push_back(actors[i % actors.len()].clone());
                }
                let threshold_val = (*threshold % 6) as u32; // 0..=5, includes invalid 0

                // configure_multisig requires admin auth implicitly via
                // require_auth inside the contract; since mock_all_auths()
                // bypasses signer checks, we instead validate the *config
                // shape* invariant: invalid configs (threshold 0, threshold >
                // signers.len(), duplicate signers) must never end up stored
                // as valid by propose_release's later validate() call.
                let _ = caller_is_admin;

                let result = client.try_configure_multisig(&signers, &threshold_val);
                if result.is_ok() {
                    let config = MultiSigConfig {
                        signers: signers.clone(),
                        threshold: threshold_val,
                    };
                    if config.validate().is_ok() {
                        multisig_configured = true;
                        configured_threshold = threshold_val;
                        max_signer_count = max_signer_count.max(n);
                    } else {
                        // INVARIANT: an invalid config (zero threshold,
                        // threshold > len, or duplicates) must never be
                        // accepted by configure_multisig.
                        panic!(
                            "INVARIANT VIOLATION: configure_multisig accepted invalid config (threshold={}, n={})",
                            threshold_val, n
                        );
                    }
                }
            }

            PaymentOperation::ProposeRelease {
                payment_idx,
                approver_idx,
            } => {
                if payment_ids.is_empty() {
                    continue;
                }
                let payment_id = payment_ids[(*payment_idx as usize) % payment_ids.len()];
                let approver = actors[*approver_idx as usize % actors.len()].clone();

                let amount = payment_amounts
                    .iter()
                    .find(|(id, _)| *id == payment_id)
                    .map(|(_, a)| *a);

                let result = client.try_propose_release(&payment_id, &approver);

                if let Ok(Ok(executed)) = result {
                    if executed {
                        // INVARIANT: if propose_release reports executed,
                        // the payment must actually be Completed with
                        // escrow_released_at set.
                        env.as_contract(&contract_id, || {
                            let payment = load_payment(&env, payment_id).unwrap();
                            assert_eq!(
                                payment.status,
                                PaymentStatus::Completed,
                                "INVARIANT VIOLATION: propose_release reported executed but status != Completed"
                            );
                            assert!(
                                payment.escrow_released_at.is_some(),
                                "INVARIANT VIOLATION: executed release missing escrow_released_at"
                            );
                        }

                        if let Some(amt) = amount {
                            if amt >= HIGH_VALUE_THRESHOLD && multisig_configured {
                                env.as_contract(&contract_id, || {
                                    let approval = load_approval(&env, payment_id).expect(
                                        "INVARIANT VIOLATION: multisig release executed without a PendingApproval record",
                                    );
                                    assert!(
                                        approval.approvals.len() >= configured_threshold,
                                        "INVARIANT VIOLATION: high-value release executed before reaching threshold ({} votes, threshold {})",
                                        approval.approvals.len(),
                                        configured_threshold
                                    );
                                }
                            }
                        }
                    }
                }
            }

            PaymentOperation::AdvanceTime { seconds } => {
                let advance = (*seconds as u64).min(7 * 24 * 60 * 60);
                env.ledger().with_mut(|li| {
                    li.timestamp += advance;
                });
            }
        }

        // ----- Global invariants after every operation -----

        // 1. No payment should ever sit in an EscrowAccount with locked_amount
        // that doesn't match its own Payment.amount (would indicate desync
        // between the two storage maps).
        env.as_contract(&contract_id, || {
            for &payment_id in payment_ids.iter() {
                let payment = load_payment(&env, payment_id).unwrap_or_else(|| {
                    panic!(
                        "GLOBAL INVARIANT VIOLATION: tracked payment {} missing from storage",
                        payment_id
                    )
                });
                if let Some(escrow) = load_escrow(&env, payment_id) {
                    assert_eq!(
                        escrow.locked_amount, payment.amount,
                        "GLOBAL INVARIANT VIOLATION: escrow/payment amount desync for {}",
                        payment_id
                    );
                }
            }
        });
        env.as_contract(&contract_id, || {
            for &payment_id in payment_ids.iter() {
                if let Some(approval) = load_approval(&env, payment_id) {
                    if multisig_configured {
                        assert!(
                            approval.approvals.len() as usize <= configured_signer_count,
                            "GLOBAL INVARIANT VIOLATION: more votes ({}) than configured signers ({}) for payment {}",
                            approval.approvals.len(),
                            configured_signer_count,
                            payment_id
                        );
                    }
                }
            }
        }
    }
});
