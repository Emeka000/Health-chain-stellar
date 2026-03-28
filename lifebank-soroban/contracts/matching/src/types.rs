use soroban_sdk::{contracttype, Address, Map, String, Symbol, Vec};

// ---------------------------------------------------------------------------
// Shared domain types (must stay in sync with inventory/requests contracts)
// ---------------------------------------------------------------------------

/// All eight ABO/Rh blood groups.
#[contracttype]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
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

/// Urgency levels for a blood request.
#[contracttype]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum Urgency {
    Critical,
    Urgent,
    Routine,
    Scheduled,
}

impl Urgency {
    /// Numeric priority — higher is more urgent.
    pub fn priority(self) -> u32 {
        match self {
            Self::Critical  => 4,
            Self::Urgent    => 3,
            Self::Routine   => 2,
            Self::Scheduled => 1,
        }
    }
}

/// Blood unit status — mirrors inventory contract's `BloodStatus`.
#[contracttype]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum BloodStatus {
    Available,
    Reserved,
    InTransit,
    Delivered,
    Expired,
    Compromised,
    Disposed,
}

/// Blood unit view returned by the inventory contract.
/// Must match `inventory_contract::types::BloodUnit` exactly.
#[contracttype]
#[derive(Clone, Debug)]
pub struct BloodUnit {
    pub id: u64,
    pub blood_type: BloodType,
    pub quantity_ml: u32,
    pub bank_id: Address,
    pub donor_id: Option<Address>,
    pub donation_timestamp: u64,
    pub expiration_timestamp: u64,
    pub status: BloodStatus,
    pub metadata: Map<Symbol, String>,
}

/// Blood component type — mirrors requests contract's `BloodComponent`.
#[contracttype]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum BloodComponent {
    WholeBlood,
    RedCells,
    Plasma,
    Platelets,
    Cryoprecipitate,
}

/// Blood request view returned by the requests contract.
/// Must match `request_contract::types::BloodRequest` exactly.
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
}

/// Request status — mirrors requests contract's `RequestStatus`.
#[contracttype]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum RequestStatus {
    Pending,
    Approved,
    Fulfilled,
    Cancelled,
}

// ---------------------------------------------------------------------------
// Matching-specific types
// ---------------------------------------------------------------------------

/// A single matched blood unit with its computed score.
#[contracttype]
#[derive(Clone, Debug)]
pub struct MatchedUnit {
    /// Inventory unit ID.
    pub unit_id: u64,
    /// Blood type of the matched unit.
    pub blood_type: BloodType,
    /// Volume contributed by this unit (may be less than unit total for partial).
    pub quantity_ml: u32,
    /// Blood bank that owns this unit.
    pub bank_id: Address,
    /// Unix expiration timestamp — used for FIFO ordering.
    pub expiration_timestamp: u64,
    /// Composite match score (higher = better).
    pub score: u32,
    /// Whether this is an exact, compatible, or partial match.
    pub match_kind: MatchKind,
}

/// Describes how closely a unit's blood type matches the request.
#[contracttype]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum MatchKind {
    /// Unit blood type == request blood type.
    Exact,
    /// Unit blood type is ABO/Rh compatible but not identical.
    Compatible,
}

/// Full result returned by `match_request`.
#[contracttype]
#[derive(Clone, Debug)]
pub struct MatchResult {
    pub request_id: u64,
    /// Ordered list of units selected to fulfil the request.
    pub matched_units: Vec<MatchedUnit>,
    /// Total volume matched across all selected units (ml).
    pub total_matched_ml: u32,
    /// Volume still unmet after matching (0 = fully fulfilled).
    pub remaining_ml: u32,
    /// True when some — but not all — of the requested volume was matched.
    pub partial_fulfillment: bool,
}

/// Storage keys for the matching contract.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum DataKey {
    Admin,
    InventoryContract,
    RequestsContract,
    Initialized,
}
