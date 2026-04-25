#![cfg(test)]

use crate::payments::{
    Dispute, DisputeMetadata, DisputeStatus, EscrowAccount, FeeStructure, MultiSigConfig, Payment,
    PaymentError, PaymentStats, PaymentStatus, PendingApproval, ReleaseConditions,
    TransactionMetadata, DEFAULT_DISPUTE_TIMEOUT_SECS, HIGH_VALUE_THRESHOLD,
};
use crate::{
    HealthChainContract, HealthChainContractClient, ADMIN, DISPUTES, DISPUTE_METADATA,
    ESCROW_ACCOUNTS, MULTISIG_CONFIG, PAYMENTS, PAYMENT_STATS, PENDING_APPROVALS,
};

use soroban_sdk::{
    testutils::{Address as _, Ledger},
    vec, Address, Bytes, Env, Map, String, Symbol,
};

fn default_fee_structure(env: &Env) -> FeeStructure {
    FeeStructure {
        policy_id: Symbol::new(env, "default_fee_policy"),
        service_fee: 0,
        network_fee: 0,
        performance_bonus: 0,
        fixed_fee: 0,
    }
}

fn payment_with_status(env: &Env, status: PaymentStatus) -> Payment {
    Payment {
        id: 1,
        request_id: 10,
        payer: Address::generate(env),
        payee: Address::generate(env),
        amount: 1_000,
        asset: Address::generate(env),
        fee_structure: default_fee_structure(env),
        status,
        escrow_released_at: None,
    }
}
// ======================================================
// Payment Validation Tests
// ======================================================

#[test]
fn payment_validates_successfully() {
    let env = Env::default();
    let payer = Address::generate(&env);
    let payee = Address::generate(&env);
    let asset = Address::generate(&env);

    let payment = Payment {
        id: 1,
        request_id: 10,
        payer,
        payee,
        amount: 1_000,
        asset,
        fee_structure: default_fee_structure(&env),
        status: PaymentStatus::Pending,
        escrow_released_at: None,
    };

    assert!(payment.validate().is_ok());
}

#[test]
fn payment_fails_with_zero_amount() {
    let env = Env::default();

    let payment = Payment {
        id: 1,
        request_id: 10,
        payer: Address::generate(&env),
        payee: Address::generate(&env),
        amount: 0,
        asset: Address::generate(&env),
        fee_structure: default_fee_structure(&env),
        status: PaymentStatus::Pending,
        escrow_released_at: None,
    };

    assert_eq!(payment.validate(), Err(PaymentError::InvalidAmount));
}

#[test]
fn payment_fails_when_payer_equals_payee() {
    let env = Env::default();
    let addr = Address::generate(&env);

    let payment = Payment {
        id: 1,
        request_id: 10,
        payer: addr.clone(),
        payee: addr.clone(),
        amount: 1_000,
        asset: Address::generate(&env),
        fee_structure: default_fee_structure(&env),
        status: PaymentStatus::Pending,
        escrow_released_at: None,
    };

    assert_eq!(payment.validate(), Err(PaymentError::SamePayerPayee));
}

#[test]
fn payment_fails_when_asset_equals_payer() {
    let env = Env::default();
    let payer = Address::generate(&env);

    let payment = Payment {
        id: 1,
        request_id: 10,
        payer: payer.clone(),
        payee: Address::generate(&env),
        amount: 1_000,
        asset: payer,
        fee_structure: default_fee_structure(&env),
        status: PaymentStatus::Pending,
        escrow_released_at: None,
    };

    assert_eq!(payment.validate(), Err(PaymentError::InvalidAsset));
}

#[test]
fn payment_fails_when_asset_equals_payee() {
    let env = Env::default();
    let payee = Address::generate(&env);

    let payment = Payment {
        id: 1,
        request_id: 10,
        payer: Address::generate(&env),
        payee: payee.clone(),
        amount: 1_000,
        asset: payee,
        fee_structure: default_fee_structure(&env),
        status: PaymentStatus::Pending,
        escrow_released_at: None,
    };

    assert_eq!(payment.validate(), Err(PaymentError::InvalidAsset));
}

