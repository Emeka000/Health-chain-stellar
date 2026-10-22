# Blockchain Module

Stellar Soroban smart contract integration with async transaction queue, idempotency guarantees, and dead-letter queue (DLQ) handling.

## Architecture

### Core Components

- **SorobanService**: Transaction submission, queue management, and status tracking
- **IdempotencyService**: Prevents duplicate transaction submissions
- **SorobanTxProcessor**: Worker that processes queued transactions
- **SorobanDlqProcessor**: Handles permanently failed transactions
- **BlockchainController**: REST API for transaction submission and monitoring

### Queue Architecture

```
Submit TX → Idempotency Check → Main Queue → Worker → Soroban Network
                                     ↓ (5 retries failed)
                                  DLQ Queue → Manual Review
```

**Features:**

- Async processing with BullMQ
- Exponential backoff with jitter (1s → 60s max)
- 5 retry attempts by default
- Idempotency keys prevent duplicate submissions
- Failed jobs moved to DLQ after max retries
- Redis-backed for persistence

## Public API

### Endpoints

#### POST /blockchain/submit-transaction

Submit a Soroban contract transaction to the queue.

**Request:**

```json
{
  "contractMethod": "record_donation",
  "args": {
    "donorId": "uuid",
    "amount": 100,
    "bloodType": "A+"
  },
  "idempotencyKey": "donation-uuid-123",
  "maxRetries": 5
}
```

**Response:** `202 Accepted`

```json
{
  "jobId": "donation-uuid-123"
}
```

**Errors:**

- `400 Bad Request`: Duplicate idempotency key

#### GET /blockchain/job/:jobId

Get status of a queued transaction.

**Response:** `200 OK`

```json
{
  "jobId": "donation-uuid-123",
  "transactionHash": "0xabc...",
  "status": "completed",
  "error": null,
  "retryCount": 0,
  "createdAt": "2024-01-01T00:00:00Z",
  "completedAt": "2024-01-01T00:00:05Z"
}
```

**Status Values:**

- `pending`: Queued, not yet processed
- `completed`: Successfully submitted to Soroban
- `failed`: Retrying or moved to DLQ
- `dlq`: Permanently failed, manual intervention needed

#### POST /blockchain/webhook/callback

Process incoming blockchain webhook events from trusted providers.

Headers:

- `X-Webhook-Signature`: HMAC SHA256 (hex) of canonical JSON payload using `BLOCKCHAIN_CALLBACK_SECRET`

Request body:

```json
{
  "eventId": "string",
  "transactionHash": "string",
  "contractMethod": "string",
  "status": "pending|confirmed|failed",
  "timestamp": "ISO-8601",
  "details": "string (optional)"
}
```

Response: `200 OK`

```json
{
  "success": true
}
```

Failures:

- `401 Unauthorized`: invalid or missing signature
- `400 Bad Request`: stale timestamp or invalid payload schema
- `409 Conflict`: replayed event

#### GET /blockchain/queue/status

Get queue metrics (admin only).

**Headers:** `Authorization: Bearer <admin_token>`

**Response:** `200 OK`

```json
{
  "queueDepth": 42,
  "failedJobs": 3,
  "dlqCount": 1,
  "processingRate": 0
}
```

## Usage

### Basic Transaction Submission

```typescript
import { SorobanService } from './blockchain/services/soroban.service';

@Injectable()
export class DonationService {
  constructor(private sorobanService: SorobanService) {}

  async recordDonation(donation: Donation) {
    // Submit to queue (async)
    const jobId = await this.sorobanService.submitTransaction({
      contractMethod: 'record_donation',
      args: {
        donorId: donation.donorId,
        amount: donation.amount,
        bloodType: donation.bloodType,
      },
      idempotencyKey: `donation-${donation.id}`,
      maxRetries: 5,
    });

    // Store jobId for later status checks
    donation.blockchainJobId = jobId;
    await this.donationRepository.save(donation);

    return { jobId };
  }
}
```

### Synchronous Transaction (Wait for Completion)

```typescript
async recordCriticalDonation(donation: Donation) {
  try {
    // Block until transaction completes (max 120s)
    const result = await this.sorobanService.submitTransactionAndWait(
      {
        contractMethod: 'record_donation',
        args: { /* ... */ },
        idempotencyKey: `donation-${donation.id}`,
      },
      120_000, // 2 minute timeout
    );

    donation.transactionHash = result.transactionHash;
    await this.donationRepository.save(donation);

    return result;
  } catch (error) {
    // Handle timeout or failure
    this.logger.error(`Blockchain submission failed: ${error.message}`);
    throw error;
  }
}
```

