# Quick Reference: Canonical Event System (#690)

## Emit an Event

```typescript
// Inject the service
constructor(
  private readonly canonicalEventEmitter: CanonicalEventEmitterService,
) {}

// Build and emit
const envelope = this.canonicalEventEmitter
  .builder()
  .withEventType('order.created')
  .withSchemaVersion('1.0.0')
  .withActor(userId)
  .withSource('order-service')
  .withPriority('HIGH')
  .withPayload({ orderId, hospitalId, bloodType })
  .build();

await this.canonicalEventEmitter.emit(envelope);
```

## Consume an Event

```typescript
// Inject dead-letter service (required for decorator)
constructor(
  private readonly deadLetterService: DeadLetterService,
) {}

// Use decorator
@CanonicalEventConsumer({
  eventType: 'order.created',
  consumerName: 'MyService.handleOrder',
  maxRetries: 3,
})
async handleOrder(envelope: CanonicalEventEnvelope<OrderPayload>): Promise<void> {
  const { orderId } = envelope.payload;
  const { correlationId, actor } = envelope.metadata;
  
  // Process event
}
```

## Register a Schema

```typescript
const schema: EventSchemaDefinition = {
  eventType: 'order.created',
  schemaVersion: '1.0.0',
  description: 'Order created event',
  payloadSchema: {
    type: 'object',
    required: ['orderId', 'hospitalId'],
    properties: {
      orderId: { type: 'string', format: 'uuid' },
      hospitalId: { type: 'string' },
    },
  },
};

// In module initializer
this.schemaRegistry.registerSchema(schema);
```

## Query Dead-Letter Events

```bash
# All dead-letter events
GET /api/v1/dead-letter

# Filter by event type
GET /api/v1/dead-letter?eventTypes=order.created,sla.breached

# Filter by error category
GET /api/v1/dead-letter?errorCategories=TRANSIENT

# Only replayable events
GET /api/v1/dead-letter?isReplayable=true&replayed=false

# Statistics
GET /api/v1/dead-letter/statistics
```

## Replay Dead-Letter Events

```bash
# Replay all replayable events
POST /api/v1/dead-letter/replay
{
  "skipPoisonMessages": true
}

# Replay specific event types
POST /api/v1/dead-letter/replay
{
  "eventTypes": ["order.created"],
  "timeWindow": {
    "startTime": "2024-01-01T00:00:00Z",
    "endTime": "2024-01-31T23:59:59Z"
  }
}

# Dry run
POST /api/v1/dead-letter/replay
{
  "eventTypes": ["order.created"],
  "dryRun": true
}
```

## Event Priorities

- `CRITICAL`: Payment failures, cold chain breaches
- `HIGH`: Order created, SLA breached
- `MEDIUM`: Status updates, notifications (default)
- `LOW`: Analytics, logging

## Error Categories

- `TRANSIENT`: Retry automatically (database connection, timeout)
- `PERMANENT`: Don't retry (validation, not found)
- `MANUAL_INTERVENTION`: Requires manual fix (unsupported version)
- `UNKNOWN`: Treat as transient

## Dead-Letter Reasons

- `SCHEMA_VALIDATION_FAILED`: Payload validation failed
- `MALFORMED_ENVELOPE`: Missing required fields
- `CONSUMER_ERROR`: Consumer threw error
- `TIMEOUT`: Processing timed out
- `POISON_MESSAGE`: 5+ failures
- `UNSUPPORTED_VERSION`: Schema version not supported
- `MISSING_HANDLER`: No consumer registered
- `BUSINESS_LOGIC_ERROR`: Business rule violation

## Best Practices

### 1. Use Correlation IDs
```typescript
.withCorrelationId(req.headers['x-correlation-id'] || uuidv4())
```

### 2. Set Causation IDs
```typescript
.withCausationId(envelope.metadata.eventId) // Event that caused this
```

### 3. Include Context
```typescript
.withTenantId(hospitalId)
.withRequestId(req.id)
.withSessionId(sessionId)
```

### 4. Handle Multiple Versions
```typescript
if (envelope.metadata.schemaVersion === '1.0.0') {
  // Handle v1
} else if (envelope.metadata.schemaVersion === '2.0.0') {
  // Handle v2
}
```

## Module Setup

```typescript
// Import EventsModule in app.module.ts
@Module({
  imports: [
    EventsModule, // Global module
    // ... other modules
  ],
})
export class AppModule {}
```

## Common Schemas

Pre-registered schemas:
- `order.created` v1.0.0
- `sla.breached` v1.0.0
- `anomaly.detected.high` v1.0.0
- `route.deviation.detected` v1.0.0
- `compliance.violation.detected` v1.0.0
- `incident-review.auto-created` v1.0.0
- `escalation.triggered` v1.0.0

## Monitoring

Track these metrics:
- Dead-letter event count by type
- Dead-letter event count by error category
- Poison message count
- Replay success/failure rates
- Event processing latency

## Troubleshooting

### Event not validated
- Check schema is registered: `schemaRegistry.hasSchema(eventType, version)`
- Check schema version matches

### Consumer not receiving events
- Check event type matches exactly
- Check `@CanonicalEventConsumer` decorator is applied
- Check `deadLetterService` is injected

### Poison messages
- Query: `GET /api/v1/dead-letter?isPoisonMessage=true`
- Investigate error patterns
- Fix root cause before replay

### Replay failures
- Check error category (PERMANENT errors won't succeed)
- Check consumer is fixed
- Use dry run first: `{ "dryRun": true }`
