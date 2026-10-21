# Backend — HealthDonor Protocol

The backend is built with **NestJS (v11)** on **Node.js + TypeScript**, following a modular domain-driven architecture. It exposes a RESTful API consumed by the frontend and integrates directly with Stellar Soroban smart contracts.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Framework | NestJS 11 |
| Language | TypeScript 5 |
| Database | PostgreSQL via TypeORM |
| Cache / Queue | Redis + BullMQ |
| Auth | JWT (access + refresh tokens), Passport |
| Blockchain | Stellar Soroban SDK |
| API Docs | Swagger / OpenAPI (`/docs`) |
| Notifications | Firebase (push), Nodemailer (email), Africa's Talking (SMS) |

---

## Project Structure

```
src/
├── auth/               # JWT auth, sessions, MFA, permissions
├── donations/          # Donation intents, confirmations, pledges
├── blood-requests/     # Blood request lifecycle
├── blood-units/        # Blood unit tracking
├── inventory/          # Inventory management
├── orders/             # Order processing
├── dispatch/           # Dispatch assignments
├── riders/             # Rider management
├── hospitals/          # Hospital registry
├── organizations/      # Organization management
├── soroban/            # Stellar Soroban contract integration
├── blockchain/         # On-chain event indexing
├── escrow-governance/  # Escrow fund management
├── notifications/      # Multi-channel notifications
├── tracking/           # Real-time location tracking
├── reporting/          # Analytics and reports
├── common/             # Shared filters, guards, middleware
└── main.ts             # Bootstrap entry point
```

---

## How the API Works

### Base URL

```
http://localhost:3001/api/v1
```

All routes are prefixed with `/api/v1`, controlled by the `API_PREFIX` environment variable.

> **Tip:** The interactive Swagger UI at `http://localhost:3001/docs` is always up-to-date with the live route table. Prefer it over the hand-maintained lists below when verifying exact paths.

### Authentication Flow

The API uses **JWT Bearer tokens**. Most endpoints require authentication; public routes are decorated with `@Public()`.

**1. Register**
```http
POST /api/v1/auth/register
Content-Type: application/json

{
  "email": "user@example.com",
  "password": "SecurePassword123!",
  "name": "John Doe",
  "role": "donor"
}
```

**2. Login — receive tokens**
```http
POST /api/v1/auth/login
Content-Type: application/json

{
  "email": "user@example.com",
  "password": "SecurePassword123!"
}
```
Response:
```json
{
  "access_token": "<jwt>",
  "refresh_token": "<jwt>"
}
```

**3. Authenticated requests — attach Bearer token**
```http
GET /api/v1/blood-requests
Authorization: Bearer <access_token>
```

**4. Refresh token**
```http
POST /api/v1/auth/refresh
Content-Type: application/json

{ "refreshToken": "<refresh_token>" }
```

**5. Logout**
```http
POST /api/v1/auth/logout
Authorization: Bearer <access_token>
```

### Request / Response Conventions

- All request bodies are validated via `class-validator` DTOs. Invalid payloads return `400` with field-level errors.
- Responses follow a consistent error shape:
  ```json
  {
    "code": "AUTH_INVALID_CREDENTIALS",
    "message": "Invalid email or password",
    "statusCode": 401,
    "timestamp": "2024-03-27T04:30:44.473Z"
  }
  ```
- A `X-Correlation-Id` header is attached to every response for request tracing.
- Idempotent mutation endpoints accept an optional `Idempotency-Key` header to prevent duplicate processing.

### Rate Limiting

Requests are throttled using Redis-backed distributed rate limiting. There are both **scope-level** limits (applied to specific route groups) and **per-role** limits (applied to authenticated callers). The per-role limits are configured in `src/config/throttle-limits.config.ts`.

**Scope-level limits**

| Scope | Limit |
|---|---|
| Default | 30 req / min |
| Auth routes | 10 req / min |
| Forgot password | 5 req / min |

**Per-role limits** (authenticated requests)

