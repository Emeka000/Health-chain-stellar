import { Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import {
    CanonicalEventEnvelope,
    DeadLetterReason,
    ErrorCategory,
} from './canonical-event.envelope';

/**
 * Metadata for canonical event consumers
 */
export interface CanonicalEventConsumerMetadata {
    eventType: string;
    consumerName: string;
    validateSchema?: boolean;
    maxRetries?: number;
    retryDelayMs?: number;
}

/**
 * Storage for consumer metadata
 */
const consumerMetadataMap = new Map<string, CanonicalEventConsumerMetadata>();

/**
 * Decorator for canonical event consumers
 * 
 * Wraps @OnEvent with validation, error handling, and dead-letter routing
 */
export function CanonicalEventConsumer(
    metadata: CanonicalEventConsumerMetadata,
): MethodDecorator {
    return function (
        target: any,
        propertyKey: string | symbol,
        descriptor: PropertyDescriptor,
    ) {
        const originalMethod = descriptor.value;
        const logger = new Logger(`${target.constructor.name}.${String(propertyKey)}`);

        // Store metadata for introspection
        const key = `${target.constructor.name}.${String(propertyKey)}`;
        consumerMetadataMap.set(key, metadata);

        // Wrap the original method with error handling
        descriptor.value = async function (
            this: any,
            envelope: CanonicalEventEnvelope,
        ) {
            const startTime = Date.now();

            try {
                // Validate envelope structure
                validateEnvelopeStructure(envelope);

                // Log event consumption
                logger.debug(
                    `Consuming event: ${envelope.metadata.eventType} (${envelope.metadata.eventId})`,
                );

                // Call original method
                const result = await originalMethod.call(this, envelope);

                // Log success
                const duration = Date.now() - startTime;
                logger.debug(
                    `Successfully consumed event: ${envelope.metadata.eventType} (${envelope.metadata.eventId}) in ${duration}ms`,
                );

                return result;
            } catch (error) {
                const duration = Date.now() - startTime;
                logger.error(
                    `Failed to consume event: ${envelope.metadata.eventType} (${envelope.metadata.eventId}) after ${duration}ms`,
                    error,
                );

                // Categorize error and determine if should dead-letter
                const errorInfo = categorizeError(error as Error);

                // Get dead-letter service from the instance
                const deadLetterService = (this as any).deadLetterService;

                if (deadLetterService) {
                    // Store in dead-letter
                    await deadLetterService.storeDeadLetter({
                        originalEvent: envelope,
                        reason: errorInfo.reason,
                        errorCategory: errorInfo.category,
                        errorMessage: (error as Error).message,
                        errorStack: (error as Error).stack,
                        failedConsumer: metadata.consumerName,
                        attemptCount: envelope.metadata.retryCount + 1,
                        diagnostics: {
                            duration,
                            errorType: (error as Error).constructor.name,
                            ...errorInfo.diagnostics,
                        },
                    });
                } else {
                    logger.warn(
                        'DeadLetterService not available - event not stored in dead-letter',
                    );
                }

                // Re-throw if transient error and retries not exhausted
                if (
                    errorInfo.category === ErrorCategory.TRANSIENT &&
                    envelope.metadata.retryCount < (metadata.maxRetries || 3)
                ) {
                    throw error;
                }
            }
        };

        // Apply @OnEvent decorator
        OnEvent(metadata.eventType, { async: true })(target, propertyKey, descriptor);

        return descriptor;
    };
}

/**
 * Validate envelope structure
 */
function validateEnvelopeStructure(envelope: any): void {
    if (!envelope || typeof envelope !== 'object') {
        throw new Error('Event is not an object');
    }

    if (!envelope.metadata) {
        throw new Error('Event missing metadata');
    }

    if (!envelope.payload) {
        throw new Error('Event missing payload');
    }

    const required = [
        'eventId',
        'eventType',
        'schemaVersion',
        'timestamp',
        'actor',
        'correlationId',
        'source',
        'priority',
    ];

    for (const field of required) {
        if (!envelope.metadata[field]) {
            throw new Error(`Event metadata missing required field: ${field}`);
        }
    }
}

/**
 * Categorize error and determine dead-letter reason
 */
function categorizeError(error: Error): {
    reason: DeadLetterReason;
    category: ErrorCategory;
    diagnostics: Record<string, unknown>;
} {
    const errorMessage = error.message.toLowerCase();
    const errorName = error.constructor.name;

    // Schema validation errors
    if (
        errorMessage.includes('validation') ||
        errorMessage.includes('schema') ||
        errorMessage.includes('invalid payload')
    ) {
        return {
            reason: DeadLetterReason.SCHEMA_VALIDATION_FAILED,
            category: ErrorCategory.PERMANENT,
            diagnostics: { errorName },
        };
    }

    // Malformed envelope
    if (
        errorMessage.includes('missing metadata') ||
        errorMessage.includes('missing payload') ||
        errorMessage.includes('missing required field')
    ) {
        return {
            reason: DeadLetterReason.MALFORMED_ENVELOPE,
            category: ErrorCategory.PERMANENT,
            diagnostics: { errorName },
        };
    }

    // Unsupported version
    if (
        errorMessage.includes('unsupported version') ||
        errorMessage.includes('unknown version')
    ) {
        return {
            reason: DeadLetterReason.UNSUPPORTED_VERSION,
            category: ErrorCategory.MANUAL_INTERVENTION,
            diagnostics: { errorName },
        };
    }

    // Timeout errors
    if (
        errorMessage.includes('timeout') ||
        errorMessage.includes('timed out') ||
        errorName === 'TimeoutError'
    ) {
        return {
            reason: DeadLetterReason.TIMEOUT,
            category: ErrorCategory.TRANSIENT,
            diagnostics: { errorName },
        };
    }

    // Database errors (transient)
    if (
        errorMessage.includes('connection') ||
        errorMessage.includes('deadlock') ||
        errorMessage.includes('lock timeout') ||
        errorName.includes('Query')
    ) {
        return {
            reason: DeadLetterReason.CONSUMER_ERROR,
            category: ErrorCategory.TRANSIENT,
            diagnostics: { errorName, errorType: 'database' },
        };
    }

    // Not found errors (permanent)
    if (
        errorMessage.includes('not found') ||
        errorName === 'NotFoundException'
    ) {
        return {
            reason: DeadLetterReason.BUSINESS_LOGIC_ERROR,
            category: ErrorCategory.PERMANENT,
            diagnostics: { errorName, errorType: 'not_found' },
        };
    }

    // Business logic errors (permanent)
    if (
        errorName === 'BadRequestException' ||
        errorName === 'ForbiddenException' ||
        errorName === 'UnauthorizedException'
    ) {
        return {
            reason: DeadLetterReason.BUSINESS_LOGIC_ERROR,
            category: ErrorCategory.PERMANENT,
            diagnostics: { errorName },
        };
    }

    // Default to unknown transient error
    return {
        reason: DeadLetterReason.CONSUMER_ERROR,
        category: ErrorCategory.UNKNOWN,
        diagnostics: { errorName },
    };
}

/**
 * Get all registered consumer metadata
 */
export function getAllConsumerMetadata(): Map<
    string,
    CanonicalEventConsumerMetadata
> {
    return new Map(consumerMetadataMap);
}
