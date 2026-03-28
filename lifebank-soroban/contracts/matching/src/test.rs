/// Tests for the blood matching algorithm.
///
/// These tests exercise the pure matching logic directly (no cross-contract
/// calls) so they run fast and deterministically without a full Soroban
/// environment. Contract-level integration tests follow at the bottom.
#[cfg(test)]
mod pure_matching {
    use soroban_sdk::Env;

    use crate::matching::{
        compatible_donor_types, is_compatible, score_unit, select_units, sort_by_expiration,
    };
    use crate::types::{BloodStatus, BloodType, BloodUnit, MatchKind, Urgency};

    // ── Helpers ──────────────────────────────────────────────────────────────

    fn env() -> Env {
        Env::default()
    }

    fn make_unit(
        env: &Env,
        id: u64,
        blood_type: BloodType,
        quantity_ml: u32,
        expiration_timestamp: u64,
    ) -> BloodUnit {
        BloodUnit {
            id,
            blood_type,
            quantity_ml,
            bank_id: soroban_sdk::Address::generate(env),
            donor_id: None,
            donation_timestamp: 0,
            expiration_timestamp,
            status: BloodStatus::Available,
            metadata: soroban_sdk::Map::new(env),
        }
    }

    fn make_unit_with_status(
        env: &Env,
        id: u64,
        blood_type: BloodType,
        quantity_ml: u32,
        expiration_timestamp: u64,
        status: BloodStatus,
    ) -> BloodUnit {
        BloodUnit {
            id,
            blood_type,
            quantity_ml,
            bank_id: soroban_sdk::Address::generate(env),
            donor_id: None,
            donation_timestamp: 0,
            expiration_timestamp,
            status,
            metadata: soroban_sdk::Map::new(env),
        }
    }

    // ── ABO / Rh compatibility matrix ────────────────────────────────────────

    #[test]
    fn o_negative_is_universal_donor() {
        use BloodType::*;
        let all = [
            APositive, ANegative, BPositive, BNegative,
            ABPositive, ABNegative, OPositive, ONegative,
        ];
        for recipient in all {
            assert!(
                is_compatible(ONegative, recipient),
                "O- should donate to {:?}",
                recipient
            );
        }
    }

    #[test]
    fn ab_positive_is_universal_recipient() {
        use BloodType::*;
        let all = [
            APositive, ANegative, BPositive, BNegative,
            ABPositive, ABNegative, OPositive, ONegative,
        ];
        for donor in all {
            assert!(
                is_compatible(donor, ABPositive),
                "{:?} should donate to AB+",
                donor
            );
        }
    }

    #[test]
    fn rh_positive_cannot_donate_to_rh_negative() {
        use BloodType::*;
        // Rh+ donors cannot give to Rh- recipients (except O- universal donor)
        assert!(!is_compatible(OPositive, ONegative));
        assert!(!is_compatible(APositive, ANegative));
        assert!(!is_compatible(BPositive, BNegative));
        assert!(!is_compatible(ABPositive, ABNegative));
    }

    #[test]
    fn rh_negative_can_donate_to_same_rh_positive() {
        use BloodType::*;
        assert!(is_compatible(ANegative, APositive));
        assert!(is_compatible(BNegative, BPositive));
        assert!(is_compatible(ABNegative, ABPositive));
    }

    #[test]
    fn incompatible_abo_groups_rejected() {
        use BloodType::*;
        assert!(!is_compatible(APositive, BPositive));
        assert!(!is_compatible(BPositive, APositive));
        assert!(!is_compatible(APositive, OPositive));
        assert!(!is_compatible(BPositive, OPositive));
    }

    #[test]
    fn compatible_donor_types_o_negative_only_receives_o_negative() {
        let env = env();
        let types = compatible_donor_types(&env, BloodType::ONegative);
        assert_eq!(types.len(), 1);
        assert_eq!(types.get(0).unwrap(), BloodType::ONegative);
    }

    #[test]
    fn compatible_donor_types_ab_positive_receives_all_eight() {
        let env = env();
        let types = compatible_donor_types(&env, BloodType::ABPositive);
        assert_eq!(types.len(), 8);
    }

    #[test]
    fn compatible_donor_types_a_positive_receives_four() {
        let env = env();
        let types = compatible_donor_types(&env, BloodType::APositive);
        // A+, A-, O+, O-
        assert_eq!(types.len(), 4);
        assert_eq!(types.get(0).unwrap(), BloodType::APositive); // exact first
    }

