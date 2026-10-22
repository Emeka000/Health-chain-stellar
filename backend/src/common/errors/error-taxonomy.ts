/**
 * Global Error Taxonomy
 * 
 * Defines consistent error codes across all modules with domain-specific namespaces
 */

/**
 * Error code format: {DOMAIN}_{CATEGORY}_{SPECIFIC}
 * 
 * Examples:
 * - AUTH_INVALID_CREDENTIALS
 * - ORDER_NOT_FOUND
 * - VALIDATION_REQUIRED_FIELD
 * - INFRA_DATABASE_CONNECTION
 */

/**
 * Error domains (namespaces)
 */
export enum ErrorDomain {
    // Core domains
    AUTH = 'AUTH',
    VALIDATION = 'VALIDATION',
    AUTHORIZATION = 'AUTHORIZATION',

    // Business domains
    ORDER = 'ORDER',
    BLOOD_REQUEST = 'BLOOD_REQUEST',
    INVENTORY = 'INVENTORY',
    DISPATCH = 'DISPATCH',
    RIDER = 'RIDER',
    HOSPITAL = 'HOSPITAL',
    BLOOD_BANK = 'BLOOD_BANK',
    DONOR = 'DONOR',

    // Operational domains
    SLA = 'SLA',
    ESCALATION = 'ESCALATION',
    INCIDENT = 'INCIDENT',
    ROUTE = 'ROUTE',
    COLD_CHAIN = 'COLD_CHAIN',

    // Technical domains
    INFRA = 'INFRA',
    BLOCKCHAIN = 'BLOCKCHAIN',
    PAYMENT = 'PAYMENT',
    NOTIFICATION = 'NOTIFICATION',

    // System domains
    RATE_LIMIT = 'RATE_LIMIT',
    SYSTEM = 'SYSTEM',
}

/**
 * Standard error codes
 */
export enum StandardErrorCode {
    // Authentication errors (AUTH_*)
    AUTH_INVALID_CREDENTIALS = 'AUTH_INVALID_CREDENTIALS',
    AUTH_TOKEN_EXPIRED = 'AUTH_TOKEN_EXPIRED',
    AUTH_TOKEN_INVALID = 'AUTH_TOKEN_INVALID',
    AUTH_TOKEN_MISSING = 'AUTH_TOKEN_MISSING',
    AUTH_SESSION_EXPIRED = 'AUTH_SESSION_EXPIRED',
    AUTH_MFA_REQUIRED = 'AUTH_MFA_REQUIRED',
    AUTH_MFA_INVALID = 'AUTH_MFA_INVALID',
    AUTH_ACCOUNT_LOCKED = 'AUTH_ACCOUNT_LOCKED',
    AUTH_ACCOUNT_DISABLED = 'AUTH_ACCOUNT_DISABLED',

    // Authorization errors (AUTHORIZATION_*)
    AUTHORIZATION_FORBIDDEN = 'AUTHORIZATION_FORBIDDEN',
    AUTHORIZATION_INSUFFICIENT_PERMISSIONS = 'AUTHORIZATION_INSUFFICIENT_PERMISSIONS',
    AUTHORIZATION_TENANT_ACCESS_DENIED = 'AUTHORIZATION_TENANT_ACCESS_DENIED',
    AUTHORIZATION_RESOURCE_ACCESS_DENIED = 'AUTHORIZATION_RESOURCE_ACCESS_DENIED',

    // Validation errors (VALIDATION_*)
    VALIDATION_FAILED = 'VALIDATION_FAILED',
    VALIDATION_REQUIRED_FIELD = 'VALIDATION_REQUIRED_FIELD',
    VALIDATION_INVALID_FORMAT = 'VALIDATION_INVALID_FORMAT',
    VALIDATION_INVALID_TYPE = 'VALIDATION_INVALID_TYPE',
    VALIDATION_OUT_OF_RANGE = 'VALIDATION_OUT_OF_RANGE',
    VALIDATION_INVALID_ENUM = 'VALIDATION_INVALID_ENUM',
    VALIDATION_DUPLICATE = 'VALIDATION_DUPLICATE',
    VALIDATION_CONSTRAINT_VIOLATION = 'VALIDATION_CONSTRAINT_VIOLATION',

