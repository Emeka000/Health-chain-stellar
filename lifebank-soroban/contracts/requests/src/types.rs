use soroban_sdk::{contracttype, Address, Map, String};

#[derive(Clone, Debug, PartialEq)]
#[contracttype]
pub enum DataKey {
    BloodUnit(u64),      // unit_id
    BankUnits(Address),  // bank_id -> Vec<u64>
    DonorUnits(Address), // donor_id -> Vec<u64>
    Registrar(Address),  // Authorization status
    Admin,               // The Admin Address
    UnitIdCounter,       // Internal counter for IDs
}

#[derive(Clone, Debug, PartialEq)]
#[contracttype]
pub struct BloodUnit {
    pub id: u64,
    pub blood_type: BloodType,
    pub quantity_ml: u32,
    pub bank_id: Address,
    pub donor_id: Option<Address>,
    pub donation_timestamp: u64,
    pub expiration_timestamp: u64,
    pub status: BloodStatus,
    pub metadata: Map<String, String>,
}

// Ensure BloodType and BloodStatus are also defined here as #[contracttype]
