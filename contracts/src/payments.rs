use soroban_sdk::{contracttype, Address, Bytes, String, Symbol, Vec};

/// **Dispute evidence (beyond `Symbol` limits).**
///
/// Soroban `Symbol` values are capped (~32 characters) and cannot carry full IPFS CIDs,
/// long URLs, or rich text. Disputes therefore store:
/// - [`Dispute::reason`]: human-readable explanation as Soroban [`String`].
/// - [`Dispute::evidence_digest`]: a fixed-size fingerprint (typically 32 bytes, e.g. SHA-256)
///   over the canonical evidence payload agreed off-chain.
/// - [`Dispute::evidence_ref_chunks`]: optional ordered segments. If a single `String` is not
///   enough for a CID/URL, split off-chain, submit each piece in order, and reassemble off-chain
///   for display. Verifiers must check the reconstructed reference against `evidence_digest`.

/// Represents the current state of a payment in its lifecycle
#[contracttype]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum PaymentStatus {
    /// Payment created but not yet funded
    Pending,
    /// Payment funds locked in escrow
    Escrowed,
    /// Payment is under dispute
    Disputed,
    /// Payment dispute has been resolved
    Resolved,
    /// Payment successfully completed and funds transferred
    Completed,
    /// Payment refunded to payer
    Refunded,
    /// Payment cancelled before escrow
    Cancelled,
}

/// Represents the status of a dispute
#[contracttype]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum DisputeStatus {
    /// Dispute initiated by a party
    Open,
    /// Dispute resolved in favor of the payer (refund)
    ResolvedInFavorOfPayer,
    /// Dispute resolved in favor of the payee (payout)
    ResolvedInFavorOfPayee,
    /// Dispute dismissed without change
    Dismissed,
}

/// Dispute record for delivery issues
#[contracttype]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Dispute {
    /// Unique dispute identifier
    pub id: u64,
    /// Associated payment ID
    pub payment_id: u64,
    /// Party who raised the dispute
    pub raised_by: Address,
    /// Current status of the dispute
    pub status: DisputeStatus,
    /// Reason for the dispute (Soroban [`String`], not `Symbol`)
    pub reason: String,
    /// 32-byte (or shorter, left-padded) digest of canonical evidence; primary on-chain anchor
    pub evidence_digest: Bytes,
    /// Optional URI/CID fragments; concatenate off-chain in order (see module docs)
    pub evidence_ref_chunks: Vec<String>,
    /// Timestamp when dispute was raised
    pub raised_at: u64,
    /// Timestamp when dispute was resolved
    pub resolved_at: Option<u64>,
}

/// Proof bundle attached to a payment for escrow release
#[contracttype]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ProofBundle {
    /// SHA-256 hash of the delivery proof record (32 bytes)
    pub delivery_hash: Bytes,
    /// SHA-256 hash of the recipient signature artifact (32 bytes)
    pub signature_hash: Bytes,
    /// SHA-256 hash of the photo evidence (32 bytes)
    pub photo_hash: Bytes,
    /// SHA-256 hash of the medical verification record (32 bytes)
    pub medical_hash: Bytes,
    /// Address of the actor who submitted the bundle
    pub submitted_by: Address,
    /// Timestamp when the bundle was attached
    pub submitted_at: u64,
    /// Whether the bundle passed backend validation
    pub validated: bool,
}

/// Conditions that must be met before escrow funds can be released
#[contracttype]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ReleaseConditions {
    /// Whether medical records have been verified
    pub medical_records_verified: bool,
    /// Minimum timestamp before release is allowed
    pub min_timestamp: u64,
    /// Optional address authorized to approve release
    pub authorized_approver: Option<Address>,
    /// Whether a validated proof bundle is required before release
    pub require_proof_bundle: bool,
}

/// Core payment transaction structure
#[contracttype]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Payment {
    /// Unique payment identifier
    pub id: u64,
    /// Associated request ID
    pub request_id: u64,
    /// Address sending the payment
    pub payer: Address,
    /// Address receiving the payment
    pub payee: Address,
    /// Payment amount in smallest unit (net after fees)
    pub amount: i128,
    /// Asset contract address
    pub asset: Address,
    /// Fee structure applied (for audit)
    pub fee_structure: FeeStructure,
    /// Current payment status
    pub status: PaymentStatus,
    /// Timestamp when escrow was released (if applicable)
    pub escrow_released_at: Option<u64>,
    /// Proof bundle attached for escrow release (if any)
    pub proof_bundle: Option<ProofBundle>,
}

/// Escrow account holding locked funds
#[contracttype]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct EscrowAccount {
    /// Associated payment ID
    pub payment_id: u64,
    /// Amount locked in escrow
    pub locked_amount: i128,
    /// Conditions for releasing funds
    pub release_conditions: ReleaseConditions,
}

/// Fee breakdown for a transaction
#[contracttype]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct FeeStructure {
    /// Policy ID for audit
    pub policy_id: Symbol,
    /// Platform service fee
    pub service_fee: i128,
    /// Network transaction fee
    pub network_fee: i128,
    /// Optional performance-based bonus
    pub performance_bonus: i128,
    /// Fixed fee
    pub fixed_fee: i128,
}