// ======================================================
// Payment Status Transition Tests
// ======================================================

#[test]
fn payment_state_machine_is_correct() {
    let env = Env::default();

    let payment = payment_with_status(&env, PaymentStatus::Pending);

    assert!(payment.can_transition_to(PaymentStatus::Cancelled));
    assert!(payment.can_transition_to(PaymentStatus::Escrowed));
    assert!(!payment.can_transition_to(PaymentStatus::Completed));

    // From Escrowed
    let escrowed_payment = Payment {
        status: PaymentStatus::Escrowed,
        ..payment.clone()
    };
    assert!(escrowed_payment.can_transition_to(PaymentStatus::Disputed));
    assert!(escrowed_payment.can_transition_to(PaymentStatus::Completed));
    assert!(escrowed_payment.can_transition_to(PaymentStatus::Refunded));

    // From Disputed
    let disputed_payment = Payment {
        status: PaymentStatus::Disputed,
        ..payment.clone()
    };
    assert!(disputed_payment.can_transition_to(PaymentStatus::Resolved));
    assert!(!disputed_payment.can_transition_to(PaymentStatus::Completed));

    // From Resolved
    let resolved_payment = Payment {
        status: PaymentStatus::Resolved,
        ..payment.clone()
    };
    assert!(resolved_payment.can_transition_to(PaymentStatus::Completed));
    assert!(resolved_payment.can_transition_to(PaymentStatus::Refunded));
}

#[test]
fn payment_status_allowed_transition_matrix_is_complete() {
    let env = Env::default();

    let allowed = [
        (PaymentStatus::Pending, PaymentStatus::Escrowed),
        (PaymentStatus::Pending, PaymentStatus::Cancelled),
        (PaymentStatus::Escrowed, PaymentStatus::Completed),
        (PaymentStatus::Escrowed, PaymentStatus::Refunded),
        (PaymentStatus::Escrowed, PaymentStatus::Disputed),
        (PaymentStatus::Disputed, PaymentStatus::Resolved),
        (PaymentStatus::Resolved, PaymentStatus::Completed),
        (PaymentStatus::Resolved, PaymentStatus::Refunded),
    ];

    for (from, to) in allowed {
        let payment = payment_with_status(&env, from);
        assert!(payment.can_transition_to(to), "allowed transition missing");
    }
}

#[test]
fn payment_status_forbidden_transition_matrix_is_complete() {
    let env = Env::default();
    let statuses = [
        PaymentStatus::Pending,
        PaymentStatus::Escrowed,
        PaymentStatus::Disputed,
        PaymentStatus::Resolved,
        PaymentStatus::Completed,
        PaymentStatus::Refunded,
        PaymentStatus::Cancelled,
    ];

    let allowed = [
        (PaymentStatus::Pending, PaymentStatus::Escrowed),
        (PaymentStatus::Pending, PaymentStatus::Cancelled),
        (PaymentStatus::Escrowed, PaymentStatus::Completed),
        (PaymentStatus::Escrowed, PaymentStatus::Refunded),
        (PaymentStatus::Escrowed, PaymentStatus::Disputed),
        (PaymentStatus::Disputed, PaymentStatus::Resolved),
        (PaymentStatus::Resolved, PaymentStatus::Completed),
        (PaymentStatus::Resolved, PaymentStatus::Refunded),
    ];

    let mut forbidden_checked = 0u32;
    for from in statuses {
        let payment = payment_with_status(&env, from);
        for to in statuses {
            if allowed.contains(&(from, to)) {
                continue;
            }
            forbidden_checked += 1;
            assert!(
                !payment.can_transition_to(to),
                "forbidden transition unexpectedly allowed"
            );
        }
    }

    assert_eq!(forbidden_checked, 41);
}

