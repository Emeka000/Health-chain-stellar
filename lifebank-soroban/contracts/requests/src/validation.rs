use crate::error::ContractError;
use soroban_sdk::Env;

/// Largest quantity a single request (or single partial fulfilment) may ask for.
pub const MAX_REQUEST_QUANTITY_ML: u32 = 50_000;

/// How far ahead a request's `required_by_timestamp` may be, in seconds (90 days).
pub const MAX_REQUIRED_BY_HORIZON_SECS: u64 = 90 * 24 * 60 * 60;

pub fn validate_timestamp(env: &Env, required_by_timestamp: u64) -> Result<(), ContractError> {
    let now = env.ledger().timestamp();
    if required_by_timestamp <= now
        || required_by_timestamp > now.saturating_add(MAX_REQUIRED_BY_HORIZON_SECS)
    {
        Err(ContractError::InvalidTimestamp)
    } else {
        Ok(())
    }
}

pub fn validate_quantity(quantity_ml: u32) -> Result<(), ContractError> {
    if quantity_ml == 0 || quantity_ml > MAX_REQUEST_QUANTITY_ML {
        Err(ContractError::InvalidQuantity)
    } else {
        Ok(())
    }
}
// Validation helpers will be added as request lifecycle features are implemented.
