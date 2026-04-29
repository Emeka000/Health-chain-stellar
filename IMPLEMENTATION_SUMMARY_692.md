# Implementation Summary: Issue #692 - Unify API Error Taxonomy and Machine-Readable Failure Contracts

## Status: ✅ COMPLETE

## Overview
Implemented a comprehensive unified error taxonomy system with standardized error codes, consistent response payloads, correlation IDs, and machine-readable remediation guidance for safer client automation.

---

## Implementation Details

### 1. Global Error Taxonomy
**File**: `backend/src/common/errors/error-taxonomy.ts`

**Error Code Format**: `{DOMAIN}_{CATEGORY}_{SPECIFIC}`
- Examples: `AUTH_INVALID_CREDENTIALS`, `ORDER_NOT_FOUND`, `VALIDATION_REQUIRED_FIELD`

**Error Domains** (15 namespaces):
- **Core**: AUTH, VALIDATION, AUTHORIZATION
- **Business**: ORDER, BLOOD_REQUEST, INVENTORY, DISPATCH, RIDER, HOSPITAL, BLOOD_BANK, DONOR
- **Operational**: SLA, ESCALATION, INCIDENT, ROUTE, COLD_CHAIN
- **Technical**: INFRA, BLOCKCHAIN, PAYMENT, NOTIFICATION
- **System**: RATE_LIMIT, SYSTEM

**Standard Error Codes** (60+ codes):
- Authentication: `AUTH_INVALID_CREDENTIALS`, `AUTH_TOKEN_EXPIRED`, `AUTH_TOKEN_INVALID`, `AUTH_MFA_REQUIRED`, etc.
- Authorization: `AUTHORIZATION_FORBIDDEN`, `AUTHORIZATION_INSUFFICIENT_PERMISSIONS`, `AUTHORIZATION_TENANT_ACCESS_DENIED`
- Validation: `VALIDATION_FAILED`, `VALIDATION_REQUIRED_FIELD`, `VALIDATION_INVALID_FORMAT`, `VALIDATION_DUPLICATE`
- Resources: `ORDER_NOT_FOUND`, `INVENTORY_INSUFFICIENT`, `DISPATCH_NO_RIDERS_AVAILABLE`, `RIDER_NOT_AVAILABLE`
- Technical: `INFRA_DATABASE_ERROR`, `BLOCKCHAIN_TRANSACTION_FAILED`, `PAYMENT_FAILED`
- System: `RATE_LIMIT_EXCEEDED`, `SYSTEM_INTERNAL_ERROR`, `SYSTEM_SERVICE_UNAVAILABLE`

**Error Severity Levels**:
- `INFO`: Informational - no action needed
- `WARNING`: May need attention
- `ERROR`: Requires action
- `CRITICAL`: Immediate action required

**Remediation Actions**:
- `RETRY`: Retry immediately
- `RETRY_WITH_BACKOFF`: Retry with exponential backoff
- `MODIFY_AND_RETRY`: Modify request and retry
- `CONTACT_SUPPORT`: Contact support
- `CHECK_CREDENTIALS`: Verify credentials
- `CHECK_PERMISSIONS`: Verify permissions
- `VALIDATE_INPUT`: Validate input
- `WAIT_AND_RETRY`: Wait before retrying
- `NO_ACTION`: No action possible

**Standardized Error Response**:
```typescript
interface StandardErrorResponse {
  statusCode: number;              // HTTP status code
  errorCode: StandardErrorCode;    // Taxonomy error code
  domain: ErrorDomain;             // Error domain
  message: string;                 // Human-readable message
  details?: string;                // Detailed description
  correlationId: string;           // Correlation ID (required)
  requestId?: string;              // Request ID
  timestamp: string;               // ISO 8601 timestamp
  path: string;                    // Request path
  method: string;                  // HTTP method
  severity: ErrorSeverity;         // Error severity
  retryable: boolean;              // Whether retryable
  remediation: RemediationHint[];  // Remediation hints
  metadata?: ErrorMetadata;        // Additional metadata
  validationErrors?: Array<{       // Validation errors
    field: string;
    message: string;
    constraint?: string;
    value?: unknown;
  }>;
  stack?: string;                  // Stack trace (dev only)
}
```

**Error Code Registry**:
- Metadata for each error code
- HTTP status mapping
- Severity level
- Retryability flag
- Remediation actions
- Description and examples

### 2. Standard Exception Classes
**File**: `backend/src/common/errors/standard-exception.ts`

**Base Class**: `StandardException extends HttpException`
- Enforces standardized error responses
- Auto-populates from error code registry
- Builds remediation hints
- Includes correlation ID

