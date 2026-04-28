use soroban_sdk::contracterror;

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum ContractError {
    AlreadyInitialized = 300,
    NotInitialized = 301,
    Unauthorized = 302,
    InvalidTimestamp = 303,
    InvalidQuantity = 304,
    NotAuthorizedHospital = 305,
    RequestNotFound = 306,
    /// Attempted status transition is not valid for the current request state.
    InvalidRequestStatus = 307,
    /// Caller is not the hospital that owns this request.
    NotRequestOwner = 308,
    /// Transition requires a non-empty human-readable reason.
    InvalidReason = 309,
}
