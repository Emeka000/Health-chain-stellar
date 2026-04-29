# Quick Reference: Unified API Error Taxonomy (#692)

## Throw Standard Exceptions

```typescript
// Import
import {
  OrderNotFoundException,
  ValidationFailedException,
  AuthInvalidCredentialsException,
  RateLimitExceededException,
} from './common/errors/standard-exception';

// Authentication
throw new AuthInvalidCredentialsException(correlationId);

// Validation
throw new ValidationFailedException([
  { field: 'email', message: 'Invalid email', constraint: 'isEmail' },
], correlationId);

// Not found
throw new OrderNotFoundException(orderId, correlationId);

// Rate limit
throw new RateLimitExceededException(60, correlationId);
```

## Error Response Format

```json
{
  "statusCode": 400,
  "errorCode": "VALIDATION_FAILED",
  "domain": "VALIDATION",
  "message": "Validation failed",
  "correlationId": "550e8400-e29b-41d4-a716-446655440000",
  "timestamp": "2024-01-01T12:00:00.000Z",
  "path": "/api/v1/orders",
  "method": "POST",
  "severity": "ERROR",
  "retryable": false,
  "remediation": [
    {
      "action": "VALIDATE_INPUT",
      "description": "Validate your input parameters"
    }
  ]
}
```

## Error Domains

- `AUTH` - Authentication errors
- `AUTHORIZATION` - Authorization errors
- `VALIDATION` - Validation errors
- `ORDER` - Order-related errors
- `INVENTORY` - Inventory errors
- `DISPATCH` - Dispatch errors
- `RIDER` - Rider errors
- `HOSPITAL` - Hospital errors
- `RATE_LIMIT` - Rate limiting
- `SYSTEM` - System errors
- `INFRA` - Infrastructure errors

## Common Error Codes

### Authentication
- `AUTH_INVALID_CREDENTIALS` - Invalid username/password
- `AUTH_TOKEN_EXPIRED` - Token expired
- `AUTH_TOKEN_INVALID` - Invalid token

### Validation
- `VALIDATION_FAILED` - General validation failure
- `VALIDATION_REQUIRED_FIELD` - Required field missing
- `VALIDATION_INVALID_FORMAT` - Invalid format
- `VALIDATION_DUPLICATE` - Duplicate entry

### Resources
- `ORDER_NOT_FOUND` - Order not found
- `INVENTORY_INSUFFICIENT` - Not enough inventory
- `DISPATCH_NO_RIDERS_AVAILABLE` - No riders available
- `RIDER_NOT_AVAILABLE` - Rider not available

### System
- `RATE_LIMIT_EXCEEDED` - Too many requests
- `SYSTEM_INTERNAL_ERROR` - Internal server error
- `SYSTEM_SERVICE_UNAVAILABLE` - Service unavailable

## Remediation Actions

- `RETRY` - Retry immediately
- `RETRY_WITH_BACKOFF` - Retry with exponential backoff
- `MODIFY_AND_RETRY` - Modify request and retry
- `VALIDATE_INPUT` - Validate input parameters
- `CHECK_CREDENTIALS` - Verify credentials
- `CHECK_PERMISSIONS` - Verify permissions
- `WAIT_AND_RETRY` - Wait before retrying
- `CONTACT_SUPPORT` - Contact support
- `NO_ACTION` - No action possible

## Client Integration

```typescript
// TypeScript
interface StandardErrorResponse {
  statusCode: number;
  errorCode: string;
  domain: string;
  message: string;
  correlationId: string;
  retryable: boolean;
  remediation: Array<{
    action: string;
    description: string;
    params?: Record<string, unknown>;
  }>;
  validationErrors?: Array<{
    field: string;
    message: string;
  }>;
}

// Handle error
const response = await fetch('/api/v1/orders', {
  headers: { 'x-correlation-id': correlationId },
});

if (!response.ok) {
  const error: StandardErrorResponse = await response.json();
  
  if (error.retryable) {
    // Retry logic
  }
  
  if (error.validationErrors) {
    // Show field errors
  }
  
  console.error(`Error ${error.errorCode} (${error.correlationId})`);
}
```

## Get Error Documentation

```bash
# All error codes
GET /api/v1/errors/codes

# Filter by domain
GET /api/v1/errors/codes?domain=ORDER

# Specific code
GET /api/v1/errors/codes/ORDER_NOT_FOUND

# JSON docs
GET /api/v1/errors/documentation/json

# Markdown docs
GET /api/v1/errors/documentation/markdown
```

## Extract Correlation ID

```typescript
// In controller
@Post()
async create(
  @Body() dto: CreateDto,
  @Headers('x-correlation-id') correlationId?: string,
) {
  const corrId = correlationId || uuidv4();
  // Use corrId in exceptions
}
```

## Module Setup

```typescript
// app.module.ts
import { ErrorsModule } from './common/errors/errors.module';

@Module({
  imports: [ErrorsModule],
})
export class AppModule {}
```

## Validation Pipe Setup

```typescript
// main.ts
import { validationExceptionFactory } from './common/errors/validation-exception.factory';

app.useGlobalPipes(
  new ValidationPipe({
    exceptionFactory: validationExceptionFactory,
  }),
);
```

## OpenAPI Documentation

```typescript
import { ErrorDocumentationGenerator } from './common/errors/error-documentation.generator';
import { StandardErrorCode } from './common/errors/error-taxonomy';

@ApiResponse({
  status: 400,
  description: 'Validation failed',
  schema: ErrorDocumentationGenerator.generateOpenAPIErrorSchema([
    StandardErrorCode.VALIDATION_FAILED,
  ]),
})
```

## Custom Error Code

```typescript
import { StandardException, StandardErrorCode } from './common/errors';

throw new StandardException({
  errorCode: StandardErrorCode.ORDER_INVALID_STATE,
  message: 'Custom message',
  metadata: { orderId, state: 'DELIVERED' },
  correlationId,
});
```

## Testing

```typescript
import { StandardErrorResponse } from './common/errors/error-taxonomy';

it('should return standard error response', async () => {
  const response = await request(app.getHttpServer())
    .post('/api/v1/orders')
    .send(invalidData)
    .expect(400);

  const error: StandardErrorResponse = response.body;
  
  expect(error.errorCode).toBe('VALIDATION_FAILED');
  expect(error.correlationId).toBeDefined();
  expect(error.retryable).toBe(false);
  expect(error.remediation).toBeDefined();
});
```