**Domain-Specific Exceptions**:
- `AuthInvalidCredentialsException`
- `AuthTokenExpiredException`
- `AuthorizationForbiddenException`
- `ValidationFailedException`
- `OrderNotFoundException`
- `OrderInvalidStateException`
- `InventoryInsufficientException`
- `DispatchNoRidersAvailableException`
- `RateLimitExceededException`
- `InfraDatabaseException`
- `SystemInternalErrorException`

**Features**:
- Type-safe error construction
- Automatic metadata population
- Correlation ID tracking
- Cause chain preservation

### 3. Exception Mapper Service
**File**: `backend/src/common/errors/exception-mapper.service.ts`

**Functionality**:
- Maps legacy exceptions to `StandardException`
- Maps NestJS built-in exceptions
- Maps TypeORM exceptions
- Maps validation errors
- Preserves error context

**Mappings**:
- `UnauthorizedException` → `AuthTokenInvalidException`
- `ForbiddenException` → `AuthorizationForbiddenException`
- `NotFoundException` → Domain-specific not found (ORDER, RIDER, HOSPITAL, etc.)
- `BadRequestException` → `ValidationFailedException`
- `ConflictException` → `VALIDATION_DUPLICATE` or `INVENTORY_INSUFFICIENT`
- `QueryFailedError` → `INFRA_DATABASE_ERROR` or `VALIDATION_CONSTRAINT_VIOLATION`
- Generic errors → `SystemInternalErrorException`

**Smart Detection**:
- Extracts resource type from error messages
- Detects database constraint violations
- Identifies connection vs timeout errors
- Categorizes validation errors

### 4. Global Exception Filter
**File**: `backend/src/common/errors/global-exception.filter.ts`

**Functionality**:
- Catches all exceptions globally
- Extracts/generates correlation ID from headers
- Maps to `StandardException`
- Builds standardized error response
- Logs with appropriate severity
- Includes stack trace in development only

**Correlation ID Sources** (priority order):
1. `x-correlation-id` header
2. `x-request-id` header
3. Generated UUID

**Logging**:
- CRITICAL: Full error with stack
- ERROR: Error message with context
- WARNING: Warning message
- INFO: Info message
- Always log full stack for 5xx errors

### 5. Validation Exception Factory
**File**: `backend/src/common/errors/validation-exception.factory.ts`

**Functionality**:
- Transforms class-validator errors to `StandardException`
- Flattens nested validation errors
- Preserves field paths
- Includes constraint names and values

**Integration**:
```typescript
new ValidationPipe({
  exceptionFactory: validationExceptionFactory,
})
```

### 6. Error Documentation Generator
**File**: `backend/src/common/errors/error-documentation.generator.ts`

**Features**:
- Generate OpenAPI error schemas
- Generate Markdown documentation
- Generate JSON documentation
- Filter by domain
- Include examples

**Methods**:
- `getErrorCodesForDomain(domain)`: Get codes for specific domain
- `getAllErrorCodes()`: Get all error codes
- `generateOpenAPIErrorSchema(codes)`: Generate OpenAPI schema
- `generateMarkdownDocumentation()`: Generate Markdown docs
- `generateJSONDocumentation()`: Generate JSON docs

### 7. Error Documentation Controller
**File**: `backend/src/common/errors/error-documentation.controller.ts`

**Endpoints**:
- `GET /api/v1/errors/codes`: Get all error codes (filter by domain)
- `GET /api/v1/errors/codes/:code`: Get specific error code details
- `GET /api/v1/errors/documentation/json`: Get JSON documentation
- `GET /api/v1/errors/documentation/markdown`: Get Markdown documentation
- `GET /api/v1/errors/domains`: Get all error domains

**Public Access**: All endpoints are public for client integration

### 8. Errors Module
**File**: `backend/src/common/errors/errors.module.ts`

**Configuration**:
- Global module
- Registers `GlobalExceptionFilter` as `APP_FILTER`
- Exports `ExceptionMapperService`
- Provides `ErrorDocumentationController`

### 9. Compatibility Tests
**File**: `backend/src/common/errors/error-response.spec.ts`

**Test Coverage**:
- Error response structure validation
- Required fields presence
- Correlation ID format (UUID v4)
- Timestamp format (ISO 8601)
- Validation errors array
- Resource metadata
- Remediation hints
- JSON parsing
- TypeScript type checking
- Error code stability
- Backward compatibility
- Optional fields handling
- Additional metadata support

---

## Acceptance Criteria: ✅ ALL MET

### ✅ Error payload shape is consistent across modules
- `StandardErrorResponse` interface enforced globally
- `GlobalExceptionFilter` transforms all exceptions
- All required fields always present
- Optional fields consistently structured

