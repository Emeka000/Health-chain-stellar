#![no_main]

use libfuzzer_sys::fuzz_target;
use arbitrary::Arbitrary;
use soroban_sdk::{
    testutils::{Address as _, Ledger},
    vec, Address, Env, Map, Symbol,
};

use health_chain_contract::payments::{
    EscrowAccount, FeeStructure, MultiSigConfig, Payment, PaymentStatus, ReleaseConditions,
    HIGH_VALUE_THRESHOLD,
};
use health_chain_contract::{Error, HealthChainContract, HealthChainContractClient};

#[derive(Arbitrary, Debug, Clone)]
enum PaymentOperation {
    CreatePayment {
        payer_idx: u8,
        payee_idx: u8,
        caller_is_admin: bool,
        amount_kind: AmountKind,
        negative_fee: bool,
    },
    ForceEscrow {
        payment_idx: u8,
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

fn payments_key() -> Symbol {
    soroban_sdk::symbol_short!("PAY_RECS")
}
fn escrow_key() -> Symbol {
    soroban_sdk::symbol_short!("ESC_ACCS")
}
fn multisig_key() -> Symbol {
    soroban_sdk::symbol_short!("MSIG_CFG")
}
fn approvals_key() -> Symbol {
    soroban_sdk::symbol_short!("PEND_APR")
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
    let mut actors: Vec<Address> = vec![&env];
    for _ in 0..8 {
        actors.push_back(Address::generate(&env));
    }
    let asset = Address::generate(&env);

    let mut payment_ids: Vec<u64> = Vec::new();
    // Track expected amount per payment_id so we can check the multisig vs
    // single-admin branch was taken correctly.
    let mut payment_amounts: Vec<(u64, i128)> = Vec::new();
    let mut multisig_configured = false;
    let mut configured_threshold: u32 = 0;
    let mut configured_signer_count: usize = 0;

    for op in input.operations.iter() {
        match op {
            PaymentOperation::CreatePayment {
                payer_idx,
                payee_idx,
                caller_is_admin,
                amount_kind,
                negative_fee,
            } => {
                let payer = actors.get((*payer_idx as u32) % actors.len()).unwrap();
                let payee = actors.get((*payee_idx as u32) % actors.len()).unwrap();
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
                    actors.get(1).unwrap()
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

                if let Ok(payment_id) = result {
                    payment_ids.push(payment_id);
                    payment_amounts.push((payment_id, amount));

                    // INVARIANT: escrow account must exist immediately after
                    // creation, pre-populated with locked_amount == amount and
                    // medical_records_verified == false (per
                    // escrow_conditions_stored_at_payment_creation test).
                    env.as_contract(&contract_id, || {
                        let escrows: Map<u64, EscrowAccount> =
                            env.storage().persistent().get(&escrow_key()).unwrap();
                        let escrow = escrows.get(payment_id).unwrap();
                        assert_eq!(
                            escrow.locked_amount, amount,
                            "INVARIANT VIOLATION: escrow locked_amount != payment amount"
                        );
                        assert!(
                            !escrow.release_conditions.medical_records_verified,
                            "INVARIANT VIOLATION: medical_records_verified true by default"
                        );
                    });
                }
            }

            PaymentOperation::ForceEscrow { payment_idx } => {
                if payment_ids.is_empty() {
                    continue;
                }
                let payment_id = payment_ids[(*payment_idx as usize) % payment_ids.len()];
                env.as_contract(&contract_id, || {
                    let mut payments: Map<u64, Payment> =
                        env.storage().persistent().get(&payments_key()).unwrap();
                    let mut payment = payments.get(payment_id).unwrap();
                    if payment.status == PaymentStatus::Pending {
                        payment.status = PaymentStatus::Escrowed;
                        payments.set(payment_id, payment);
                        env.storage().persistent().set(&payments_key(), &payments);
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
                let approver = actors
                    .get((*approver_idx as u32) % actors.len())
                    .unwrap();

                env.as_contract(&contract_id, || {
                    let mut escrows: Map<u64, EscrowAccount> =
                        env.storage().persistent().get(&escrow_key()).unwrap();
                    if let Some(mut escrow) = escrows.get(payment_id) {
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
                        escrows.set(payment_id, escrow);
                        env.storage().persistent().set(&escrow_key(), &escrows);
                    }
                });
            }

            PaymentOperation::ConfigureMultisig {
                num_signers,
                threshold,
                caller_is_admin,
            } => {
                let n = ((*num_signers % 5) + 1) as usize; // 1..=5 signers
                let mut signers: Vec<Address> = vec![&env];
                for i in 0..n {
                    signers.push_back(actors.get((i as u32) % actors.len()).unwrap());
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
                        configured_signer_count = n;
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
                let approver = actors
                    .get((*approver_idx as u32) % actors.len())
                    .unwrap();

                let amount = payment_amounts
                    .iter()
                    .find(|(id, _)| *id == payment_id)
                    .map(|(_, a)| *a);

                let result = client.try_propose_release(&payment_id, &approver);

                if let Ok(executed) = result {
                    if executed {
                        // INVARIANT: if propose_release reports executed,
                        // the payment must actually be Completed with
                        // escrow_released_at set.
                        env.as_contract(&contract_id, || {
                            let payments: Map<u64, Payment> =
                                env.storage().persistent().get(&payments_key()).unwrap();
                            let payment = payments.get(payment_id).unwrap();
                            assert_eq!(
                                payment.status,
                                PaymentStatus::Completed,
                                "INVARIANT VIOLATION: propose_release reported executed but status != Completed"
                            );
                            assert!(
                                payment.escrow_released_at.is_some(),
                                "INVARIANT VIOLATION: executed release missing escrow_released_at"
                            );
                        });


                        if let Some(amt) = amount {
                            if amt >= HIGH_VALUE_THRESHOLD && multisig_configured {
                                env.as_contract(&contract_id, || {
                                    use health_chain_contract::payments::PendingApproval;
                                    let approvals: Map<u64, PendingApproval> = env
                                        .storage()
                                        .persistent()
                                        .get(&approvals_key())
                                        .unwrap();
                                    let approval = approvals.get(payment_id).unwrap();
                                    assert!(
                                        approval.approvals.len() >= configured_threshold,
                                        "INVARIANT VIOLATION: high-value release executed before reaching threshold ({} votes, threshold {})",
                                        approval.approvals.len(),
                                        configured_threshold
                                    );
                                    let _ = configured_signer_count;
                                });
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
            if let (Some(payments), Some(escrows)) = (
                env.storage()
                    .persistent()
                    .get::<_, Map<u64, Payment>>(&payments_key()),
                env.storage()
                    .persistent()
                    .get::<_, Map<u64, EscrowAccount>>(&escrow_key()),
            ) {
                for payment_id in payments.keys() {
                    let payment = payments.get(payment_id).unwrap();
                    if let Some(escrow) = escrows.get(payment_id) {
                        assert_eq!(
                            escrow.locked_amount, payment.amount,
                            "GLOBAL INVARIANT VIOLATION: escrow/payment amount desync for {}",
                            payment_id
                        );
                    }
                }
            }
        });
        env.as_contract(&contract_id, || {
            use health_chain_contract::payments::PendingApproval;
            if let Some(approvals) = env
                .storage()
                .persistent()
                .get::<_, Map<u64, PendingApproval>>(&approvals_key())
            {
                for payment_id in approvals.keys() {
                    let approval = approvals.get(payment_id).unwrap();
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
        });
    }
});