    #[test]
    fn compatible_donor_types_first_element_is_always_exact_match() {
        let env = env();
        use BloodType::*;
        let all = [
            APositive, ANegative, BPositive, BNegative,
            ABPositive, ABNegative, OPositive, ONegative,
        ];
        for bt in all {
            let types = compatible_donor_types(&env, bt);
            assert_eq!(
                types.get(0).unwrap(),
                bt,
                "First compatible type for {:?} should be itself",
                bt
            );
        }
    }

    // ── FIFO sort ────────────────────────────────────────────────────────────

    #[test]
    fn sort_by_expiration_orders_oldest_first() {
        let env = env();
        let mut units = soroban_sdk::Vec::new(&env);
        units.push_back(make_unit(&env, 1, BloodType::APositive, 450, 3000));
        units.push_back(make_unit(&env, 2, BloodType::APositive, 450, 1000));
        units.push_back(make_unit(&env, 3, BloodType::APositive, 450, 2000));

        sort_by_expiration(&mut units);

        assert_eq!(units.get(0).unwrap().id, 2); // expires at 1000
        assert_eq!(units.get(1).unwrap().id, 3); // expires at 2000
        assert_eq!(units.get(2).unwrap().id, 1); // expires at 3000
    }

    #[test]
    fn sort_by_expiration_stable_on_equal_timestamps() {
        let env = env();
        let mut units = soroban_sdk::Vec::new(&env);
        units.push_back(make_unit(&env, 1, BloodType::OPositive, 450, 1000));
        units.push_back(make_unit(&env, 2, BloodType::OPositive, 450, 1000));

        sort_by_expiration(&mut units);

        // Both have same expiry — order preserved (insertion sort is stable)
        assert_eq!(units.get(0).unwrap().id, 1);
        assert_eq!(units.get(1).unwrap().id, 2);
    }

    #[test]
    fn sort_by_expiration_single_element_unchanged() {
        let env = env();
        let mut units = soroban_sdk::Vec::new(&env);
        units.push_back(make_unit(&env, 42, BloodType::BNegative, 300, 9999));
        sort_by_expiration(&mut units);
        assert_eq!(units.get(0).unwrap().id, 42);
    }

    // ── Scoring ──────────────────────────────────────────────────────────────

    #[test]
    fn exact_match_scores_higher_than_compatible() {
        let env = env();
        let exact_unit = make_unit(&env, 1, BloodType::APositive, 450, 86_400 * 5); // 5 days
        let compat_unit = make_unit(&env, 2, BloodType::ONegative, 450, 86_400 * 5);

        let exact_score = score_unit(&exact_unit, BloodType::APositive, Urgency::Routine, None, 0);
        let compat_score = score_unit(&compat_unit, BloodType::APositive, Urgency::Routine, None, 0);

        assert!(
            exact_score > compat_score,
            "exact={} should beat compatible={}",
            exact_score,
            compat_score
        );
    }

    #[test]
    fn expiring_soon_scores_higher_than_fresh() {
        let env = env();
        let expiring = make_unit(&env, 1, BloodType::OPositive, 450, 86_400 * 2); // 2 days
        let fresh    = make_unit(&env, 2, BloodType::OPositive, 450, 86_400 * 60); // 60 days

        let s_expiring = score_unit(&expiring, BloodType::OPositive, Urgency::Routine, None, 0);
        let s_fresh    = score_unit(&fresh,    BloodType::OPositive, Urgency::Routine, None, 0);

        assert!(s_expiring > s_fresh);
    }

    #[test]
    fn critical_urgency_scores_higher_than_scheduled() {
        let env = env();
        let unit = make_unit(&env, 1, BloodType::BPositive, 450, 86_400 * 10);

        let s_critical  = score_unit(&unit, BloodType::BPositive, Urgency::Critical,  None, 0);
        let s_scheduled = score_unit(&unit, BloodType::BPositive, Urgency::Scheduled, None, 0);

        assert!(s_critical > s_scheduled);
    }

    // ── select_units ─────────────────────────────────────────────────────────

    #[test]
    fn exact_match_preferred_over_compatible() {
        let env = env();
        let mut candidates = soroban_sdk::Vec::new(&env);
        // Compatible unit expires sooner (would win on FIFO alone)
        candidates.push_back(make_unit(&env, 1, BloodType::ONegative, 450, 1000));
        // Exact match expires later
        candidates.push_back(make_unit(&env, 2, BloodType::APositive, 450, 9000));

        let result = select_units(
            &env,
            candidates,
            BloodType::APositive,
            Urgency::Routine,
            450,
            None,
            0,
        );

        assert_eq!(result.len(), 1);
        assert_eq!(result.get(0).unwrap().unit_id, 2); // exact match wins
        assert_eq!(result.get(0).unwrap().match_kind, MatchKind::Exact);
    }

