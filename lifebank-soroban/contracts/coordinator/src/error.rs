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

    // Cross-contract call failures
    InventoryUpdateFailed = 830,
    PaymentUpdateFailed = 831,
}
