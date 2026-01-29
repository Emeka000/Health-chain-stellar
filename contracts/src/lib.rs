#![no_std]
use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, symbol_short, vec, Address, Env, Map,
    String, Symbol, Vec,
};

/// Error types for blood registration and transfer
#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Error {
    Unauthorized = 1,
    InvalidQuantity = 2,
    InvalidExpiration = 3,
    DuplicateRegistration = 4,
    StorageError = 5,
    InvalidStatus = 6,
    UnitNotFound = 7,
    UnitExpired = 8,
    UnauthorizedHospital = 9,
    InvalidTransition = 10,
    AlreadyAllocated = 11,
    BatchSizeExceeded = 12,
}

/// Blood type enumeration
#[contracttype]
#[derive(Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub enum BloodType {
    APositive,
    ANegative,
    BPositive,
    BNegative,
    ABPositive,
    ABNegative,
    OPositive,
    ONegative,
}

/// Blood status enumeration
#[contracttype]
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub enum BloodStatus {
    Available,
    Reserved,
    InTransit,
    Delivered,
    Expired,
    Discarded,
}

/// Withdrawal reason enumeration
#[contracttype]
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub enum WithdrawalReason {
    Used,
    Contaminated,
    Damaged,
    Other,
}

/// Blood unit inventory record
#[contracttype]
#[derive(Clone)]
pub struct BloodUnit {
    pub id: u64,
    pub blood_type: BloodType,
    pub quantity: u32,
    pub expiration_date: u64,
    pub donor_id: Symbol,
    pub location: Symbol,
    pub bank_id: Address,
    pub registration_timestamp: u64,
    pub status: BloodStatus,
    pub recipient_hospital: Option<Address>,
    pub allocation_timestamp: Option<u64>,
    pub transfer_timestamp: Option<u64>,
    pub delivery_timestamp: Option<u64>,
}

/// Transfer record
#[contracttype]
#[derive(Clone)]
pub struct TransferRecord {
    pub blood_unit_id: u64,
    pub from_bank: Address,
    pub to_hospital: Address,
    pub allocation_timestamp: u64,
    pub transfer_timestamp: Option<u64>,
    pub delivery_timestamp: Option<u64>,
    pub status: BloodStatus,
}

/// Status change event
#[contracttype]
#[derive(Clone)]
pub struct StatusChangeEvent {
    pub blood_unit_id: u64,
    pub old_status: BloodStatus,
    pub new_status: BloodStatus,
    pub actor: Address,
    pub timestamp: u64,
}

/// Blood request record
#[contracttype]
#[derive(Clone)]
pub struct BloodRequest {
    pub id: u64,
    pub hospital_id: Address,
    pub blood_type: BloodType,
    pub quantity_ml: u32,
    pub urgency: UrgencyLevel,
    pub required_by: u64,
    pub delivery_address: String,
    pub created_at: u64,
}

/// Key for detecting duplicate requests
#[contracttype]
#[derive(Clone, PartialEq, Eq, PartialOrd, Ord)]
pub struct RequestKey {
    pub hospital_id: Address,
    pub blood_type: BloodType,
    pub quantity_ml: u32,
    pub urgency: UrgencyLevel,
    pub required_by: u64,
    pub delivery_address: String,
}

/// Event data for blood registration
#[contracttype]
#[derive(Clone)]
pub struct BloodRegisteredEvent {
    pub unit_id: u64,
    pub bank_id: Address,
    pub blood_type: BloodType,
    pub quantity_ml: u32,
    pub expiration_timestamp: u64,
    pub donor_id: Option<Symbol>,
    pub registration_timestamp: u64,
}

/// Event data for blood request creation
#[contracttype]
#[derive(Clone)]
pub struct RequestCreatedEvent {
    pub request_id: u64,
    pub hospital_id: Address,
    pub blood_type: BloodType,
    pub quantity_ml: u32,
    pub urgency: UrgencyLevel,
    pub required_by: u64,
    pub delivery_address: String,
    pub created_at: u64,
}

/// Blood request record
#[contracttype]
#[derive(Clone)]
pub struct BloodRequest {
    pub id: u64,
    pub hospital_id: Address,
    pub blood_type: BloodType,
    pub quantity: u32,
    pub urgency: UrgencyLevel,
    pub required_by: u64,
    pub delivery_address: Symbol, // Changed to Symbol for Soroban efficiency
    pub status: Symbol,           // e.g., "PENDING"
    pub created_at: u64,
}

/// Event data for blood requests
#[contracttype]
#[derive(Clone)]
pub struct BloodRequestEvent {
    pub request_id: u64,
    pub hospital_id: Address,
    pub blood_type: BloodType,
    pub quantity_ml: u32,
    pub urgency: UrgencyLevel,
}

/// Storage keys
const BLOOD_UNITS: Symbol = symbol_short!("UNITS");
const NEXT_ID: Symbol = symbol_short!("NEXT_ID");
const BLOOD_BANKS: Symbol = symbol_short!("BANKS");
const HOSPITALS: Symbol = symbol_short!("HOSPS");
const ADMIN: Symbol = symbol_short!("ADMIN");
const HOSPITALS: Symbol = symbol_short!("HOSPITALS");
const REQUESTS: Symbol = symbol_short!("REQUESTS");
const NEXT_REQUEST_ID: Symbol = symbol_short!("NEXT_REQ");
const REQUEST_KEYS: Symbol = symbol_short!("REQ_KEYS");
const BLOOD_REQUESTS: Symbol = symbol_short!("REQS");
const HOSPITALS: Symbol = symbol_short!("HOSPITAL");

// Validation constants
const MIN_QUANTITY_ML: u32 = 50; // Minimum 50ml
const MAX_QUANTITY_ML: u32 = 500; // Maximum 500ml per unit
const MIN_SHELF_LIFE_DAYS: u64 = 1; // At least 1 day shelf life
const MAX_SHELF_LIFE_DAYS: u64 = 42; // Maximum 42 days for whole blood
const MIN_REQUEST_ML: u32 = 50; // Minimum request amount
const MAX_REQUEST_ML: u32 = 5000; // Maximum request amount

#[contract]
pub struct HealthChainContract;

#[contractimpl]
impl HealthChainContract {
    /// Initialize the contract with admin
    pub fn initialize(env: Env, admin: Address) -> Symbol {
        admin.require_auth();
        env.storage().instance().set(&ADMIN, &admin);
        symbol_short!("init")
    }

    /// Register a blood bank (admin only)
    pub fn register_blood_bank(env: Env, bank_id: Address) -> Result<(), Error> {
        let admin: Address = env
            .storage()
            .instance()
            .get(&ADMIN)
            .ok_or(Error::Unauthorized)?;
        admin.require_auth();

        let mut banks: Map<Address, bool> = env
            .storage()
            .persistent()
            .get(&BLOOD_BANKS)
            .unwrap_or(Map::new(&env));

        banks.set(bank_id.clone(), true);
        env.storage().persistent().set(&BLOOD_BANKS, &banks);

        Ok(())
    }

    /// Register a hospital (admin only)
    pub fn register_hospital(env: Env, hospital_id: Address) -> Result<(), Error> {
        let admin: Address = env
            .storage()
            .instance()
            .get(&ADMIN)
            .ok_or(Error::Unauthorized)?;
        admin.require_auth();

        let mut hospitals: Map<Address, bool> = env
            .storage()
            .persistent()
            .get(&HOSPITALS)
            .unwrap_or(Map::new(&env));

        hospitals.set(hospital_id.clone(), true);
        env.storage().persistent().set(&HOSPITALS, &hospitals);

        Ok(())
    }