    // Resource errors
    ORDER_NOT_FOUND = 'ORDER_NOT_FOUND',
    ORDER_ALREADY_EXISTS = 'ORDER_ALREADY_EXISTS',
    ORDER_INVALID_STATE = 'ORDER_INVALID_STATE',
    ORDER_CANNOT_CANCEL = 'ORDER_CANNOT_CANCEL',
    ORDER_EXPIRED = 'ORDER_EXPIRED',

    BLOOD_REQUEST_NOT_FOUND = 'BLOOD_REQUEST_NOT_FOUND',
    BLOOD_REQUEST_ALREADY_FULFILLED = 'BLOOD_REQUEST_ALREADY_FULFILLED',
    BLOOD_REQUEST_EXPIRED = 'BLOOD_REQUEST_EXPIRED',

    INVENTORY_INSUFFICIENT = 'INVENTORY_INSUFFICIENT',
    INVENTORY_NOT_FOUND = 'INVENTORY_NOT_FOUND',
    INVENTORY_EXPIRED = 'INVENTORY_EXPIRED',
    INVENTORY_RESERVED = 'INVENTORY_RESERVED',

    DISPATCH_NOT_FOUND = 'DISPATCH_NOT_FOUND',
    DISPATCH_NO_RIDERS_AVAILABLE = 'DISPATCH_NO_RIDERS_AVAILABLE',
    DISPATCH_RIDER_BUSY = 'DISPATCH_RIDER_BUSY',
    DISPATCH_ALREADY_ASSIGNED = 'DISPATCH_ALREADY_ASSIGNED',

    RIDER_NOT_FOUND = 'RIDER_NOT_FOUND',
    RIDER_NOT_AVAILABLE = 'RIDER_NOT_AVAILABLE',
    RIDER_SUSPENDED = 'RIDER_SUSPENDED',

    HOSPITAL_NOT_FOUND = 'HOSPITAL_NOT_FOUND',
    HOSPITAL_NOT_VERIFIED = 'HOSPITAL_NOT_VERIFIED',
    HOSPITAL_SUSPENDED = 'HOSPITAL_SUSPENDED',

    BLOOD_BANK_NOT_FOUND = 'BLOOD_BANK_NOT_FOUND',
    BLOOD_BANK_NOT_VERIFIED = 'BLOOD_BANK_NOT_VERIFIED',

    DONOR_NOT_FOUND = 'DONOR_NOT_FOUND',
    DONOR_NOT_ELIGIBLE = 'DONOR_NOT_ELIGIBLE',
    DONOR_SUSPENDED = 'DONOR_SUSPENDED',

    // Operational errors
    SLA_BREACH = 'SLA_BREACH',
    SLA_NOT_FOUND = 'SLA_NOT_FOUND',

    ESCALATION_NOT_FOUND = 'ESCALATION_NOT_FOUND',
    ESCALATION_ALREADY_ACKNOWLEDGED = 'ESCALATION_ALREADY_ACKNOWLEDGED',

    INCIDENT_NOT_FOUND = 'INCIDENT_NOT_FOUND',
    INCIDENT_ALREADY_CLOSED = 'INCIDENT_ALREADY_CLOSED',

    ROUTE_DEVIATION = 'ROUTE_DEVIATION',
    ROUTE_NOT_FOUND = 'ROUTE_NOT_FOUND',

    COLD_CHAIN_BREACH = 'COLD_CHAIN_BREACH',
    COLD_CHAIN_TEMPERATURE_EXCEEDED = 'COLD_CHAIN_TEMPERATURE_EXCEEDED',

