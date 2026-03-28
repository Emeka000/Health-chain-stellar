/// Pure matching logic — no Env I/O, fully deterministic, unit-testable.
///
/// Design decisions:
/// - Exact matches are always preferred over compatible matches.
/// - Within each tier, units are sorted by expiration_timestamp ascending (FIFO)
///   so the oldest blood is consumed first, minimising waste.
/// - Urgency shifts the score so that high-urgency requests rank their matches
///   higher when results from multiple requests are compared externally.
/// - Partial matching is supported: if total available volume < requested, we
///   return whatever we found rather than failing.
use soroban_sdk::{Env, Vec};

use crate::types::{BloodStatus, BloodType, BloodUnit, MatchKind, MatchedUnit, Urgency};

// ---------------------------------------------------------------------------
// ABO / Rh compatibility
// ---------------------------------------------------------------------------

/// Returns the ordered list of blood types that can donate to `recipient`.
///
/// The first element is always the exact match; subsequent elements are
/// compatible donors ordered from most-preferred to least-preferred
/// (Rh-negative before Rh-positive to preserve rare O- stock).
pub fn compatible_donor_types(env: &Env, recipient: BloodType) -> Vec<BloodType> {
    let mut types = Vec::new(env);
    match recipient {
        BloodType::OPositive => {
            types.push_back(BloodType::OPositive);
            types.push_back(BloodType::ONegative);
        }
        BloodType::ONegative => {
            types.push_back(BloodType::ONegative);
        }
        BloodType::APositive => {
            types.push_back(BloodType::APositive);
            types.push_back(BloodType::ANegative);
            types.push_back(BloodType::OPositive);
            types.push_back(BloodType::ONegative);
        }
        BloodType::ANegative => {
            types.push_back(BloodType::ANegative);
            types.push_back(BloodType::ONegative);
        }
        BloodType::BPositive => {
            types.push_back(BloodType::BPositive);
            types.push_back(BloodType::BNegative);
            types.push_back(BloodType::OPositive);
            types.push_back(BloodType::ONegative);
        }
        BloodType::BNegative => {
            types.push_back(BloodType::BNegative);
            types.push_back(BloodType::ONegative);
        }
        BloodType::ABPositive => {
            types.push_back(BloodType::ABPositive);
            types.push_back(BloodType::ABNegative);
            types.push_back(BloodType::APositive);
            types.push_back(BloodType::ANegative);
            types.push_back(BloodType::BPositive);
            types.push_back(BloodType::BNegative);
            types.push_back(BloodType::OPositive);
            types.push_back(BloodType::ONegative);
        }
        BloodType::ABNegative => {
            types.push_back(BloodType::ABNegative);
            types.push_back(BloodType::ANegative);
            types.push_back(BloodType::BNegative);
            types.push_back(BloodType::ONegative);
        }
    }
    types
}

/// Returns true if `donor` can safely donate to `recipient`.
pub fn is_compatible(donor: BloodType, recipient: BloodType) -> bool {
    // O- is universal donor
    if donor == BloodType::ONegative {
        return true;
    }
    // AB+ is universal recipient
    if recipient == BloodType::ABPositive {
        return true;
    }
    use BloodType::*;
    match (donor, recipient) {
        (OPositive,  OPositive | APositive | BPositive | ABPositive) => true,
        (ANegative,  ANegative | APositive | ABNegative | ABPositive) => true,
        (APositive,  APositive | ABPositive) => true,
        (BNegative,  BNegative | BPositive | ABNegative | ABPositive) => true,
        (BPositive,  BPositive | ABPositive) => true,
        (ABNegative, ABNegative | ABPositive) => true,
        (ABPositive, ABPositive) => true,
        _ => false,
    }
}

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------

/// Composite score for a candidate unit against a request.
///
/// Score components (all additive):
/// | Component          | Max pts | Rationale                              |
/// |--------------------|---------|----------------------------------------|
/// | Exact blood type   |  40     | Preserve rare compatible stock         |
/// | Expiration urgency |  30     | FIFO — use oldest first                |
/// | Request urgency    |  20     | Critical requests get better units     |
/// | Proximity tier     |  10     | Same bank_id = 0 km proxy              |
///
/// Higher score = better candidate.
pub fn score_unit(
    unit: &BloodUnit,
    request_blood_type: BloodType,
    request_urgency: Urgency,
    request_bank_id_hint: Option<&soroban_sdk::Address>,
    now_timestamp: u64,
) -> u32 {
    let mut score: u32 = 0;

    // 1. Exact match bonus
    if unit.blood_type == request_blood_type {
        score += 40;
    }

    // 2. Expiration urgency (FIFO) — units expiring sooner score higher
    let secs_until_expiry = unit
        .expiration_timestamp
        .saturating_sub(now_timestamp);
    let days_until_expiry = secs_until_expiry / 86_400;
    score += match days_until_expiry {
        0..=3   => 30,
        4..=7   => 25,
        8..=14  => 18,
        15..=30 => 10,
        _       => 4,
    };

    // 3. Request urgency weight
    score += request_urgency.priority() * 5; // 5, 10, 15, or 20

    // 4. Proximity — same bank as the requesting hospital hint
    if let Some(hint) = request_bank_id_hint {
        if &unit.bank_id == hint {
            score += 10;
        }
    }

    score
}

