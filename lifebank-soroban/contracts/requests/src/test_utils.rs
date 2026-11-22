//! Shared test doubles for the requests contract tests.
use crate::inventory_client::InventoryReservation;
use crate::RequestContractClient;
use soroban_sdk::{contract, contracterror, contractimpl, Address, Env, Vec};

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum MockInventoryError {
    ReservationNotFound = 150,
}

/// Minimal inventory mock: release calls succeed, and reservations seeded via
/// `seed_reservation` are returned by `get_reservation`.
#[contract]
pub struct MockInventory;

#[contractimpl]
impl MockInventory {
    pub fn release_reservation(_env: Env, _caller: Address, _reservation_id: u64) {}
    pub fn release_reservation_by_contract(
        _env: Env,
        _authorized_contract: Address,
        _reservation_id: u64,
    ) {
    }

    pub fn seed_reservation(env: Env, reservation_id: u64, request_id: u64, requester: Address) {
        let reservation = InventoryReservation {
            unit_ids: Vec::new(&env),
            requester: requester.clone(),
            reserved_by: requester,
            created_timestamp: 0,
            expiration_timestamp: u64::MAX,
            request_id,
        };
        env.storage().persistent().set(&reservation_id, &reservation);
    }

    pub fn get_reservation(
        env: Env,
        reservation_id: u64,
    ) -> Result<InventoryReservation, MockInventoryError> {
        env.storage()
            .persistent()
            .get(&reservation_id)
            .ok_or(MockInventoryError::ReservationNotFound)
    }
}

/// Seed a reservation `reservation_id` for `request_id` owned by `requester`
/// on the mock inventory wired into `client`.
pub fn seed_reservation(
    env: &Env,
    client: &RequestContractClient<'_>,
    reservation_id: u64,
    request_id: u64,
    requester: &Address,
) {
    MockInventoryClient::new(env, &client.get_inventory_contract()).seed_reservation(
        &reservation_id,
        &request_id,
        requester,
    );
}
