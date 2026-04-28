use soroban_sdk::contracterror;

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum ContractError {
    // General errors (100-109)
    AlreadyInitialized = 100,
    NotInitialized = 101,
    Unauthorized = 102,

    // Validation errors (110-119)
    InvalidAmount = 110,
    InvalidAddress = 111,
    InvalidInput = 112,
    InvalidBloodType = 113,
    InvalidStatus = 114,
    InvalidTimestamp = 115,
    InvalidQuantity = 116,
    InvalidExpiration = 117,

    // State errors (120-129)
    AlreadyExists = 120,
    NotFound = 121,
    Expired = 122,
    BloodUnitExpired = 123,
    DuplicateBloodUnit = 124,

    // Permission errors (130-139)
    InsufficientBalance = 130,
    InsufficientPermissions = 131,
    NotAuthorizedBloodBank = 132,

    // Blood-specific errors (140-149)
    BloodUnitNotAvailable = 140,
    InvalidStatusTransition = 141,

    // Reservation errors (150-159)
    ReservationNotFound = 150,
    ReservationExpired = 151,
    NotReservationOwner = 152,

    // Circuit breaker (160)
    ContractPaused = 160,
}
