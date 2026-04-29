# API Versioning Strategy

## Overview

HealthDonor Protocol uses **URI-based versioning** to manage API evolution while maintaining backward compatibility. All routes are prefixed with `/api/v1`.

## Current Version

- **Current API Version**: v1
- **Base URL**: `http://localhost:3000/api/v1`
- **Environment Variable**: `API_PREFIX` (default: `api/v1`)

## Versioning Approach

### URI-Based Versioning

All API endpoints include the version in the URI path:

```
/api/v1/auth/login
/api/v1/blood-requests
/api/v1/inventory/items
```

**Advantages:**
- Clear version visibility in URLs
- Easy to route to different handlers
- Explicit in API documentation
- Supports multiple versions simultaneously

## Available Endpoints (v1)

### Authentication
- `POST /api/v1/auth/register` - User registration
- `POST /api/v1/auth/login` - User login
- `POST /api/v1/auth/refresh` - Refresh JWT token
- `DELETE /api/v1/auth/logout` - User logout

### Blood Requests
- `GET /api/v1/blood-requests` - List blood requests
- `POST /api/v1/blood-requests` - Create blood request
- `GET /api/v1/blood-requests/:id` - Get blood request details
- `PATCH /api/v1/blood-requests/:id` - Update blood request

### Inventory
- `GET /api/v1/inventory` - List inventory items
- `POST /api/v1/inventory` - Create inventory item
- `GET /api/v1/inventory/:id` - Get inventory item
- `PATCH /api/v1/inventory/:id` - Update inventory item

### Orders
- `GET /api/v1/orders` - List orders
- `POST /api/v1/orders` - Create order
- `GET /api/v1/orders/:id` - Get order details
- `PATCH /api/v1/orders/:id` - Update order

### Dispatch
- `GET /api/v1/dispatch/assignments` - List dispatch assignments
- `POST /api/v1/dispatch/assignments` - Create assignment
- `PATCH /api/v1/dispatch/assignments/:id` - Update assignment

### Riders
- `GET /api/v1/riders` - List riders
- `POST /api/v1/riders` - Create rider
- `GET /api/v1/riders/:id` - Get rider details
- `PATCH /api/v1/riders/:id` - Update rider

### Users
- `GET /api/v1/users` - List users
- `GET /api/v1/users/:id` - Get user details
- `PATCH /api/v1/users/:id` - Update user

### Organizations
- `GET /api/v1/organizations` - List organizations
- `POST /api/v1/organizations` - Create organization
- `GET /api/v1/organizations/:id` - Get organization details

### Hospitals
- `GET /api/v1/hospitals` - List hospitals
- `POST /api/v1/hospitals` - Create hospital
- `GET /api/v1/hospitals/:id` - Get hospital details

### Blockchain
- `GET /api/v1/blockchain/status` - Get blockchain status
- `POST /api/v1/blockchain/submit` - Submit transaction
- `GET /api/v1/blockchain/transaction/:id` - Get transaction details

### Notifications
- `GET /api/v1/notifications` - List notifications
- `POST /api/v1/notifications` - Create notification
- `PATCH /api/v1/notifications/:id/read` - Mark notification as read

### Maps
- `GET /api/v1/maps/nearby` - Find nearby locations
- `POST /api/v1/maps/route` - Calculate route

### Blood Units
- `GET /api/v1/blood-units` - List blood units
- `POST /api/v1/blood-units` - Create blood unit
- `GET /api/v1/blood-units/:id` - Get blood unit details

### Activity Logs
- `GET /api/v1/activity-logs` - List activity logs

## Backward Compatibility

### Current Status
All existing routes are available under the v1 prefix. Endpoint compatibility classes are now enforced with contract checks:

- `additive`: only backward-compatible field additions allowed
- `strict`: frozen response shape unless approved override exists
- `deprecated`: endpoint emits deprecation/sunset metadata and successor link

Legacy response adapters are supported on selected endpoints using:

- Header: `X-API-Client-Shape: legacy`
- Query: `?compat=legacy`

### Migration Path for Future Versions

When introducing v2 or later:

