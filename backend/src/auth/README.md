# Auth Module

JWT-based authentication and authorization with session management, role-based access control (RBAC), and security features.

## Architecture

### Core Components

- **AuthService**: Handles registration, login, token management, and session lifecycle
- **AuthController**: REST endpoints for authentication operations
- **JwtStrategy**: Passport strategy for JWT validation
- **PermissionsService**: Role and permission management
- **Guards**:
  - `JwtAuthGuard`: Validates JWT tokens (applied globally)
  - `PermissionsGuard`: Enforces permission-based access control

### Security Features

- Password hashing with bcrypt
- JWT access tokens (short-lived, default 1h)
- Refresh tokens with rotation (long-lived, default 7d)
- Session management with Redis
- Concurrent session limits (default: 3 per user)
- Account lockout after failed login attempts (5 attempts → 15min lock)
- Password history (prevents reuse of last 3 passwords)
- Rate limiting (20 requests/min on auth endpoints)
- Refresh token replay attack prevention

## Public API

### Endpoints

#### POST /auth/register
Register a new user account.

**Request:**
```json
{
  "email": "user@example.com",
  "password": "SecurePass123!",
  "firstName": "John",
  "lastName": "Doe",
  "phoneNumber": "+254700000000"
}
```

**Response:** `201 Created`
```json
{
  "message": "Registration successful",
  "user": {
    "id": "uuid",
    "email": "user@example.com",
    "role": "donor"
  }
}
```

#### POST /auth/login
Authenticate and receive tokens.

**Request:**
```json
{
  "email": "user@example.com",
  "password": "SecurePass123!"
}
```

**Response:** `200 OK`
```json
{
  "access_token": "eyJhbGc...",
  "refresh_token": "eyJhbGc..."
}
```

#### POST /auth/refresh
Rotate tokens using refresh token.

**Request:**
```json
{
  "refreshToken": "eyJhbGc..."
}
```

**Response:** `200 OK`
```json
{
  "access_token": "eyJhbGc...",
  "refresh_token": "eyJhbGc..."
}
```

#### POST /auth/logout
Revoke current or all sessions.

**Headers:** `Authorization: Bearer <access_token>`

**Response:** `200 OK`

#### GET /auth/sessions
List active sessions for current user.

**Headers:** `Authorization: Bearer <access_token>`

**Response:** `200 OK`
```json
[
  {
    "userId": "uuid",
    "sessionId": "hex-string",
    "createdAt": "2024-01-01T00:00:00Z",
    "expiresAt": "2024-01-08T00:00:00Z"
  }
]
```

#### DELETE /auth/sessions/:sessionId
Revoke a specific session.

**Headers:** `Authorization: Bearer <access_token>`

**Response:** `200 OK`

#### POST /auth/change-password
Change user password.

**Headers:** `Authorization: Bearer <access_token>`

**Request:**
```json
{
  "oldPassword": "OldPass123!",
  "newPassword": "NewPass123!"
}
```

**Response:** `200 OK`

#### PATCH /auth/unlock
Admin-only: Unlock a locked user account.

**Headers:** `Authorization: Bearer <admin_access_token>`

**Request:**
```json
{
  "userId": "uuid"
}
```

**Response:** `200 OK`

## Role-to-Permission Matrix

For a complete table of which role holds which permission, see
**[docs/rbac.md](../../../../docs/rbac.md)**.

That document also covers:
- How permission resolution works at request time
- Every `Permission` enum value and what it allows
- Known gaps (permissions in the enum that are currently ungranted, causing 403 for all roles)
- Step-by-step instructions for adding or changing a grant via a migration

A Jest test at [`__tests__/rbac-coverage.spec.ts`](./__tests__/rbac-coverage.spec.ts)
fails if any `Permission` enum value is not seeded to at least one role, keeping the
matrix and the migrations in sync.

---

## Usage

### Protecting Routes

All routes are protected by default via global `JwtAuthGuard`. To make a route public:

```typescript
import { Public } from './auth/decorators/public.decorator';

@Public()
@Get('public-endpoint')
async publicEndpoint() {
  return { message: 'No auth required' };
}
```

### Permission-Based Access

```typescript
import { RequirePermissions } from './auth/decorators/require-permissions.decorator';
import { Permission } from './auth/enums/permission.enum';

@RequirePermissions(Permission.MANAGE_USERS, Permission.VIEW_REPORTS)
@Get('admin-only')
async adminEndpoint() {
  return { message: 'Admin access required' };
}
```

### Accessing Current User

```typescript
@Get('profile')
async getProfile(@Request() req) {
  const userId = req.user.id;
  const userEmail = req.user.email;
  const userRole = req.user.role;
  // ...
}
```

## Configuration

Environment variables (see `.env.example`):

```env
JWT_SECRET=your-secret-key
JWT_EXPIRES_IN=1h
JWT_REFRESH_SECRET=your-refresh-secret
JWT_REFRESH_EXPIRES_IN=7d
MAX_CONCURRENT_SESSIONS=3
```

## Data Models

### User Entity
- `id`: UUID
- `email`: Unique, lowercase
- `passwordHash`: Bcrypt hash
- `passwordHistory`: Array of previous hashes
- `role`: User role (donor, hospital, admin, etc.)
- `failedLoginAttempts`: Counter for lockout
- `lockedUntil`: Timestamp for account lock expiry

### Role Entity
- `id`: UUID
- `name`: Role name
- `description`: Role description

### RolePermission Entity
- Links roles to permissions
- Many-to-many relationship

## Redis Keys

- `auth:session:{sessionId}`: Session data (hash)
- `auth:user-sessions:{userId}`: User's session IDs (sorted set)
- `auth:refresh-consumed:{token}`: Consumed refresh tokens (string with TTL)

## Testing

```bash
# Unit tests
npm test -- auth

# Integration tests
npm test -- auth.service.integration

# Contract tests
npm run test:contracts -- auth.contract
```

## Security Considerations

- Never log passwords or tokens
- Rotate JWT secrets regularly in production
- Use HTTPS in production
- Configure CORS appropriately
- Monitor failed login attempts
- Implement rate limiting at load balancer level
- Use strong password policies
- Consider 2FA for sensitive operations
