import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { CanonicalEventEnvelope } from './canonical-event.envelope';
import { EventEnvelopeBuilder } from './event-envelope.builder';
import { EventSchemaRegistryService } from './event-schema-registry.service';

/**
 * Canonical Event Emitter
 * 
 * Wraps EventEmitter2 to enforce canonical event envelope structure
 * and schema validation
 */
@Injectable()
export class CanonicalEventEmitterService {
    private readonly logger = new Logger(CanonicalEventEmitterService.name);

    constructor(
        private readonly eventEmitter: EventEmitter2,
        private readonly schemaRegistry: EventSchemaRegistryService,
    ) { }

    /**
     * Emit a canonical event with validation
     */
    async emit<TPayload = unknown>(
        envelope: CanonicalEventEnvelope<TPayload>,
        options?: {
            skipValidation?: boolean;
            async?: boolean;
        },
    ): Promise<void> {
        // Validate envelope structure
        this.validateEnvelope(envelope);

        // Validate payload against schema (unless skipped)
        if (!options?.skipValidation) {
            const validation = this.schemaRegistry.validate(
                envelope.metadata.eventType,
                envelope.metadata.schemaVersion,
                envelope.payload,
            );

            if (!validation.valid) {
                const error = new Error(
                    `Event payload validation failed: ${JSON.stringify(validation.errors)}`,
                );
                this.logger.error(
                    `Event validation failed: ${envelope.metadata.eventType}@${envelope.metadata.schemaVersion}`,
                    validation.errors,
                );
                throw error;
            }
        }

        // Emit the event
        const eventName = envelope.metadata.eventType;

        if (options?.async) {
            this.eventEmitter.emit(eventName, envelope);
        } else {
            await this.eventEmitter.emitAsync(eventName, envelope);
        }

        this.logger.debug(
            `Emitted event: ${eventName} (${envelope.metadata.eventId})`,
        );
    }

    /**
     * Create a builder for constructing canonical events
     */
    builder<TPayload = unknown>(): EventEnvelopeBuilder<TPayload> {
        return new EventEnvelopeBuilder<TPayload>();
    }

    /**
     * Validate envelope structure
     */
    private validateEnvelope(envelope: CanonicalEventEnvelope): void {
        if (!envelope.metadata) {
            throw new Error('Event envelope missing metadata');
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
            if (!envelope.metadata[field as keyof typeof envelope.metadata]) {
                throw new Error(`Event envelope missing required field: metadata.${field}`);
            }
        }

        if (envelope.payload === undefined) {
            throw new Error('Event envelope missing payload');
        }

        // Validate timestamp format
        if (isNaN(Date.parse(envelope.metadata.timestamp))) {
            throw new Error('Event envelope has invalid timestamp format');
        }

        // Validate priority
        const validPriorities = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];
        if (!validPriorities.includes(envelope.metadata.priority)) {
            throw new Error(`Event envelope has invalid priority: ${envelope.metadata.priority}`);
        }

        // Validate retry count
        if (
            typeof envelope.metadata.retryCount !== 'number' ||
            envelope.metadata.retryCount < 0
        ) {
            throw new Error('Event envelope has invalid retryCount');
        }
    }
}