### Checking Transaction Status

```typescript
async checkDonationStatus(donationId: string) {
  const donation = await this.donationRepository.findOne(donationId);

  const status = await this.sorobanService.getJobStatus(
    donation.blockchainJobId,
  );

  return {
    donation,
    blockchain: status,
  };
}
```

## Configuration

Environment variables:

```env
SOROBAN_RPC_URL=https://soroban-testnet.stellar.org
SOROBAN_CONTRACT_ID=CXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
SOROBAN_SECRET_KEY=SXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
SOROBAN_NETWORK=testnet
REDIS_HOST=localhost
REDIS_PORT=6379
```

## Data Models

### SorobanTxJob

```typescript
{
  contractMethod: string;        // Smart contract method name
  args: Record<string, any>;     // Method arguments
  idempotencyKey: string;        // Unique key to prevent duplicates
  maxRetries?: number;           // Override default retry count
}
```

### SorobanTxResult

```typescript
{
  jobId: string;
  transactionHash?: string;
  status: 'pending' | 'completed' | 'failed' | 'dlq';
  error?: string;
  retryCount: number;
  createdAt: Date;
  completedAt?: Date;
}
```

## Queue Configuration

### Main Queue (soroban-tx-queue)

- **Attempts**: 5 retries
- **Backoff**: Exponential (1s → 2s → 4s → 8s → 16s)
- **Jitter**: 0-10% random delay added
- **Max Delay**: 60 seconds
- **Cleanup**: Completed jobs removed, failed jobs retained

### Dead Letter Queue (soroban-dlq)

- Receives jobs after 5 failed attempts
- Requires manual review and resubmission
- Persisted indefinitely for audit trail

## Idempotency

All transactions require an `idempotencyKey`:

- **Purpose**: Prevent duplicate submissions (e.g., retry button clicks)
- **Storage**: Redis with 24-hour TTL
- **Behavior**: Second submission with same key returns `400 Bad Request`

**Best Practices:**

- Use deterministic keys: `{entity}-{id}` (e.g., `donation-uuid-123`)
- Include operation type if multiple operations per entity
- Don't reuse keys across different operations

## Error Handling

### Retry Strategy

1. **Transient Errors** (network, RPC timeout): Automatic retry with backoff
2. **Permanent Errors** (invalid args, insufficient funds): Move to DLQ immediately
3. **Unknown Errors**: Retry up to max attempts, then DLQ

### Monitoring Failed Jobs

```typescript
// Get DLQ jobs for manual review
const dlqJobs = await this.dlq.getJobs(['failed', 'completed']);

for (const job of dlqJobs) {
  console.log({
    jobId: job.id,
    data: job.data,
    error: job.failedReason,
    attempts: job.attemptsMade,
  });
}
```

## Testing

```bash
# Unit tests
npm test -- blockchain

# Integration tests (requires Redis)
npm test -- blockchain.service.spec

# Contract tests
npm run test:contracts
```

## Security Considerations

- Admin endpoints protected by `AdminGuard`
- Soroban secret key stored in environment variables
- Never expose secret key in logs or responses
- Rate limit transaction submissions at API gateway
- Monitor DLQ for suspicious patterns
- Validate contract method names and arguments
- Use testnet for development

## Performance

- **Throughput**: ~10-50 tx/sec (limited by Soroban network)
- **Latency**: 2-5 seconds per transaction (network dependent)
- **Queue Capacity**: Limited by Redis memory
- **Backpressure**: Implement client-side rate limiting if queue depth > 1000

## Organization Verification Status

`SorobanService.getOrganizationVerificationStatus(organizationId)` queries the on-chain verification state of an organization. It delegates to `soroban/soroban.service.ts`, which owns the Soroban RPC connection and a Redis cache (5-minute TTL).

**Return shape:**

```typescript
{
  verified: boolean;
  verifiedAt?: number;       // Unix timestamp
  verifiedBy?: string;       // Address that performed verification
  revokedAt?: number;        // Set if verification was revoked
  revocationReason?: string;
  orgId: string;
} | null
```

Returns `null` when:

- No Soroban contract is configured (`SOROBAN_CONTRACT_ID` unset)
- The organization has no on-chain record
- The contract simulation fails (e.g. contract not deployed)