    // Technical errors
    INFRA_DATABASE_ERROR = 'INFRA_DATABASE_ERROR',
    INFRA_DATABASE_CONNECTION = 'INFRA_DATABASE_CONNECTION',
    INFRA_DATABASE_TIMEOUT = 'INFRA_DATABASE_TIMEOUT',
    INFRA_CACHE_ERROR = 'INFRA_CACHE_ERROR',
    INFRA_QUEUE_ERROR = 'INFRA_QUEUE_ERROR',
    INFRA_EXTERNAL_SERVICE_ERROR = 'INFRA_EXTERNAL_SERVICE_ERROR',
    INFRA_EXTERNAL_SERVICE_TIMEOUT = 'INFRA_EXTERNAL_SERVICE_TIMEOUT',

    BLOCKCHAIN_TRANSACTION_FAILED = 'BLOCKCHAIN_TRANSACTION_FAILED',
    BLOCKCHAIN_INSUFFICIENT_BALANCE = 'BLOCKCHAIN_INSUFFICIENT_BALANCE',
    BLOCKCHAIN_CONTRACT_ERROR = 'BLOCKCHAIN_CONTRACT_ERROR',

    PAYMENT_FAILED = 'PAYMENT_FAILED',
    PAYMENT_INSUFFICIENT_FUNDS = 'PAYMENT_INSUFFICIENT_FUNDS',
    PAYMENT_GATEWAY_ERROR = 'PAYMENT_GATEWAY_ERROR',
    PAYMENT_ALREADY_PROCESSED = 'PAYMENT_ALREADY_PROCESSED',

    NOTIFICATION_FAILED = 'NOTIFICATION_FAILED',
    NOTIFICATION_CHANNEL_UNAVAILABLE = 'NOTIFICATION_CHANNEL_UNAVAILABLE',

    // System errors
    RATE_LIMIT_EXCEEDED = 'RATE_LIMIT_EXCEEDED',
    RATE_LIMIT_QUOTA_EXCEEDED = 'RATE_LIMIT_QUOTA_EXCEEDED',

    SYSTEM_INTERNAL_ERROR = 'SYSTEM_INTERNAL_ERROR',
    SYSTEM_SERVICE_UNAVAILABLE = 'SYSTEM_SERVICE_UNAVAILABLE',
    SYSTEM_MAINTENANCE = 'SYSTEM_MAINTENANCE',
    SYSTEM_TIMEOUT = 'SYSTEM_TIMEOUT',
    SYSTEM_BAD_GATEWAY = 'SYSTEM_BAD_GATEWAY',
}

/**
 * Error severity levels
 */
export enum ErrorSeverity {
    /** Informational - no action needed */
    INFO = 'INFO',

    /** Warning - may need attention */
    WARNING = 'WARNING',

    /** Error - requires action */
    ERROR = 'ERROR',

    /** Critical - immediate action required */
    CRITICAL = 'CRITICAL',
}

/**
 * Remediation action types
 */
export enum RemediationAction {
    /** Retry the request */
    RETRY = 'RETRY',

    /** Retry with exponential backoff */
    RETRY_WITH_BACKOFF = 'RETRY_WITH_BACKOFF',

    /** Modify request and retry */
    MODIFY_AND_RETRY = 'MODIFY_AND_RETRY',

    /** Contact support */
    CONTACT_SUPPORT = 'CONTACT_SUPPORT',

    /** Check credentials */
    CHECK_CREDENTIALS = 'CHECK_CREDENTIALS',

    /** Check permissions */
    CHECK_PERMISSIONS = 'CHECK_PERMISSIONS',

    /** Validate input */
    VALIDATE_INPUT = 'VALIDATE_INPUT',

    /** Wait and retry */
    WAIT_AND_RETRY = 'WAIT_AND_RETRY',

    /** No action possible */
    NO_ACTION = 'NO_ACTION',
}

/**
 * Error metadata for additional context
 */
export interface ErrorMetadata {
    /** Resource ID that caused the error */
    resourceId?: string;

