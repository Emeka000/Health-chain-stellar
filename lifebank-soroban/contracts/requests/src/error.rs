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
    UnauthorizedStatusTransition = 307,
    InvalidStatusTransition = 308,
    NotAuthorizedBloodBank = 309,
    NotAuthorizedRider = 310,
    /// Attempted status transition is not valid for the current request state.
    InvalidRequestStatus = 311,
    /// Caller is not the hospital that owns this request.
    NotRequestOwner = 312,
    /// Transition requires a non-empty human-readable reason.
    InvalidReason = 313,
    /// Request already has a reservation ID; overwrite would orphan the prior reservation.
    ReservationAlreadySet = 314,
    /// Batch exceeds the maximum number of entries allowed in one call.
    BatchTooLarge = 315,
}

#[cfg(test)]
mod tests {
    use super::ContractError;

    /// Regression test: every variant must have a unique discriminant, or the
    /// crate fails to compile with E0081 (duplicate discriminant value).
    #[test]
    fn all_discriminants_are_unique() {
        let all = [
            ContractError::AlreadyInitialized,
            ContractError::NotInitialized,
            ContractError::Unauthorized,
            ContractError::InvalidTimestamp,
            ContractError::InvalidQuantity,
            ContractError::NotAuthorizedHospital,
            ContractError::RequestNotFound,
            ContractError::UnauthorizedStatusTransition,
            ContractError::InvalidStatusTransition,
            ContractError::NotAuthorizedBloodBank,
            ContractError::NotAuthorizedRider,
            ContractError::InvalidRequestStatus,
            ContractError::NotRequestOwner,
            ContractError::InvalidReason,
            ContractError::ReservationAlreadySet,
            ContractError::BatchTooLarge,
        ];

        for i in 0..all.len() {
            for j in (i + 1)..all.len() {
                assert_ne!(
                    all[i] as u32, all[j] as u32,
                    "ContractError variants {:?} and {:?} share discriminant {}",
                    all[i], all[j], all[i] as u32
                );
            }
        }
    }
}
