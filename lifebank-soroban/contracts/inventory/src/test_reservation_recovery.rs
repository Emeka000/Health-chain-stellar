//! Recovery after a reservation leaves the active ledger (issue #1819).
use crate::{
    storage, types::DataKey, BloodStatus, BloodType, ContractError, InventoryContract,
    InventoryContractClient,
};
use soroban_sdk::{
    contract, contractimpl, symbol_short,
    testutils::{storage::Persistent as _, Address as _, Events as _, Ledger as _},
    vec,
    xdr::{LedgerKey, ScVal},
    Address, Env, IntoVal, String, TryFromVal, Val, Vec,
};

fn setup(count: u32) -> (Env, Address, Address, Vec<u64>) {
    let env = Env::default();
    env.mock_all_auths();
    let id = env.register(InventoryContract, ());
    let bank = Address::generate(&env);
    let client = InventoryContractClient::new(&env, &id);
    client.initialize(&bank);
    let mut units = Vec::new(&env);
    for i in 0..count {
        let serial = String::from_str(&env, if i == 0 { "RECOVERY-1" } else { "RECOVERY-2" });
        units.push_back(client.register_blood(&bank, &serial, &BloodType::OPositive, &450, &None));
    }
    (env, id, bank, units)
}

fn reserve(env: &Env, id: &Address, bank: &Address, units: &Vec<u64>) -> u64 {
    InventoryContractClient::new(env, id).reserve_blood(bank, bank, units, &1, &3600)
}

fn has_reference(env: &Env, id: &Address, unit: u64) -> bool {
    env.as_contract(id, || {
        env.storage()
            .persistent()
            .has(&DataKey::UnitReservation(unit))
    })
}

fn assert_available(env: &Env, id: &Address, units: &Vec<u64>) {
    let client = InventoryContractClient::new(env, id);
    for unit in units.iter() {
        assert_eq!(client.get_blood_unit(&unit).status, BloodStatus::Available);
        env.as_contract(id, || {
            let available: Vec<u64> = env
                .storage()
                .persistent()
                .get(&DataKey::StatusIndexPage(BloodStatus::Available, 0))
                .unwrap();
            let reserved: Vec<u64> = env
                .storage()
                .persistent()
                .get(&DataKey::StatusIndexPage(BloodStatus::Reserved, 0))
                .unwrap();
            assert!(available.contains(unit));
            assert!(!reserved.contains(unit));
        });
    }
}

// SDK recording mode automatically restores expired persistent entries.
// Advance the actual live-until boundary and evict the reservation from the
// active-ledger snapshot, instead of relying on that test-only auto-restore.
fn archive_reservation(
    env: &Env,
    id: &Address,
    reservation: u64,
    units: &Vec<u64>,
) -> (Env, Address) {
    let reservation_ttl = env.as_contract(id, || {
        env.storage()
            .persistent()
            .get_ttl(&DataKey::Reservation(reservation))
    });
    env.as_contract(id, || {
        for unit in units.iter() {
            assert!(
                env.storage()
                    .persistent()
                    .get_ttl(&DataKey::UnitReservation(unit))
                    > reservation_ttl
            );
            assert!(
                env.storage()
                    .persistent()
                    .get_ttl(&DataKey::BloodUnit(unit))
                    > reservation_ttl
            );
        }
    });
    let mut snapshot = env.to_ledger_snapshot();
    snapshot.sequence_number += reservation_ttl + 1;
    snapshot.timestamp += u64::from(reservation_ttl + 1) * 5;
    let key: Val = DataKey::Reservation(reservation).into_val(env);
    let key = ScVal::try_from_val(env, &key).unwrap();
    let contract = match ScVal::from(id) {
        ScVal::Address(address) => address,
        _ => panic!("expected contract address"),
    };
    let mut evicted = 0;
    snapshot
        .ledger_entries
        .retain(|(ledger_key, (_, live_until))| {
            if let LedgerKey::ContractData(data) = &**ledger_key {
                if data.contract == contract && data.key == key {
                    assert!(live_until.unwrap() < snapshot.sequence_number);
                    evicted += 1;
                    return false;
                }
                if data.contract == contract {
                    assert!(
                        live_until.unwrap() >= snapshot.sequence_number,
                        "the recovery fixture must keep all other contract entries live"
                    );
                }
            }
            true
        });
    assert_eq!(evicted, 1);
    let recovered_env = Env::from_ledger_snapshot(snapshot);
    let recovered_id = Address::try_from_val(&recovered_env, &contract).unwrap();
    recovered_env.register_at(&recovered_id, InventoryContract, ());
    recovered_env.mock_auths(&[]);
    (recovered_env, recovered_id)
}