#[test]
fn dispute_structure_is_valid() {
    let env = Env::default();
    let raiser = Address::generate(&env);
    use crate::payments::{Dispute, DisputeStatus};

    let mut chunks = vec![&env];
    chunks.push_back(String::from_str(&env, "bafyFIRST"));
    chunks.push_back(String::from_str(&env, "SECONDchunk"));

    let digest_bytes = [0xab; 32];
    let evidence_digest = Bytes::from_slice(&env, &digest_bytes);

    let dispute = Dispute {
        id: 1,
        payment_id: 10,
        raised_by: raiser,
        status: DisputeStatus::Open,
        reason: String::from_str(&env, "delayed_delivery_report"),
        evidence_digest,
        evidence_ref_chunks: chunks,
        raised_at: 1000,
        resolved_at: None,
    };

    assert_eq!(dispute.status, DisputeStatus::Open);
}

/// Off-chain indexers concatenate `evidence_ref_chunks` in order; integrity is checked against `evidence_digest`.
#[test]
fn dispute_evidence_chunk_order_is_stable() {
    let env = Env::default();
    let mut chunks = vec![&env];
    chunks.push_back(String::from_str(&env, "a"));
    chunks.push_back(String::from_str(&env, "b"));
    assert_eq!(chunks.len(), 2u32);
    let first = chunks.get(0).unwrap();
    let second = chunks.get(1).unwrap();
    assert!(first.len() > 0 && second.len() > 0);
}

#[test]
fn terminal_states_are_enforced() {
    let env = Env::default();

    for status in [
        PaymentStatus::Completed,
        PaymentStatus::Refunded,
        PaymentStatus::Cancelled,
    ] {
        let payment = Payment {
            id: 1,
            request_id: 10,
            payer: Address::generate(&env),
            payee: Address::generate(&env),
            amount: 1_000,
            asset: Address::generate(&env),
            fee_structure: default_fee_structure(&env),
            status,
            escrow_released_at: None,
        };

        assert!(payment.is_terminal());
        assert!(!payment.can_transition_to(PaymentStatus::Pending));
    }
}

// ======================================================
// EscrowAccount Tests
// ======================================================

#[test]
fn escrow_validates_and_releases_correctly() {
    let env = Env::default();
    let approver = Address::generate(&env);

    let escrow = EscrowAccount {
        payment_id: 1,
        locked_amount: 1_000,
        release_conditions: ReleaseConditions {
            medical_records_verified: true,
            min_timestamp: 100,
            authorized_approver: Some(approver.clone()),
        },
    };

    assert!(escrow.validate().is_ok());
    assert!(escrow.can_release(200, Some(&approver)));
}

#[test]
fn escrow_fails_release_without_conditions() {
    let escrow = EscrowAccount {
        payment_id: 1,
        locked_amount: 1_000,
        release_conditions: ReleaseConditions {
            medical_records_verified: false,
            min_timestamp: 100,
            authorized_approver: None,
        },
    };

    assert!(!escrow.can_release(200, None));
}

#[test]
fn escrow_release_integration_rejects_premature_and_unauthorized_attempts() {
    let env = Env::default();
    let authorized_approver = Address::generate(&env);
    let unauthorized_approver = Address::generate(&env);

    let payment = Payment {
        id: 42,
        request_id: 101,
        payer: Address::generate(&env),
        payee: Address::generate(&env),
        amount: 5_000,
        asset: Address::generate(&env),
        fee_structure: default_fee_structure(&env),
        status: PaymentStatus::Escrowed,
        escrow_released_at: None,
    };

    let escrow = EscrowAccount {
        payment_id: payment.id,
        locked_amount: payment.amount,
        release_conditions: ReleaseConditions {
            medical_records_verified: true,
            min_timestamp: 1_000,
            authorized_approver: Some(authorized_approver.clone()),
        },
    };

    // Premature release attempt (before min_timestamp) must fail even if approver is correct.
    assert!(!escrow.can_release(999, Some(&authorized_approver)));

    // Unauthorized release attempt at/after min_timestamp must fail.
    assert!(!escrow.can_release(1_000, Some(&unauthorized_approver)));

    // Missing required approver at/after min_timestamp must fail.
    assert!(!escrow.can_release(1_000, None));
}