### ✅ Domain-specific error codes are stable and documented
- 60+ error codes across 15 domains
- Error code registry with metadata
- Semantic versioning for changes
- Documentation endpoints available
- Markdown and JSON documentation generated

### ✅ Correlation IDs are present on all non-success responses
- Extracted from `x-correlation-id` or `x-request-id` headers
- Generated if not provided
- Included in all error responses
- Used for logging and tracing

### ✅ Client parsing tests pass for standardized error responses
- Comprehensive test suite (15+ tests)
- JSON parsing validation
- TypeScript type checking
- Backward compatibility tests
- Optional fields handling
- Metadata extensibility

---

## Usage Examples

### Throwing Standard Exceptions

```typescript
// Authentication error
throw new AuthInvalidCredentialsException(correlationId);

// Authorization error
throw new AuthorizationForbiddenException('Order', correlationId);

// Validation error
throw new ValidationFailedException([
  { field: 'email', message: 'Invalid email format', constraint: 'isEmail' },
  { field: 'age', message: 'Must be positive', constraint: 'isPositive', value: -5 },
], correlationId);

// Resource not found
throw new OrderNotFoundException(orderId, correlationId);

// Business logic error
throw new InventoryInsufficientException('O+', 5, 2, correlationId);

// Rate limiting
throw new RateLimitExceededException(60, correlationId);

// Infrastructure error
throw new InfraDatabaseException('Connection timeout', correlationId, cause);

// Generic error with custom code
throw new StandardException({
  errorCode: StandardErrorCode.ORDER_INVALID_STATE,
  message: 'Order cannot be cancelled',
  metadata: { orderId, currentState: 'DELIVERED' },
  correlationId,
});
```

### Error Response Example

```json
{
  "statusCode": 400,
  "errorCode": "VALIDATION_FAILED",
  "domain": "VALIDATION",
  "message": "Validation failed",
  "details": "2 validation error(s)",
  "correlationId": "550e8400-e29b-41d4-a716-446655440000",
  "requestId": "550e8400-e29b-41d4-a716-446655440001",
  "timestamp": "2024-01-01T12:00:00.000Z",
  "path": "/api/v1/orders",
  "method": "POST",
  "severity": "ERROR",
  "retryable": false,
  "remediation": [
    {
      "action": "VALIDATE_INPUT",
      "description": "Validate your input parameters"
    },
    {
      "action": "MODIFY_AND_RETRY",
      "description": "Modify the request parameters and retry"
    }
  ],
  "validationErrors": [
    {
      "field": "email",
      "message": "Email must be a valid email address",
      "constraint": "isEmail"
    },
    {
      "field": "age",
      "message": "Age must be a positive number",
      "constraint": "isPositive",
      "value": -5
    }
  ]
}
```

### Client Integration

```typescript
// TypeScript client
interface StandardErrorResponse {
  statusCode: number;
  errorCode: string;
  domain: string;
  message: string;
  correlationId: string;
  timestamp: string;
  path: string;
  method: string;
  severity: string;
  retryable: boolean;
  remediation: Array<{
    action: string;
    description: string;
    params?: Record<string, unknown>;
  }>;
  metadata?: Record<string, unknown>;
  validationErrors?: Array<{
    field: string;
    message: string;
    constraint?: string;
    value?: unknown;
  }>;
}

// Handle error response
try {
  const response = await fetch('/api/v1/orders', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-correlation-id': correlationId,
    },
    body: JSON.stringify(orderData),
  });

  if (!response.ok) {
    const error: StandardErrorResponse = await response.json();
    
    // Check if retryable
    if (error.retryable) {
      // Find retry remediation
      const retryHint = error.remediation.find(
        r => r.action === 'RETRY_WITH_BACKOFF'
      );
      
      if (retryHint) {
        // Implement retry logic
        await retryWithBackoff(retryHint.params);
      }
    }
    
    // Check for validation errors
    if (error.validationErrors) {
      // Display field-specific errors
      for (const validationError of error.validationErrors) {
        showFieldError(validationError.field, validationError.message);
      }
    }
    
    // Log with correlation ID for support
    console.error(`Error ${error.errorCode} (${error.correlationId}):`, error.message);
  }
} catch (error) {
  // Handle network errors
}
```

### Getting Error Documentation

```bash
# Get all error codes
curl http://localhost:3000/api/v1/errors/codes

# Get error codes for specific domain
curl http://localhost:3000/api/v1/errors/codes?domain=ORDER

# Get specific error code details
curl http://localhost:3000/api/v1/errors/codes/ORDER_NOT_FOUND

# Get JSON documentation
curl http://localhost:3000/api/v1/errors/documentation/json

# Get Markdown documentation
curl http://localhost:3000/api/v1/errors/documentation/markdown

# Get all domains
curl http://localhost:3000/api/v1/errors/domains
```