#[test]
fn archived_reservation_units_recover_without_admin_auth() {
    let (env, id, bank, units) = setup(2);
    let reservation = reserve(&env, &id, &bank, &units);
    let (active, active_id) = archive_reservation(&env, &id, reservation, &units);
    let client = InventoryContractClient::new(&active, &active_id);
    assert_eq!(
        client.try_expire_reservation(&reservation),
        Err(Ok(ContractError::ReservationNotFound))
    );
    for unit in units.iter() {
        assert_eq!(client.get_blood_unit(&unit).status, BloodStatus::Reserved);
        assert!(client.release_unit_if_orphaned(&unit));
        assert!(!has_reference(&active, &active_id, unit));
        let history = client.get_status_history(&unit);
        assert_eq!(history.len(), 1);
        assert_eq!(history.get(0).unwrap().from_status, BloodStatus::Reserved);
        assert_eq!(history.get(0).unwrap().to_status, BloodStatus::Available);
        assert_eq!(history.get(0).unwrap().authorized_by, active_id);
        let events = active.events().all().len();
        assert!(!client.release_unit_if_orphaned(&unit));
        assert_eq!(client.get_status_history(&unit).len(), 1);
        assert_eq!(active.events().all().len(), events);
    }
    assert_available(&active, &active_id, &units);
    assert!(active.auths().is_empty());
}

#[test]
fn recovery_rejects_before_expiry_and_succeeds_at_exact_boundary() {
    let (env, id, bank, units) = setup(1);
    reserve(&env, &id, &bank, &units);
    let unit = units.get(0).unwrap();
    let client = InventoryContractClient::new(&env, &id);
    env.mock_auths(&[]);
    env.ledger().set_timestamp(3599);
    assert_eq!(
        client.try_release_unit_if_orphaned(&unit),
        Err(Ok(ContractError::ReservationNotExpired))
    );
    // The SDK drops events from failed invocations; no recovery event is committed.
    assert!(env.events().all().is_empty());
    assert_eq!(client.get_blood_unit(&unit).status, BloodStatus::Reserved);
    assert!(has_reference(&env, &id, unit));
    assert!(client.get_status_history(&unit).is_empty());
    env.ledger().set_timestamp(3600);
    assert!(client.release_unit_if_orphaned(&unit));
    assert_available(&env, &id, &units);
}

#[test]
fn normal_release_and_expiry_remove_recovery_references() {
    for expire in [false, true] {
        let (env, id, bank, units) = setup(2);
        let reservation = reserve(&env, &id, &bank, &units);
        let client = InventoryContractClient::new(&env, &id);
        if expire {
            env.ledger().set_timestamp(3600);
            env.mock_auths(&[]);
            client.expire_reservation(&reservation);
        } else {
            client.release_reservation(&bank, &reservation);
        }
        for unit in units.iter() {
            assert!(!has_reference(&env, &id, unit));
            assert!(!client.release_unit_if_orphaned(&unit));
        }
        assert_available(&env, &id, &units);
    }
}

#[test]
fn old_reservation_cleanup_preserves_a_newer_reservation() {
    let (env, id, bank, units) = setup(2);
    let old = reserve(&env, &id, &bank, &units);
    let client = InventoryContractClient::new(&env, &id);
    env.ledger().set_timestamp(3600);
    assert!(client.release_unit_if_orphaned(&units.get(0).unwrap()));
    let new_units = vec![&env, units.get(0).unwrap()];
    let new = client.reserve_blood(&bank, &bank, &new_units, &2, &3600);
    env.mock_auths(&[]);
    client.expire_reservation(&old);
    assert_eq!(
        client.get_blood_unit(&units.get(0).unwrap()).status,
        BloodStatus::Reserved
    );
    assert_eq!(
        client.get_blood_unit(&units.get(1).unwrap()).status,
        BloodStatus::Available
    );
    env.as_contract(&id, || {
        assert_eq!(
            storage::get_unit_reservation(&env, units.get(0).unwrap())
                .unwrap()
                .reservation_id,
            new
        );
    });
    assert_eq!(
        client.try_release_unit_if_orphaned(&units.get(0).unwrap()),
        Err(Ok(ContractError::ReservationNotExpired))
    );
}

#[test]
fn recovery_does_not_revert_progressed_units() {
    for status in [
        BloodStatus::InTransit,
        BloodStatus::Compromised,
        BloodStatus::Expired,
    ] {
        let (env, id, bank, units) = setup(1);
        reserve(&env, &id, &bank, &units);
        let unit = units.get(0).unwrap();
        let client = InventoryContractClient::new(&env, &id);
        client.update_status(&unit, &status, &bank, &None);
        assert!(!has_reference(&env, &id, unit));
        env.ledger().set_timestamp(3600);
        env.mock_auths(&[]);
        let history = client.get_status_history(&unit).len();
        let events = env.events().all().len();
        assert!(!client.release_unit_if_orphaned(&unit));
        assert_eq!(client.get_blood_unit(&unit).status, status);
        assert_eq!(client.get_status_history(&unit).len(), history);
        assert_eq!(env.events().all().len(), events);
        assert!(!has_reference(&env, &id, unit));
    }
}

