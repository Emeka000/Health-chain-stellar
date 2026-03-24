use soroban_sdk::contracterror;

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum ContractError {
    AlreadyInitialized = 0,
    NotInitialized = 1,
    Unauthorized = 2,
    InvalidTimestamp = 3,
    InvalidQuantity = 4,
    NotAuthorizedHospital = 5,
    RequestNotFound = 6,
}
