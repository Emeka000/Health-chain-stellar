import { v4 as uuidv4 } from 'uuid';
import { CanonicalEventEnvelope } from './canonical-event.envelope';

/**
 * Builder for creating canonical event envelopes
 */
export class EventEnvelopeBuilder<TPayload = unknown> {
    private envelope: Partial<CanonicalEventEnvelope<TPayload>> = {
        metadata: {
            eventId: uuidv4(),
            eventType: '',
            schemaVersion: '1.0.0',
            timestamp: new Date().toISOString(),
            actor: 'SYSTEM',
            correlationId: uuidv4(),
            causationId: null,
            source: 'unknown',
            priority: 'MEDIUM',
            retryCount: 0,
            originalEventId: null,
        },
        context: {},
    };

    /**
     * Set event type
     */
    withEventType(eventType: string): this {
        this.envelope.metadata!.eventType = eventType;
        return this;
    }

    /**
     * Set schema version
     */
    withSchemaVersion(version: string): this {
        this.envelope.metadata!.schemaVersion = version;
        return this;
    }

    /**
     * Set actor
     */
    withActor(actor: string): this {
        this.envelope.metadata!.actor = actor;
        return this;
    }

    /**
     * Set correlation ID
     */
    withCorrelationId(correlationId: string): this {
        this.envelope.metadata!.correlationId = correlationId;
        return this;
    }

    /**
     * Set causation ID
     */
    withCausationId(causationId: string | null): this {
        this.envelope.metadata!.causationId = causationId;
        return this;
    }

    /**
     * Set source
     */
    withSource(source: string): this {
        this.envelope.metadata!.source = source;
        return this;
    }

    /**
     * Set priority
     */
    withPriority(priority: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL'): this {
        this.envelope.metadata!.priority = priority;
        return this;
    }

    /**
     * Set payload
     */
    withPayload(payload: TPayload): this {
        this.envelope.payload = payload;
        return this;
    }

    /**
     * Set tenant ID
     */
    withTenantId(tenantId: string): this {
        this.envelope.context = this.envelope.context || {};
        this.envelope.context.tenantId = tenantId;
        return this;
    }

    /**
     * Set session ID
     */
    withSessionId(sessionId: string): this {
        this.envelope.context = this.envelope.context || {};
        this.envelope.context.sessionId = sessionId;
        return this;
    }

    /**
     * Set request ID
     */
    withRequestId(requestId: string): this {
        this.envelope.context = this.envelope.context || {};
        this.envelope.context.requestId = requestId;
        return this;
    }

    /**
     * Set environment
     */
    withEnvironment(environment: string): this {
        this.envelope.context = this.envelope.context || {};
        this.envelope.context.environment = environment;
        return this;
    }

    /**
     * Add custom context
     */
    withContext(key: string, value: unknown): this {
        this.envelope.context = this.envelope.context || {};
        this.envelope.context[key] = value;
        return this;
    }

    /**
     * Mark as retry
     */
    asRetry(originalEventId: string, retryCount: number): this {
        this.envelope.metadata!.originalEventId = originalEventId;
        this.envelope.metadata!.retryCount = retryCount;
        return this;
    }

    /**
     * Build the envelope
     */
    build(): CanonicalEventEnvelope<TPayload> {
        if (!this.envelope.metadata!.eventType) {
            throw new Error('Event type is required');
        }
        if (!this.envelope.payload) {
            throw new Error('Payload is required');
        }

        return this.envelope as CanonicalEventEnvelope<TPayload>;
    }

    /**
     * Create a new builder from an existing envelope (for retries)
     */
    static fromEnvelope<T>(
        envelope: CanonicalEventEnvelope<T>,
    ): EventEnvelopeBuilder<T> {
        const builder = new EventEnvelopeBuilder<T>();
        builder.envelope = JSON.parse(JSON.stringify(envelope));
        return builder;
    }
}