    /// Register blood donation into inventory
    pub fn register_blood(
        env: Env,
        bank_id: Address,
        blood_type: BloodType,
        quantity_ml: u32,
        expiration_timestamp: u64,
        donor_id: Option<Symbol>,
    ) -> Result<u64, Error> {
        // Authenticate blood bank
        bank_id.require_auth();

        // Verify blood bank is authorized
        let banks: Map<Address, bool> = env
            .storage()
            .persistent()
            .get(&BLOOD_BANKS)
            .unwrap_or(Map::new(&env));

        if !banks.get(bank_id.clone()).unwrap_or(false) {
            return Err(Error::Unauthorized);
        }

        // Validate quantity
        if !(MIN_QUANTITY_ML..=MAX_QUANTITY_ML).contains(&quantity_ml) {
            return Err(Error::InvalidQuantity);
        }

        // Validate expiration date
        let current_time = env.ledger().timestamp();
        let min_expiration = current_time + (MIN_SHELF_LIFE_DAYS * 86400);
        let max_expiration = current_time + (MAX_SHELF_LIFE_DAYS * 86400);

        if expiration_timestamp <= current_time || expiration_timestamp < min_expiration {
            return Err(Error::InvalidExpiration);
        }

        if expiration_timestamp > max_expiration {
            return Err(Error::InvalidExpiration);
        }

        // Generate unique ID
        let unit_id = Self::get_next_id(&env);

        // Create blood unit
        let blood_unit = BloodUnit {
            id: unit_id,
            blood_type,
            quantity: quantity_ml,
            expiration_date: expiration_timestamp,
            donor_id: donor_id.clone().unwrap_or(symbol_short!("ANON")),
            location: symbol_short!("BANK"),
            bank_id: bank_id.clone(),
            registration_timestamp: current_time,
            status: BloodStatus::Available,
            recipient_hospital: None,
            allocation_timestamp: None,
            transfer_timestamp: None,
            delivery_timestamp: None,
        };

        // Store blood unit
        let mut units: Map<u64, BloodUnit> = env
            .storage()
            .persistent()
            .get(&BLOOD_UNITS)
            .unwrap_or(Map::new(&env));

        units.set(unit_id, blood_unit);
        env.storage().persistent().set(&BLOOD_UNITS, &units);

        // Emit event
        let event = BloodRegisteredEvent {
            unit_id,
            bank_id,
            blood_type,
            quantity_ml,
            expiration_timestamp,
            donor_id,
            registration_timestamp: current_time,
        };

        env.events()
            .publish((symbol_short!("blood"), symbol_short!("register")), event);

        Ok(unit_id)
    }

    /// Check if an address is an authorized blood bank
    pub fn is_blood_bank(env: Env, bank_id: Address) -> bool {
        let banks: Map<Address, bool> = env
            .storage()
            .persistent()
            .get(&BLOOD_BANKS)
            .unwrap_or(Map::new(&env));

        banks.get(bank_id).unwrap_or(false)
    }

    /// Register a hospital (admin only)
    pub fn register_hospital(env: Env, hospital: Address) -> Result<(), Error> {
        let admin: Address = env
            .storage()
            .instance()
            .get(&ADMIN)
            .ok_or(Error::Unauthorized)?;
        admin.require_auth();

        let mut hospitals: Map<Address, bool> = env
            .storage()
            .persistent()
            .get(&HOSPITALS)
            .unwrap_or(Map::new(&env));

        hospitals.set(hospital.clone(), true);
        env.storage().persistent().set(&HOSPITALS, &hospitals);

        env.events().publish(
            (symbol_short!("hospital"), symbol_short!("register")),
            hospital,
        );

        Ok(())
    }

    /// Check if an address is a registered hospital
    pub fn is_hospital(env: Env, hospital: Address) -> bool {
        let hospitals: Map<Address, bool> = env
            .storage()
            .persistent()
            .get(&HOSPITALS)
            .unwrap_or(Map::new(&env));

        hospitals.get(hospital).unwrap_or(false)
    }

    /// Allocate blood unit to a hospital
    pub fn allocate_blood(
        env: Env,
        bank_id: Address,
        unit_id: u64,
        hospital: Address,
    ) -> Result<(), Error> {
        bank_id.require_auth();

        // Verify blood bank is authorized
        if !Self::is_blood_bank(env.clone(), bank_id.clone()) {
            return Err(Error::Unauthorized);
        }

        // Verify hospital is registered
        if !Self::is_hospital(env.clone(), hospital.clone()) {
            return Err(Error::UnauthorizedHospital);
        }

        // Get blood unit
        let mut units: Map<u64, BloodUnit> = env
            .storage()
            .persistent()
            .get(&BLOOD_UNITS)
            .unwrap_or(Map::new(&env));

        let mut unit = units.get(unit_id).ok_or(Error::UnitNotFound)?;

        // Check if expired
        let current_time = env.ledger().timestamp();
        if unit.expiration_date <= current_time {
            return Err(Error::UnitExpired);
        }

        // Check status
        if unit.status != BloodStatus::Available {
            return Err(Error::InvalidStatus);
        }

        // Record old status for event
        let old_status = unit.status;

        // Update unit
        unit.status = BloodStatus::Reserved;
        unit.recipient_hospital = Some(hospital.clone());
        unit.allocation_timestamp = Some(current_time);

        units.set(unit_id, unit.clone());
        env.storage().persistent().set(&BLOOD_UNITS, &units);

        // Record status change
        Self::record_status_change(&env, unit_id, old_status, BloodStatus::Reserved, bank_id.clone());

        // Emit event
        env.events().publish(
            (symbol_short!("blood"), symbol_short!("allocate")),
            (unit_id, hospital, current_time),
        );

        Ok(())
    }

    /// Batch allocate blood units
    pub fn batch_allocate_blood(
        env: Env,
        bank_id: Address,
        unit_ids: Vec<u64>,
        hospital: Address,
    ) -> Result<Vec<u64>, Error> {
        bank_id.require_auth();

        // Check batch size
        if unit_ids.len() > MAX_BATCH_SIZE {
            return Err(Error::BatchSizeExceeded);
        }

        // Verify blood bank is authorized
        if !Self::is_blood_bank(env.clone(), bank_id.clone()) {
            return Err(Error::Unauthorized);
        }

        // Verify hospital is registered
        if !Self::is_hospital(env.clone(), hospital.clone()) {
            return Err(Error::UnauthorizedHospital);
        }

        let mut allocated = vec![&env];
        let mut units: Map<u64, BloodUnit> = env
            .storage()
            .persistent()
            .get(&BLOOD_UNITS)
            .unwrap_or(Map::new(&env));

        let current_time = env.ledger().timestamp();

        // Process all units
        for i in 0..unit_ids.len() {
            let unit_id = unit_ids.get(i).unwrap();
            let mut unit = units.get(unit_id).ok_or(Error::UnitNotFound)?;

            // Check if expired
            if unit.expiration_date <= current_time {
                return Err(Error::UnitExpired);
            }

            // Check status
            if unit.status != BloodStatus::Available {
                return Err(Error::InvalidStatus);
            }

            // Record old status for event
            let old_status = unit.status;

            // Update unit
            unit.status = BloodStatus::Reserved;
            unit.recipient_hospital = Some(hospital.clone());
            unit.allocation_timestamp = Some(current_time);

            units.set(unit_id, unit.clone());

            // Record status change
            Self::record_status_change(&env, unit_id, old_status, BloodStatus::Reserved, bank_id.clone());

            // Emit event
            env.events().publish(
                (symbol_short!("blood"), symbol_short!("allocate")),
                (unit_id, hospital.clone(), current_time),
            );

            allocated.push_back(unit_id);
        }

        // Save all changes
        env.storage().persistent().set(&BLOOD_UNITS, &units);

        Ok(allocated)
    }

