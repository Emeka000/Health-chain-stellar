# Event System Migration Guide

This guide explains how to migrate existing event producers and consumers to use the canonical event envelope system.

## Overview

The canonical event system provides:
- **Standardized event envelopes** with metadata (correlation ID, causation ID, schema version, etc.)
- **Schema validation** to prevent malformed events
- **Dead-letter storage** for failed events
- **Replay functionality** to recover from failures
- **Deterministic error categorization** for proper handling

## Migration Steps

### Step 1: Update Event Producers

**Before (Old Way):**
```typescript
@Injectable()
export class OrderService {
  constructor(private readonly eventEmitter: EventEmitter2) {}

  async createOrder(dto: CreateOrderDto): Promise<Order> {
    const order = await this.orderRepo.save(dto);
    
    // Old way - plain object
    this.eventEmitter.emit('order.created', {
      orderId: order.id,
      hospitalId: order.hospitalId,
      bloodType: order.bloodType,
    });
    
    return order;
  }
}
```

**After (New Way):**
```typescript
@Injectable()
export class OrderService {
  constructor(
    private readonly canonicalEventEmitter: CanonicalEventEmitterService,
  ) {}

  async createOrder(dto: CreateOrderDto, userId: string): Promise<Order> {
    const order = await this.orderRepo.save(dto);
    
    // New way - canonical envelope
    const envelope = this.canonicalEventEmitter
      .builder()
      .withEventType('order.created')
      .withSchemaVersion('1.0.0')
      .withActor(userId)
      .withSource('order-service')
      .withPriority('HIGH')
      .withPayload({
        orderId: order.id,
        hospitalId: order.hospitalId,
        bloodType: order.bloodType,
        units: order.units,
        urgency: order.urgency,
      })
      .build();
    
    await this.canonicalEventEmitter.emit(envelope);
    
    return order;
  }
}
```

### Step 2: Update Event Consumers

**Before (Old Way):**
```typescript
@Injectable()
export class OrderListener {
  @OnEvent('order.created')
  async handleOrderCreated(payload: any): Promise<void> {
    // Process event
    console.log('Order created:', payload.orderId);
  }
}
```

**After (New Way):**
```typescript
@Injectable()
export class OrderListener {
  constructor(
    private readonly deadLetterService: DeadLetterService, // Required for decorator
  ) {}

  @CanonicalEventConsumer({
    eventType: 'order.created',
    consumerName: 'OrderListener.handleOrderCreated',
    validateSchema: true,
    maxRetries: 3,
  })
  async handleOrderCreated(
    envelope: CanonicalEventEnvelope<OrderCreatedPayload>,
  ): Promise<void> {
    // Access payload
    const { orderId, hospitalId, bloodType } = envelope.payload;
    
    // Access metadata
    const { correlationId, actor, timestamp } = envelope.metadata;
    
    // Process event
    console.log('Order created:', orderId, 'by', actor);
  }
}
```

### Step 3: Register Event Schemas

Create schema definitions for your events:

```typescript
// src/orders/schemas/order-event-schemas.ts
import { EventSchemaDefinition } from '../../events/canonical-event.envelope';

export const ORDER_CREATED_SCHEMA: EventSchemaDefinition = {
  eventType: 'order.created',
  schemaVersion: '1.0.0',
  description: 'Emitted when a new order is created',
  payloadSchema: {
    type: 'object',
    required: ['orderId', 'hospitalId', 'bloodType', 'units'],
    properties: {
      orderId: { type: 'string', format: 'uuid' },
      hospitalId: { type: 'string' },
      bloodType: { 
        type: 'string', 
        enum: ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'] 
      },
      units: { type: 'number', minimum: 1 },
      urgency: { 
        type: 'string', 
        enum: ['CRITICAL', 'URGENT', 'STANDARD'] 
      },
    },
  },
};
```

Register schemas on module initialization:

