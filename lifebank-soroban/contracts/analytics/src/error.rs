use soroban_sdk::contracterror;

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum AnalyticsError {
    AlreadyInitialized = 900,
    NotInitialized = 901,
    Unauthorized = 902,
    InvalidPeriod = 903,
    PeriodNotFound = 904,
    MetricNotFound = 905,
    InvalidAmount = 906,
}
