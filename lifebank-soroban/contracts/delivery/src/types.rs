use soroban_sdk::{contracttype, Address, String};

/// Storage keys for the delivery contract
#[contracttype]
#[derive(Clone, Eq, PartialEq)]
pub enum DataKey {
    /// Contract admin address
    Admin,
    /// Address of the linked requests contract
    RequestContract,
    /// Global delivery counter
    DeliveryCounter,
    /// Temperature thresholds (min, max) in celsius * 100
    TempThresholds,
    /// Whether photo proof is required
    PhotoProofRequired,
    /// Whether signature proof is required
    SignatureRequired,
    /// Delivery record by ID
    Delivery(u64),
}

/// Delivery status lifecycle
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq, Copy)]
pub enum DeliveryStatus {
    /// Delivery created, awaiting pickup
    Pending,
    /// Courier has picked up the shipment
    InTransit,
    /// Successfully delivered and confirmed
    Delivered,
    /// Delivery failed or cancelled
    Failed,
}

/// Temperature thresholds for medical supply transport
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq, Copy)]
pub struct TemperatureThresholds {
    /// Minimum acceptable temperature (celsius * 100)
    pub min_celsius_x100: i32,
    /// Maximum acceptable temperature (celsius * 100)
    pub max_celsius_x100: i32,
}

/// Proof requirements for delivery confirmation
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq, Copy)]
pub struct ProofRequirements {
    pub photo_required: bool,
    pub signature_required: bool,
}

/// A delivery record
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct DeliveryRecord {
    pub id: u64,
    pub request_id: u64,
    pub courier: Address,
    pub recipient: Address,
    pub status: DeliveryStatus,
    pub created_at: u64,
    pub delivered_at: Option<u64>,
    pub photo_proof: Option<String>,
    pub signature_proof: Option<String>,
}