Throws when:

- The Soroban RPC is unreachable (`RPC unavailable` message)
- The RPC call times out (`timeout or network error` message)
- The returned `ScVal` cannot be decoded

**Module wiring:** `BlockchainModule` imports `SorobanModule` via `forwardRef()` to avoid a circular dependency. The `SorobanRpcService` is injected into `SorobanService` (blockchain) with `@Inject(forwardRef(() => SorobanRpcService))`.

---

## Webhook Callback Processing

`processWebhookCallback(callback)` handles inbound blockchain events from a trusted webhook provider. It persists durable state to the `on_chain_tx_states` table and emits domain events **exactly once per milestone** using a bitmask on `emittedEvents`.

### State machine

```
PENDING → CONFIRMED (accumulating) → FINAL
        ↘ FAILED
```

### Event bitmask

Each milestone is guarded by a bit in `TX_EVENT_BIT` so retried webhook deliveries cannot produce duplicate domain events:

| Bit | Constant                 | Domain event emitted      |
| --- | ------------------------ | ------------------------- |
| 1   | `TX_EVENT_BIT.PENDING`   | `blockchain.tx.pending`   |
| 2   | `TX_EVENT_BIT.CONFIRMED` | `blockchain.tx.confirmed` |
| 4   | `TX_EVENT_BIT.FAILED`    | `blockchain.tx.failed`    |
| 8   | `TX_EVENT_BIT.FINAL`     | `blockchain.tx.final`     |

`blockchain.tx.final` is only emitted once the confirmation count reaches the finality threshold defined in `ConfirmationService`.

### Listening to domain events

```typescript
import { OnEvent } from '@nestjs/event-emitter';
import { TxFinalEvent } from '../events/blockchain-tx.events';

@Injectable()
export class OrderService {
  @OnEvent('blockchain.tx.final')
  async handleTxFinal(event: TxFinalEvent) {
    // Safe to mark order as settled — fires exactly once
    await this.orderRepo.markSettled(event.transactionHash);
  }
}
```

---

## DLQ Replay

`replayDlqJobs(options)` resubmits permanently failed jobs from the dead-letter queue back to the main queue. It is an admin-only operation exposed via `BlockchainController`.

**Options:**

| Field       | Type    | Default | Description                    |
| ----------- | ------- | ------- | ------------------------------ |
| `dryRun`    | boolean | `false` | Inspect without resubmitting   |
| `batchSize` | number  | `10`    | Max jobs to process per call   |
| `offset`    | number  | `0`     | Pagination offset into the DLQ |

**Response:**

```typescript
{
  dryRun: boolean;
  totalInspected: number;
  replayable: number; // Jobs with valid data
  replayed: number; // Successfully resubmitted (live run only)
  skipped: number; // Jobs with missing required fields
  errors: Array<{ jobId: string; reason: string }>;
}
```

**What happens during a live replay:**

1. The old idempotency key is cleared so the job can be resubmitted.
2. The job is re-enqueued on `soroban-tx-queue` with `replayedFrom` and `replayedAt` added to its metadata.
3. The original DLQ entry is removed on success.

Always run with `dryRun: true` first to inspect what would be replayed before committing.

---

## Backoff Calculation

`calculateBackoffDelay(attemptNumber)` returns the delay in milliseconds for a given retry attempt. It is used internally by the queue worker but is public for testing and observability.

**Formula:** `min(baseDelay × 2^(attempt−1) + jitter, maxDelay)`

- Base delay: 1 000 ms
- Max delay: 60 000 ms
- Jitter: 0–10 % of the exponential component (prevents thundering herd)

| Attempt | Approx. delay |
| ------- | ------------- |
| 1       | ~1 s          |
| 2       | ~2 s          |
| 3       | ~4 s          |
| 4       | ~8 s          |
| 5       | ~16 s         |

---

## Troubleshooting

### Jobs Stuck in Queue

```bash
# Check Redis connection
redis-cli ping

# Check queue depth
curl http://localhost:3000/api/v1/blockchain/queue/status
```

### High DLQ Count

- Review DLQ jobs for common error patterns
- Check Soroban RPC URL connectivity
- Verify contract ID and network configuration
- Ensure sufficient XLM balance for fees

### Idempotency Key Conflicts

- Use more specific keys (include timestamp or nonce)
- Increase Redis TTL if operations take longer
- Clear old keys manually if needed: `redis-cli DEL idempotency:{key}`
