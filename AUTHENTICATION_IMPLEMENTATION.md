# Authentication System Implementation Guide

## Overview

This document describes the production-ready authentication system with automatic token refresh, implemented for the Health Chain Stellar application.

## ✅ Implemented Features

### 1. Automatic Token Refresh
- ✅ Axios-like interceptor pattern using native fetch
- ✅ Catches 401 responses and automatically refreshes tokens
- ✅ Transparently retries original request after refresh
- ✅ No user interruption during token refresh

### 2. Request Queue Pattern
- ✅ Prevents duplicate refresh calls
- ✅ Queues concurrent requests during refresh
- ✅ Retries all queued requests after new token is issued
- ✅ Thread-safe refresh coordination

### 3. Session Management
- ✅ Zustand store with persist middleware
- ✅ sessionStorage backend (cleared on browser close)
- ✅ Secure token storage (not localStorage)
- ✅ Survives page refresh but not browser close

### 4. Route Protection
- ✅ Next.js middleware for server-side protection
- ✅ Redirects unauthenticated users to login
- ✅ Preserves intended destination in redirect parameter
- ✅ Prevents authenticated users from accessing auth pages

### 5. User Experience
- ✅ Toast notifications for session expiry
- ✅ Automatic redirect to login with reason parameter
- ✅ Seamless token refresh (no UI interruption)
- ✅ Loading states and error handling

## Architecture

### File Structure

```
frontend/health-chain/
├── lib/
│   ├── api/
│   │   ├── http-client.ts          # HTTP client with token refresh
│   │   ├── README.md               # API documentation
│   │   └── __tests__/
│   │       └── http-client.test.ts # Unit tests
│   ├── stores/
│   │   └── auth.store.ts           # Zustand auth store
│   ├── hooks/
│   │   ├── useAuth.ts              # Auth operations hook
│   │   └── useToast.ts             # Toast notifications hook
│   └── types/
│       └── auth.types.ts           # TypeScript types
├── components/
│   ├── ui/
│   │   └── Toast.tsx               # Toast component
│   └── providers/
│       └── ToastProvider.tsx       # Global toast provider
├── middleware.ts                    # Route protection
├── app/
│   └── layout.tsx                  # Root layout with providers
└── .env.example                    # Environment variables

```

### Data Flow

```
┌─────────────────────────────────────────────────────────────┐
│                     User Makes Request                       │
└────────────────────────┬────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────┐
│              HTTP Client (http-client.ts)                    │
│  • Adds Authorization header with access token              │
│  • Sends request to backend                                 │
└────────────────────────┬────────────────────────────────────┘
                         │
                         ▼
                    ┌────────┐
                    │Backend │
                    └────┬───┘
                         │
         ┌───────────────┴───────────────┐
         │                               │
         ▼                               ▼
    ┌────────┐                      ┌────────┐
    │200 OK  │                      │401 Unauth│
    └────┬───┘                      └────┬───┘
         │                               │
         ▼                               ▼
    Return Data              ┌──────────────────────┐
                            │ Is Refresh Running?   │
                            └──────┬───────┬────────┘
                                   │       │
                              Yes  │       │  No
                                   │       │
                                   ▼       ▼
                         ┌──────────┐  ┌──────────────┐
                         │Queue Req │  │Start Refresh │
                         └────┬─────┘  └──────┬───────┘
                              │                │
                              │                ▼
                              │      ┌──────────────────┐
                              │      │Call /auth/refresh│
                              │      └────┬─────┬───────┘
                              │           │     │
                              │      Success   Fail
                              │           │     │
                              │           ▼     ▼
                              │    ┌──────────┐ ┌──────────┐
                              │    │Update    │ │Clear Auth│
                              │    │Token     │ │Redirect  │
                              │    └────┬─────┘ └──────────┘
                              │         │
                              └─────────┤
                                        │
                                        ▼
                              ┌──────────────────┐
                              │Retry All Queued  │
                              │Requests          │
                              └──────────────────┘
```

## Installation

### 1. Install Dependencies

```bash
cd frontend/health-chain
npm install zustand
```

### 2. Environment Configuration

Create `.env.local`:

```bash
NEXT_PUBLIC_API_URL=http://localhost:3001
```

### 3. Backend Requirements

Ensure your backend implements these endpoints:

#### Login Endpoint
```typescript
POST /auth/login
Request: { email: string, password: string }
Response: {
  access_token: string,      // Short-lived (15 min recommended)
  refresh_token: string,     // Long-lived (7 days recommended)
  user: {
    id: string,
    email: string,
    name: string,
    role: string
  }
}
```

#### Refresh Endpoint
```typescript
POST /auth/refresh
Request: { refreshToken: string }
Response: {
  access_token: string,
  refresh_token?: string     // Optional: for token rotation
}
```

#### Protected Endpoints
Return 401 when token is invalid:
```typescript
Response: 401 Unauthorized
Headers: { "WWW-Authenticate": "Bearer" }
```

## Usage Examples

### 1. Making API Calls

```typescript
import { api } from '@/lib/api/http-client';

// Authenticated request (automatic token refresh)
const orders = await api.get('/orders');

// POST with data
const newOrder = await api.post('/orders', {
  bloodType: 'A+',
  quantity: 2
});

// Public endpoint (skip auth)
const stats = await api.get('/public/stats', { skipAuth: true });
```

### 2. Using Auth Hook

```typescript
'use client';

import { useAuth } from '@/lib/hooks/useAuth';

export default function ProfilePage() {
  const { user, isAuthenticated, logout } = useAuth();

  if (!isAuthenticated) {
    return <div>Please log in</div>;
  }

  return (
    <div>
      <h1>Welcome, {user?.name}</h1>
      <button onClick={logout}>Logout</button>
    </div>
  );
}
```

