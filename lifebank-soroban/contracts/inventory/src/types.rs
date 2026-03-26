use crate::error::ContractError;
use soroban_sdk::{contracttype, Address, Map, String, Symbol, Vec};

/// Blood type enumeration supporting all major blood groups
///
/// Each variant represents a unique combination of ABO and Rh blood typing:
/// - A+, A-: Type A with positive/negative Rh factor
/// - B+, B-: Type B with positive/negative Rh factor  
/// - AB+, AB-: Type AB with positive/negative Rh factor
/// - O+, O-: Type O with positive/negative Rh factor
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq, Copy)]
pub enum BloodType {
    /// Type A positive (A+)
    APositive,
    /// Type A negative (A-)
    ANegative,
    /// Type B positive (B+)
    BPositive,
    /// Type B negative (B-)
    BNegative,
    /// Type AB positive (AB+) - Universal plasma donor
    ABPositive,
    /// Type AB negative (AB-)
    ABNegative,
    /// Type O positive (O+)
    OPositive,
    /// Type O negative (O-) - Universal blood donor
    ONegative,
}

/// Blood unit status representing its current state in the supply chain
///
/// Status transitions follow this flow:
/// Available -> Reserved -> InTransit -> Delivered
///           \-> Expired (can happen at any stage)
///           \-> Compromised (temperature violations trigger this)
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq, Copy)]
pub enum BloodStatus {
    /// Available for reservation - initial state after donation processing
    Available,
    /// Reserved for a specific request but not yet shipped
    Reserved,
    /// Currently being transported to destination
    InTransit,
    /// Successfully delivered to recipient/hospital
    Delivered,
    /// Expired and no longer usable (typically after 42 days for whole blood)
    Expired,
    /// Compromised due to 3 consecutive temperature violations - unsafe for use
    Compromised,
    /// Formally disposed of after expiry or compromise — permanent end-of-life
    Disposed,
}

/// Complete blood unit record stored in the inventory contract
///
/// Represents a single unit of donated blood with full tracking information
/// from donation through delivery or expiration.
///
/// # Storage Keys
/// - Primary key: `id` (u64)
/// - Secondary indexes: `blood_type`, `bank_id`, `status`
#[contracttype]
#[derive(Clone, Debug)]
pub struct BloodUnit {
    /// Unique identifier for this blood unit
    pub id: u64,

    /// Blood type (A+, A-, B+, B-, AB+, AB-, O+, O-)
    pub blood_type: BloodType,

    /// Volume in milliliters (ml)
    /// Standard unit: 450ml ± 10% for whole blood
    /// Typical range: 400-500ml
    pub quantity_ml: u32,

    /// Blood bank address that manages this unit
    pub bank_id: Address,

    /// Optional donor address (may be anonymous)
    /// None indicates anonymous donation
    pub donor_id: Option<Address>,

    /// Unix timestamp (seconds) when donation was collected
    pub donation_timestamp: u64,

    /// Unix timestamp (seconds) when unit expires
    /// Typically 42 days from donation for whole blood
    /// 5 days for platelets, 1 year for frozen plasma
    pub expiration_timestamp: u64,

    /// Current status in supply chain
    pub status: BloodStatus,

    /// Extensible metadata for additional attributes
    /// Examples: test_results, storage_location, lot_number, processing_notes
    pub metadata: Map<Symbol, String>,
}

impl BloodType {
    /// Check if this blood type can donate to the recipient blood type
    ///
    /// Based on compatibility rules:
    /// - O- can donate to all types (universal donor)
    /// - AB+ can receive from all types (universal recipient)
    /// - Rh- can donate to Rh+ and Rh-
    /// - Rh+ can only donate to Rh+
    pub fn can_donate_to(&self, recipient: &BloodType) -> bool {
        use BloodType::*;

        match (self, recipient) {
            // O- is universal donor
            (ONegative, _) => true,

            // O+ can donate to all positive types
            (OPositive, APositive | BPositive | ABPositive | OPositive) => true,

            // A- can donate to A and AB (both + and -)
            (ANegative, APositive | ANegative | ABPositive | ABNegative) => true,

            // A+ can donate to A+ and AB+
            (APositive, APositive | ABPositive) => true,

            // B- can donate to B and AB (both + and -)
            (BNegative, BPositive | BNegative | ABPositive | ABNegative) => true,

            // B+ can donate to B+ and AB+
            (BPositive, BPositive | ABPositive) => true,

            // AB- can donate to AB+ and AB-
            (ABNegative, ABPositive | ABNegative) => true,

            // AB+ can only donate to AB+
            (ABPositive, ABPositive) => true,

            // All other combinations are incompatible
            _ => false,
        }
    }
}

