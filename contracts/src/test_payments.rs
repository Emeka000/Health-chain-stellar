#![cfg(test)]

use crate::payments::{
    EscrowAccount, FeeStructure, Payment, PaymentError, PaymentStatus, ReleaseConditions,
    TransactionMetadata,
};

use soroban_sdk::{testutils::Address as _, vec, Address, Env, Symbol};

fn payment_with_status(env: &Env, status: PaymentStatus) -> Payment {
    Payment {
        id: 1,
        request_id: 10,
        payer: Address::generate(env),
        payee: Address::generate(env),
        amount: 1_000,
        asset: Address::generate(env),
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

    let dispute = Dispute {
        id: 1,
        payment_id: 10,
        raised_by: raiser,
        status: DisputeStatus::Open,
        reason: Symbol::new(&env, "delayed"),
        evidence_hash: Symbol::new(&env, "hash123"),
        raised_at: 1000,
        resolved_at: None,
    };

    assert_eq!(dispute.status, DisputeStatus::Open);
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
    let fees = FeeStructure {
        service_fee: 10,
        network_fee: 5,
        performance_bonus: 5,
    };

    assert_eq!(fees.total(), 20);
    assert_eq!(fees.calculate_net_amount(1_000).unwrap(), 980);
}

#[test]
fn fees_cannot_exceed_payment_amount() {
    let fees = FeeStructure {
        service_fee: 600,
        network_fee: 300,
        performance_bonus: 200,
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