```typescript
@Injectable()
export class OrderModuleInitializer implements OnModuleInit {
  constructor(
    private readonly schemaRegistry: EventSchemaRegistryService,
  ) {}

  onModuleInit(): void {
    this.schemaRegistry.registerSchema(ORDER_CREATED_SCHEMA);
  }
}
```

### Step 4: Handle Schema Versioning

When you need to change an event schema:

1. **Create a new version:**
```typescript
export const ORDER_CREATED_SCHEMA_V2: EventSchemaDefinition = {
  eventType: 'order.created',
  schemaVersion: '2.0.0', // Increment version
  description: 'Emitted when a new order is created (v2 with priority)',
  payloadSchema: {
    type: 'object',
    required: ['orderId', 'hospitalId', 'bloodType', 'units', 'priority'],
    properties: {
      orderId: { type: 'string', format: 'uuid' },
      hospitalId: { type: 'string' },
      bloodType: { type: 'string' },
      units: { type: 'number', minimum: 1 },
      priority: { type: 'number', minimum: 1, maximum: 10 }, // New field
    },
  },
};
```

2. **Support both versions in consumers:**
```typescript
@CanonicalEventConsumer({
  eventType: 'order.created',
  consumerName: 'OrderListener.handleOrderCreated',
})
async handleOrderCreated(
  envelope: CanonicalEventEnvelope<OrderCreatedPayload>,
): Promise<void> {
  const version = envelope.metadata.schemaVersion;
  
  if (version === '1.0.0') {
    // Handle v1 payload
    const { orderId, hospitalId } = envelope.payload;
    // ...
  } else if (version === '2.0.0') {
    // Handle v2 payload
    const { orderId, hospitalId, priority } = envelope.payload;
    // ...
  } else {
    throw new Error(`Unsupported schema version: ${version}`);
  }
}
```

3. **Gradually migrate producers to new version**

4. **Deprecate old version after migration period**

## Dead-Letter Handling

Events that fail processing are automatically stored in dead-letter storage with diagnostic metadata.

### Query Dead-Letter Events

```bash
# Get all dead-letter events
GET /api/v1/dead-letter

# Filter by event type
GET /api/v1/dead-letter?eventTypes=order.created,sla.breached

# Filter by error category
GET /api/v1/dead-letter?errorCategories=TRANSIENT

# Filter by time window
GET /api/v1/dead-letter?startTime=2024-01-01T00:00:00Z&endTime=2024-01-31T23:59:59Z

# Get only replayable events
GET /api/v1/dead-letter?isReplayable=true&replayed=false
```

### Replay Dead-Letter Events

```bash
# Replay all replayable events
POST /api/v1/dead-letter/replay
{
  "skipPoisonMessages": true
}

# Replay specific event types
POST /api/v1/dead-letter/replay
{
  "eventTypes": ["order.created", "sla.breached"],
  "timeWindow": {
    "startTime": "2024-01-01T00:00:00Z",
    "endTime": "2024-01-31T23:59:59Z"
  },
  "skipPoisonMessages": true
}

# Dry run (validate without executing)
POST /api/v1/dead-letter/replay
{
  "eventTypes": ["order.created"],
  "dryRun": true
}
```

### Get Statistics

```bash
GET /api/v1/dead-letter/statistics
```

## Error Categories

The system automatically categorizes errors:

- **TRANSIENT**: Temporary errors (database connection, timeout) - will retry
- **PERMANENT**: Permanent errors (validation, not found) - won't retry
- **MANUAL_INTERVENTION**: Requires manual fix (unsupported version)
- **UNKNOWN**: Unknown error type - treated as transient

## Best Practices

### 1. Always Use Correlation IDs

```typescript
// In HTTP controllers, extract correlation ID from request
const correlationId = req.headers['x-correlation-id'] || uuidv4();

const envelope = this.canonicalEventEmitter
  .builder()
  .withCorrelationId(correlationId)
  .withEventType('order.created')
  // ...
  .build();
```