1. **Parallel Support**: Both v1 and v2 endpoints will be available simultaneously
2. **Deprecation Period**: v1 will be maintained for at least 6 months after v2 release
3. **Deprecation Headers**: v1 responses will include `Deprecation: true` header
4. **Sunset Header**: v1 will include `Sunset: <date>` header indicating end-of-life

Example deprecation headers:
```
Deprecation: true
Sunset: Sun, 31 Dec 2024 23:59:59 GMT
Link: </api/v2/blood-requests>; rel="successor-version"
```

## Configuration

### Setting API Prefix

The API prefix is configured via environment variable:

```bash
# .env
API_PREFIX=api/v1
```

### Changing the Prefix

To use a different prefix (e.g., `api/v2`):

```bash
API_PREFIX=api/v2 npm run start
```

The prefix is applied globally in `src/main.ts`:

```typescript
const apiPrefix = configService.get<string>('API_PREFIX', 'api/v1');
app.setGlobalPrefix(apiPrefix);
```

## Client Integration

### JavaScript/TypeScript

```typescript
const API_BASE = 'http://localhost:3000/api/v1';

// Fetch blood requests
const response = await fetch(`${API_BASE}/blood-requests`);
const data = await response.json();
```

### cURL

```bash
curl -X GET http://localhost:3000/api/v1/blood-requests \
  -H "Authorization: Bearer <token>"
```

### Postman

1. Set base URL: `{{BASE_URL}}/api/v1`
2. Use relative paths: `/blood-requests`, `/auth/login`, etc.

## API Documentation

Full API documentation is available via Swagger/OpenAPI:

```
http://localhost:3000/api/v1/api
```

### Contract Enforcement

- Schema breaking changes are validated in `src/__contracts__/schema-diff.spec.ts`
- OpenAPI response drift checks are validated in `src/__contracts__/openapi-diff.contract.spec.ts`
- Endpoint compatibility and deprecation headers are validated in `src/__contracts__/api-compatibility.contract.spec.ts`

### Migration Notes

- Blood matching endpoint migration examples:
  - `docs/API_MIGRATION_NOTES_BLOOD_MATCHING.md`

## Version Upgrade Guide

### For API Consumers

When a new version is released:

1. **Monitor Deprecation Headers**: Watch for `Deprecation: true` header
2. **Review Migration Guide**: Check release notes for breaking changes
3. **Test Against v2**: Use staging environment to test v2 endpoints
4. **Update Client Code**: Migrate to v2 before sunset date
5. **Verify Functionality**: Ensure all features work with v2

### For API Developers

When introducing a new version:

1. **Create New Controllers**: Duplicate existing controllers with v2 suffix
2. **Update Routes**: Change `@Controller('resource')` to `@Controller('v2/resource')`
3. **Implement Changes**: Add new features or fix breaking issues
4. **Add Deprecation Headers**: Mark v1 endpoints as deprecated
5. **Document Changes**: Create migration guide for consumers
6. **Test Compatibility**: Ensure v1 and v2 coexist without conflicts

## Best Practices

### For API Consumers

- Always include the version in your API calls
- Monitor deprecation headers and plan upgrades
- Test against new versions in staging before production
- Keep client libraries updated

### For API Developers

- Never remove endpoints without deprecation period
- Always provide migration path for breaking changes
- Document all changes in release notes
- Maintain backward compatibility when possible
- Use semantic versioning for API versions

## Troubleshooting

### Routes Not Found (404)

Ensure you're using the correct version prefix:

```bash
# ❌ Wrong - missing /api/v1
curl http://localhost:3000/blood-requests

# ✅ Correct
curl http://localhost:3000/api/v1/blood-requests
```

### Version Mismatch

If you're getting unexpected responses:

1. Check the `API_PREFIX` environment variable
2. Verify the server is running with correct prefix
3. Check Swagger docs at `/api/v1/api`

## Future Roadmap

- **v2 (Planned)**: GraphQL support, enhanced filtering, batch operations
- **v3 (Future)**: Real-time subscriptions, advanced analytics

## References

- [Semantic Versioning](https://semver.org/)
- [REST API Versioning Best Practices](https://restfulapi.net/versioning/)
- [NestJS Global Prefix Documentation](https://docs.nestjs.com/faq/global-prefix)
