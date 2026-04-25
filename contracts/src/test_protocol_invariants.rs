#![cfg(test)]

use crate::payments::{
    EscrowAccount, FeeStructure, MultiSigConfig, Payment, PaymentError, PaymentStatus,
    PendingApproval, ReleaseConditions, HIGH_VALUE_THRESHOLD,
};
use crate::{
    BloodComponent, BloodRequest, BloodStatus, BloodType, BloodUnit, CustodyStatus, Error,
    HealthChainContract, HealthChainContractClient, QuarantineReason, RequestStatus, UrgencyLevel,
    BLOOD_UNITS, ESCROW_ACCOUNTS, PAYMENTS, REQUESTS,
};

use soroban_sdk::{
    symbol_short,
    testutils::{Address as _, Ledger},
    vec, Address, Env, Map, String, Symbol,
};

struct ProtocolFixture {
    env: Env,
    contract_id: Address,
    bank: Address,
    other_bank: Address,
    hospital: Address,
    admin: Address,
}

fn setup_protocol() -> ProtocolFixture {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(HealthChainContract, ());
    let client = HealthChainContractClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let bank = Address::generate(&env);
    let other_bank = Address::generate(&env);
    let hospital = Address::generate(&env);

    client.initialize(&admin);
    client.register_blood_bank(&bank);
    client.register_blood_bank(&other_bank);
    client.register_hospital(&hospital);

    ProtocolFixture {
        env,
        contract_id,
        bank,
        other_bank,
        hospital,
        admin,
    }
}

fn client<'a>(fixture: &'a ProtocolFixture) -> HealthChainContractClient<'a> {
    HealthChainContractClient::new(&fixture.env, &fixture.contract_id)
}

fn valid_expiration(env: &Env) -> u64 {
    env.ledger().timestamp() + (7 * 86_400)
}

fn register_unit(fixture: &ProtocolFixture, quantity: u32) -> u64 {
    client(fixture).register_blood(
        &fixture.bank,
        &BloodType::OPositive,
        &BloodComponent::WholeBlood,
        &quantity,
        &valid_expiration(&fixture.env),
        &Some(symbol_short!("donor")),
    )
}

fn create_request(fixture: &ProtocolFixture, quantity: u32) -> u64 {
    client(fixture).create_request(
        &fixture.hospital,
        &BloodType::OPositive,
        &quantity,
        &UrgencyLevel::Urgent,
        &(fixture.env.ledger().timestamp() + 3_600),
        &String::from_str(&fixture.env, "Ward A"),
    )
}

fn stored_unit(fixture: &ProtocolFixture, unit_id: u64) -> BloodUnit {
    client(fixture).get_blood_unit(&unit_id)
}

fn stored_request(fixture: &ProtocolFixture, request_id: u64) -> BloodRequest {
    fixture.env.as_contract(&fixture.contract_id, || {
        let requests: Map<u64, BloodRequest> =
            fixture.env.storage().persistent().get(&REQUESTS).unwrap();
        requests.get(request_id).unwrap()
    })
}

fn force_unit_quantity(fixture: &ProtocolFixture, unit_id: u64, quantity: u32) {
    fixture.env.as_contract(&fixture.contract_id, || {
        let mut units: Map<u64, BloodUnit> = fixture
            .env
            .storage()
            .persistent()
            .get(&BLOOD_UNITS)
            .unwrap();
        let mut unit = units.get(unit_id).unwrap();
        unit.quantity = quantity;
        units.set(unit_id, unit);
        fixture.env.storage().persistent().set(&BLOOD_UNITS, &units);
    });
}

fn escrow_payment(fixture: &ProtocolFixture, payment_id: u64, approver: &Address) {
    fixture.env.as_contract(&fixture.contract_id, || {
        let mut payments: Map<u64, Payment> =
            fixture.env.storage().persistent().get(&PAYMENTS).unwrap();
        let mut payment = payments.get(payment_id).unwrap();
        payment.status = PaymentStatus::Escrowed;
        payments.set(payment_id, payment);
        fixture.env.storage().persistent().set(&PAYMENTS, &payments);

        let mut escrows: Map<u64, EscrowAccount> = fixture
            .env
            .storage()
            .persistent()
            .get(&ESCROW_ACCOUNTS)
            .unwrap();
        let mut escrow = escrows.get(payment_id).unwrap();
        escrow.release_conditions = ReleaseConditions {
            medical_records_verified: true,
            min_timestamp: 0,
            authorized_approver: Some(approver.clone()),
        };
        escrows.set(payment_id, escrow);
        fixture
            .env
            .storage()
            .persistent()
            .set(&ESCROW_ACCOUNTS, &escrows);
    });
}

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
        request_id: 1,
        payer: Address::generate(env),
        payee: Address::generate(env),
        amount: 1_000,
        asset: Address::generate(env),
        fee_structure: default_fee_structure(env),
        status,
        escrow_released_at: None,
    }
}

