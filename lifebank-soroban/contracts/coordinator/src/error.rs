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
    /// The requests contract refused a lifecycle transition driven by the
    /// coordinator (e.g. it is paused or the coordinator is not trusted).
    RequestUpdateFailed = 833,

    // Circuit breaker
    ContractPaused = 840,

    /// emergency_halt() has been called; all workflow mutations are blocked.
    EmergencyHalted = 841,

    /// expire_workflow() was called but the deadline has not yet elapsed.
    WorkflowNotExpired = 842,

    // Payment binding checks in allocate_units
    /// The bound payment is not `Locked` (e.g. still `Pending`, or `Disputed`).
    PaymentNotLocked = 850,
    /// The bound payment has no token behind it, so nothing is escrowed.
    PaymentNotEscrowed = 851,
    /// The bound payment was not made by the request's hospital.
    PaymentPayerMismatch = 852,
}
