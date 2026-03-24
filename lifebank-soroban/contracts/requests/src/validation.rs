use crate::error::ContractError;
use soroban_sdk::Env;

pub fn validate_timestamp(env: &Env, required_by_timestamp: u64) -> Result<(), ContractError> {
    if required_by_timestamp <= env.ledger().timestamp() {
        Err(ContractError::InvalidTimestamp)
    } else {
        Ok(())
    }
}

pub fn validate_quantity(quantity_ml: u32) -> Result<(), ContractError> {
    if quantity_ml == 0 {
        Err(ContractError::InvalidQuantity)
    } else {
        Ok(())
    }
}
// Validation helpers will be added as request lifecycle features are implemented.