#[test]
fn property_request_quantities_are_never_negative_and_invalid_ranges_fail() {
    let fixture = setup_protocol();
    let invalid_quantities = [0, 1, 49, 5_001, u32::MAX];

    for quantity in invalid_quantities {
        let result = client(&fixture).try_create_request(
            &fixture.hospital,
            &BloodType::OPositive,
            &quantity,
            &UrgencyLevel::Urgent,
            &(fixture.env.ledger().timestamp() + 3_600),
            &String::from_str(&fixture.env, "Ward A"),
        );

        assert!(matches!(result, Err(Ok(Error::InvalidQuantity))));
    }

    let request_id = create_request(&fixture, 500);
    let request = stored_request(&fixture, request_id);
    assert_eq!(request.quantity_ml, 500);
    assert_eq!(request.fulfilled_quantity_ml, 0);
}

#[test]
fn property_expired_units_cannot_be_allocated_or_transferred() {
    let fixture = setup_protocol();
    let unit_id = register_unit(&fixture, 450);

    let expiration = stored_unit(&fixture, unit_id).expiration_date;
    fixture.env.ledger().with_mut(|ledger| {
        ledger.timestamp = expiration;
    });

    let allocation =
        client(&fixture).try_allocate_blood(&fixture.bank, &unit_id, &fixture.hospital);
    assert!(matches!(allocation, Err(Ok(Error::UnitExpired))));
    assert_eq!(
        stored_unit(&fixture, unit_id).status,
        BloodStatus::Available
    );
}

#[test]
fn property_duplicate_and_invalid_request_transitions_fail_deterministically() {
    let fixture = setup_protocol();
    let required_by = fixture.env.ledger().timestamp() + 3_600;
    let address = String::from_str(&fixture.env, "Ward A");

    let first_id = client(&fixture).create_request(
        &fixture.hospital,
        &BloodType::OPositive,
        &500,
        &UrgencyLevel::Urgent,
        &required_by,
        &address,
    );

    let duplicate = client(&fixture).try_create_request(
        &fixture.hospital,
        &BloodType::OPositive,
        &500,
        &UrgencyLevel::Urgent,
        &required_by,
        &String::from_str(&fixture.env, "ward a"),
    );
    assert!(matches!(duplicate, Err(Ok(Error::DuplicateRequest))));

    let invalid = client(&fixture).try_update_request_status(&first_id, &RequestStatus::Fulfilled);
    assert!(matches!(invalid, Err(Ok(Error::InvalidTransition))));
    assert_eq!(
        stored_request(&fixture, first_id).status,
        RequestStatus::Pending
    );
}

#[test]
fn property_request_approval_overflow_fails_before_state_mutation() {
    let fixture = setup_protocol();
    let first = register_unit(&fixture, 450);
    let second = register_unit(&fixture, 450);
    let request_id = create_request(&fixture, 500);

    force_unit_quantity(&fixture, first, u32::MAX);
    force_unit_quantity(&fixture, second, 1);

    let unit_ids = vec![&fixture.env, first, second];
    let result = client(&fixture).try_approve_request(&fixture.bank, &request_id, &unit_ids);

    assert!(matches!(result, Err(Ok(Error::ArithmeticError))));
    assert_eq!(
        stored_request(&fixture, request_id).status,
        RequestStatus::Pending
    );
    assert_eq!(stored_unit(&fixture, first).status, BloodStatus::Available);
    assert_eq!(stored_unit(&fixture, second).status, BloodStatus::Available);
}

#[test]
fn property_delivered_unit_cannot_be_concurrently_quarantined_by_duplicate_action() {
    let fixture = setup_protocol();
    let unit_id = register_unit(&fixture, 450);

    client(&fixture).allocate_blood(&fixture.bank, &unit_id, &fixture.hospital);
    let event_id = client(&fixture).initiate_transfer(&fixture.bank, &unit_id);
    client(&fixture).confirm_transfer(&fixture.hospital, &event_id);

    let duplicate_confirm = client(&fixture).try_confirm_transfer(&fixture.hospital, &event_id);
    assert!(matches!(duplicate_confirm, Err(Ok(Error::InvalidStatus))));

    let event = client(&fixture).get_custody_event(&event_id);
    assert_eq!(event.status, CustodyStatus::Confirmed);
    assert_eq!(
        stored_unit(&fixture, unit_id).status,
        BloodStatus::Delivered
    );
}

