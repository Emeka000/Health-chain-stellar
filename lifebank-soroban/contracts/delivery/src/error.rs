use soroban_sdk::contracterror;

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum ContractError {
    AlreadyInitialized = 1,
    NotInitialized = 2,
    Unauthorized = 3,
    DeliveryNotFound = 4,
    InvalidStatusTransition = 5,
    InvalidTemperatureThreshold = 6,
    ProofAlreadySubmitted = 7,
    MissingProof = 8,
}
