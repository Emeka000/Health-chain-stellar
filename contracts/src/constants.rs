//! # Registry Contract Constants
//!
//! This module contains all magic numbers used throughout the blood registry contract,
//! with documentation explaining their origin and significance.

// ── BLOOD UNIT VALIDATION ────────────────────────────────────────────────────

/// Minimum quantity for a blood unit in milliliters.
/// 
/// Based on standard blood banking practices where 50ml is the minimum viable
/// unit for transfusion or testing purposes.
pub const MIN_QUANTITY_ML: u32 = 50;

/// Maximum quantity for a single blood unit in milliliters.
/// 
/// Standard whole blood donation is typically 450-500ml. This limit prevents
/// registration of unrealistic unit sizes and helps maintain data integrity.
pub const MAX_QUANTITY_ML: u32 = 500;

/// Minimum shelf life for blood units in days.
/// 
/// Blood units must have at least 1 day of remaining shelf life to be
/// registered, ensuring they have practical utility before expiration.
pub const MIN_SHELF_LIFE_DAYS: u64 = 1;

/// Maximum shelf life for whole blood in days per WHO guidelines (WHOGMP 2010).
/// 
/// After 42 days, whole blood components degrade and the unit must be discarded
/// regardless of storage conditions. This is a regulatory requirement based on
/// red blood cell viability.
pub const MAX_SHELF_LIFE_DAYS: u64 = 42;

/// Seconds per day constant for timestamp calculations.
/// 
/// Used to convert day-based shelf life limits into Unix timestamp offsets.
/// 1 day = 24 hours × 60 minutes × 60 seconds = 86,400 seconds.
pub const SECONDS_PER_DAY: u64 = 86_400;

// ── BLOOD REQUEST VALIDATION ──────────────────────────────────────────────────

/// Minimum blood request quantity in milliliters.
/// 
/// Aligned with MIN_QUANTITY_ML to ensure requests are for viable unit sizes.
pub const MIN_REQUEST_ML: u32 = 50;

/// Maximum blood request quantity in milliliters.
/// 
/// Set at 5000ml (approximately 10 standard units) to prevent unrealistic
/// bulk requests while allowing for emergency scenarios requiring multiple units.
pub const MAX_REQUEST_ML: u32 = 5000;

// ── BATCH OPERATION LIMITS ────────────────────────────────────────────────────

/// Maximum number of units that can be processed in a single batch operation.
/// 
/// Enforced to stay within Soroban's per-transaction compute unit budget.
/// Operations like batch allocation or batch expiry are limited to prevent
/// transaction timeouts and excessive gas costs.
pub const MAX_BATCH_SIZE: u32 = 100;

/// Maximum number of units that can be batch-expired in a single contract call.
/// 
/// Enforced to stay within Soroban's per-transaction compute unit budget.
/// This is more conservative than MAX_BATCH_SIZE due to the additional
/// storage writes required for status changes and history records.
pub const MAX_BATCH_EXPIRY_SIZE: u32 = 50;

// ── CUSTODY TRANSFER SETTINGS ─────────────────────────────────────────────────

/// Transfer expiry window in seconds (30 minutes).
/// 
/// Once a blood unit transfer is initiated, the receiving hospital has 30 minutes
/// to confirm delivery. After this window, the transfer can be cancelled by the
/// blood bank. This prevents units from being stuck in transit indefinitely.
pub const TRANSFER_EXPIRY_SECONDS: u64 = 1_800;

/// Maximum number of custody events stored per page.
/// 
/// Custody trails are paginated to prevent unbounded storage growth. Each page
/// stores up to 20 event IDs, allowing efficient retrieval while maintaining
/// complete audit trails for blood unit chain-of-custody.
pub const MAX_EVENTS_PER_PAGE: u32 = 20;

// ── UNIT ID VALIDATION ────────────────────────────────────────────────────────

/// Maximum length of a blood unit ID string.
/// 
/// Aligned with the NestJS backend's UUID v4 format (36 characters) plus
/// additional headroom for prefixes or custom identifiers. This prevents
/// excessively long IDs that could cause storage or display issues.
pub const MAX_UNIT_ID_LENGTH: u32 = 64;

/// Maximum length for hex-encoded SHA256 hash strings.
/// 
/// SHA256 produces a 32-byte hash, which when hex-encoded becomes 64 characters.
/// Used for custody event IDs and other cryptographic identifiers.
pub const HEX_HASH_LENGTH: usize = 64;
