/**
 * Sensitive Field Taxonomy
 *
 * Canonical registry of all fields that must never appear in public
 * transparency publications. Grouped by category for audit and review.
 *
 * This file is the single source of truth for the redaction engine.
 * Any new PHI / PII field added to the domain must be registered here.
 */

export enum SensitivityCategory {
    /** Direct patient health information */
    PHI = 'PHI',
    /** Personally identifiable information */
    PII = 'PII',
    /** Internal system / operational identifiers */
    INTERNAL_ID = 'INTERNAL_ID',
    /** Financial / commercial data */
    FINANCIAL = 'FINANCIAL',
    /** Security credentials and secrets */
    CREDENTIAL = 'CREDENTIAL',
    /** Precise geolocation that could identify individuals */
    PRECISE_GEO = 'PRECISE_GEO',
}

export interface SensitiveFieldDefinition {
    field: string;
    category: SensitivityCategory;
    description: string;
    /** Regex patterns that also match this field (aliases, nested paths) */
    aliases?: RegExp[];
}

export const SENSITIVE_FIELD_TAXONOMY: SensitiveFieldDefinition[] = [
    // ── PHI ──────────────────────────────────────────────────────────────────
    { field: 'donorId', category: SensitivityCategory.PHI, description: 'Donor identifier' },
    { field: 'donor_id', category: SensitivityCategory.PHI, description: 'Donor identifier (snake_case)' },
    { field: 'patientId', category: SensitivityCategory.PHI, description: 'Patient identifier' },
    { field: 'patient_id', category: SensitivityCategory.PHI, description: 'Patient identifier (snake_case)' },
    { field: 'recipientName', category: SensitivityCategory.PHI, description: 'Recipient full name' },
    { field: 'recipient_name', category: SensitivityCategory.PHI, description: 'Recipient full name (snake_case)' },
    { field: 'testResults', category: SensitivityCategory.PHI, description: 'Blood test results' },
    { field: 'test_results', category: SensitivityCategory.PHI, description: 'Blood test results (snake_case)' },
    { field: 'medicalNotes', category: SensitivityCategory.PHI, description: 'Free-text medical notes' },
    { field: 'barcodeData', category: SensitivityCategory.PHI, description: 'Unit barcode (traceable to donor)' },
    { field: 'barcode_data', category: SensitivityCategory.PHI, description: 'Unit barcode (snake_case)' },
    { field: 'unitNumber', category: SensitivityCategory.PHI, description: 'Blood unit serial number' },
    { field: 'unit_number', category: SensitivityCategory.PHI, description: 'Blood unit serial number (snake_case)' },
    { field: 'unitCode', category: SensitivityCategory.PHI, description: 'Blood unit code' },
    { field: 'unit_code', category: SensitivityCategory.PHI, description: 'Blood unit code (snake_case)' },

    // ── PII ───────────────────────────────────────────────────────────────────
    { field: 'email', category: SensitivityCategory.PII, description: 'Email address' },
    { field: 'phone', category: SensitivityCategory.PII, description: 'Phone number' },
    { field: 'phoneNumber', category: SensitivityCategory.PII, description: 'Phone number (camelCase)' },
    { field: 'phone_number', category: SensitivityCategory.PII, description: 'Phone number (snake_case)' },
    { field: 'address', category: SensitivityCategory.PII, description: 'Street address' },
    { field: 'addressLine1', category: SensitivityCategory.PII, description: 'Address line 1' },
    { field: 'addressLine2', category: SensitivityCategory.PII, description: 'Address line 2' },
    { field: 'address_line_1', category: SensitivityCategory.PII, description: 'Address line 1 (snake_case)' },
    { field: 'address_line_2', category: SensitivityCategory.PII, description: 'Address line 2 (snake_case)' },
    { field: 'postalCode', category: SensitivityCategory.PII, description: 'Postal / ZIP code' },
    { field: 'postal_code', category: SensitivityCategory.PII, description: 'Postal code (snake_case)' },
    { field: 'deliveryAddress', category: SensitivityCategory.PII, description: 'Delivery address' },
    { field: 'delivery_address', category: SensitivityCategory.PII, description: 'Delivery address (snake_case)' },
    { field: 'legalName', category: SensitivityCategory.PII, description: 'Legal entity name' },
    { field: 'legal_name', category: SensitivityCategory.PII, description: 'Legal entity name (snake_case)' },
    { field: 'registrationNumber', category: SensitivityCategory.PII, description: 'Org registration number' },
    { field: 'registration_number', category: SensitivityCategory.PII, description: 'Org registration number (snake_case)' },
    { field: 'licenseNumber', category: SensitivityCategory.PII, description: 'License number' },
    { field: 'license_number', category: SensitivityCategory.PII, description: 'License number (snake_case)' },

    // ── INTERNAL_ID ───────────────────────────────────────────────────────────
    { field: 'id', category: SensitivityCategory.INTERNAL_ID, description: 'Primary key UUID' },
    { field: 'hospitalId', category: SensitivityCategory.INTERNAL_ID, description: 'Hospital internal ID' },
    { field: 'hospital_id', category: SensitivityCategory.INTERNAL_ID, description: 'Hospital internal ID (snake_case)' },
    { field: 'riderId', category: SensitivityCategory.INTERNAL_ID, description: 'Rider internal ID' },
    { field: 'rider_id', category: SensitivityCategory.INTERNAL_ID, description: 'Rider internal ID (snake_case)' },
    { field: 'bloodBankId', category: SensitivityCategory.INTERNAL_ID, description: 'Blood bank internal ID' },
    { field: 'blood_bank_id', category: SensitivityCategory.INTERNAL_ID, description: 'Blood bank internal ID (snake_case)' },
    { field: 'bankId', category: SensitivityCategory.INTERNAL_ID, description: 'Bank internal ID' },
    { field: 'bank_id', category: SensitivityCategory.INTERNAL_ID, description: 'Bank internal ID (snake_case)' },
    { field: 'organizationId', category: SensitivityCategory.INTERNAL_ID, description: 'Organization internal ID' },
    { field: 'organization_id', category: SensitivityCategory.INTERNAL_ID, description: 'Organization internal ID (snake_case)' },
    { field: 'registeredBy', category: SensitivityCategory.INTERNAL_ID, description: 'Registering user ID' },
    { field: 'registered_by', category: SensitivityCategory.INTERNAL_ID, description: 'Registering user ID (snake_case)' },
    { field: 'verifiedByUserId', category: SensitivityCategory.INTERNAL_ID, description: 'Verifying user ID' },
    { field: 'verified_by_user_id', category: SensitivityCategory.INTERNAL_ID, description: 'Verifying user ID (snake_case)' },
    { field: 'importedBy', category: SensitivityCategory.INTERNAL_ID, description: 'Import actor ID' },
    { field: 'disputeId', category: SensitivityCategory.INTERNAL_ID, description: 'Dispute internal ID' },

    // ── FINANCIAL ─────────────────────────────────────────────────────────────
    { field: 'feeBreakdown', category: SensitivityCategory.FINANCIAL, description: 'Detailed fee breakdown' },
    { field: 'fee_breakdown', category: SensitivityCategory.FINANCIAL, description: 'Detailed fee breakdown (snake_case)' },
    { field: 'feeCalculationTrace', category: SensitivityCategory.FINANCIAL, description: 'Fee calculation trace' },
    { field: 'appliedPolicyId', category: SensitivityCategory.FINANCIAL, description: 'Applied fee policy ID' },

    // ── CREDENTIAL ────────────────────────────────────────────────────────────
    { field: 'blockchainTxHash', category: SensitivityCategory.CREDENTIAL, description: 'Blockchain tx hash (operational)' },
    { field: 'blockchain_tx_hash', category: SensitivityCategory.CREDENTIAL, description: 'Blockchain tx hash (snake_case)' },
    { field: 'blockchainAddress', category: SensitivityCategory.CREDENTIAL, description: 'Blockchain address' },
    { field: 'blockchain_address', category: SensitivityCategory.CREDENTIAL, description: 'Blockchain address (snake_case)' },
    { field: 'blockchainUnitId', category: SensitivityCategory.CREDENTIAL, description: 'Blockchain unit ID' },
    { field: 'licenseDocumentPath', category: SensitivityCategory.CREDENTIAL, description: 'License document storage path' },
    { field: 'certificateDocumentPath', category: SensitivityCategory.CREDENTIAL, description: 'Certificate document storage path' },
    { field: 'verificationDocuments', category: SensitivityCategory.CREDENTIAL, description: 'Verification document references' },
    { field: 'rejectionReason', category: SensitivityCategory.CREDENTIAL, description: 'Internal rejection reason' },

    // ── PRECISE_GEO ───────────────────────────────────────────────────────────
    { field: 'latitude', category: SensitivityCategory.PRECISE_GEO, description: 'Precise latitude' },
    { field: 'longitude', category: SensitivityCategory.PRECISE_GEO, description: 'Precise longitude' },
    { field: 'storageLocation', category: SensitivityCategory.PRECISE_GEO, description: 'Precise storage location' },
    { field: 'storage_location', category: SensitivityCategory.PRECISE_GEO, description: 'Precise storage location (snake_case)' },
];

/** Fast lookup set for O(1) field checks */
export const SENSITIVE_FIELD_SET: ReadonlySet<string> = new Set(
    SENSITIVE_FIELD_TAXONOMY.map((f) => f.field),
);

/** Lookup map for category by field name */
export const SENSITIVE_FIELD_CATEGORY_MAP: ReadonlyMap<string, SensitivityCategory> = new Map(
    SENSITIVE_FIELD_TAXONOMY.map((f) => [f.field, f.category]),
);
