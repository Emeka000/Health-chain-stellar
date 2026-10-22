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
    /// excursion_summary.unit_id does not match the unit_id argument
    ExcursionSummaryMismatch = 612,
    /// Oracle is not assigned to the unit it is trying to log for
    OracleNotAssignedToUnit = 613,
    /// A threshold change is already pending for this unit
    ThresholdAlreadyPending = 614,
    /// payment_id is not bound to the given unit_id
    PaymentUnitMismatch = 615,
}