    /// Cancel blood allocation
    pub fn cancel_allocation(env: Env, bank_id: Address, unit_id: u64) -> Result<(), Error> {
        bank_id.require_auth();

        // Verify blood bank is authorized
        if !Self::is_blood_bank(env.clone(), bank_id.clone()) {
            return Err(Error::Unauthorized);
        }

        // Get blood unit
        let mut units: Map<u64, BloodUnit> = env
            .storage()
            .persistent()
            .get(&BLOOD_UNITS)
            .unwrap_or(Map::new(&env));

        let mut unit = units.get(unit_id).ok_or(Error::UnitNotFound)?;

        // Check status - can only cancel if Reserved
        if unit.status != BloodStatus::Reserved {
            return Err(Error::InvalidStatus);
        }

        let old_status = unit.status;

        // Update unit back to Available
        unit.status = BloodStatus::Available;
        unit.recipient_hospital = None;
        unit.allocation_timestamp = None;

        units.set(unit_id, unit.clone());
        env.storage().persistent().set(&BLOOD_UNITS, &units);

        // Record status change
        Self::record_status_change(&env, unit_id, old_status, BloodStatus::Available, bank_id.clone());

        // Emit event
        env.events().publish(
            (symbol_short!("blood"), symbol_short!("cancel")),
            unit_id,
        );

        Ok(())
    }

    /// Initiate blood transfer
    pub fn initiate_transfer(env: Env, bank_id: Address, unit_id: u64) -> Result<(), Error> {
        bank_id.require_auth();

        // Verify blood bank is authorized
        if !Self::is_blood_bank(env.clone(), bank_id.clone()) {
            return Err(Error::Unauthorized);
        }

        // Get blood unit
        let mut units: Map<u64, BloodUnit> = env
            .storage()
            .persistent()
            .get(&BLOOD_UNITS)
            .unwrap_or(Map::new(&env));

        let mut unit = units.get(unit_id).ok_or(Error::UnitNotFound)?;

        // Check if expired
        let current_time = env.ledger().timestamp();
        if unit.expiration_date <= current_time {
            return Err(Error::UnitExpired);
        }

        // Check status - must be Reserved
        if unit.status != BloodStatus::Reserved {
            return Err(Error::InvalidStatus);
        }

        let old_status = unit.status;

        // Update unit
        unit.status = BloodStatus::InTransit;
        unit.transfer_timestamp = Some(current_time);

        units.set(unit_id, unit.clone());
        env.storage().persistent().set(&BLOOD_UNITS, &units);

        // Record status change
        Self::record_status_change(&env, unit_id, old_status, BloodStatus::InTransit, bank_id.clone());

        // Emit event
        env.events().publish(
            (symbol_short!("blood"), symbol_short!("transfer")),
            (unit_id, current_time),
        );

        Ok(())
    }

    /// Confirm blood delivery
    pub fn confirm_delivery(env: Env, hospital: Address, unit_id: u64) -> Result<(), Error> {
        hospital.require_auth();

        // Verify hospital is registered
        if !Self::is_hospital(env.clone(), hospital.clone()) {
            return Err(Error::UnauthorizedHospital);
        }

        // Get blood unit
        let mut units: Map<u64, BloodUnit> = env
            .storage()
            .persistent()
            .get(&BLOOD_UNITS)
            .unwrap_or(Map::new(&env));

        let mut unit = units.get(unit_id).ok_or(Error::UnitNotFound)?;

        // Verify hospital is the recipient
        if unit.recipient_hospital != Some(hospital.clone()) {
            return Err(Error::Unauthorized);
        }

        // Check status - must be InTransit
        if unit.status != BloodStatus::InTransit {
            return Err(Error::InvalidStatus);
        }

        let current_time = env.ledger().timestamp();
        let old_status = unit.status;

        // Check if expired during transit
        if unit.expiration_date <= current_time {
            unit.status = BloodStatus::Expired;
            units.set(unit_id, unit.clone());
            env.storage().persistent().set(&BLOOD_UNITS, &units);
            Self::record_status_change(&env, unit_id, old_status, BloodStatus::Expired, hospital.clone());
            return Err(Error::UnitExpired);
        }

        // Update unit
        unit.status = BloodStatus::Delivered;
        unit.delivery_timestamp = Some(current_time);

        units.set(unit_id, unit.clone());
        env.storage().persistent().set(&BLOOD_UNITS, &units);

        // Record status change
        Self::record_status_change(&env, unit_id, old_status, BloodStatus::Delivered, hospital.clone());

        // Emit event
        env.events().publish(
            (symbol_short!("blood"), symbol_short!("deliver")),
            (unit_id, current_time),
        );

        Ok(())
    }

    /// Withdraw blood unit (mark as used/discarded)
    pub fn withdraw_blood(
        env: Env,
        caller: Address,
        unit_id: u64,
        reason: WithdrawalReason,
    ) -> Result<(), Error> {
        caller.require_auth();

        // Verify caller is authorized (blood bank or hospital)
        let is_bank = Self::is_blood_bank(env.clone(), caller.clone());
        let is_hosp = Self::is_hospital(env.clone(), caller.clone());

        if !is_bank && !is_hosp {
            return Err(Error::Unauthorized);
        }

        // Get blood unit
        let mut units: Map<u64, BloodUnit> = env
            .storage()
            .persistent()
            .get(&BLOOD_UNITS)
            .unwrap_or(Map::new(&env));

        let mut unit = units.get(unit_id).ok_or(Error::UnitNotFound)?;

        let old_status = unit.status;
        let current_time = env.ledger().timestamp();

        // Update unit
        unit.status = BloodStatus::Discarded;

        units.set(unit_id, unit.clone());
        env.storage().persistent().set(&BLOOD_UNITS, &units);

        // Record status change
        Self::record_status_change(&env, unit_id, old_status, BloodStatus::Discarded, caller.clone());

        // Emit event
        env.events().publish(
            (symbol_short!("blood"), symbol_short!("withdraw")),
            (unit_id, reason, current_time),
        );

        Ok(())
    }

    /// Get blood unit by ID
    pub fn get_blood_unit(env: Env, unit_id: u64) -> Result<BloodUnit, Error> {
        let units: Map<u64, BloodUnit> = env
            .storage()
            .persistent()
            .get(&BLOOD_UNITS)
            .unwrap_or(Map::new(&env));

        units.get(unit_id).ok_or(Error::UnitNotFound)
    }

    /// Get blood status
    pub fn get_blood_status(env: Env, unit_id: u64) -> Result<BloodStatus, Error> {
        let unit = Self::get_blood_unit(env, unit_id)?;
        Ok(unit.status)
    }

    /// Query blood units by status
    pub fn query_by_status(
        env: Env,
        status: BloodStatus,
        max_results: u32,
    ) -> Vec<BloodUnit> {
        let units: Map<u64, BloodUnit> = env
            .storage()
            .persistent()
            .get(&BLOOD_UNITS)
            .unwrap_or(Map::new(&env));

        let mut results = vec![&env];
        let mut count = 0u32;

        for (_, unit) in units.iter() {
            if unit.status == status {
                results.push_back(unit);
                count += 1;
                if max_results > 0 && count >= max_results {
                    break;
                }
            }
        }

        results
    }

    /// Query blood units by hospital
    pub fn query_by_hospital(
        env: Env,
        hospital: Address,
        max_results: u32,
    ) -> Vec<BloodUnit> {
        let units: Map<u64, BloodUnit> = env
            .storage()
            .persistent()
            .get(&BLOOD_UNITS)
            .unwrap_or(Map::new(&env));

        let mut results = vec![&env];
        let mut count = 0u32;

        for (_, unit) in units.iter() {
            if unit.recipient_hospital == Some(hospital.clone()) {
                results.push_back(unit);
                count += 1;
                if max_results > 0 && count >= max_results {
                    break;
                }
            }
        }

        results
    }

    /// Get transfer history for a blood unit
    pub fn get_transfer_history(env: Env, unit_id: u64) -> Vec<StatusChangeEvent> {
        let history_key = (HISTORY, unit_id);
        env.storage()
            .persistent()
            .get(&history_key)
            .unwrap_or(vec![&env])
    }

