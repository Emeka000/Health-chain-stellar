/**
 * Canonical Event Envelope
 * 
 * All events emitted across the system MUST conform to this envelope structure.
 * This ensures consistent event handling, tracing, and recovery.
 */

export interface CanonicalEventEnvelope<TPayload = unknown> {
    /**
     * Event metadata
     */
    metadata: {
        /** Unique event identifier */
        eventId: string;

        /** Event type/name (e.g., 'order.created', 'sla.breached') */
        eventType: string;

        /** Schema version for this event type (semver format) */
        schemaVersion: string;

        /** Timestamp when event was emitted (ISO 8601) */
        timestamp: string;

        /** Actor who triggered the event (userId or 'SYSTEM') */
        actor: string;

        /** Correlation ID for tracing related events across services */
        correlationId: string;

        /** Causation ID - the event that caused this event */
        causationId: string | null;

        /** Source service/module that emitted the event */
        source: string;

        /** Event priority (for processing order) */
        priority: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

        /** Retry count (incremented on reprocessing) */
        retryCount: number;

        /** Original event ID if this is a retry */
        originalEventId: string | null;
    };

    /**
     * Event payload - the actual event data
     */
    payload: TPayload;

    /**
     * Optional context for additional metadata
     */
    context?: {
        /** Tenant/organization ID for multi-tenancy */
        tenantId?: string;

        /** User session ID */
        sessionId?: string;

        /** Request ID from HTTP request */
        requestId?: string;

        /** Environment (production, staging, development) */
        environment?: string;

        /** Additional custom metadata */
        [key: string]: unknown;
    };
}

/**
 * Event schema definition for validation
 */
export interface EventSchemaDefinition {
    eventType: string;
    schemaVersion: string;
    payloadSchema: Record<string, unknown>; // JSON Schema
    description: string;
    examples?: unknown[];
}

/**
 * Dead-letter event with diagnostic metadata
 */
export interface DeadLetterEvent {
    /** Original event envelope */
    originalEvent: CanonicalEventEnvelope;

    /** Dead-letter metadata */
    deadLetterMetadata: {
        /** When the event was moved to dead-letter */
        deadLetteredAt: string;

        /** Reason for dead-lettering */
        reason: DeadLetterReason;

        /** Error category */
        errorCategory: ErrorCategory;

        /** Error message */
        errorMessage: string;

        /** Error stack trace */
        errorStack?: string;

        /** Consumer that failed to process */
        failedConsumer: string;

        /** Number of processing attempts before dead-lettering */
        attemptCount: number;

        /** Whether this event is replayable */
        isReplayable: boolean;

        /** Diagnostic metadata for debugging */
        diagnostics: {
            /** Validation errors if schema validation failed */
            validationErrors?: unknown[];

            /** Consumer state at time of failure */
            consumerState?: Record<string, unknown>;

            /** Additional debug info */
            [key: string]: unknown;
        };
    };
}

/**
 * Reasons for dead-lettering an event
 */
export enum DeadLetterReason {
    SCHEMA_VALIDATION_FAILED = 'SCHEMA_VALIDATION_FAILED',
    MALFORMED_ENVELOPE = 'MALFORMED_ENVELOPE',
    CONSUMER_ERROR = 'CONSUMER_ERROR',
    TIMEOUT = 'TIMEOUT',
    POISON_MESSAGE = 'POISON_MESSAGE',
    UNSUPPORTED_VERSION = 'UNSUPPORTED_VERSION',
    MISSING_HANDLER = 'MISSING_HANDLER',
    BUSINESS_LOGIC_ERROR = 'BUSINESS_LOGIC_ERROR',
}

/**
 * Error categories for deterministic error handling
 */
export enum ErrorCategory {
    /** Transient errors that may succeed on retry */
    TRANSIENT = 'TRANSIENT',

    /** Permanent errors that will never succeed */
    PERMANENT = 'PERMANENT',

    /** Errors requiring manual intervention */
    MANUAL_INTERVENTION = 'MANUAL_INTERVENTION',

    /** Unknown error category */
    UNKNOWN = 'UNKNOWN',
}

/**
 * Replay request for dead-letter events
 */
export interface ReplayRequest {
    /** Event types to replay (empty = all) */
    eventTypes?: string[];

    /** Time window for replay */
    timeWindow?: {
        startTime: string;
        endTime: string;
    };

    /** Specific event IDs to replay */
    eventIds?: string[];

    /** Error categories to replay */
    errorCategories?: ErrorCategory[];

    /** Dead-letter reasons to replay */
    deadLetterReasons?: DeadLetterReason[];

    /** Maximum number of events to replay */
    limit?: number;

    /** Whether to skip poison messages */
    skipPoisonMessages?: boolean;

    /** Dry run mode (validate without executing) */
    dryRun?: boolean;
}

/**
 * Replay result
 */
export interface ReplayResult {
    /** Number of events selected for replay */
    selectedCount: number;

    /** Number of events successfully replayed */
    successCount: number;

    /** Number of events that failed replay */
    failureCount: number;

    /** Number of events skipped (poison messages) */
    skippedCount: number;

    /** Event IDs that were replayed */
    replayedEventIds: string[];

    /** Event IDs that failed replay */
    failedEventIds: string[];

    /** Event IDs that were skipped */
    skippedEventIds: string[];

    /** Errors encountered during replay */
    errors: Array<{
        eventId: string;
        error: string;
    }>;
}