    #[test]
    fn fifo_within_exact_tier() {
        let env = env();
        let mut candidates = soroban_sdk::Vec::new(&env);
        candidates.push_back(make_unit(&env, 1, BloodType::APositive, 450, 5000)); // newer
        candidates.push_back(make_unit(&env, 2, BloodType::APositive, 450, 1000)); // older

        let result = select_units(
            &env,
            candidates,
            BloodType::APositive,
            Urgency::Routine,
            450,
            None,
            0,
        );

        assert_eq!(result.len(), 1);
        assert_eq!(result.get(0).unwrap().unit_id, 2); // oldest expiry first
    }

    #[test]
    fn fifo_within_compatible_tier() {
        let env = env();
        let mut candidates = soroban_sdk::Vec::new(&env);
        candidates.push_back(make_unit(&env, 1, BloodType::ONegative, 450, 8000));
        candidates.push_back(make_unit(&env, 2, BloodType::ONegative, 450, 2000));

        let result = select_units(
            &env,
            candidates,
            BloodType::APositive, // O- is compatible with A+
            Urgency::Routine,
            450,
            None,
            0,
        );

        assert_eq!(result.len(), 1);
        assert_eq!(result.get(0).unwrap().unit_id, 2); // oldest first
    }

    #[test]
    fn partial_matching_returns_available_volume() {
        let env = env();
        let mut candidates = soroban_sdk::Vec::new(&env);
        candidates.push_back(make_unit(&env, 1, BloodType::BPositive, 300, 1000));

        // Request 600 ml but only 300 available
        let result = select_units(
            &env,
            candidates,
            BloodType::BPositive,
            Urgency::Urgent,
            600,
            None,
            0,
        );

        assert_eq!(result.len(), 1);
        assert_eq!(result.get(0).unwrap().quantity_ml, 300);
    }

    #[test]
    fn partial_matching_across_multiple_units() {
        let env = env();
        let mut candidates = soroban_sdk::Vec::new(&env);
        candidates.push_back(make_unit(&env, 1, BloodType::OPositive, 200, 1000));
        candidates.push_back(make_unit(&env, 2, BloodType::OPositive, 200, 2000));
        candidates.push_back(make_unit(&env, 3, BloodType::OPositive, 200, 3000));

        // Request 500 ml — needs 3 units but last one only partially used
        let result = select_units(
            &env,
            candidates,
            BloodType::OPositive,
            Urgency::Critical,
            500,
            None,
            0,
        );

        assert_eq!(result.len(), 3);
        let total: u32 = (0..result.len()).map(|i| result.get(i).unwrap().quantity_ml).sum();
        assert_eq!(total, 500);
        assert_eq!(result.get(2).unwrap().quantity_ml, 100); // last unit partially used
    }

    #[test]
    fn non_available_units_are_excluded() {
        let env = env();
        let mut candidates = soroban_sdk::Vec::new(&env);
        candidates.push_back(make_unit_with_status(
            &env, 1, BloodType::ABNegative, 450, 1000, BloodStatus::Reserved,
        ));
        candidates.push_back(make_unit_with_status(
            &env, 2, BloodType::ABNegative, 450, 2000, BloodStatus::Expired,
        ));
        candidates.push_back(make_unit(
            &env, 3, BloodType::ABNegative, 450, 3000, // Available
        ));

        let result = select_units(
            &env,
            candidates,
            BloodType::ABNegative,
            Urgency::Routine,
            450,
            None,
            0,
        );

        assert_eq!(result.len(), 1);
        assert_eq!(result.get(0).unwrap().unit_id, 3);
    }

    #[test]
    fn no_candidates_returns_empty() {
        let env = env();
        let candidates = soroban_sdk::Vec::new(&env);

        let result = select_units(
            &env,
            candidates,
            BloodType::ABPositive,
            Urgency::Critical,
            900,
            None,
            0,
        );

        assert_eq!(result.len(), 0);
    }