    /// Helper: Record status change in history
    fn record_status_change(
        env: &Env,
        unit_id: u64,
        old_status: BloodStatus,
        new_status: BloodStatus,
        actor: Address,
    ) {
        let history_key = (HISTORY, unit_id);
        let mut history: Vec<StatusChangeEvent> = env
            .storage()
            .persistent()
            .get(&history_key)
            .unwrap_or(vec![env]);

        let event = StatusChangeEvent {
            blood_unit_id: unit_id,
            old_status,
            new_status,
            actor,
            timestamp: env.ledger().timestamp(),
        };

        history.push_back(event.clone());
        env.storage().persistent().set(&history_key, &history);

        // Also emit event
        env.events().publish(
            (symbol_short!("status"), symbol_short!("change")),
            event,
        );
    }

    /// Check if an address is an authorized hospital
    pub fn is_hospital(env: Env, hospital_id: Address) -> bool {
        let hospitals: Map<Address, bool> = env
            .storage()
            .persistent()
            .get(&HOSPITALS)
            .unwrap_or(Map::new(&env));

        hospitals.get(hospital_id).unwrap_or(false)
    }

    /// Create a blood request (hospital only)
    pub fn create_request(
        env: Env,
        hospital_id: Address,
        blood_type: BloodType,
        quantity_ml: u32,
        urgency: UrgencyLevel,
        required_by: u64,
        delivery_address: String,
    ) -> Result<u64, Error> {
        hospital_id.require_auth();

        let hospitals: Map<Address, bool> = env
            .storage()
            .persistent()
            .get(&HOSPITALS)
            .unwrap_or(Map::new(&env));

        if !hospitals.get(hospital_id.clone()).unwrap_or(false) {
            return Err(Error::Unauthorized);
        }

        if !(MIN_REQUEST_ML..=MAX_REQUEST_ML).contains(&quantity_ml) {
            return Err(Error::InvalidQuantity);
        }

        if delivery_address.len() == 0 {
            return Err(Error::InvalidDeliveryAddress);
        }

        let current_time = env.ledger().timestamp();
        if required_by <= current_time {
            return Err(Error::InvalidRequiredBy);
        }

        let request_key = RequestKey {
            hospital_id: hospital_id.clone(),
            blood_type,
            quantity_ml,
            urgency,
            required_by,
            delivery_address: delivery_address.clone(),
        };

        let mut request_keys: Map<RequestKey, u64> = env
            .storage()
            .persistent()
            .get(&REQUEST_KEYS)
            .unwrap_or(Map::new(&env));

        if request_keys.get(request_key.clone()).is_some() {
            return Err(Error::DuplicateRequest);
        }

        let request_id = Self::get_next_request_id(&env);

        let request = BloodRequest {
            id: request_id,
            hospital_id: hospital_id.clone(),
            blood_type,
            quantity_ml,
            urgency,
            required_by,
            delivery_address: delivery_address.clone(),
            created_at: current_time,
        };

        let mut requests: Map<u64, BloodRequest> = env
            .storage()
            .persistent()
            .get(&REQUESTS)
            .unwrap_or(Map::new(&env));

        requests.set(request_id, request);
        env.storage().persistent().set(&REQUESTS, &requests);

        request_keys.set(request_key, request_id);
        env.storage().persistent().set(&REQUEST_KEYS, &request_keys);

        let event = RequestCreatedEvent {
            request_id,
            hospital_id,
            blood_type,
            quantity_ml,
            urgency,
            required_by,
            delivery_address,
            created_at: current_time,
        };

        env.events()
            .publish((symbol_short!("request"), symbol_short!("create")), event);

        Ok(request_id)
    }

    /// Store a health record hash
    pub fn store_record(env: Env, patient_id: Symbol, record_hash: Symbol) -> Vec<Symbol> {
        vec![&env, patient_id, record_hash]
    }

    /// Retrieve stored record
    pub fn get_record(_env: Env, patient_id: Symbol) -> Symbol {
        patient_id
    }

    /// Verify record access
    pub fn verify_access(_env: Env, _patient_id: Symbol, _provider_id: Symbol) -> bool {
        true
    }

    /// Add a blood unit to inventory (legacy function for testing)
    pub fn add_blood_unit(
        env: Env,
        blood_type: BloodType,
        quantity: u32,
        expiration_date: u64,
        donor_id: Symbol,
        location: Symbol,
    ) -> u64 {
        let id = Self::get_next_id(&env);
        let current_time = env.ledger().timestamp();

        // Create a default address for legacy function using contract address
        let default_bank = env.current_contract_address();

        let unit = BloodUnit {
            id,
            blood_type,
            quantity,
            expiration_date,
            donor_id,
            location,
            bank_id: default_bank,
            registration_timestamp: current_time,
            status: BloodStatus::Available,
            recipient_hospital: None,
            allocation_timestamp: None,
            transfer_timestamp: None,
            delivery_timestamp: None,
        };

        let mut units: Map<u64, BloodUnit> = env
            .storage()
            .persistent()
            .get(&BLOOD_UNITS)
            .unwrap_or(Map::new(&env));

        units.set(id, unit);
        env.storage().persistent().set(&BLOOD_UNITS, &units);

        id
    }

    /// Query blood inventory by blood type with filters
    /// Query blood inventory by blood type with filters
    pub fn query_by_blood_type(
        env: Env,
        blood_type: BloodType,
        min_quantity: u32,
        max_results: u32,
    ) -> Vec<BloodUnit> {
        let units: Map<u64, BloodUnit> = env
            .storage()
            .persistent()
            .get(&BLOOD_UNITS)
            .unwrap_or(Map::new(&env));

        let current_time = env.ledger().timestamp();
        let mut results = vec![&env];
        let mut temp_units = vec![&env];

        // Collect matching units (Available status, non-expired, matching blood type, sufficient quantity)
        for (_, unit) in units.iter() {
            if unit.blood_type == blood_type
                && unit.status == BloodStatus::Available
                && unit.quantity >= min_quantity
                && unit.expiration_date > current_time
            {
                temp_units.push_back(unit);
            }
        }

        // Sort by expiration date (FIFO - earliest expiration first)
        let len = temp_units.len();
        for i in 0..len {
            for j in 0..len.saturating_sub(i + 1) {
                let unit_j = temp_units.get(j).unwrap();
                let unit_j_plus_1 = temp_units.get(j + 1).unwrap();

                if unit_j.expiration_date > unit_j_plus_1.expiration_date {
                    temp_units.set(j, unit_j_plus_1.clone());
                    temp_units.set(j + 1, unit_j);
                }
            }
        }

        // Apply pagination
        let limit = if max_results == 0 {
            len
        } else {
            max_results.min(len)
        };
        for i in 0..limit {
            if let Some(unit) = temp_units.get(i) {
                results.push_back(unit);
            }
        }

        results
    }

    /// Check if sufficient blood quantity is available
    pub fn check_availability(env: Env, blood_type: BloodType, required_quantity: u32) -> bool {
        let units: Map<u64, BloodUnit> = env
            .storage()
            .persistent()
            .get(&BLOOD_UNITS)
            .unwrap_or(Map::new(&env));

        let current_time = env.ledger().timestamp();
        let mut total_quantity: u32 = 0;

        // Sum up available quantities for the blood type (Available status and non-expired only)
        for (_, unit) in units.iter() {
            if unit.blood_type == blood_type 
                && unit.status == BloodStatus::Available
                && unit.expiration_date > current_time {
                total_quantity = total_quantity.saturating_add(unit.quantity);

                // Early exit if we've found enough
                if total_quantity >= required_quantity {
                    return true;
                }
            }
        }

        total_quantity >= required_quantity
    }

    /// Register a hospital (admin only) - Required for authorization
    pub fn register_hospital(env: Env, hospital_id: Address) -> Result<(), Error> {
        let admin: Address = env
            .storage()
            .instance()
            .get(&ADMIN)
            .ok_or(Error::Unauthorized)?;
        admin.require_auth();

        let mut hospitals: Map<Address, bool> = env
            .storage()
            .persistent()
            .get(&HOSPITALS)
            .unwrap_or(Map::new(&env));
        hospitals.set(hospital_id, true);
        env.storage().persistent().set(&HOSPITALS, &hospitals);
        Ok(())
    }