/// Additional metadata for transaction tracking
///
/// Note: Soroban Symbols have strict constraints:
/// - Only a-z, A-Z, 0-9, and underscore allowed
/// - No spaces, hyphens, dots, or special characters
/// - Maximum 32 characters for regular Symbol, 9 for symbol_short!
///
/// For complex strings like URLs or multi-word descriptions,
/// consider using String type or storing a hash/reference ID
#[contracttype]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct TransactionMetadata {
    /// Short identifier or category (use underscores for spaces)
    pub description: Symbol,
    /// Categorization tags (short identifiers only)
    pub tags: Vec<Symbol>,
    /// Reference identifier (not a full URL - use hash or ID)
    pub reference_url: Symbol,
}

impl Payment {
    pub fn validate(&self) -> Result<(), PaymentError> {
        // Amount must be positive
        if self.amount <= 0 {
            return Err(PaymentError::InvalidAmount);
        }

        // Payer and payee must be different
        if self.payer == self.payee {
            return Err(PaymentError::SamePayerPayee);
        }

        // Asset must not be payer or payee
        if self.asset == self.payer || self.asset == self.payee {
            return Err(PaymentError::InvalidAsset);
        }

        Ok(())
    }
    /// Checks if payment can transition to a new status
    pub fn can_transition_to(&self, new_status: PaymentStatus) -> bool {
        match (self.status, new_status) {
            // Pending can go to Escrowed or Cancelled
            (PaymentStatus::Pending, PaymentStatus::Escrowed) => true,
            (PaymentStatus::Pending, PaymentStatus::Cancelled) => true,

            // Escrowed can go to Completed, Refunded or Disputed
            (PaymentStatus::Escrowed, PaymentStatus::Completed) => true,
            (PaymentStatus::Escrowed, PaymentStatus::Refunded) => true,
            (PaymentStatus::Escrowed, PaymentStatus::Disputed) => true,

            // Disputed can go to Resolved
            (PaymentStatus::Disputed, PaymentStatus::Resolved) => true,

            // Resolved can go to Completed or Refunded
            (PaymentStatus::Resolved, PaymentStatus::Completed) => true,
            (PaymentStatus::Resolved, PaymentStatus::Refunded) => true,

            // Terminal states cannot transition
            (PaymentStatus::Completed, _) => false,
            (PaymentStatus::Refunded, _) => false,
            (PaymentStatus::Cancelled, _) => false,

            // All other transitions are invalid
            _ => false,
        }
    }

    /// Checks if the payment is in a terminal state
    pub fn is_terminal(&self) -> bool {
        matches!(
            self.status,
            PaymentStatus::Completed | PaymentStatus::Refunded | PaymentStatus::Cancelled
        )
    }
}

impl EscrowAccount {
    /// Validates escrow account structure
    pub fn validate(&self) -> Result<(), PaymentError> {
        if self.locked_amount <= 0 {
            return Err(PaymentError::InvalidAmount);
        }
        Ok(())
    }

    /// Checks if release conditions are satisfied
    pub fn can_release(&self, current_timestamp: u64, approver: Option<&Address>, proof_bundle: Option<&ProofBundle>) -> bool {
        // Check timestamp condition
        if current_timestamp < self.release_conditions.min_timestamp {
            return false;
        }

        // Check medical records verification
        if !self.release_conditions.medical_records_verified {
            return false;
        }

        // Check approver if required
        if let Some(required_approver) = &self.release_conditions.authorized_approver {
            if let Some(provided_approver) = approver {
                if required_approver != provided_approver {
                    return false;
                }
            } else {
                return false;
            }
        }

        // Check proof bundle requirement
        if self.release_conditions.require_proof_bundle {
            match proof_bundle {
                Some(bundle) if bundle.validated => {}
                _ => return false,
            }
        }

        true
    }
}

impl FeeStructure {
    /// Calculates total fees
    pub fn total(&self) -> i128 {
        self.service_fee + self.network_fee + self.performance_bonus + self.fixed_fee
    }

    /// Validates fee structure
    pub fn validate(&self) -> Result<(), PaymentError> {
        if self.service_fee < 0
            || self.network_fee < 0
            || self.performance_bonus < 0
            || self.fixed_fee < 0
        {
            return Err(PaymentError::InvalidFee);
        }
        Ok(())
    }

    /// Calculates net amount after deducting fees
    pub fn calculate_net_amount(&self, gross_amount: i128) -> Result<i128, PaymentError> {
        let total_fees = self.total();
        if total_fees > gross_amount {
            return Err(PaymentError::FeesExceedAmount);
        }
        Ok(gross_amount - total_fees)
    }
}

/// Error types for payment operations
#[contracttype]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum PaymentError {
    InvalidAmount,
    SamePayerPayee,
    InvalidFee,
    InvalidAsset,
    FeesExceedAmount,
    InvalidTransition,
    EscrowNotReleasable,
    /// Escrow release requires a proof bundle but none was provided
    ProofBundleMissing,
    /// Proof bundle exists but has not been validated
    ProofBundleInvalid,
}
