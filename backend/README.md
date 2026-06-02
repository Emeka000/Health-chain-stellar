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
http://localhost:3000/api/v1
```

All routes are prefixed with `/api/v1`, controlled by the `API_PREFIX` environment variable.

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

Requests are throttled per role using Redis-backed distributed rate limiting:

| Scope | Limit |
|---|---|
| Default | 30 req / min |
| Auth routes | 10 req / min |
| Forgot password | 5 req / min |

Exceeding the limit returns `429 Too Many Requests`.

### Permissions

After JWT validation, a global `PermissionsGuard` enforces role-based access. Restricted endpoints use the `@RequirePermissions()` decorator:

```typescript
@RequirePermissions(Permission.MANAGE_USERS)
@Patch('unlock')
```

### Donation API Flow

```
POST /api/v1/donations/intent      → create payment intent (returns unsigned tx)
PATCH /api/v1/donations/:id/confirm → submit signed transaction hash on-chain
GET  /api/v1/donations/my-donations → donor history (donations + pledges)
GET  /api/v1/donations/:id          → single donation detail
```

### Soroban / Blockchain Integration

The `SorobanModule` wraps the Stellar SDK. On-chain events are indexed by `SorobanIndexerService` and stored in PostgreSQL for fast querying. Blockchain submissions go through:

```
POST /api/v1/blockchain/submit
GET  /api/v1/blockchain/transaction/:id
GET  /api/v1/blockchain/status
```

### WebSocket (Real-time)

Real-time events (tracking, notifications) are served over Socket.io via `@nestjs/websockets`. Connections are authenticated using the same JWT strategy via `WsAuthService`.

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
http://localhost:3000/docs
```

---

## Testing

```bash
npm run test           # unit tests
npm run test:e2e       # end-to-end tests
npm run test:cov       # coverage report
npm run test:contracts # Soroban contract integration tests
```