| Role | Limit / min | Notes |
|---|---|---|
| Admin | Unlimited | Never throttled |
| Vendor / Blood Bank | 500 | |
| Hospital | 200 | 2× weight on emergency endpoints |
| Donor | 60 | |
| Rider | 60 | |
| Public (unauthenticated) | 30 | |
| USSD | 10 | Tightest limit; public-facing dial-in |

Emergency roles (Admin, Hospital) receive a **2× priority weight** on endpoints flagged as emergency workflows.

> **Note:** Due to a key-case normalisation bug in the current throttle guard, per-role limits are not yet applied at runtime — all authenticated requests currently fall through to the public (30 req/min) default. This is tracked separately and will be fixed in an upcoming release.

Exceeding any limit returns `429 Too Many Requests`.

### Permissions

After JWT validation, a global `PermissionsGuard` enforces role-based access. Restricted endpoints use the `@RequirePermissions()` decorator:

```typescript
@RequirePermissions(Permission.MANAGE_USERS)
@Patch('unlock')
```

### Donation API Flow

The donation flow is **memo-based**: the backend issues a unique memo that the client must embed in the Stellar payment transaction. The backend never constructs the transaction itself.

```
POST  /api/v1/donations/intent          → create donation intent (returns entity with memo)
PATCH /api/v1/donations/:id/confirm     → confirm by submitting on-chain tx hash
GET   /api/v1/donations/my-donations    → donor history (donations + pledges)
GET   /api/v1/donations/:id             → single donation detail
```

**Step-by-step**

1. **Create intent** — `POST /api/v1/donations/intent`

   The server creates a `DonationEntity` with status `PENDING` and returns a `memo` of the form `DON-XXXXXXXX` (e.g. `DON-A3F92B1C`).

   ```json
   {
     "id": "...",
     "memo": "DON-A3F92B1C",
     "amount": 100,
     "asset": "XLM",
     "status": "PENDING"
   }
   ```

2. **Build and submit the Stellar payment** — client-side

   The client constructs a standard Stellar `PAYMENT` (or `PATH_PAYMENT`) operation targeting the recipient address, sets the transaction **text memo** to the exact `memo` value returned above, signs it with the donor's keypair, and submits it to Horizon / Soroban RPC.

   ```js
   const tx = new StellarSdk.TransactionBuilder(sourceAccount, { fee, networkPassphrase })
     .addOperation(StellarSdk.Operation.payment({ destination, asset, amount }))
     .addMemo(StellarSdk.Memo.text(donation.memo))   // ← required
     .setTimeout(30)
     .build();

   tx.sign(keypair);
   const result = await server.submitTransaction(tx);
   const txHash = result.hash;
   ```

3. **Confirm donation** — `PATCH /api/v1/donations/:id/confirm`

   Supply the transaction hash. The backend fetches the transaction on-chain, checks it is `SUCCESS`, and verifies the memo matches the one issued with the intent. Any mismatch returns `400`.

   ```http
   PATCH /api/v1/donations/DON_ENTITY_ID/confirm
   Authorization: Bearer <access_token>
   Content-Type: application/json

   { "transactionHash": "<stellar_tx_hash>" }
   ```

   On success the entity status moves to `COMPLETED` and the hash is persisted.

> **Consent requirement:** `createIntent` calls `ConsentService.assertCurrentConsent` for authenticated donors. If the donor's consent record is missing or drifted, the intent is rejected before any write occurs.

### Soroban / Blockchain Integration

The `SorobanModule` wraps the Stellar SDK. On-chain events are indexed by `SorobanIndexerService` and stored in PostgreSQL for fast querying. Blockchain submissions go through an async BullMQ queue; callers receive a `jobId` immediately and poll for the result.

**Endpoints** (all require `Authorization: Bearer <token>` unless noted)