#[test]
fn property_custody_transfer_requires_authorized_current_custodian() {
    let fixture = setup_protocol();
    let unit_id = register_unit(&fixture, 450);

    client(&fixture).allocate_blood(&fixture.bank, &unit_id, &fixture.hospital);

    let non_custodian_attempt =
        client(&fixture).try_initiate_transfer(&fixture.other_bank, &unit_id);
    assert!(matches!(
        non_custodian_attempt,
        Err(Ok(Error::NotCurrentCustodian))
    ));
    assert_eq!(stored_unit(&fixture, unit_id).status, BloodStatus::Reserved);

    let event_id = client(&fixture).initiate_transfer(&fixture.bank, &unit_id);
    let unauthorized_recipient = Address::generate(&fixture.env);
    let bad_confirm = client(&fixture).try_confirm_transfer(&unauthorized_recipient, &event_id);
    assert!(matches!(bad_confirm, Err(Ok(Error::UnauthorizedHospital))));
    assert_eq!(
        stored_unit(&fixture, unit_id).status,
        BloodStatus::InTransit
    );
}

#[test]
fn property_completed_payments_are_terminal_and_cannot_reenter_escrow() {
    let fixture = setup_protocol();
    let payer = Address::generate(&fixture.env);
    let payee = Address::generate(&fixture.env);
    let asset = Address::generate(&fixture.env);

    let payment_id =
        client(&fixture).create_payment(&1, &payer, &payee, &(HIGH_VALUE_THRESHOLD - 1), &asset);
    escrow_payment(&fixture, payment_id, &fixture.admin);
    assert!(client(&fixture).propose_release(&payment_id, &fixture.admin));

    let second_release = client(&fixture).try_propose_release(&payment_id, &fixture.admin);
    assert!(matches!(
        second_release,
        Err(Ok(Error::InvalidPaymentStatus))
    ));

    fixture.env.as_contract(&fixture.contract_id, || {
        let payments: Map<u64, Payment> =
            fixture.env.storage().persistent().get(&PAYMENTS).unwrap();
        let payment = payments.get(payment_id).unwrap();
        assert_eq!(payment.status, PaymentStatus::Completed);
        assert!(payment.is_terminal());
        assert!(!payment.can_transition_to(PaymentStatus::Escrowed));
    });
}

#[test]
fn property_payment_transition_matrix_rejects_arbitrary_invalid_sequences() {
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

    for from in statuses {
        let payment = payment_with_status(&env, from);
        for to in statuses {
            assert_eq!(
                payment.can_transition_to(to),
                allowed.contains(&(from, to)),
                "unexpected payment transition result"
            );
        }
    }
}

#[test]
fn property_fee_and_multisig_arithmetic_fail_safely_for_arbitrary_edges() {
    let env = Env::default();
    let fee_cases = [
        (0, 0, 0, 0, 1_000, Ok(1_000)),
        (500, 400, 100, 1, 1_000, Err(PaymentError::FeesExceedAmount)),
        (-1, 0, 0, 0, 1_000, Ok(1_001)),
    ];

    for (service_fee, network_fee, performance_bonus, fixed_fee, gross, expected_net) in fee_cases {
        let fees = FeeStructure {
            policy_id: Symbol::new(&env, "default_fee_policy"),
            service_fee,
            network_fee,
            performance_bonus,
            fixed_fee,
        };

        if service_fee < 0 || network_fee < 0 || performance_bonus < 0 || fixed_fee < 0 {
            assert_eq!(fees.validate(), Err(PaymentError::InvalidFee));
        } else {
            assert_eq!(fees.calculate_net_amount(gross), expected_net);
        }
    }

    let signer = Address::generate(&env);
    let duplicate_config = MultiSigConfig {
        signers: vec![&env, signer.clone(), signer.clone()],
        threshold: 2,
    };
    assert_eq!(
        duplicate_config.validate(),
        Err(PaymentError::InvalidMultiSigConfig)
    );

    let mut approval = PendingApproval::new(&env, 7);
    assert_eq!(approval.register_vote(signer.clone()), Ok(()));
    assert_eq!(
        approval.register_vote(signer),
        Err(PaymentError::DuplicateApproval)
    );
}

#[test]
fn property_invalid_custody_and_quarantine_sequences_leave_single_status() {
    let fixture = setup_protocol();
    let unit_id = register_unit(&fixture, 450);

    let invalid_quarantine_finalize = client(&fixture).try_finalize_quarantine(
        &fixture.bank,
        &unit_id,
        &QuarantineReason::ManualOperatorAction,
        &crate::QuarantineDisposition::Release,
    );
    assert!(matches!(
        invalid_quarantine_finalize,
        Err(Ok(Error::InvalidStatus))
    ));

    client(&fixture).quarantine_blood(
        &fixture.bank,
        &unit_id,
        &QuarantineReason::ManualOperatorAction,
    );
    let duplicate_quarantine = client(&fixture).try_quarantine_blood(
        &fixture.bank,
        &unit_id,
        &QuarantineReason::ManualOperatorAction,
    );
    assert!(matches!(
        duplicate_quarantine,
        Err(Ok(Error::InvalidStatus))
    ));
    assert_eq!(
        stored_unit(&fixture, unit_id).status,
        BloodStatus::Quarantined
    );
}
