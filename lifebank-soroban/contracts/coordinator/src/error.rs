use soroban_sdk::contracterror;

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum CoordinatorError {
    AlreadyInitialized = 800,
    NotInitialized = 801,
    Unauthorized = 802,

    // Workflow state errors
    WorkflowNotFound = 810,
    WorkflowAlreadyStarted = 811,
    InvalidWorkflowState = 812,
    CannotRollbackSettled = 813,

    // Cross-contract pre-condition failures
    RequestNotFound = 820,
    InvalidRequestState = 821,
    UnitNotFound = 822,
    UnitNotAvailable = 823,
    PaymentNotFound = 824,
    InvalidPaymentState = 825,
    DeliveryNotConfirmed = 826,
    IncompatibleBloodType = 827,
    NoUnitsSpecified = 828,
    PaymentRequestMismatch = 829,

    // Cross-contract call failures
    InventoryUpdateFailed = 830,
    PaymentUpdateFailed = 831,
    PaymentFlagFailed = 832,

    // Circuit breaker
    ContractPaused = 840,

    /// emergency_halt() has been called; all workflow mutations are blocked.
    EmergencyHalted = 841,

    /// expire_workflow() was called but the deadline has not yet elapsed.
    WorkflowNotExpired = 842,

    // Allocation, cold-chain and settlement checks
    /// The allocated units' total volume is below the request's remaining quantity.
    InsufficientQuantity = 850,
    /// Allocated units belong to more than one blood bank; a single inventory
    /// reservation can only cover one bank's units.
    MixedBloodBanks = 851,
    /// The temperature contract reports at least one unit as compromised.
    UnitCompromised = 852,
    /// The cross-contract `is_compromised` query failed.
    TemperatureCheckFailed = 853,
    /// A cross-contract call to the requests contract failed.
    RequestUpdateFailed = 854,
    /// finalize_settlement was called before the hospital confirmed receipt.
    ReceiptNotConfirmed = 855,
}
