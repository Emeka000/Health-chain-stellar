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
    /// Attempted to overwrite an already-set fulfilling org; overwrite would silently lose the prior value.
    FulfillingOrgAlreadySet = 316,
    /// No trusted payments contract has been configured.
    PaymentsContractNotSet = 317,
    /// Contract is paused; state-mutating entrypoints are disabled.
    ContractPaused = 318,
    /// The inventory reservation does not exist.
    ReservationNotFound = 319,
    /// The inventory reservation was created for a different request.
    ReservationRequestMismatch = 320,
    /// The reservation's requester does not match the fulfilling org.
    ReservationOwnerMismatch = 321,
    /// A blood bank may only claim a request whose reservation it owns.
    ReservationRequired = 322,
    /// The inventory contract refused to release the request's reservation
    /// (e.g. inventory is paused). The transition is aborted so the
    /// reservation is never orphaned; retry once inventory accepts releases.
    InventoryReleaseFailed = 323,
    /// `expire_request` was called before the request's `required_by_timestamp` passed.
    RequestNotExpired = 324,
    /// No trusted coordinator contract has been configured.
    CoordinatorContractNotSet = 325,
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
            ContractError::FulfillingOrgAlreadySet,
            ContractError::PaymentsContractNotSet,
            ContractError::ContractPaused,
            ContractError::ReservationNotFound,
            ContractError::ReservationRequestMismatch,
            ContractError::ReservationOwnerMismatch,
            ContractError::ReservationRequired,
            ContractError::InventoryReleaseFailed,
            ContractError::RequestNotExpired,
            ContractError::CoordinatorContractNotSet,
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