#[test]
fn direct_status_reservation_does_not_inherit_an_old_recovery_deadline() {
    let (env, id, bank, units) = setup(1);
    reserve(&env, &id, &bank, &units);
    let unit = units.get(0).unwrap();
    let client = InventoryContractClient::new(&env, &id);
    client.update_status(&unit, &BloodStatus::Available, &bank, &None);
    client.update_status(&unit, &BloodStatus::Reserved, &bank, &None);
    env.ledger().set_timestamp(3600);
    env.mock_auths(&[]);
    assert!(!client.release_unit_if_orphaned(&unit));
    assert_eq!(client.get_blood_unit(&unit).status, BloodStatus::Reserved);
}

#[test]
fn legacy_reservation_without_reference_still_releases_normally() {
    let (env, id, bank, units) = setup(1);
    let reservation = reserve(&env, &id, &bank, &units);
    let unit = units.get(0).unwrap();
    env.as_contract(&id, || storage::remove_unit_reservation(&env, unit));
    let client = InventoryContractClient::new(&env, &id);
    env.ledger().set_timestamp(3600);
    env.mock_auths(&[]);
    assert!(!client.release_unit_if_orphaned(&unit));
    assert!(!client.release_unit_if_orphaned(&999));
    assert_eq!(client.get_blood_unit(&unit).status, BloodStatus::Reserved);
    client.expire_reservation(&reservation);
    assert_available(&env, &id, &units);
}

#[test]
fn paused_recovery_keeps_unit_and_reference() {
    let (env, id, bank, units) = setup(1);
    reserve(&env, &id, &bank, &units);
    let client = InventoryContractClient::new(&env, &id);
    client.pause(&bank);
    env.ledger().set_timestamp(3600);
    env.mock_auths(&[]);
    let unit = units.get(0).unwrap();
    assert_eq!(
        client.try_release_unit_if_orphaned(&unit),
        Err(Ok(ContractError::ContractPaused))
    );
    assert!(has_reference(&env, &id, unit));
    assert_eq!(client.get_blood_unit(&unit).status, BloodStatus::Reserved);
}

#[test]
fn unit_updates_keep_recovery_reference_live() {
    let (env, id, bank, units) = setup(1);
    reserve(&env, &id, &bank, &units);
    let unit = units.get(0).unwrap();
    env.ledger()
        .with_mut(|ledger| ledger.sequence_number += storage::TTL_THRESHOLD + 1);
    env.as_contract(&id, || {
        let blood = storage::get_blood_unit(&env, unit).unwrap();
        storage::set_blood_unit(&env, &blood);
        assert_eq!(
            env.storage()
                .persistent()
                .get_ttl(&DataKey::BloodUnit(unit)),
            env.storage()
                .persistent()
                .get_ttl(&DataKey::UnitReservation(unit))
        );
        assert!(
            env.storage()
                .persistent()
                .get_ttl(&DataKey::UnitReservation(unit))
                >= storage::TTL_EXTEND_TO
        );
    });
}

#[contract]
struct RecoveryRegistry;

#[contractimpl]
impl RecoveryRegistry {
    pub fn inventory_release_unit(
        env: Env,
        inventory: Address,
        bank: Address,
        unit: u64,
    ) -> Result<(), ContractError> {
        inventory.require_auth();
        let expected: Address = env
            .storage()
            .instance()
            .get(&symbol_short!("bank"))
            .unwrap();
        assert_eq!(bank, expected);
        if env
            .storage()
            .instance()
            .get::<_, bool>(&symbol_short!("fail"))
            .unwrap_or(false)
        {
            return Err(ContractError::InvalidInput);
        }
        env.storage().persistent().set(&unit, &true);
        Ok(())
    }
}

#[test]
fn registry_release_is_permissionless_and_failure_rolls_back() {
    for fail in [false, true] {
        let (env, id, bank, units) = setup(1);
        reserve(&env, &id, &bank, &units);
        let registry = env.register(RecoveryRegistry, ());
        env.as_contract(&registry, || {
            env.storage().instance().set(&symbol_short!("bank"), &bank);
            env.storage().instance().set(&symbol_short!("fail"), &fail);
        });
        InventoryContractClient::new(&env, &id).set_registry_contract(&bank, &registry);
        let client = InventoryContractClient::new(&env, &id);
        env.ledger().set_timestamp(3600);
        env.mock_auths(&[]);
        let unit = units.get(0).unwrap();
        let history = client.get_status_history(&unit).len();
        let events = env.events().all().len();
        if fail {
            assert_eq!(
                client.try_release_unit_if_orphaned(&unit),
                Err(Ok(ContractError::RegistryCallFailed))
            );
            assert_eq!(client.get_blood_unit(&unit).status, BloodStatus::Reserved);
            assert!(has_reference(&env, &id, unit));
            assert_eq!(client.get_status_history(&unit).len(), history);
            assert_eq!(env.events().all().len(), events);
        } else {
            assert!(client.release_unit_if_orphaned(&unit));
            assert_available(&env, &id, &units);
            assert!(!has_reference(&env, &id, unit));
        }
        env.as_contract(&registry, || {
            assert_eq!(
                env.storage()
                    .persistent()
                    .get::<_, bool>(&unit)
                    .unwrap_or(false),
                !fail
            );
        });
        assert!(env.auths().is_empty());
    }
}