| Method | Path | Auth | Description |
|---|---|---|---|
| `POST` | `/api/v1/blockchain/submit-transaction` | Admin (FULL scope) | Enqueue a Soroban contract call; returns `{ jobId }` |
| `GET` | `/api/v1/blockchain/job/:jobId` | Bearer | Poll job status and result |
| `GET` | `/api/v1/blockchain/queue/status` | Admin (READ_METRICS) | Live queue depth and DLQ count |
| `GET` | `/api/v1/blockchain/metrics` | Admin | Detailed counters and duration statistics |
| `GET` | `/api/v1/blockchain/metrics/prometheus` | Admin | Prometheus text-format scrape endpoint |
| `POST` | `/api/v1/blockchain/webhook/callback` | Public (HMAC-signed) | Receive on-chain event callbacks from Stellar node |
| `POST` | `/api/v1/blockchain/admin/retry-failed` | Admin | Replay all failed outbox records |
| `GET` | `/api/v1/blockchain/admin/replay-audits` | Admin | List DLQ replay audit trail |
| `GET` | `/api/v1/blockchain/admin/health` | Admin | Count of unresolved failed transactions |

**Webhook security:** `POST /blockchain/webhook/callback` is `@Public()` but validates an HMAC-SHA-256 signature in the `X-Webhook-Signature` header (key: `BLOCKCHAIN_CALLBACK_SECRET`). Callbacks older than 5 minutes or missing the signature are rejected. Duplicate `eventId` values are detected and rejected to prevent replay attacks.

**Async submit flow:**

```
Client → POST /blockchain/submit-transaction → { jobId }
                                                    ↓
                                              BullMQ queue
                                                    ↓
                                         SorobanService worker
                                                    ↓
Client → GET /blockchain/job/:jobId → { status, result | error }
```

### WebSocket (Real-time)

Real-time events (tracking, notifications) are served over Socket.io via `@nestjs/websockets`. Connections are authenticated by `WsAuthService`, which replicates the full HTTP JWT + RBAC verification.

**Authentication requirements:**

- Supply the JWT in `socket.handshake.auth.token` **or** as a `Bearer` token in the `Authorization` handshake header.
- The JWT must contain `userId`. For all roles **except** `donor` and `rider`, a `tenantId` claim is also required — connections without one are rejected with `Invalid token claims: missing userId or tenantId` (see issue #1498).
- The session referenced by the token's `sid` claim must be active (not logged out or revoked).

**Rate limiting:** maximum **10 new connections per minute** per `userId + IP` combination. Excess connections receive `Rate limit exceeded: too many connections`.

```js
// Correct: provide token in auth object
const socket = io('http://localhost:3001', {
  auth: { token: accessToken },
});

// Also accepted: Authorization header
const socket = io('http://localhost:3001', {
  extraHeaders: { Authorization: `Bearer ${accessToken}` },
});
```

---

## Running the Backend

```bash
# Install dependencies
npm install

# Development (watch mode)
npm run start:dev

# Production
npm run build
npm run start:prod
```

### Environment Variables

Copy `.env.example` to `.env` and fill in the required values:

```bash
cp .env.example .env
```

> The backend defaults to `PORT=3001`. The Next.js frontend defaults to port 3000, so running both at once won't conflict.

Key variables:

```env
DATABASE_HOST=localhost
DATABASE_PORT=5432
DATABASE_USERNAME=postgres
DATABASE_PASSWORD=
DATABASE_NAME=

JWT_SECRET=
JWT_REFRESH_SECRET=

REDIS_HOST=localhost
REDIS_PORT=6379

SOROBAN_RPC_URL=https://soroban-testnet.stellar.org
SOROBAN_CONTRACT_ID=
SOROBAN_SECRET_KEY=
SOROBAN_NETWORK=testnet

BLOCKCHAIN_CALLBACK_SECRET=   # HMAC secret for webhook signature validation
```

### Database Migrations

```bash
npm run migration:run      # apply pending migrations
npm run migration:revert   # revert last migration
npm run migration:generate # generate migration from entity changes
```

> `synchronize` is only enabled in `development` and `test` environments. Production always uses explicit migrations.

---

## API Documentation

Interactive Swagger docs are available at:

```
http://localhost:3001/docs
```

The machine-readable OpenAPI schema (used by code generators and validators) is at:

```
http://localhost:3001/docs-json
```

---

## Testing

```bash
npm run test           # unit tests
npm run test:e2e       # end-to-end tests
npm run test:cov       # coverage report
npm run test:contracts # Soroban contract integration tests
```
