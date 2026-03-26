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
    Fulfilled,
    Cancelled,
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