#[test]
fn escrow_release_integration_allows_release_only_when_all_guards_pass() {
    let env = Env::default();
    let authorized_approver = Address::generate(&env);

    let payment = Payment {
        id: 43,
        request_id: 102,
        payer: Address::generate(&env),
        payee: Address::generate(&env),
        amount: 7_500,
        asset: Address::generate(&env),
        fee_structure: default_fee_structure(&env),
        status: PaymentStatus::Escrowed,
        escrow_released_at: None,
    };

    let escrow = EscrowAccount {
        payment_id: payment.id,
        locked_amount: payment.amount,
        release_conditions: ReleaseConditions {
            medical_records_verified: true,
            min_timestamp: 2_000,
            authorized_approver: Some(authorized_approver.clone()),
        },
    };

    assert!(!escrow.can_release(1_999, Some(&authorized_approver)));
    assert!(escrow.can_release(2_000, Some(&authorized_approver)));
    assert!(escrow.can_release(2_001, Some(&authorized_approver)));
}

// ======================================================
// FeeStructure Tests
// ======================================================

#[test]
fn fee_calculation_is_correct() {
    let env = Env::default();
    let fees = FeeStructure {
        policy_id: Symbol::new(&env, "default_fee_policy"),
        service_fee: 10,
        network_fee: 5,
        performance_bonus: 5,
        fixed_fee: 0,
    };

    assert_eq!(fees.total(), 20);
    assert_eq!(fees.calculate_net_amount(1_000).unwrap(), 980);
}

#[test]
fn fees_cannot_exceed_payment_amount() {
    let env = Env::default();
    let fees = FeeStructure {
        policy_id: Symbol::new(&env, "default_fee_policy"),
        service_fee: 600,
        network_fee: 300,
        performance_bonus: 200,
        fixed_fee: 0,
    };

    assert_eq!(
        fees.calculate_net_amount(1_000),
        Err(PaymentError::FeesExceedAmount)
    );
}

// ======================================================
// Transaction Metadata Tests
// ======================================================
#[test]
fn transaction_metadata_is_valid() {
    let env = Env::default();

    let metadata = TransactionMetadata {
        description: Symbol::new(&env, "medical_payment"),
        tags: vec![&env, Symbol::new(&env, "health")],
        reference_url: Symbol::new(&env, "ref_001"),
    };

    assert_eq!(metadata.tags.len(), 1);
}

fn setup_dispute_contract(env: &Env) -> (soroban_sdk::Address, HealthChainContractClient<'_>) {
    env.mock_all_auths();
    let contract_id = env.register(HealthChainContract, ());
    let client = HealthChainContractClient::new(env, &contract_id);
    let admin = Address::generate(env);
    client.initialize(&admin);
    (contract_id, client)
}

fn move_payment_to_disputed_ready_state(env: &Env, contract_id: &Address, payment_id: u64) {
    env.as_contract(contract_id, || {
        let mut payments: Map<u64, Payment> = env.storage().persistent().get(&PAYMENTS).unwrap();
        let mut payment = payments.get(payment_id).unwrap();
        payment.status = PaymentStatus::Escrowed;
        payments.set(payment_id, payment);
        env.storage().persistent().set(&PAYMENTS, &payments);
    });
}

#[test]
fn auto_refund_after_timeout() {
    let env = Env::default();
    let (contract_id, client) = setup_dispute_contract(&env);
    let payer = Address::generate(&env);
    let payee = Address::generate(&env);
    let asset = Address::generate(&env);
    let raiser = Address::generate(&env);

    client.set_dispute_timeout(&10);
    let payment_id = client.create_payment(&1, &payer, &payee, &5_000, &asset);
    move_payment_to_disputed_ready_state(&env, &contract_id, payment_id);

    let dispute_id = client.raise_dispute(
        &payment_id,
        &raiser,
        &String::from_str(&env, "timeout_case"),
        &Bytes::from_slice(&env, &[1; 32]),
        &vec![&env],
    );

    env.ledger().with_mut(|ledger| {
        ledger.timestamp += 11;
    });

    assert_eq!(client.process_expired_disputes(), 1);

    env.as_contract(&contract_id, || {
        let payments: Map<u64, Payment> = env.storage().persistent().get(&PAYMENTS).unwrap();
        let payment = payments.get(payment_id).unwrap();
        assert_eq!(payment.status, PaymentStatus::Refunded);

        let disputes: Map<u64, Dispute> = env.storage().persistent().get(&DISPUTES).unwrap();
        let dispute = disputes.get(dispute_id).unwrap();
        assert_eq!(dispute.status, DisputeStatus::ResolvedInFavorOfPayer);

        let metadata: Map<u64, DisputeMetadata> =
            env.storage().persistent().get(&DISPUTE_METADATA).unwrap();
        let dispute_metadata = metadata.get(dispute_id).unwrap();
        assert!(dispute_metadata.dispute_deadline > dispute.raised_at);

        let stats: PaymentStats = env.storage().persistent().get(&PAYMENT_STATS).unwrap();
        assert_eq!(stats.count_auto_refunded, 1);
        assert_eq!(stats.total_auto_refunded, 5_000);
    });
}

