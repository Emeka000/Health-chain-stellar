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

#[contracttype]
#[derive(Clone, Eq, PartialEq)]
pub enum DataKey {
    Admin,
    Threshold(u64),
    TempPage(u64, u32),
    TempPageLen(u64, u32),
}