---

## Migration Guide

### Step 1: Import ErrorsModule

```typescript
// app.module.ts
import { ErrorsModule } from './common/errors/errors.module';

@Module({
  imports: [
    ErrorsModule, // Add this
    // ... other modules
  ],
})
export class AppModule {}
```

### Step 2: Replace Legacy Exceptions

**Before**:
```typescript
throw new NotFoundException(`Order ${orderId} not found`);
```

**After**:
```typescript
throw new OrderNotFoundException(orderId, correlationId);
```

### Step 3: Update Validation Pipe

```typescript
// main.ts
app.useGlobalPipes(
  new ValidationPipe({
    exceptionFactory: validationExceptionFactory,
    whitelist: true,
    transform: true,
  }),
);
```

### Step 4: Extract Correlation ID in Controllers

```typescript
@Post()
async createOrder(
  @Body() dto: CreateOrderDto,
  @Headers('x-correlation-id') correlationId?: string,
) {
  const corrId = correlationId || uuidv4();
  
  try {
    return await this.orderService.create(dto);
  } catch (error) {
    // Error will be caught by GlobalExceptionFilter
    // and transformed with correlation ID
    throw error;
  }
}
```

### Step 5: Update OpenAPI Documentation

```typescript
// Add to controller methods
@ApiResponse({
  status: 400,
  description: 'Validation failed',
  schema: ErrorDocumentationGenerator.generateOpenAPIErrorSchema([
    StandardErrorCode.VALIDATION_FAILED,
    StandardErrorCode.VALIDATION_REQUIRED_FIELD,
  ]),
})
@ApiResponse({
  status: 404,
  description: 'Order not found',
  schema: ErrorDocumentationGenerator.generateOpenAPIErrorSchema([
    StandardErrorCode.ORDER_NOT_FOUND,
  ]),
})
```

---

## Error Code Stability

Error codes follow semantic versioning:
- **MAJOR**: Breaking changes (code removed or behavior changed)
- **MINOR**: New codes added (backward compatible)
- **PATCH**: Documentation updates

**Deprecation Policy**:
1. Mark code as deprecated in documentation
2. Keep code for at least 6 months
3. Provide migration path
4. Remove in next major version

---

## Monitoring and Observability

### Metrics to Track
1. **Error rate by code**: Track frequency of each error code
2. **Error rate by domain**: Track errors per domain
3. **Error rate by severity**: Track CRITICAL, ERROR, WARNING, INFO
4. **Correlation ID coverage**: Ensure all errors have correlation IDs
5. **Retry success rate**: Track retryable errors that succeed on retry

### Logging
All errors are logged with:
- Error code
- Correlation ID
- Request path and method
- HTTP status code
- Severity level
- Stack trace (for 5xx errors)

### Alerting
Set up alerts for:
- High rate of CRITICAL errors
- Spike in specific error codes
- Missing correlation IDs
- High rate of 5xx errors

---

## Files Created

1. `backend/src/common/errors/error-taxonomy.ts` - Error codes and types
2. `backend/src/common/errors/standard-exception.ts` - Exception classes
3. `backend/src/common/errors/exception-mapper.service.ts` - Exception mapping
4. `backend/src/common/errors/global-exception.filter.ts` - Global filter
5. `backend/src/common/errors/validation-exception.factory.ts` - Validation factory
6. `backend/src/common/errors/error-documentation.generator.ts` - Documentation generator
7. `backend/src/common/errors/error-documentation.controller.ts` - Documentation API
8. `backend/src/common/errors/errors.module.ts` - Module configuration
9. `backend/src/common/errors/error-response.spec.ts` - Compatibility tests
10. `IMPLEMENTATION_SUMMARY_692.md` - This file

---

## Summary

Issue #692 has been fully implemented with a production-ready unified error taxonomy system:

✅ **Consistent error payload shape** across all modules with `StandardErrorResponse`

✅ **Stable, documented error codes** with 60+ codes across 15 domains

✅ **Correlation IDs on all errors** extracted from headers or generated

✅ **Client parsing tests** with comprehensive test suite

✅ **Machine-readable remediation** with actionable hints and parameters

✅ **OpenAPI documentation** with automatic schema generation

✅ **Backward compatibility** with optional fields and metadata extensibility

✅ **Global exception handling** with automatic mapping and transformation

The system provides safer client automation with predictable error responses, clear remediation guidance, and full traceability through correlation IDs.