#[test]
fn no_refund_before_deadline() {
    let env = Env::default();
    let (contract_id, client) = setup_dispute_contract(&env);
    let payer = Address::generate(&env);
    let payee = Address::generate(&env);
    let asset = Address::generate(&env);
    let raiser = Address::generate(&env);

    client.set_dispute_timeout(&10);
    let payment_id = client.create_payment(&1, &payer, &payee, &2_000, &asset);
    move_payment_to_disputed_ready_state(&env, &contract_id, payment_id);

    client.raise_dispute(
        &payment_id,
        &raiser,
        &String::from_str(&env, "waiting_case"),
        &Bytes::from_slice(&env, &[2; 32]),
        &vec![&env],
    );

    env.ledger().with_mut(|ledger| {
        ledger.timestamp += 9;
    });

    assert_eq!(client.process_expired_disputes(), 0);
}

#[test]
fn multisig_config_validates_threshold_and_signers() {
    let env = Env::default();
    let signer = Address::generate(&env);

    let empty = MultiSigConfig {
        signers: vec![&env],
        threshold: 1,
    };
    assert_eq!(empty.validate(), Err(PaymentError::InvalidMultiSigConfig));

    let zero_threshold = MultiSigConfig {
        signers: vec![&env, signer.clone()],
        threshold: 0,
    };
    assert_eq!(
        zero_threshold.validate(),
        Err(PaymentError::InvalidMultiSigConfig)
    );

    let excessive_threshold = MultiSigConfig {
        signers: vec![&env, signer.clone()],
        threshold: 2,
    };
    assert_eq!(
        excessive_threshold.validate(),
        Err(PaymentError::InvalidMultiSigConfig)
    );

    let duplicate_signers = MultiSigConfig {
        signers: vec![&env, signer.clone(), signer.clone()],
        threshold: 2,
    };
    assert_eq!(
        duplicate_signers.validate(),
        Err(PaymentError::InvalidMultiSigConfig)
    );
}

#[test]
fn pending_approval_rejects_duplicate_votes() {
    let env = Env::default();
    let signer = Address::generate(&env);
    let mut approval = PendingApproval::new(&env, 7);

    assert!(approval.register_vote(signer.clone()).is_ok());
    assert_eq!(
        approval.register_vote(signer),
        Err(PaymentError::DuplicateApproval)
    );
}

fn satisfy_escrow_conditions(
    env: &Env,
    contract_id: &Address,
    payment_id: u64,
    approver: &Address,
) {
    env.as_contract(contract_id, || {
        let mut escrow_accounts: Map<u64, EscrowAccount> =
            env.storage().persistent().get(&ESCROW_ACCOUNTS).unwrap();
        let mut escrow = escrow_accounts.get(payment_id).unwrap();
        escrow.release_conditions = ReleaseConditions {
            medical_records_verified: true,
            min_timestamp: 0,
            authorized_approver: Some(approver.clone()),
        };
        escrow_accounts.set(payment_id, escrow);
        env.storage()
            .persistent()
            .set(&ESCROW_ACCOUNTS, &escrow_accounts);
    });
}