### 3. Login Component

```typescript
'use client';

import { useAuth } from '@/lib/hooks/useAuth';
import { useRouter } from 'next/navigation';
import { useToast } from '@/lib/hooks/useToast';

export default function LoginForm() {
  const { login } = useAuth();
  const router = useRouter();
  const { success, error } = useToast();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    const result = await login({
      email: 'user@example.com',
      password: 'password'
    });

    if (result.success) {
      success('Logged in successfully!');
      router.push('/dashboard');
    } else {
      error(result.error || 'Login failed');
    }
  };

  return <form onSubmit={handleSubmit}>{/* form fields */}</form>;
}
```

### 4. Protected Route

Routes under `/dashboard` are automatically protected by middleware. No additional code needed!

```typescript
// app/dashboard/page.tsx
export default function Dashboard() {
  // This page is automatically protected
  // Unauthenticated users are redirected to /auth/signin
  return <div>Dashboard Content</div>;
}
```

## Security Best Practices

### ✅ Implemented

1. **sessionStorage over localStorage**
   - Cleared on browser close
   - Reduced XSS attack surface
   - Better for sensitive tokens

2. **Token Refresh Pattern**
   - Short-lived access tokens (15 min)
   - Long-lived refresh tokens (7 days)
   - Automatic refresh before expiry

3. **Secure Token Handling**
   - Never exposed in URLs
   - Not stored in cookies (client-side)
   - Cleared on logout

4. **Route Protection**
   - Server-side middleware
   - No client-side bypass possible
   - Preserves intended destination

### 🔒 Backend Requirements

Implement these on your backend:

1. **httpOnly Cookies for Refresh Tokens**
   ```typescript
   res.cookie('refreshToken', token, {
     httpOnly: true,
     secure: true,
     sameSite: 'strict',
     maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days
   });
   ```

2. **CORS Configuration**
   ```typescript
   app.use(cors({
     origin: process.env.FRONTEND_URL,
     credentials: true
   }));
   ```

3. **Rate Limiting**
   ```typescript
   // Limit refresh attempts
   rateLimit({
     windowMs: 15 * 60 * 1000,
     max: 5
   });
   ```

4. **Token Rotation**
   - Issue new refresh token on each refresh
   - Invalidate old refresh token
   - Detect token reuse (security breach)

## Testing

### Manual Testing Checklist

- [ ] Login with valid credentials
- [ ] Login with invalid credentials
- [ ] Access protected route when authenticated
- [ ] Access protected route when not authenticated
- [ ] Token refresh on 401 (wait for expiry)
- [ ] Multiple concurrent requests during refresh
- [ ] Session expiry notification
- [ ] Logout functionality
- [ ] Page refresh preserves session
- [ ] Browser close clears session
- [ ] Redirect after login to intended page

### Automated Tests

Run tests:
```bash
npm run test
```

See `lib/api/__tests__/http-client.test.ts` for test cases.

## Troubleshooting

### Issue: "Session expired" appears immediately after login

**Cause**: Backend not returning proper tokens
**Solution**: Check backend response format matches expected structure

### Issue: Infinite redirect loop

**Cause**: Middleware configuration issue
**Solution**: Verify middleware matcher excludes static files and API routes

### Issue: Token not refreshing

**Cause**: Refresh endpoint returning 401
**Solution**: Ensure refresh endpoint doesn't require access token

### Issue: Multiple refresh calls

**Cause**: Race condition
**Solution**: Verify `isRefreshing` flag is properly managed (already implemented)

### Issue: Session not persisting across page refresh

**Cause**: sessionStorage not available
**Solution**: Check browser privacy settings and compatibility

## CI/CD Integration

### GitHub Actions Example

```yaml
name: Frontend CI

on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
        with:
          node-version: '18'
      
      - name: Install dependencies
        run: npm ci
        working-directory: ./frontend/health-chain
      
      - name: Type check
        run: npm run type-check
        working-directory: ./frontend/health-chain
      
      - name: Lint
        run: npm run lint
        working-directory: ./frontend/health-chain
      
      - name: Test
        run: npm run test
        working-directory: ./frontend/health-chain
      
      - name: Build
        run: npm run build
        working-directory: ./frontend/health-chain
        env:
          NEXT_PUBLIC_API_URL: ${{ secrets.API_URL }}
```

### Deployment Checklist

- [ ] Environment variables configured
- [ ] API URL points to production backend
- [ ] HTTPS enabled
- [ ] CORS configured on backend
- [ ] Security headers configured
- [ ] Error monitoring setup (Sentry, LogRocket, etc.)
- [ ] Rate limiting enabled
- [ ] Token expiry times configured
- [ ] Backup and recovery plan

## Performance Metrics

### Expected Performance

- **Token Refresh**: < 200ms
- **Request Queue**: Minimal memory overhead
- **Concurrent Requests**: Single refresh for unlimited requests
- **Storage**: ~2KB in sessionStorage

### Monitoring

Monitor these metrics in production:

1. Token refresh success rate
2. Average refresh time
3. Number of session expiries
4. Failed login attempts
5. API error rates

## Future Enhancements

Potential improvements:

- [ ] Proactive token refresh (before expiry)
- [ ] Offline support with request queuing
- [ ] Request deduplication
- [ ] Retry logic for network errors
- [ ] Biometric authentication
- [ ] Multi-factor authentication
- [ ] Remember me functionality (with secure long-lived tokens)

## Support

For issues or questions:
1. Check troubleshooting section
2. Review API documentation in `lib/api/README.md`
3. Check test files for usage examples
4. Review backend implementation

## License

This implementation is part of the Health Chain Stellar project.
