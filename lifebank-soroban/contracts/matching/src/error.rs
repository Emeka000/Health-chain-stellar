use soroban_sdk::contracterror;

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum MatchingError {
    // General (600-609)
    AlreadyInitialized = 600,
    NotInitialized     = 601,
    Unauthorized       = 602,

    // Request errors (610-619)
    RequestNotFound    = 610,
    InvalidRequest     = 611,

    // Inventory errors (620-629)
    InventoryCallFailed = 620,
    NoUnitsAvailable    = 621,
}