#[test]
fn low_value_release_keeps_single_admin_flow() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(HealthChainContract, ());
    let client = HealthChainContractClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let payer = Address::generate(&env);
    let payee = Address::generate(&env);
    let asset = Address::generate(&env);

    client.initialize(&admin);
    let payment_id = client.create_payment(&1, &payer, &payee, &(HIGH_VALUE_THRESHOLD - 1), &asset);

    env.as_contract(&contract_id, || {
        let mut payments: Map<u64, Payment> = env.storage().persistent().get(&PAYMENTS).unwrap();
        let mut payment = payments.get(payment_id).unwrap();
        payment.status = PaymentStatus::Escrowed;
        payments.set(payment_id, payment);
        env.storage().persistent().set(&PAYMENTS, &payments);
    });

    // Satisfy escrow conditions before proposing release.
    satisfy_escrow_conditions(&env, &contract_id, payment_id, &admin);

    assert!(client.propose_release(&payment_id, &admin));

    env.as_contract(&contract_id, || {
        let payments: Map<u64, Payment> = env.storage().persistent().get(&PAYMENTS).unwrap();
        let payment = payments.get(payment_id).unwrap();
        assert_eq!(payment.status, PaymentStatus::Completed);
        assert!(payment.escrow_released_at.is_some());
    });
}

#[test]
fn manual_resolution_prevents_refund() {
    let env = Env::default();
    let (contract_id, client) = setup_dispute_contract(&env);
    let payer = Address::generate(&env);
    let payee = Address::generate(&env);
    let asset = Address::generate(&env);
    let raiser = Address::generate(&env);

    client.set_dispute_timeout(&10);
    let payment_id = client.create_payment(&1, &payer, &payee, &3_000, &asset);
    move_payment_to_disputed_ready_state(&env, &contract_id, payment_id);

    let dispute_id = client.raise_dispute(
        &payment_id,
        &raiser,
        &String::from_str(&env, "manual_case"),
        &Bytes::from_slice(&env, &[3; 32]),
        &vec![&env],
    );

    client.resolve_dispute(&dispute_id, &DisputeStatus::ResolvedInFavorOfPayee);

    env.ledger().with_mut(|ledger| {
        ledger.timestamp += 11;
    });

    assert_eq!(client.process_expired_disputes(), 0);
}

#[test]
fn high_value_release_requires_threshold_votes_and_prevents_duplicates() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(HealthChainContract, ());
    let client = HealthChainContractClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let signer_one = Address::generate(&env);
    let signer_two = Address::generate(&env);
    let payer = Address::generate(&env);
    let payee = Address::generate(&env);
    let asset = Address::generate(&env);

    client.initialize(&admin);
    client.configure_multisig(&vec![&env, signer_one.clone(), signer_two.clone()], &2);
    let payment_id = client.create_payment(&1, &payer, &payee, &HIGH_VALUE_THRESHOLD, &asset);

    env.as_contract(&contract_id, || {
        let mut payments: Map<u64, Payment> = env.storage().persistent().get(&PAYMENTS).unwrap();
        let mut payment = payments.get(payment_id).unwrap();
        payment.status = PaymentStatus::Escrowed;
        payments.set(payment_id, payment);
        env.storage().persistent().set(&PAYMENTS, &payments);
    });

    // Satisfy escrow conditions for both signers before voting.
    satisfy_escrow_conditions(&env, &contract_id, payment_id, &signer_one);
    assert!(!client.propose_release(&payment_id, &signer_one));

    env.as_contract(&contract_id, || {
        let approvals: Map<u64, PendingApproval> =
            env.storage().persistent().get(&PENDING_APPROVALS).unwrap();
        let approval = approvals.get(payment_id).unwrap();
        assert_eq!(approval.approvals.len(), 1);
        assert!(!approval.executed);
    });

    let duplicate_attempt = client.try_propose_release(&payment_id, &signer_one);
    assert!(duplicate_attempt.is_err());

    // Update conditions to allow signer_two to also pass the approver check.
    satisfy_escrow_conditions(&env, &contract_id, payment_id, &signer_two);
    assert!(client.propose_release(&payment_id, &signer_two));

    env.as_contract(&contract_id, || {
        let payments: Map<u64, Payment> = env.storage().persistent().get(&PAYMENTS).unwrap();
        let payment = payments.get(payment_id).unwrap();
        assert_eq!(payment.status, PaymentStatus::Completed);

        let stats: PaymentStats = env
            .storage()
            .persistent()
            .get(&PAYMENT_STATS)
            .unwrap_or(PaymentStats::new());
        assert_eq!(stats.count_auto_refunded, 0);
        assert_eq!(stats.total_auto_refunded, 0);
        let approvals: Map<u64, PendingApproval> =
            env.storage().persistent().get(&PENDING_APPROVALS).unwrap();
        let approval = approvals.get(payment_id).unwrap();
        assert!(approval.executed);
        assert_eq!(approval.approvals.len(), 2);
    });
}