    pub fn create_request(
        env: Env,
        hospital_id: Address,
        blood_type: BloodType,
        quantity_ml: u32,
        urgency: UrgencyLevel,
        required_by: u64,
        delivery_address: Symbol,
    ) -> Result<u64, Error> {
        // 1. Validate hospital authorization
        hospital_id.require_auth();
        let hospitals: Map<Address, bool> = env
            .storage()
            .persistent()
            .get(&HOSPITALS)
            .unwrap_or(Map::new(&env));
        if !hospitals.get(hospital_id.clone()).unwrap_or(false) {
            return Err(Error::Unauthorized);
        }

        // 2. Check blood quantity validity
        if quantity_ml < MIN_QUANTITY_ML {
            return Err(Error::InvalidQuantity);
        }

        // 3. Verify required_by date is in the future
        let current_time = env.ledger().timestamp();
        if required_by <= current_time {
            return Err(Error::InvalidExpiration);
        }

        // 4. Generate unique ID
        let request_id = Self::get_next_id(&env);

        // 5. Store request in persistent storage
        let request = BloodRequest {
            id: request_id,
            hospital_id: hospital_id.clone(),
            blood_type,
            quantity: quantity_ml,
            urgency,
            required_by,
            delivery_address,
            status: symbol_short!("PENDING"),
            created_at: current_time,
        };

        let mut requests: Map<u64, BloodRequest> = env
            .storage()
            .persistent()
            .get(&BLOOD_REQUESTS)
            .unwrap_or(Map::new(&env));

        // Note: duplicate check is handled by the unique ID incrementing,
        // but logic can be added here to check for identical active requests if needed.

        requests.set(request_id, request);
        env.storage().persistent().set(&BLOOD_REQUESTS, &requests);

        // 6. Emit request created event
        let event = BloodRequestEvent {
            request_id,
            hospital_id,
            blood_type,
            quantity_ml,
            urgency,
        };
        env.events()
            .publish((symbol_short!("blood"), symbol_short!("request")), event);

        Ok(request_id)
    }

    /// Helper function to get next ID
    fn get_next_id(env: &Env) -> u64 {
        let id: u64 = env.storage().persistent().get(&NEXT_ID).unwrap_or(1);

        env.storage().persistent().set(&NEXT_ID, &(id + 1));
        id
    }

    /// Helper function to get next request ID
    fn get_next_request_id(env: &Env) -> u64 {
        let id: u64 = env
            .storage()
            .persistent()
            .get(&NEXT_REQUEST_ID)
            .unwrap_or(1);

        env.storage().persistent().set(&NEXT_REQUEST_ID, &(id + 1));
        id
    }
}

#[cfg(test)]
mod test {
    use super::*;
    use soroban_sdk::{
        symbol_short, testutils::Address as _, testutils::Events, Address, Env, String, Symbol,
        TryFromVal,
    };