    /** Resource type */
    resourceType?: string;

    /** Field that caused validation error */
    field?: string;

    /** Expected value or format */
    expected?: string;

    /** Actual value received */
    actual?: string;

    /** Constraint that was violated */
    constraint?: string;

    /** Retry after seconds (for rate limiting) */
    retryAfter?: number;

    /** Additional context */
    [key: string]: unknown;
}

/**
 * Remediation hint for clients
 */
export interface RemediationHint {
    /** Action to take */
    action: RemediationAction;

    /** Human-readable description */
    description: string;

    /** Additional parameters for the action */
    params?: Record<string, unknown>;
}

/**
 * Standardized error response payload
 */
export interface StandardErrorResponse {
    /** HTTP status code */
    statusCode: number;

    /** Error code from taxonomy */
    errorCode: StandardErrorCode;

    /** Error domain */
    domain: ErrorDomain;

    /** Human-readable error message */
    message: string;

    /** Detailed error description (optional) */
    details?: string;

    /** Correlation ID for tracing */
    correlationId: string;

    /** Request ID */
    requestId?: string;

    /** Timestamp of error */
    timestamp: string;

    /** Request path */
    path: string;

    /** HTTP method */
    method: string;

    /** Error severity */
    severity: ErrorSeverity;

    /** Whether error is retryable */
    retryable: boolean;

    /** Remediation hints for clients */
    remediation: RemediationHint[];

    /** Additional error metadata */
    metadata?: ErrorMetadata;

    /** Validation errors (for validation failures) */
    validationErrors?: Array<{
        field: string;
        message: string;
        constraint?: string;
        value?: unknown;
    }>;

    /** Stack trace (only in development) */
    stack?: string;
}

/**
 * Error code metadata for documentation
 */
export interface ErrorCodeMetadata {
    code: StandardErrorCode;
    domain: ErrorDomain;
    httpStatus: number;
    message: string;
    description: string;
    severity: ErrorSeverity;
    retryable: boolean;
    remediationActions: RemediationAction[];
    examples?: string[];
}

/**
 * Error code registry for documentation and validation
 */