### 2. Set Causation IDs for Event Chains

```typescript
// When one event causes another
@CanonicalEventConsumer({
  eventType: 'order.created',
  consumerName: 'InventoryService.reserveInventory',
})
async handleOrderCreated(
  envelope: CanonicalEventEnvelope<OrderCreatedPayload>,
): Promise<void> {
  // Reserve inventory
  const reservation = await this.reserveInventory(envelope.payload);
  
  // Emit new event with causation
  const newEnvelope = this.canonicalEventEmitter
    .builder()
    .withEventType('inventory.reserved')
    .withCorrelationId(envelope.metadata.correlationId) // Same correlation
    .withCausationId(envelope.metadata.eventId) // Caused by order.created
    .withPayload(reservation)
    .build();
  
  await this.canonicalEventEmitter.emit(newEnvelope);
}
```

### 3. Use Appropriate Priorities

```typescript
// Critical events
.withPriority('CRITICAL') // Payment failures, cold chain breaches

// High priority events
.withPriority('HIGH') // Order created, SLA breached

// Medium priority events (default)
.withPriority('MEDIUM') // Status updates, notifications

// Low priority events
.withPriority('LOW') // Analytics, logging
```

### 4. Include Context for Multi-Tenancy

```typescript
const envelope = this.canonicalEventEmitter
  .builder()
  .withEventType('order.created')
  .withTenantId(order.hospitalId)
  .withRequestId(req.id)
  .withPayload(order)
  .build();
```

### 5. Handle Poison Messages

Poison messages (events that repeatedly fail) are automatically detected after 5 failures. They are marked as `isPoisonMessage: true` and can be skipped during replay.

To investigate poison messages:

```bash
GET /api/v1/dead-letter?isPoisonMessage=true
```

## Testing

### Unit Tests

```typescript
describe('OrderService', () => {
  it('should emit canonical event on order creation', async () => {
    const emitSpy = jest.spyOn(canonicalEventEmitter, 'emit');
    
    await orderService.createOrder(dto, 'user-123');
    
    expect(emitSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({
          eventType: 'order.created',
          actor: 'user-123',
        }),
        payload: expect.objectContaining({
          orderId: expect.any(String),
        }),
      }),
    );
  });
});
```

### Integration Tests

```typescript
describe('Event System Integration', () => {
  it('should handle malformed events with dead-letter', async () => {
    // Emit malformed event
    const envelope = {
      metadata: { eventType: 'test.event' }, // Missing required fields
      payload: {},
    };
    
    await expect(
      canonicalEventEmitter.emit(envelope as any),
    ).rejects.toThrow();
    
    // Check dead-letter storage
    const deadLetters = await deadLetterService.queryDeadLetters({
      eventTypes: ['test.event'],
    });
    
    expect(deadLetters.length).toBeGreaterThan(0);
    expect(deadLetters[0].deadLetterReason).toBe('MALFORMED_ENVELOPE');
  });
});
```

## Monitoring

Monitor these metrics:
- Dead-letter event count by type
- Dead-letter event count by error category
- Poison message count
- Replay success/failure rates
- Event processing latency

## Rollback Plan

If you need to rollback:

1. Keep old event emitters alongside new ones temporarily
2. Emit both old and new format events during migration
3. Consumers can handle both formats
4. Remove old format after successful migration

```typescript
// Dual emission during migration
async createOrder(dto: CreateOrderDto, userId: string): Promise<Order> {
  const order = await this.orderRepo.save(dto);
  
  // New format
  const envelope = this.canonicalEventEmitter.builder()
    .withEventType('order.created')
    .withPayload(order)
    .build();
  await this.canonicalEventEmitter.emit(envelope);
  
  // Old format (for backward compatibility)
  this.eventEmitter.emit('order.created', order);
  
  return order;
}
```
