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
    ChangeNotReady = 605,
    NoPendingChange = 606,
    ContractPaused = 607,
    /// Coordinator contract address not configured
    CoordinatorNotSet = 608,
    /// Cross-contract call to coordinator failed
    CoordinatorCallFailed = 609,
    /// Caller is not a whitelisted oracle
    OracleNotWhitelisted = 610,
    /// Reading is outside the physically-plausible temperature range
    TemperatureOutOfRange = 611,
}
