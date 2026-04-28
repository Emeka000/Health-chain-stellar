use soroban_sdk::contracterror;

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum ContractError {
    Unauthorized = 600,
    UnitNotFound = 601,
    ThresholdNotFound = 602,
    InvalidThreshold = 603,
    AlreadyInitialized = 604,
    ContractPaused = 605,
    /// Coordinator contract address not configured
    CoordinatorNotSet = 606,
    /// Cross-contract call to coordinator failed
    CoordinatorCallFailed = 607,
}
