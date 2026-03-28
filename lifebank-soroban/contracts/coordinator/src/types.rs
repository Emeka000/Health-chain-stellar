use soroban_sdk::{contracttype, Vec};

/// Canonical workflow states — shared identifier across all contracts.
#[contracttype]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum WorkflowStatus {
    /// Initial state before allocate_units is called.
    Pending,
    /// Units reserved, request approved.
    Allocated,
    /// All units delivered to hospital.
    Delivered,
    /// Payment released to blood bank.
    Settled,
    /// Workflow rolled back; units released, payment refunded.
    RolledBack,
}

/// Per-request workflow record stored in the coordinator.
/// This is the canonical cross-contract state reference.
#[contracttype]
#[derive(Clone, Debug)]
pub struct WorkflowRecord {
    /// Stable identifier shared across all contracts.
    pub request_id: u64,
    /// Payment record ID in the payment contract.
    pub payment_id: u64,
    /// Inventory unit IDs allocated to this request.
    pub unit_ids: Vec<u64>,
    pub status: WorkflowStatus,
    pub delivery_confirmed: bool,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum DataKey {
    Admin,
    RequestContract,
    InventoryContract,
    PaymentContract,
    Workflow(u64),
}
