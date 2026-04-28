use soroban_sdk::contracttype;

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq, Copy)]
pub struct TemperatureReading {
    pub temperature_celsius_x100: i32,
    pub timestamp: u64,
    pub is_violation: bool,
}

impl Default for TemperatureReading {
    fn default() -> Self {
        TemperatureReading {
            temperature_celsius_x100: 0,
            timestamp: 0,
            is_violation: false,
        }
    }
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq, Copy)]
pub struct TemperatureThreshold {
    pub min_celsius_x100: i32,
    pub max_celsius_x100: i32,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct TemperatureSummary {
    pub count: u32,
    pub avg_celsius_x100: i32,
    pub min_celsius_x100: i32,
    pub max_celsius_x100: i32,
    pub violation_count: u32,
}

/// Summary of a sustained temperature excursion, passed to the coordinator
/// when automatically raising a payment dispute.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ExcursionSummary {
    /// Blood unit affected
    pub unit_id: u64,
    /// Number of consecutive violations that triggered this excursion
    pub violation_count: u32,
    /// Peak temperature recorded during the excursion (×100 scale)
    pub peak_celsius_x100: i32,
    /// Ledger timestamp when the excursion was first detected
    pub detected_at: u64,
}

#[contracttype]
#[derive(Clone, Eq, PartialEq)]
pub enum DataKey {
    Admin,
    Threshold(u64),
    TempPage(u64, u32),
    TempPageLen(u64, u32),
    /// Tracks consecutive violation streak for a blood unit
    ConsecutiveViolationStreak(u64),
    /// Tracks if unit has been compromised (3+ consecutive violations)
    IsCompromised(u64),
    Paused,
    /// Address of the coordinator contract for cross-contract dispute escalation
    CoordinatorContract,
    /// Whitelisted IoT oracle addresses allowed to report excursions
    OracleWhitelist(soroban_sdk::Address),
}