impl BloodStatus {
    /// Check if this status is a terminal state.
    ///
    /// Terminal states cannot transition to any other status.
    /// `Disposed` is the true physical end-of-life; `Expired` and `Compromised`
    /// units may still transition to `Disposed` before being considered fully done.
    pub fn is_terminal(&self) -> bool {
        matches!(
            self,
            BloodStatus::Delivered | BloodStatus::Disposed | BloodStatus::Compromised
        )
    }
}

/// Blood Unit Lifecycle Transition Map
///
/// The blood unit follows a strict forward-only lifecycle through the supply chain:
///
///   Available ──► Reserved ──► InTransit ──► Delivered (terminal)
///       │             │             │
///       ▼             ▼             ▼
///    Expired       Expired       Expired ──► Disposed (terminal)
///
///   Compromised ──► Disposed (terminal)
///   Reserved can also cancel back to Available.
///
/// Valid transitions:
///   - Available   → Reserved   (unit is reserved for a request)
///   - Available   → Expired    (unit expired before being reserved)
///   - Reserved    → InTransit  (unit is dispatched for delivery)
///   - Reserved    → Available  (reservation cancelled, unit returned to pool)
///   - Reserved    → Expired    (unit expired while reserved)
///   - InTransit   → Delivered  (unit successfully delivered)
///   - InTransit   → Expired    (unit expired during transport)
///   - Expired     → Disposed   (formally disposed of after expiry)
///   - Compromised → Disposed   (formally disposed of after compromise)
///   - Delivered   → (none)     (terminal state — no further transitions)
///   - Disposed    → (none)     (terminal state — no further transitions)
///
/// All other transitions are invalid and will be rejected. Backwards transitions
/// (e.g., Delivered → Available, InTransit → Reserved) are explicitly forbidden
/// to preserve the integrity of the on-chain audit trail.
///
/// This is a pure function with no storage access, making it unit-testable in isolation.
pub fn is_valid_transition(from: &BloodStatus, to: &BloodStatus) -> bool {
    use BloodStatus::*;

    matches!(
        (from, to),
        (Available, Reserved)
            | (Available, Expired)
            | (Reserved, InTransit)
            | (Reserved, Available)
            | (Reserved, Expired)
            | (InTransit, Delivered)
            | (InTransit, Expired)
            | (Expired, Disposed)
            | (Compromised, Disposed)
    )
}

impl BloodUnit {
    /// Validate that the blood unit data is consistent and valid
    ///
    /// Checks:
    /// - Quantity is within acceptable range (100-600ml)
    /// - Expiration is after donation
    /// - Timestamps are reasonable (not in far future)
    pub fn validate(&self, current_time: u64) -> Result<(), ContractError> {
        // Validate quantity (typical range: 100-600ml)
        if self.quantity_ml < 100 || self.quantity_ml > 600 {
            return Err(ContractError::InvalidQuantity);
        }

        // Validate timestamps
        if self.expiration_timestamp <= self.donation_timestamp {
            return Err(ContractError::InvalidTimestamp);
        }

        // Donation shouldn't be from far future (allow up to 1 hour ahead for clock skew)
        if self.donation_timestamp > current_time + 3600 {
            return Err(ContractError::InvalidTimestamp);
        }

        Ok(())
    }

    /// Check if blood unit is currently expired
    pub fn is_expired(&self, current_time: u64) -> bool {
        current_time >= self.expiration_timestamp
    }

    /// Calculate shelf life remaining in seconds
    pub fn shelf_life_remaining(&self, current_time: u64) -> i64 {
        (self.expiration_timestamp as i64) - (current_time as i64)
    }
}

/// Storage key types for efficient querying
#[contracttype]
#[derive(Clone, Debug)]
pub enum DataKey {
    /// Individual blood unit by ID
    BloodUnit(u64),

    /// Counter for generating new blood unit IDs
    BloodUnitCounter,

    /// Index: Blood type -> Vec<u64> (blood unit IDs)
    BloodTypeIndex(BloodType),

    /// Index: Bank ID -> Vec<u64> (blood unit IDs)
    BankIndex(Address),