// ---------------------------------------------------------------------------
// Insertion sort (no_std, Soroban Vec)
// ---------------------------------------------------------------------------

/// Sort `units` in-place by expiration_timestamp ascending (oldest first).
/// Uses insertion sort — acceptable for the small slices expected in practice.
pub fn sort_by_expiration(units: &mut Vec<BloodUnit>) {
    let len = units.len();
    if len <= 1 {
        return;
    }
    for i in 1..len {
        let mut j = i;
        while j > 0 {
            let a = units.get(j - 1).unwrap();
            let b = units.get(j).unwrap();
            if a.expiration_timestamp > b.expiration_timestamp {
                units.set(j - 1, b);
                units.set(j, a);
                j -= 1;
            } else {
                break;
            }
        }
    }
}

// ---------------------------------------------------------------------------
// Core matching
// ---------------------------------------------------------------------------

/// Select units from `candidates` to satisfy `needed_ml`, returning a Vec of
/// `MatchedUnit` with scores attached.
///
/// Strategy:
/// 1. Filter to `Available` units only.
/// 2. Separate into exact-match and compatible-match buckets.
/// 3. Sort each bucket by expiration ascending (FIFO).
/// 4. Drain exact bucket first, then compatible bucket.
/// 5. Support partial matching — stop when `needed_ml` is satisfied or
///    candidates are exhausted.
pub fn select_units(
    env: &Env,
    candidates: Vec<BloodUnit>,
    request_blood_type: BloodType,
    request_urgency: Urgency,
    needed_ml: u32,
    bank_hint: Option<&soroban_sdk::Address>,
    now_timestamp: u64,
) -> Vec<MatchedUnit> {
    // Partition into exact / compatible buckets
    let mut exact: Vec<BloodUnit> = Vec::new(env);
    let mut compatible: Vec<BloodUnit> = Vec::new(env);

    for i in 0..candidates.len() {
        let unit = candidates.get(i).unwrap();
        if unit.status != BloodStatus::Available {
            continue;
        }
        if unit.blood_type == request_blood_type {
            exact.push_back(unit);
        } else if is_compatible(unit.blood_type, request_blood_type) {
            compatible.push_back(unit);
        }
    }

    // FIFO within each bucket
    sort_by_expiration(&mut exact);
    sort_by_expiration(&mut compatible);

    let mut result: Vec<MatchedUnit> = Vec::new(env);
    let mut remaining = needed_ml;

    // Drain exact matches first
    for i in 0..exact.len() {
        if remaining == 0 {
            break;
        }
        let unit = exact.get(i).unwrap();
        let taken = if unit.quantity_ml <= remaining {
            unit.quantity_ml
        } else {
            remaining
        };
        let s = score_unit(&unit, request_blood_type, request_urgency, bank_hint, now_timestamp);
        result.push_back(MatchedUnit {
            unit_id: unit.id,
            blood_type: unit.blood_type,
            quantity_ml: taken,
            bank_id: unit.bank_id.clone(),
            expiration_timestamp: unit.expiration_timestamp,
            score: s,
            match_kind: MatchKind::Exact,
        });
        remaining -= taken;
    }

    // Then compatible matches
    for i in 0..compatible.len() {
        if remaining == 0 {
            break;
        }
        let unit = compatible.get(i).unwrap();
        let taken = if unit.quantity_ml <= remaining {
            unit.quantity_ml
        } else {
            remaining
        };
        let s = score_unit(&unit, request_blood_type, request_urgency, bank_hint, now_timestamp);
        result.push_back(MatchedUnit {
            unit_id: unit.id,
            blood_type: unit.blood_type,
            quantity_ml: taken,
            bank_id: unit.bank_id.clone(),
            expiration_timestamp: unit.expiration_timestamp,
            score: s,
            match_kind: MatchKind::Compatible,
        });
        remaining -= taken;
    }

    result
}