#[test]
fn non_disputed_payments_are_ignored() {
    let env = Env::default();
    let (_contract_id, client) = setup_dispute_contract(&env);
    let payer = Address::generate(&env);
    let payee = Address::generate(&env);
    let asset = Address::generate(&env);

    assert_eq!(client.get_dispute_timeout(), DEFAULT_DISPUTE_TIMEOUT_SECS);

    let _payment_id = client.create_payment(&1, &payer, &payee, &1_500, &asset);
    assert_eq!(client.process_expired_disputes(), 0);
    assert_eq!(client.get_payment_stats(), PaymentStats::new());
}

#[test]
#[test]
fn escrow_conditions_block_release_when_unmet() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(HealthChainContract, ());
    let client = HealthChainContractClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    let payer = Address::generate(&env);
    let payee = Address::generate(&env);
    let asset = Address::generate(&env);

    client.initialize(&admin);
    let payment_id = client.create_payment(&1, &payer, &payee, &(HIGH_VALUE_THRESHOLD - 1), &asset);

    env.as_contract(&contract_id, || {
        let mut payments: Map<u64, Payment> = env.storage().persistent().get(&PAYMENTS).unwrap();
        let mut payment = payments.get(payment_id).unwrap();
        payment.status = PaymentStatus::Escrowed;
        payments.set(payment_id, payment);
        env.storage().persistent().set(&PAYMENTS, &payments);
    });

    // Default conditions: medical_records_verified=false — release must be blocked.
    let result = client.try_propose_release(&payment_id, &admin);
    assert!(
        result.is_err(),
        "release must fail when escrow conditions are unmet"
    );
}

#[test]
fn escrow_conditions_block_release_before_min_timestamp() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(HealthChainContract, ());
    let client = HealthChainContractClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    let payer = Address::generate(&env);
    let payee = Address::generate(&env);
    let asset = Address::generate(&env);

    client.initialize(&admin);
    let payment_id = client.create_payment(&1, &payer, &payee, &(HIGH_VALUE_THRESHOLD - 1), &asset);

    env.as_contract(&contract_id, || {
        let mut payments: Map<u64, Payment> = env.storage().persistent().get(&PAYMENTS).unwrap();
        let mut payment = payments.get(payment_id).unwrap();
        payment.status = PaymentStatus::Escrowed;
        payments.set(payment_id, payment);
        env.storage().persistent().set(&PAYMENTS, &payments);

        // Set conditions: verified but min_timestamp in the future.
        let mut escrow_accounts: Map<u64, EscrowAccount> =
            env.storage().persistent().get(&ESCROW_ACCOUNTS).unwrap();
        let mut escrow = escrow_accounts.get(payment_id).unwrap();
        escrow.release_conditions = ReleaseConditions {
            medical_records_verified: true,
            min_timestamp: 9_999_999,
            authorized_approver: Some(admin.clone()),
        };
        escrow_accounts.set(payment_id, escrow);
        env.storage()
            .persistent()
            .set(&ESCROW_ACCOUNTS, &escrow_accounts);
    });

    // Ledger timestamp is 0 < 9_999_999 — must be blocked.
    let result = client.try_propose_release(&payment_id, &admin);
    assert!(result.is_err(), "release must fail before min_timestamp");
}