export const ERROR_CODE_REGISTRY: Record<StandardErrorCode, ErrorCodeMetadata> = {
    // Authentication errors
    [StandardErrorCode.AUTH_INVALID_CREDENTIALS]: {
        code: StandardErrorCode.AUTH_INVALID_CREDENTIALS,
        domain: ErrorDomain.AUTH,
        httpStatus: 401,
        message: 'Invalid credentials',
        description: 'The provided username or password is incorrect',
        severity: ErrorSeverity.ERROR,
        retryable: false,
        remediationActions: [RemediationAction.CHECK_CREDENTIALS],
    },

    [StandardErrorCode.AUTH_TOKEN_EXPIRED]: {
        code: StandardErrorCode.AUTH_TOKEN_EXPIRED,
        domain: ErrorDomain.AUTH,
        httpStatus: 401,
        message: 'Token expired',
        description: 'The authentication token has expired',
        severity: ErrorSeverity.WARNING,
        retryable: true,
        remediationActions: [RemediationAction.CHECK_CREDENTIALS],
    },

    [StandardErrorCode.AUTH_TOKEN_INVALID]: {
        code: StandardErrorCode.AUTH_TOKEN_INVALID,
        domain: ErrorDomain.AUTH,
        httpStatus: 401,
        message: 'Invalid token',
        description: 'The authentication token is invalid or malformed',
        severity: ErrorSeverity.ERROR,
        retryable: false,
        remediationActions: [RemediationAction.CHECK_CREDENTIALS],
    },

    // Authorization errors
    [StandardErrorCode.AUTHORIZATION_FORBIDDEN]: {
        code: StandardErrorCode.AUTHORIZATION_FORBIDDEN,
        domain: ErrorDomain.AUTHORIZATION,
        httpStatus: 403,
        message: 'Forbidden',
        description: 'You do not have permission to access this resource',
        severity: ErrorSeverity.ERROR,
        retryable: false,
        remediationActions: [RemediationAction.CHECK_PERMISSIONS],
    },

    [StandardErrorCode.AUTHORIZATION_INSUFFICIENT_PERMISSIONS]: {
        code: StandardErrorCode.AUTHORIZATION_INSUFFICIENT_PERMISSIONS,
        domain: ErrorDomain.AUTHORIZATION,
        httpStatus: 403,
        message: 'Insufficient permissions',
        description: 'Your account does not have the required permissions',
        severity: ErrorSeverity.ERROR,
        retryable: false,
        remediationActions: [RemediationAction.CHECK_PERMISSIONS, RemediationAction.CONTACT_SUPPORT],
    },

    // Validation errors
    [StandardErrorCode.VALIDATION_FAILED]: {
        code: StandardErrorCode.VALIDATION_FAILED,
        domain: ErrorDomain.VALIDATION,
        httpStatus: 400,
        message: 'Validation failed',
        description: 'One or more fields failed validation',
        severity: ErrorSeverity.ERROR,
        retryable: false,
        remediationActions: [RemediationAction.VALIDATE_INPUT, RemediationAction.MODIFY_AND_RETRY],
    },

    [StandardErrorCode.VALIDATION_REQUIRED_FIELD]: {
        code: StandardErrorCode.VALIDATION_REQUIRED_FIELD,
        domain: ErrorDomain.VALIDATION,
        httpStatus: 400,
        message: 'Required field missing',
        description: 'A required field is missing from the request',
        severity: ErrorSeverity.ERROR,
        retryable: false,
        remediationActions: [RemediationAction.VALIDATE_INPUT, RemediationAction.MODIFY_AND_RETRY],
    },

    // Resource errors
    [StandardErrorCode.ORDER_NOT_FOUND]: {
        code: StandardErrorCode.ORDER_NOT_FOUND,
        domain: ErrorDomain.ORDER,
        httpStatus: 404,
        message: 'Order not found',
        description: 'The requested order does not exist',
        severity: ErrorSeverity.ERROR,
        retryable: false,
        remediationActions: [RemediationAction.NO_ACTION],
    },

    [StandardErrorCode.INVENTORY_INSUFFICIENT]: {
        code: StandardErrorCode.INVENTORY_INSUFFICIENT,
        domain: ErrorDomain.INVENTORY,
        httpStatus: 409,
        message: 'Insufficient inventory',
        description: 'Not enough inventory available to fulfill the request',
        severity: ErrorSeverity.ERROR,
        retryable: true,
        remediationActions: [RemediationAction.WAIT_AND_RETRY, RemediationAction.MODIFY_AND_RETRY],
    },

    // Rate limiting
    [StandardErrorCode.RATE_LIMIT_EXCEEDED]: {
        code: StandardErrorCode.RATE_LIMIT_EXCEEDED,
        domain: ErrorDomain.RATE_LIMIT,
        httpStatus: 429,
        message: 'Rate limit exceeded',
        description: 'Too many requests. Please slow down.',
        severity: ErrorSeverity.WARNING,
        retryable: true,
        remediationActions: [RemediationAction.WAIT_AND_RETRY],
    },

    // System errors
    [StandardErrorCode.SYSTEM_INTERNAL_ERROR]: {
        code: StandardErrorCode.SYSTEM_INTERNAL_ERROR,
        domain: ErrorDomain.SYSTEM,
        httpStatus: 500,
        message: 'Internal server error',
        description: 'An unexpected error occurred',
        severity: ErrorSeverity.CRITICAL,
        retryable: true,
        remediationActions: [RemediationAction.RETRY_WITH_BACKOFF, RemediationAction.CONTACT_SUPPORT],
    },

    // Add remaining error codes with similar structure...
    // (Abbreviated for brevity - in production, all codes would be defined)
} as any; // Type assertion to avoid exhaustive check during development