    #[test]
    fn exact_match_exhausted_falls_back_to_compatible() {
        let env = env();
        let mut candidates = soroban_sdk::Vec::new(&env);
        // 200 ml exact
        candidates.push_back(make_unit(&env, 1, BloodType::APositive, 200, 1000));
        // 300 ml compatible
        candidates.push_back(make_unit(&env, 2, BloodType::ONegative, 300, 2000));

        let result = select_units(
            &env,
            candidates,
            BloodType::APositive,
            Urgency::Urgent,
            500,
            None,
            0,
        );

        assert_eq!(result.len(), 2);
        assert_eq!(result.get(0).unwrap().match_kind, MatchKind::Exact);
        assert_eq!(result.get(1).unwrap().match_kind, MatchKind::Compatible);
        let total: u32 = (0..result.len()).map(|i| result.get(i).unwrap().quantity_ml).sum();
        assert_eq!(total, 500);
    }

    #[test]
    fn request_fully_satisfied_stops_early() {
        let env = env();
        let mut candidates = soroban_sdk::Vec::new(&env);
        candidates.push_back(make_unit(&env, 1, BloodType::BNegative, 450, 1000));
        candidates.push_back(make_unit(&env, 2, BloodType::BNegative, 450, 2000));
        candidates.push_back(make_unit(&env, 3, BloodType::BNegative, 450, 3000));

        // Only need 450 ml
        let result = select_units(
            &env,
            candidates,
            BloodType::BNegative,
            Urgency::Routine,
            450,
            None,
            0,
        );

        assert_eq!(result.len(), 1);
        assert_eq!(result.get(0).unwrap().unit_id, 1); // oldest first
    }

    // ── Multi-request urgency ordering ───────────────────────────────────────

    #[test]
    fn urgency_priority_values_are_ordered() {
        assert!(Urgency::Critical.priority() > Urgency::Urgent.priority());
        assert!(Urgency::Urgent.priority() > Urgency::Routine.priority());
        assert!(Urgency::Routine.priority() > Urgency::Scheduled.priority());
    }
}

// ---------------------------------------------------------------------------
// Contract-level integration tests
// ---------------------------------------------------------------------------
#[cfg(test)]
mod contract_tests {
    use soroban_sdk::{
        testutils::Address as _,
        Address, Env,
    };

    use crate::{BloodType, MatchingContract, MatchingContractClient, MatchingError};

    fn setup<'a>() -> (Env, MatchingContractClient<'a>, Address, Address, Address) {
        let env = Env::default();
        env.mock_all_auths();

        let contract_id = env.register(MatchingContract, ());
        let client = MatchingContractClient::new(&env, &contract_id);

        let admin = Address::generate(&env);
        let inventory = Address::generate(&env);
        let requests = Address::generate(&env);

        client.initialize(&admin, &inventory, &requests);

        (env, client, admin, inventory, requests)
    }

    #[test]
    fn initialize_sets_state() {
        let (env, client, admin, _inv, _req) = setup();
        assert!(client.is_initialized());
        assert_eq!(client.get_admin(), admin);
    }

    #[test]
    #[should_panic(expected = "Error(Contract, #600)")]
    fn double_initialize_panics() {
        let (env, client, admin, inv, req) = setup();
        client.initialize(&admin, &inv, &req);
    }

    #[test]
    fn get_compatible_types_o_negative() {
        let (_env, client, ..) = setup();
        let types = client.get_compatible_types(&BloodType::ONegative);
        assert_eq!(types.len(), 1);
        assert_eq!(types.get(0).unwrap(), BloodType::ONegative);
    }

    #[test]
    fn get_compatible_types_ab_positive_all_eight() {
        let (_env, client, ..) = setup();
        let types = client.get_compatible_types(&BloodType::ABPositive);
        assert_eq!(types.len(), 8);
    }

    #[test]
    fn check_compatibility_o_neg_to_all() {
        let (_env, client, ..) = setup();
        use BloodType::*;
        for recipient in [APositive, ANegative, BPositive, BNegative,
                          ABPositive, ABNegative, OPositive, ONegative] {
            assert!(client.check_compatibility(&ONegative, &recipient));
        }
    }

    #[test]
    fn check_compatibility_a_pos_cannot_donate_to_b_pos() {
        let (_env, client, ..) = setup();
        assert!(!client.check_compatibility(&BloodType::APositive, &BloodType::BPositive));
    }

    #[test]
    #[should_panic(expected = "Error(Contract, #601)")]
    fn match_request_before_init_panics() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(MatchingContract, ());
        let client = MatchingContractClient::new(&env, &contract_id);
        client.match_request(&1);
    }
}