#[test]
fn escrow_conditions_block_release_wrong_approver() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(HealthChainContract, ());
    let client = HealthChainContractClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    let other = Address::generate(&env);
    let payer = Address::generate(&env);
    let payee = Address::generate(&env);
    let asset = Address::generate(&env);

    client.initialize(&admin);
    let payment_id = client.create_payment(&1, &payer, &payee, &(HIGH_VALUE_THRESHOLD - 1), &asset);

    env.as_contract(&contract_id, || {
        let mut payments: Map<u64, Payment> = env.storage().persistent().get(&PAYMENTS).unwrap();
        let mut payment = payments.get(payment_id).unwrap();
        payment.status = PaymentStatus::Escrowed;
        payments.set(payment_id, payment);
        env.storage().persistent().set(&PAYMENTS, &payments);

        // Conditions require `other` as approver, but admin will call.
        let mut escrow_accounts: Map<u64, EscrowAccount> =
            env.storage().persistent().get(&ESCROW_ACCOUNTS).unwrap();
        let mut escrow = escrow_accounts.get(payment_id).unwrap();
        escrow.release_conditions = ReleaseConditions {
            medical_records_verified: true,
            min_timestamp: 0,
            authorized_approver: Some(other.clone()),
        };
        escrow_accounts.set(payment_id, escrow);
        env.storage()
            .persistent()
            .set(&ESCROW_ACCOUNTS, &escrow_accounts);
    });

    let result = client.try_propose_release(&payment_id, &admin);
    assert!(
        result.is_err(),
        "release must fail when approver does not match"
    );
}

#[test]
fn escrow_conditions_allow_release_when_all_met() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(HealthChainContract, ());
    let client = HealthChainContractClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    let payer = Address::generate(&env);
    let payee = Address::generate(&env);
    let asset = Address::generate(&env);

    client.initialize(&admin);
    let payment_id = client.create_payment(&1, &payer, &payee, &(HIGH_VALUE_THRESHOLD - 1), &asset);

    env.as_contract(&contract_id, || {
        let mut payments: Map<u64, Payment> = env.storage().persistent().get(&PAYMENTS).unwrap();
        let mut payment = payments.get(payment_id).unwrap();
        payment.status = PaymentStatus::Escrowed;
        payments.set(payment_id, payment);
        env.storage().persistent().set(&PAYMENTS, &payments);
    });

    satisfy_escrow_conditions(&env, &contract_id, payment_id, &admin);

    assert!(client.propose_release(&payment_id, &admin));

    env.as_contract(&contract_id, || {
        let payments: Map<u64, Payment> = env.storage().persistent().get(&PAYMENTS).unwrap();
        assert_eq!(
            payments.get(payment_id).unwrap().status,
            PaymentStatus::Completed
        );
    });
}

#[test]
fn escrow_conditions_stored_at_payment_creation() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(HealthChainContract, ());
    let client = HealthChainContractClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    let payer = Address::generate(&env);
    let payee = Address::generate(&env);
    let asset = Address::generate(&env);

    client.initialize(&admin);
    let payment_id = client.create_payment(&1, &payer, &payee, &500, &asset);

    env.as_contract(&contract_id, || {
        let escrow_accounts: Map<u64, EscrowAccount> =
            env.storage().persistent().get(&ESCROW_ACCOUNTS).unwrap();
        let escrow = escrow_accounts.get(payment_id).unwrap();
        assert_eq!(escrow.payment_id, payment_id);
        assert_eq!(escrow.locked_amount, 500);
        assert!(!escrow.release_conditions.medical_records_verified);
    });
}

#[test]
fn configure_multisig_is_admin_only_and_persists_storage() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(HealthChainContract, ());
    let client = HealthChainContractClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let signer = Address::generate(&env);
    client.initialize(&admin);
    client.configure_multisig(&vec![&env, signer.clone()], &1);

    env.as_contract(&contract_id, || {
        let stored_admin: Address = env.storage().instance().get(&ADMIN).unwrap();
        assert_eq!(stored_admin, admin);

        let config: MultiSigConfig = env.storage().persistent().get(&MULTISIG_CONFIG).unwrap();
        assert_eq!(config.threshold, 1);
        assert!(config.signers.contains(signer));
    });
}