    /// Index: Status -> Vec<u64> (blood unit IDs)
    StatusIndex(BloodStatus),

    /// Index: Donor ID -> Vec<u64> (blood unit IDs)
    DonorIndex(Address),

    /// Admin address
    Admin,

    /// Status change history for a blood unit
    StatusHistory(u64), // u64 is blood_unit_id -> Vec<StatusChangeHistory>

    /// Counter for status change history records
    StatusHistoryCounter,

    /// Counter for status changes on specific blood unit
    BloodUnitStatusChangeCount(u64), // u64 is blood_unit_id
}

#[contracttype]
#[derive(Clone, Debug)]
pub struct BloodRegisteredEvent {
    /// Unique ID of the registered blood unit
    pub blood_unit_id: u64,

    /// Blood bank that registered the unit
    pub bank_id: Address,

    /// Blood type
    pub blood_type: BloodType,

    /// Quantity in milliliters
    pub quantity_ml: u32,

    /// When the unit expires
    pub expiration_timestamp: u64,

    /// When the unit was registered
    pub registered_at: u64,
}

/// Event emitted when blood unit status changes
#[contracttype]
#[derive(Clone, Debug)]
pub struct StatusChangeEvent {
    /// Unique ID of the blood unit
    pub blood_unit_id: u64,

    /// Previous status
    pub from_status: BloodStatus,

    /// New status
    pub to_status: BloodStatus,

    /// Who authorized this change
    pub authorized_by: Address,

    /// When the status change occurred
    pub changed_at: u64,

    /// Optional reason for status change (e.g., "Delivered to Hospital A")
    pub reason: Option<String>,
}

/// Historical record of a status change
#[contracttype]
#[derive(Clone, Debug)]
pub struct StatusChangeHistory {
    /// Unique ID for this history record
    pub id: u64,

    /// Blood unit ID
    pub blood_unit_id: u64,

    /// Previous status
    pub from_status: BloodStatus,

    /// New status
    pub to_status: BloodStatus,

    /// Who authorized this change
    pub authorized_by: Address,

    /// When the status change occurred
    pub changed_at: u64,

    /// Optional reason for status change
    pub reason: Option<String>,
}

/// Batch status update operation
#[contracttype]
#[derive(Clone, Debug)]
pub struct BatchStatusUpdate {
    /// List of blood unit IDs to update
    pub blood_unit_ids: Vec<u64>,

    /// New status for all units
    pub new_status: BloodStatus,

    /// Optional reason for batch update
    pub reason: Option<String>,
}

#[cfg(test)]
mod tests {
    use super::*;
    use soroban_sdk::{testutils::Address as _, Env};

    #[test]
    fn test_blood_type_compatibility_universal_donor() {
        let o_neg = BloodType::ONegative;

        // O- can donate to all types
        assert!(o_neg.can_donate_to(&BloodType::ONegative));
        assert!(o_neg.can_donate_to(&BloodType::OPositive));
        assert!(o_neg.can_donate_to(&BloodType::ANegative));
        assert!(o_neg.can_donate_to(&BloodType::APositive));
        assert!(o_neg.can_donate_to(&BloodType::BNegative));
        assert!(o_neg.can_donate_to(&BloodType::BPositive));
        assert!(o_neg.can_donate_to(&BloodType::ABNegative));
        assert!(o_neg.can_donate_to(&BloodType::ABPositive));
    }

    #[test]
    fn test_blood_type_compatibility_universal_recipient() {
        let ab_pos = BloodType::ABPositive;

        // AB+ can receive from all types
        assert!(BloodType::ONegative.can_donate_to(&ab_pos));
        assert!(BloodType::OPositive.can_donate_to(&ab_pos));
        assert!(BloodType::ANegative.can_donate_to(&ab_pos));
        assert!(BloodType::APositive.can_donate_to(&ab_pos));
        assert!(BloodType::BNegative.can_donate_to(&ab_pos));
        assert!(BloodType::BPositive.can_donate_to(&ab_pos));
        assert!(BloodType::ABNegative.can_donate_to(&ab_pos));
        assert!(BloodType::ABPositive.can_donate_to(&ab_pos));
    }