    fn setup_contract_with_admin<'a>(
        env: &'a Env,
    ) -> (Address, Address, HealthChainContractClient<'a>) {
        symbol_short,
        testutils::{Address as _, Events, Ledger},
        Address, Env, IntoVal,
    };

    fn setup_contract_with_admin(env: &Env) -> (Address, Address, HealthChainContractClient<'_>) {
        let admin = Address::generate(env);
        let contract_id = env.register(HealthChainContract, ());
        let client = HealthChainContractClient::new(env, &contract_id);

        env.mock_all_auths();
        client.initialize(&admin);

        (contract_id, admin, client)
    }

    fn setup_contract_with_hospital<'a>(
        env: &'a Env,
    ) -> (Address, Address, Address, HealthChainContractClient<'a>) {
        let (contract_id, admin, client) = setup_contract_with_admin(env);
        let hospital = Address::generate(env);

        env.mock_all_auths();
        client.register_hospital(&hospital);

        env.mock_all_auths();

        (contract_id, admin, hospital, client)
    }

    #[test]
    fn test_initialize() {
        let env = Env::default();
        let admin = Address::generate(&env);
        let contract_id = env.register(HealthChainContract, ());
        let client = HealthChainContractClient::new(&env, &contract_id);

        env.mock_all_auths();
        let result = client.initialize(&admin);
        assert_eq!(result, symbol_short!("init"));
    }

    #[test]
    fn test_register_blood_bank() {
        let env = Env::default();
        let (_, _, client) = setup_contract_with_admin(&env);
        let bank = Address::generate(&env);

        env.mock_all_auths();
        client.register_blood_bank(&bank);

        // Verify bank is registered
        assert_eq!(client.is_blood_bank(&bank), true);
    }

    #[test]
    fn test_register_hospital() {
        let env = Env::default();
        let (_, _, client) = setup_contract_with_admin(&env);
        let hospital = Address::generate(&env);

        env.mock_all_auths();
        client.register_hospital(&hospital);

        assert_eq!(client.is_hospital(&hospital), true);
    }

    #[test]
    fn test_register_blood_success() {
        let env = Env::default();
        let (_, _, client) = setup_contract_with_admin(&env);
        let bank = Address::generate(&env);

        env.mock_all_auths();
        client.register_blood_bank(&bank);

        let current_time = env.ledger().timestamp();
        let expiration = current_time + (7 * 86400); // 7 days from now

        let result = client.register_blood(
            &bank,
            &BloodType::OPositive,
            &450,
            &expiration,
            &Some(symbol_short!("donor1")),
        );

        assert_eq!(result, 1);
    }

    #[test]
    #[should_panic(expected = "Error(Contract, #1)")]
    fn test_register_blood_unauthorized_bank() {
        let env = Env::default();
        let (_, _, client) = setup_contract_with_admin(&env);
        let unauthorized_bank = Address::generate(&env);

        env.mock_all_auths();

        let current_time = env.ledger().timestamp();
        let expiration = current_time + (7 * 86400);

        client.register_blood(
            &unauthorized_bank,
            &BloodType::OPositive,
            &450,
            &expiration,
            &Some(symbol_short!("donor1")),
        );
    }

    #[test]
    #[should_panic(expected = "Error(Contract, #2)")]
    fn test_register_blood_invalid_quantity_too_low() {
        let env = Env::default();
        let (_, _, client) = setup_contract_with_admin(&env);
        let bank = Address::generate(&env);

        env.mock_all_auths();
        client.register_blood_bank(&bank);

        let current_time = env.ledger().timestamp();
        let expiration = current_time + (7 * 86400);

        client.register_blood(
            &bank,
            &BloodType::OPositive,
            &25, // Below minimum
            &expiration,
            &Some(symbol_short!("donor1")),
        );
    }

    #[test]
    #[should_panic(expected = "Error(Contract, #2)")]
    fn test_register_blood_invalid_quantity_too_high() {
        let env = Env::default();
        let (_, _, client) = setup_contract_with_admin(&env);
        let bank = Address::generate(&env);

        env.mock_all_auths();
        client.register_blood_bank(&bank);

        let current_time = env.ledger().timestamp();
        let expiration = current_time + (7 * 86400);

        client.register_blood(
            &bank,
            &BloodType::OPositive,
            &600, // Above maximum
            &expiration,
            &Some(symbol_short!("donor1")),
        );
    }

    #[test]
    #[should_panic(expected = "Error(Contract, #3)")]
    fn test_register_blood_expired_date() {
        let env = Env::default();
        let (_, _, client) = setup_contract_with_admin(&env);
        let bank = Address::generate(&env);

        env.mock_all_auths();
        client.register_blood_bank(&bank);

        let expiration = 0; // Already expired

        client.register_blood(
            &bank,
            &BloodType::OPositive,
            &450,
            &expiration,
            &Some(symbol_short!("donor1")),
        );
    }

    #[test]
    #[should_panic(expected = "Error(Contract, #3)")]
    fn test_register_blood_expiration_too_far() {
        let env = Env::default();
        let (_, _, client) = setup_contract_with_admin(&env);
        let bank = Address::generate(&env);

        env.mock_all_auths();
        client.register_blood_bank(&bank);

        let current_time = env.ledger().timestamp();
        let expiration = current_time + (50 * 86400); // 50 days (exceeds 42 day limit)

        client.register_blood(
            &bank,
            &BloodType::OPositive,
            &450,
            &expiration,
            &Some(symbol_short!("donor1")),
        );
    }

    #[test]
    fn test_register_blood_without_donor_id() {
        let env = Env::default();
        let (_, _, client) = setup_contract_with_admin(&env);
        let bank = Address::generate(&env);

        env.mock_all_auths();
        client.register_blood_bank(&bank);

        let current_time = env.ledger().timestamp();
        let expiration = current_time + (7 * 86400);

        let result = client.register_blood(
            &bank,
            &BloodType::ABNegative,
            &350,
            &expiration,
            &None, // Anonymous donor
        );

        assert_eq!(result, 1);
    }

    #[test]
    fn test_register_multiple_blood_units() {
        let env = Env::default();
        let (_, _, client) = setup_contract_with_admin(&env);
        let bank = Address::generate(&env);

        env.mock_all_auths();
        client.register_blood_bank(&bank);

        let current_time = env.ledger().timestamp();
        let expiration = current_time + (7 * 86400);

        // Register first unit
        let id1 = client.register_blood(
            &bank,
            &BloodType::OPositive,
            &450,
            &expiration,
            &Some(symbol_short!("donor1")),
        );

        // Register second unit
        let id2 = client.register_blood(
            &bank,
            &BloodType::APositive,
            &400,
            &expiration,
            &Some(symbol_short!("donor2")),
        );

        assert_eq!(id1, 1);
        assert_eq!(id2, 2);
    }

    #[test]
    fn test_register_blood_all_blood_types() {
        let env = Env::default();
        let (_, _, client) = setup_contract_with_admin(&env);
        let bank = Address::generate(&env);

        env.mock_all_auths();
        client.register_blood_bank(&bank);

        let current_time = env.ledger().timestamp();
        let expiration = current_time + (7 * 86400);

        let blood_types = vec![
            &env,
            BloodType::APositive,
            BloodType::ANegative,
            BloodType::BPositive,
            BloodType::BNegative,
            BloodType::ABPositive,
            BloodType::ABNegative,
            BloodType::OPositive,
            BloodType::ONegative,
        ];

        for (i, blood_type) in blood_types.iter().enumerate() {
            let result = client.register_blood(
                &bank,
                &blood_type,
                &450,
                &expiration,
                &Some(symbol_short!("donor")),
            );
            assert_eq!(result, (i as u64) + 1);
        }
    }

    #[test]
    fn test_register_blood_minimum_valid_quantity() {
        let env = Env::default();
        let (_, _, client) = setup_contract_with_admin(&env);
        let bank = Address::generate(&env);

        env.mock_all_auths();
        client.register_blood_bank(&bank);

        let current_time = env.ledger().timestamp();
        let expiration = current_time + (7 * 86400);

        let result = client.register_blood(
            &bank,
            &BloodType::OPositive,
            &50, // Minimum valid quantity
            &expiration,
            &Some(symbol_short!("donor1")),
        );

        assert_eq!(result, 1);
    }

    #[test]
    fn test_register_blood_maximum_valid_quantity() {
        let env = Env::default();
        let (_, _, client) = setup_contract_with_admin(&env);
        let bank = Address::generate(&env);

        env.mock_all_auths();
        client.register_blood_bank(&bank);

        let current_time = env.ledger().timestamp();
        let expiration = current_time + (7 * 86400);

        let result = client.register_blood(
            &bank,
            &BloodType::OPositive,
            &500, // Maximum valid quantity
            &expiration,
            &Some(symbol_short!("donor1")),
        );

        assert_eq!(result, 1);
    }

    #[test]
    fn test_register_blood_minimum_shelf_life() {
        let env = Env::default();
        let (_, _, client) = setup_contract_with_admin(&env);
        let bank = Address::generate(&env);

        env.mock_all_auths();
        client.register_blood_bank(&bank);

        let current_time = env.ledger().timestamp();
        let expiration = current_time + (1 * 86400) + 1; // Just over 1 day

        let result = client.register_blood(
            &bank,
            &BloodType::OPositive,
            &450,
            &expiration,
            &Some(symbol_short!("donor1")),
        );

        assert_eq!(result, 1);
    }

    #[test]
    fn test_register_blood_maximum_shelf_life() {
        let env = Env::default();
        let (_, _, client) = setup_contract_with_admin(&env);
        let bank = Address::generate(&env);

        env.mock_all_auths();
        client.register_blood_bank(&bank);

        let current_time = env.ledger().timestamp();
        let expiration = current_time + (42 * 86400); // Exactly 42 days

        let result = client.register_blood(
            &bank,
            &BloodType::OPositive,
            &450,
            &expiration,
            &Some(symbol_short!("donor1")),
        );

        assert_eq!(result, 1);
    }

    #[test]
    fn test_multiple_blood_banks() {
        let env = Env::default();
        let (_, _, client) = setup_contract_with_admin(&env);
        let bank1 = Address::generate(&env);
        let bank2 = Address::generate(&env);

        env.mock_all_auths();
        client.register_blood_bank(&bank1);
        client.register_blood_bank(&bank2);

        let current_time = env.ledger().timestamp();
        let expiration = current_time + (7 * 86400);

        // Both banks can register blood
        let id1 = client.register_blood(
            &bank1,
            &BloodType::OPositive,
            &450,
            &expiration,
            &Some(symbol_short!("donor1")),
        );

        let id2 = client.register_blood(
            &bank2,
            &BloodType::APositive,
            &400,
            &expiration,
            &Some(symbol_short!("donor2")),
        );

        assert_eq!(id1, 1);
        assert_eq!(id2, 2);
    }

    #[test]
    fn test_store_record() {
        let env = Env::default();
        let contract_id = env.register(HealthChainContract, ());
        let client = HealthChainContractClient::new(&env, &contract_id);

        let patient = symbol_short!("patient1");
        let hash = symbol_short!("hash123");

        let result = client.store_record(&patient, &hash);
        assert_eq!(result.len(), 2);
    }

    #[test]
    fn test_verify_access() {
        let env = Env::default();
        let contract_id = env.register(HealthChainContract, ());
        let client = HealthChainContractClient::new(&env, &contract_id);

        let patient = symbol_short!("patient1");
        let provider = symbol_short!("doctor1");

        let has_access = client.verify_access(&patient, &provider);
        assert_eq!(has_access, true);
    }

    #[test]
    fn test_add_blood_unit() {
        let env = Env::default();
        let contract_id = env.register(HealthChainContract, ());
        let client = HealthChainContractClient::new(&env, &contract_id);

        let id = client.add_blood_unit(
            &BloodType::OPositive,
            &100,
            &(env.ledger().timestamp() + 86400 * 30), // 30 days from now
            &symbol_short!("donor1"),
            &symbol_short!("loc1"),
        );

        assert_eq!(id, 1);
    }

    #[test]
    fn test_query_by_blood_type_basic() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(HealthChainContract, ());
        let client = HealthChainContractClient::new(&env, &contract_id);

        let current_time = env.ledger().timestamp();

        // Add multiple blood units
        client.add_blood_unit(
            &BloodType::OPositive,
            &100,
            &(current_time + 86400 * 30),
            &symbol_short!("donor1"),
            &symbol_short!("loc1"),
        );

        client.add_blood_unit(
            &BloodType::OPositive,
            &50,
            &(current_time + 86400 * 15),
            &symbol_short!("donor2"),
            &symbol_short!("loc1"),
        );

        client.add_blood_unit(
            &BloodType::APositive,
            &75,
            &(current_time + 86400 * 20),
            &symbol_short!("donor3"),
            &symbol_short!("loc2"),
        );

        // Query O+ blood
        let results = client.query_by_blood_type(&BloodType::OPositive, &0, &10);
        assert_eq!(results.len(), 2);
    }

    #[test]
    fn test_query_excludes_expired() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(HealthChainContract, ());
        let client = HealthChainContractClient::new(&env, &contract_id);

        let current_time = env.ledger().timestamp();

        // Add expired unit (expiration = 0, which is before current_time)
        client.add_blood_unit(
            &BloodType::OPositive,
            &100,
            &0, // Already expired
            &symbol_short!("donor1"),
            &symbol_short!("loc1"),
        );

        // Add valid unit
        client.add_blood_unit(
            &BloodType::OPositive,
            &50,
            &(current_time + 86400 * 15),
            &symbol_short!("donor2"),
            &symbol_short!("loc1"),
        );

        let results = client.query_by_blood_type(&BloodType::OPositive, &0, &10);
        assert_eq!(results.len(), 1);
        assert_eq!(results.get(0).unwrap().quantity, 50);
    }

    #[test]
    fn test_query_min_quantity_filter() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(HealthChainContract, ());
        let client = HealthChainContractClient::new(&env, &contract_id);

        let current_time = env.ledger().timestamp();

        client.add_blood_unit(
            &BloodType::OPositive,
            &100,
            &(current_time + 86400 * 30),
            &symbol_short!("donor1"),
            &symbol_short!("loc1"),
        );

        client.add_blood_unit(
            &BloodType::OPositive,
            &25,
            &(current_time + 86400 * 15),
            &symbol_short!("donor2"),
            &symbol_short!("loc1"),
        );

        // Query with min_quantity = 50
        let results = client.query_by_blood_type(&BloodType::OPositive, &50, &10);
        assert_eq!(results.len(), 1);
        assert_eq!(results.get(0).unwrap().quantity, 100);
    }

    #[test]
    fn test_query_fifo_sorting() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(HealthChainContract, ());
        let client = HealthChainContractClient::new(&env, &contract_id);

        let current_time = env.ledger().timestamp();

        // Add units with different expiration dates (not in order)
        client.add_blood_unit(
            &BloodType::OPositive,
            &100,
            &(current_time + 86400 * 30), // Expires last
            &symbol_short!("donor1"),
            &symbol_short!("loc1"),
        );

        client.add_blood_unit(
            &BloodType::OPositive,
            &50,
            &(current_time + 86400 * 10), // Expires first
            &symbol_short!("donor2"),
            &symbol_short!("loc1"),
        );

        client.add_blood_unit(
            &BloodType::OPositive,
            &75,
            &(current_time + 86400 * 20), // Expires middle
            &symbol_short!("donor3"),
            &symbol_short!("loc1"),
        );

        let results = client.query_by_blood_type(&BloodType::OPositive, &0, &10);
        assert_eq!(results.len(), 3);

        // Verify FIFO order (earliest expiration first)
        assert_eq!(results.get(0).unwrap().quantity, 50);
        assert_eq!(results.get(1).unwrap().quantity, 75);
        assert_eq!(results.get(2).unwrap().quantity, 100);
    }

    #[test]
    fn test_query_pagination() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(HealthChainContract, ());
        let client = HealthChainContractClient::new(&env, &contract_id);

        let current_time = env.ledger().timestamp();

        // Add 5 units
        for i in 1..=5 {
            client.add_blood_unit(
                &BloodType::OPositive,
                &(i * 10),
                &(current_time + 86400 * i as u64),
                &symbol_short!("donor"),
                &symbol_short!("loc1"),
            );
        }

        // Query with max_results = 2
        let results = client.query_by_blood_type(&BloodType::OPositive, &0, &2);
        assert_eq!(results.len(), 2);

        // Query with max_results = 0 (should return all)
        let all_results = client.query_by_blood_type(&BloodType::OPositive, &0, &0);
        assert_eq!(all_results.len(), 5);
    }

    #[test]
    fn test_query_no_results() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(HealthChainContract, ());
        let client = HealthChainContractClient::new(&env, &contract_id);

        // Query without adding any units
        let results = client.query_by_blood_type(&BloodType::OPositive, &0, &10);
        assert_eq!(results.len(), 0);
    }

    #[test]
    fn test_check_availability_sufficient() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(HealthChainContract, ());
        let client = HealthChainContractClient::new(&env, &contract_id);

        let current_time = env.ledger().timestamp();

        client.add_blood_unit(
            &BloodType::OPositive,
            &100,
            &(current_time + 86400 * 30),
            &symbol_short!("donor1"),
            &symbol_short!("loc1"),
        );

        client.add_blood_unit(
            &BloodType::OPositive,
            &50,
            &(current_time + 86400 * 15),
            &symbol_short!("donor2"),
            &symbol_short!("loc1"),
        );

        // Check for 120 units (should be available: 100 + 50 = 150)
        let available = client.check_availability(&BloodType::OPositive, &120);
        assert_eq!(available, true);
    }

    #[test]
    fn test_check_availability_insufficient() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(HealthChainContract, ());
        let client = HealthChainContractClient::new(&env, &contract_id);

        let current_time = env.ledger().timestamp();

        client.add_blood_unit(
            &BloodType::OPositive,
            &100,
            &(current_time + 86400 * 30),
            &symbol_short!("donor1"),
            &symbol_short!("loc1"),
        );

        // Check for 200 units (only 100 available)
        let available = client.check_availability(&BloodType::OPositive, &200);
        assert_eq!(available, false);
    }

    #[test]
    fn test_check_availability_excludes_expired() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(HealthChainContract, ());
        let client = HealthChainContractClient::new(&env, &contract_id);

        let current_time = env.ledger().timestamp();

        // Add expired unit (expiration = 0, which is before current_time)
        client.add_blood_unit(
            &BloodType::OPositive,
            &100,
            &0, // Already expired
            &symbol_short!("donor1"),
            &symbol_short!("loc1"),
        );

        // Add valid unit
        client.add_blood_unit(
            &BloodType::OPositive,
            &50,
            &(current_time + 86400 * 15),
            &symbol_short!("donor2"),
            &symbol_short!("loc1"),
        );

        // Check for 75 units (only 50 available, expired doesn't count)
        let available = client.check_availability(&BloodType::OPositive, &75);
        assert_eq!(available, false);

        // Check for 50 units (should be available)
        let available = client.check_availability(&BloodType::OPositive, &50);
        assert_eq!(available, true);
    }

    #[test]
    fn test_check_availability_no_inventory() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(HealthChainContract, ());
        let client = HealthChainContractClient::new(&env, &contract_id);

        // Check without adding any units
        let available = client.check_availability(&BloodType::OPositive, &1);
        assert_eq!(available, false);
    }

    #[test]
    fn test_create_request_success() {
        let env = Env::default();
        let (_, _, hospital, client) = setup_contract_with_hospital(&env);

        env.mock_all_auths();
        let current_time = env.ledger().timestamp();
        let required_by = current_time + 3600;

        let request_id = client.create_request(
            &hospital,
            &BloodType::APositive,
            &500,
            &UrgencyLevel::Urgent,
            &required_by,
            &String::from_str(&env, "Ward A, City Hospital"),
        );

        let events = env.events().all();
        assert_eq!(events.len(), 1);

        assert_eq!(request_id, 1);
    }

    #[test]
    #[should_panic(expected = "Error(Contract, #1)")]
    fn test_create_request_unauthorized_hospital() {
        let env = Env::default();
        let (_, _, client) = setup_contract_with_admin(&env);
        let hospital = Address::generate(&env);

        env.mock_all_auths();
        let current_time = env.ledger().timestamp();
        let required_by = current_time + 3600;

        client.create_request(
            &hospital,
            &BloodType::ONegative,
            &600,
            &UrgencyLevel::Critical,
            &required_by,
            &String::from_str(&env, "ER"),
        );
    }

    #[test]
    #[should_panic(expected = "Error(Contract, #2)")]
    fn test_create_request_invalid_quantity_low() {
        let env = Env::default();
        let (_, _, hospital, client) = setup_contract_with_hospital(&env);

        env.mock_all_auths();
        let current_time = env.ledger().timestamp();
        let required_by = current_time + 3600;

        client.create_request(
            &hospital,
            &BloodType::OPositive,
            &10,
            &UrgencyLevel::Routine,
            &required_by,
            &String::from_str(&env, "Ward B"),
    fn test_create_blood_request_success() {
        let env = Env::default();
        let (_, _, client) = setup_contract_with_admin(&env);
        let hospital = Address::generate(&env);

        env.mock_all_auths();
        client.register_hospital(&hospital);

        let required_by = env.ledger().timestamp() + 86400; // Tomorrow
        let result = client.create_request(
            &hospital,
            &BloodType::ABNegative,
            &500,
            &UrgencyLevel::High,
            &required_by,
            &symbol_short!("Main_Hosp"),
        );

        assert_eq!(result, 1);
    }

    #[test]
    #[should_panic(expected = "Error(Contract, #1)")] // Error::Unauthorized
    fn test_create_request_unauthorized() {
        let env = Env::default();
        let (_, _, client) = setup_contract_with_admin(&env);
        let rogue_hospital = Address::generate(&env);

        env.mock_all_auths();
        // hospital is NOT registered via client.register_hospital()

        client.create_request(
            &rogue_hospital,
            &BloodType::OPositive,
            &400,
            &UrgencyLevel::Medium,
            &(env.ledger().timestamp() + 86400),
            &symbol_short!("Hosp_1"),
        );
    }

    #[test]
    #[should_panic(expected = "Error(Contract, #2)")]
    fn test_create_request_invalid_quantity_high() {
        let env = Env::default();
        let (_, _, hospital, client) = setup_contract_with_hospital(&env);

        env.mock_all_auths();
        let current_time = env.ledger().timestamp();
        let required_by = current_time + 3600;

        client.create_request(
            &hospital,
            &BloodType::BPositive,
            &6000,
            &UrgencyLevel::Routine,
            &required_by,
            &String::from_str(&env, "Ward B"),
    #[should_panic(expected = "Error(Contract, #2)")] // Error::InvalidQuantity
    fn test_create_request_invalid_quantity() {
        let env = Env::default();
        let (_, _, client) = setup_contract_with_admin(&env);
        let hospital = Address::generate(&env);

        env.mock_all_auths();
        client.register_hospital(&hospital);

        client.create_request(
            &hospital,
            &BloodType::OPositive,
            &10, // Below MIN_QUANTITY_ML (50)
            &UrgencyLevel::Low,
            &(env.ledger().timestamp() + 86400),
            &symbol_short!("Hosp_1"),
        );
    }

    #[test]
    #[should_panic(expected = "Error(Contract, #6)")]
    fn test_create_request_required_by_in_past() {
        let env = Env::default();
        let (_, _, hospital, client) = setup_contract_with_hospital(&env);

        env.mock_all_auths();
        let current_time = env.ledger().timestamp();
        let required_by = current_time;

        client.create_request(
            &hospital,
            &BloodType::ABPositive,
            &200,
            &UrgencyLevel::Urgent,
            &required_by,
            &String::from_str(&env, "Ward C"),
        );
    }

    #[test]
    #[should_panic(expected = "Error(Contract, #8)")]
    fn test_create_request_empty_delivery_address() {
        let env = Env::default();
        let (_, _, hospital, client) = setup_contract_with_hospital(&env);

        env.mock_all_auths();
        let current_time = env.ledger().timestamp();
        let required_by = current_time + 3600;

        client.create_request(
            &hospital,
            &BloodType::ABNegative,
            &200,
            &UrgencyLevel::Urgent,
            &required_by,
            &String::from_str(&env, ""),
    #[should_panic(expected = "Error(Contract, #3)")]
    fn test_create_request_past_date() {
        let env = Env::default();

        // Set the time to something substantial first
        env.ledger().with_mut(|li| li.timestamp = 10000);

        let (_, _, client) = setup_contract_with_admin(&env);
        let hospital = Address::generate(&env);

        env.mock_all_auths();
        client.register_hospital(&hospital);

        client.create_request(
            &hospital,
            &BloodType::OPositive,
            &200,
            &UrgencyLevel::High,
            &5000, // Now this is safely in the past (5000 < 10000)
            &symbol_short!("Hosp_1"),
        );
    }

    #[test]
    #[should_panic(expected = "Error(Contract, #7)")]
    fn test_create_request_duplicate_request() {
        let env = Env::default();
        let (_, _, hospital, client) = setup_contract_with_hospital(&env);

        env.mock_all_auths();
        let current_time = env.ledger().timestamp();
        let required_by = current_time + 7200;
        let address = String::from_str(&env, "Ward D");

        client.create_request(
            &hospital,
            &BloodType::OPositive,
            &350,
            &UrgencyLevel::Urgent,
            &required_by,
            &address,
        );

        client.create_request(
            &hospital,
            &BloodType::OPositive,
            &350,
            &UrgencyLevel::Urgent,
            &required_by,
            &address,
        );
    }

    #[test]
    fn test_create_request_event_payload() {
        let env = Env::default();
        let (contract_id, _, hospital, client) = setup_contract_with_hospital(&env);

        env.mock_all_auths();
        let current_time = env.ledger().timestamp();
        let required_by = current_time + 7200;
        let delivery_address = String::from_str(&env, "Ward E, General Hospital");

        let request_id = client.create_request(
            &hospital,
            &BloodType::ONegative,
            &450,
            &UrgencyLevel::Critical,
            &required_by,
            &delivery_address,
        );

        let events = env.events().all();
        assert_eq!(events.len(), 1);

        let (event_contract_id, topics, data) = events.get(0).unwrap();
        assert_eq!(event_contract_id, contract_id);
        assert_eq!(topics.len(), 2);

        let topic0: Symbol = TryFromVal::try_from_val(&env, &topics.get(0).unwrap()).unwrap();
        let topic1: Symbol = TryFromVal::try_from_val(&env, &topics.get(1).unwrap()).unwrap();
        assert_eq!(topic0, symbol_short!("request"));
        assert_eq!(topic1, symbol_short!("create"));

        let event: RequestCreatedEvent = TryFromVal::try_from_val(&env, &data).unwrap();
        assert_eq!(event.request_id, request_id);
        assert_eq!(event.hospital_id, hospital);
        assert!(event.blood_type == BloodType::ONegative);
        assert_eq!(event.quantity_ml, 450);
        assert!(event.urgency == UrgencyLevel::Critical);
        assert_eq!(event.required_by, required_by);
        assert_eq!(event.delivery_address, delivery_address);
        assert_eq!(event.created_at, current_time);
    fn test_create_request_emits_event() {
        let env = Env::default();
        let (contract_id, _, client) = setup_contract_with_admin(&env);
        let hospital = Address::generate(&env);

        env.mock_all_auths();
        client.register_hospital(&hospital);

        let req_id = client.create_request(
            &hospital,
            &BloodType::BPositive,
            &300,
            &UrgencyLevel::Critical,
            &(env.ledger().timestamp() + 3600),
            &symbol_short!("ER_Room"),
        );

        // Get the last event
        let last_event = env.events().all().last().unwrap();

        // 1. Verify the Contract ID
        assert_eq!(last_event.0, contract_id);

        // 2. Verify the Topics (blood, request)
        let expected_topics = (symbol_short!("blood"), symbol_short!("request")).into_val(&env);
        assert_eq!(last_event.1, expected_topics);

        // 3. Verify the Data (Optional: Deserialize it to be sure)
        let event_data: BloodRequestEvent = last_event.2.into_val(&env);
        assert_eq!(event_data.request_id, req_id);
        assert_eq!(event_data.hospital_id, hospital);
    }
}

