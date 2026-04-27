use soroban_sdk::{contracttype, Address, String, Vec};

#[derive(Clone, Debug, Eq, PartialEq)]
#[contracttype]
pub enum DataKey {
    Admin,
    InventoryContract,
    RequestCounter,
    Initialized,
    Metadata,
    AuthorizedHospital(Address),
    Request(u64),
}

#[derive(Clone, Debug, Eq, PartialEq)]
#[contracttype]
pub struct ContractMetadata {
    pub name: String,
    pub version: u32,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
#[contracttype]
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

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
#[contracttype]
pub enum BloodComponent {
    WholeBlood,
    RedCells,
    Plasma,
    Platelets,
    Cryoprecipitate,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
#[contracttype]
pub enum Urgency {
    Critical,
    Urgent,
    Routine,
    Scheduled,
}

impl Urgency {
    pub fn priority(&self) -> u32 {
        match self {
            Self::Critical => 4,
            Self::Urgent => 3,
            Self::Routine => 2,
            Self::Scheduled => 1,
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
#[contracttype]
pub enum RequestStatus {
    Pending,
    Approved,
    InProgress,
    Fulfilled,
    Cancelled,
    Rejected,
}

#[derive(Clone, Debug, Eq, PartialEq)]
#[contracttype]
pub struct RequestHistoryEntry {
    pub previous_status: RequestStatus,
    pub is_initial_transition: bool,
    pub new_status: RequestStatus,
    pub actor: Address,
    pub reason: String,
    pub fulfilled_delta_ml: u32,
    pub released_reservation: bool,
    pub timestamp: u64,
}

#[derive(Clone, Debug, Eq, PartialEq)]
#[contracttype]
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
    /// Reservation ID on the inventory contract, set when units are reserved.
    pub reservation_id: Option<u64>,
    /// Request lifecycle transitions with rationale and accounting details.
    pub history: Vec<RequestHistoryEntry>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
#[contracttype]
pub struct RequestCreatedEvent {
    pub request_id: u64,
    pub hospital: Address,
    pub blood_type: BloodType,
    pub quantity_ml: u32,
    pub urgency: u32,
    pub timestamp: u64,
}