    #[test]
    fn test_blood_type_compatibility_specific_cases() {
        // A+ can donate to A+ and AB+
        assert!(BloodType::APositive.can_donate_to(&BloodType::APositive));
        assert!(BloodType::APositive.can_donate_to(&BloodType::ABPositive));
        assert!(!BloodType::APositive.can_donate_to(&BloodType::ANegative));
        assert!(!BloodType::APositive.can_donate_to(&BloodType::BPositive));

        // B- can donate to B+, B-, AB+, AB-
        assert!(BloodType::BNegative.can_donate_to(&BloodType::BPositive));
        assert!(BloodType::BNegative.can_donate_to(&BloodType::BNegative));
        assert!(BloodType::BNegative.can_donate_to(&BloodType::ABPositive));
        assert!(BloodType::BNegative.can_donate_to(&BloodType::ABNegative));
        assert!(!BloodType::BNegative.can_donate_to(&BloodType::APositive));
    }

    #[test]
    fn test_is_valid_transition_all_valid() {
        use super::is_valid_transition;
        use BloodStatus::*;

        // All 7 valid transitions in the blood unit lifecycle
        assert!(is_valid_transition(&Available, &Reserved));
        assert!(is_valid_transition(&Available, &Expired));
        assert!(is_valid_transition(&Reserved, &InTransit));
        assert!(is_valid_transition(&Reserved, &Available)); // cancellation
        assert!(is_valid_transition(&Reserved, &Expired));
        assert!(is_valid_transition(&InTransit, &Delivered));
        assert!(is_valid_transition(&InTransit, &Expired));
    }

    #[test]
    fn test_is_valid_transition_invalid_backwards() {
        use super::is_valid_transition;
        use BloodStatus::*;

        // 1. Delivered -> Available (backwards)
        assert!(!is_valid_transition(&Delivered, &Available));
        // 2. Delivered -> Reserved (backwards)
        assert!(!is_valid_transition(&Delivered, &Reserved));
        // 3. Delivered -> InTransit (backwards)
        assert!(!is_valid_transition(&Delivered, &InTransit));
        // 4. Delivered -> Expired (terminal cannot transition)
        assert!(!is_valid_transition(&Delivered, &Expired));
        // 5. Expired -> Available (backwards from terminal)
        assert!(!is_valid_transition(&Expired, &Available));
        // 6. Expired -> Reserved (backwards from terminal)
        assert!(!is_valid_transition(&Expired, &Reserved));
        // 7. Expired -> InTransit (backwards from terminal)
        assert!(!is_valid_transition(&Expired, &InTransit));
        // 8. Expired -> Delivered (backwards from terminal)
        assert!(!is_valid_transition(&Expired, &Delivered));
        // 9. InTransit -> Available (skip backwards)
        assert!(!is_valid_transition(&InTransit, &Available));
        // 10. InTransit -> Reserved (backwards)
        assert!(!is_valid_transition(&InTransit, &Reserved));
        // 11. Available -> Delivered (skip forward)
        assert!(!is_valid_transition(&Available, &Delivered));
        // 12. Available -> InTransit (skip forward)
        assert!(!is_valid_transition(&Available, &InTransit));
        // 13. Reserved -> Delivered (skip forward)
        assert!(!is_valid_transition(&Reserved, &Delivered));
    }

    #[test]
    fn test_is_valid_transition_self_transitions_invalid() {
        use super::is_valid_transition;
        use BloodStatus::*;

        // No status should be able to transition to itself
        assert!(!is_valid_transition(&Available, &Available));
        assert!(!is_valid_transition(&Reserved, &Reserved));
        assert!(!is_valid_transition(&InTransit, &InTransit));
        assert!(!is_valid_transition(&Delivered, &Delivered));
        assert!(!is_valid_transition(&Expired, &Expired));
    }

    #[test]
    fn test_status_terminal_states() {
        assert!(BloodStatus::Delivered.is_terminal());
        assert!(!BloodStatus::Expired.is_terminal());
        assert!(!BloodStatus::Available.is_terminal());
        assert!(!BloodStatus::Reserved.is_terminal());
        assert!(!BloodStatus::InTransit.is_terminal());
    }

    #[test]
    fn test_blood_unit_validation_valid() {
        let env = Env::default();
        let bank = Address::generate(&env);
        let current_time = 1000u64;

        let unit = BloodUnit {
            id: 1,
            blood_type: BloodType::APositive,
            quantity_ml: 450,
            bank_id: bank,
            donor_id: None,
            donation_timestamp: current_time,
            expiration_timestamp: current_time + (42 * 24 * 60 * 60), // 42 days
            status: BloodStatus::Available,
            metadata: Map::new(&env),
        };

        assert!(unit.validate(current_time).is_ok());
    }

    #[test]
    fn test_blood_unit_validation_invalid_quantity_too_low() {
        let env = Env::default();
        let bank = Address::generate(&env);
        let current_time = 1000u64;

        let unit = BloodUnit {
            id: 1,
            blood_type: BloodType::APositive,
            quantity_ml: 50, // Too low
            bank_id: bank,
            donor_id: None,
            donation_timestamp: current_time,
            expiration_timestamp: current_time + (42 * 24 * 60 * 60),
            status: BloodStatus::Available,
            metadata: Map::new(&env),
        };

        assert_eq!(
            unit.validate(current_time),
            Err(ContractError::InvalidQuantity)
        );
    }

    #[test]
    fn test_blood_unit_validation_invalid_quantity_too_high() {
        let env = Env::default();
        let bank = Address::generate(&env);
        let current_time = 1000u64;

        let unit = BloodUnit {
            id: 1,
            blood_type: BloodType::APositive,
            quantity_ml: 700, // Too high
            bank_id: bank,
            donor_id: None,
            donation_timestamp: current_time,
            expiration_timestamp: current_time + (42 * 24 * 60 * 60),
            status: BloodStatus::Available,
            metadata: Map::new(&env),
        };

        assert_eq!(
            unit.validate(current_time),
            Err(ContractError::InvalidQuantity)
        );
    }

    #[test]
    fn test_blood_unit_validation_expiration_before_donation() {
        let env = Env::default();
        let bank = Address::generate(&env);
        let current_time = 1000u64;

        let unit = BloodUnit {
            id: 1,
            blood_type: BloodType::APositive,
            quantity_ml: 450,
            bank_id: bank,
            donor_id: None,
            donation_timestamp: current_time,
            expiration_timestamp: current_time - 100, // Before donation
            status: BloodStatus::Available,
            metadata: Map::new(&env),
        };

        assert_eq!(
            unit.validate(current_time),
            Err(ContractError::InvalidTimestamp)
        );
    }

    #[test]
    fn test_blood_unit_validation_future_donation() {
        let env = Env::default();
        let bank = Address::generate(&env);
        let current_time = 1000u64;

        let unit = BloodUnit {
            id: 1,
            blood_type: BloodType::APositive,
            quantity_ml: 450,
            bank_id: bank,
            donor_id: None,
            donation_timestamp: current_time + 7200, // 2 hours in future
            expiration_timestamp: current_time + (42 * 24 * 60 * 60),
            status: BloodStatus::Available,
            metadata: Map::new(&env),
        };

        assert_eq!(
            unit.validate(current_time),
            Err(ContractError::InvalidTimestamp)
        );
    }

    #[test]
    fn test_blood_unit_is_expired() {
        let env = Env::default();
        let bank = Address::generate(&env);
        let donation_time = 1000u64;
        let expiration_time = donation_time + (42 * 24 * 60 * 60);

        let unit = BloodUnit {
            id: 1,
            blood_type: BloodType::APositive,
            quantity_ml: 450,
            bank_id: bank,
            donor_id: None,
            donation_timestamp: donation_time,
            expiration_timestamp: expiration_time,
            status: BloodStatus::Available,
            metadata: Map::new(&env),
        };

        // Not expired before expiration time
        assert!(!unit.is_expired(expiration_time - 1));

        // Expired at expiration time
        assert!(unit.is_expired(expiration_time));

        // Expired after expiration time
        assert!(unit.is_expired(expiration_time + 100));
    }

    #[test]
    fn test_blood_unit_shelf_life_remaining() {
        let env = Env::default();
        let bank = Address::generate(&env);
        let donation_time = 1000u64;
        let expiration_time = donation_time + 3600; // 1 hour

        let unit = BloodUnit {
            id: 1,
            blood_type: BloodType::APositive,
            quantity_ml: 450,
            bank_id: bank,
            donor_id: None,
            donation_timestamp: donation_time,
            expiration_timestamp: expiration_time,
            status: BloodStatus::Available,
            metadata: Map::new(&env),
        };

        // 30 minutes before expiration
        assert_eq!(unit.shelf_life_remaining(donation_time + 1800), 1800);

        // At expiration
        assert_eq!(unit.shelf_life_remaining(expiration_time), 0);

        // 10 minutes past expiration
        assert_eq!(unit.shelf_life_remaining(expiration_time + 600), -600);
    }
}
