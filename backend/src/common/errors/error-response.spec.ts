/**
 * Error Response Compatibility Tests
 * 
 * Tests that error responses conform to the standardized contract
 * and can be parsed by clients
 */

import { StandardErrorResponse, StandardErrorCode, ErrorDomain, ErrorSeverity } from './error-taxonomy';
import { StandardException, ValidationFailedException, OrderNotFoundException } from './standard-exception';

describe('Error Response Contract', () => {
    describe('StandardErrorResponse Structure', () => {
        it('should have all required fields', () => {
            const errorResponse: StandardErrorResponse = {
                statusCode: 400,
                errorCode: StandardErrorCode.VALIDATION_FAILED,
                domain: ErrorDomain.VALIDATION,
                message: 'Validation failed',
                correlationId: '123e4567-e89b-12d3-a456-426614174000',
                timestamp: '2024-01-01T00:00:00.000Z',
                path: '/api/v1/orders',
                method: 'POST',
                severity: ErrorSeverity.ERROR,
                retryable: false,
                remediation: [
                    {
                        action: 'VALIDATE_INPUT',
                        description: 'Validate your input parameters',
                    },
                ],
            };

            // Verify all required fields are present
            expect(errorResponse.statusCode).toBeDefined();
            expect(errorResponse.errorCode).toBeDefined();
            expect(errorResponse.domain).toBeDefined();
            expect(errorResponse.message).toBeDefined();
            expect(errorResponse.correlationId).toBeDefined();
            expect(errorResponse.timestamp).toBeDefined();
            expect(errorResponse.path).toBeDefined();
            expect(errorResponse.method).toBeDefined();
            expect(errorResponse.severity).toBeDefined();
            expect(errorResponse.retryable).toBeDefined();
            expect(errorResponse.remediation).toBeDefined();
        });

        it('should have valid correlation ID format', () => {
            const errorResponse: StandardErrorResponse = {
                statusCode: 400,
                errorCode: StandardErrorCode.VALIDATION_FAILED,
                domain: ErrorDomain.VALIDATION,
                message: 'Validation failed',
                correlationId: '123e4567-e89b-12d3-a456-426614174000',
                timestamp: '2024-01-01T00:00:00.000Z',
                path: '/api/v1/orders',
                method: 'POST',
                severity: ErrorSeverity.ERROR,
                retryable: false,
                remediation: [],
            };

            // UUID v4 format
            const uuidRegex =
                /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
            expect(errorResponse.correlationId).toMatch(uuidRegex);
        });

        it('should have valid ISO 8601 timestamp', () => {
            const errorResponse: StandardErrorResponse = {
                statusCode: 400,
                errorCode: StandardErrorCode.VALIDATION_FAILED,
                domain: ErrorDomain.VALIDATION,
                message: 'Validation failed',
                correlationId: '123e4567-e89b-12d3-a456-426614174000',
                timestamp: '2024-01-01T00:00:00.000Z',
                path: '/api/v1/orders',
                method: 'POST',
                severity: ErrorSeverity.ERROR,
                retryable: false,
                remediation: [],
            };

            const date = new Date(errorResponse.timestamp);
            expect(date.toISOString()).toBe(errorResponse.timestamp);
        });
    });

    describe('Validation Error Response', () => {
        it('should include validation errors array', () => {
            const validationErrors = [
                {
                    field: 'email',
                    message: 'Email must be a valid email address',
                    constraint: 'isEmail',
                },
                {
                    field: 'age',
                    message: 'Age must be a positive number',
                    constraint: 'isPositive',
                    value: -5,
                },
            ];

            const exception = new ValidationFailedException(
                validationErrors,
                '123e4567-e89b-12d3-a456-426614174000',
            );

            expect(exception.errorCode).toBe(StandardErrorCode.VALIDATION_FAILED);
            expect(exception.metadata?.validationErrors).toEqual(validationErrors);
        });
    });

    describe('Resource Not Found Error Response', () => {
        it('should include resource metadata', () => {
            const orderId = '123e4567-e89b-12d3-a456-426614174000';
            const exception = new OrderNotFoundException(
                orderId,
                '123e4567-e89b-12d3-a456-426614174001',
            );

            expect(exception.errorCode).toBe(StandardErrorCode.ORDER_NOT_FOUND);
            expect(exception.metadata?.resourceId).toBe(orderId);
            expect(exception.metadata?.resourceType).toBe('Order');
        });
    });

    describe('Remediation Hints', () => {
        it('should provide actionable remediation hints', () => {
            const exception = new StandardException({
                errorCode: StandardErrorCode.RATE_LIMIT_EXCEEDED,
                metadata: { retryAfter: 60 },
                correlationId: '123e4567-e89b-12d3-a456-426614174000',
            });

            expect(exception.remediation).toBeDefined();
            expect(exception.remediation.length).toBeGreaterThan(0);
            expect(exception.remediation[0].action).toBeDefined();
            expect(exception.remediation[0].description).toBeDefined();
        });

        it('should include retry parameters for rate limit errors', () => {
            const exception = new StandardException({
                errorCode: StandardErrorCode.RATE_LIMIT_EXCEEDED,
                metadata: { retryAfter: 60 },
                correlationId: '123e4567-e89b-12d3-a456-426614174000',
            });

            const waitAndRetryHint = exception.remediation.find(
                (h) => h.action === 'WAIT_AND_RETRY',
            );

            expect(waitAndRetryHint).toBeDefined();
            expect(waitAndRetryHint?.params?.retryAfter).toBe(60);
        });
    });

    describe('Client Parsing', () => {
        it('should be parseable as JSON', () => {
            const errorResponse: StandardErrorResponse = {
                statusCode: 400,
                errorCode: StandardErrorCode.VALIDATION_FAILED,
                domain: ErrorDomain.VALIDATION,
                message: 'Validation failed',
                correlationId: '123e4567-e89b-12d3-a456-426614174000',
                timestamp: '2024-01-01T00:00:00.000Z',
                path: '/api/v1/orders',
                method: 'POST',
                severity: ErrorSeverity.ERROR,
                retryable: false,
                remediation: [],
            };

            const json = JSON.stringify(errorResponse);
            const parsed = JSON.parse(json) as StandardErrorResponse;

            expect(parsed.statusCode).toBe(errorResponse.statusCode);
            expect(parsed.errorCode).toBe(errorResponse.errorCode);
            expect(parsed.correlationId).toBe(errorResponse.correlationId);
        });

        it('should support TypeScript type checking', () => {
            // This test verifies that the type system works correctly
            const errorResponse: StandardErrorResponse = {
                statusCode: 400,
                errorCode: StandardErrorCode.VALIDATION_FAILED,
                domain: ErrorDomain.VALIDATION,
                message: 'Validation failed',
                correlationId: '123e4567-e89b-12d3-a456-426614174000',
                timestamp: '2024-01-01T00:00:00.000Z',
                path: '/api/v1/orders',
                method: 'POST',
                severity: ErrorSeverity.ERROR,
                retryable: false,
                remediation: [],
            };

            // TypeScript should allow accessing all fields
            expect(typeof errorResponse.statusCode).toBe('number');
            expect(typeof errorResponse.errorCode).toBe('string');
            expect(typeof errorResponse.message).toBe('string');
            expect(typeof errorResponse.retryable).toBe('boolean');
        });
    });

    describe('Error Code Stability', () => {
        it('should have stable error codes', () => {
            // Error codes should never change once defined
            expect(StandardErrorCode.AUTH_INVALID_CREDENTIALS).toBe(
                'AUTH_INVALID_CREDENTIALS',
            );
            expect(StandardErrorCode.VALIDATION_FAILED).toBe('VALIDATION_FAILED');
            expect(StandardErrorCode.ORDER_NOT_FOUND).toBe('ORDER_NOT_FOUND');
            expect(StandardErrorCode.RATE_LIMIT_EXCEEDED).toBe('RATE_LIMIT_EXCEEDED');
        });

        it('should have stable error domains', () => {
            expect(ErrorDomain.AUTH).toBe('AUTH');
            expect(ErrorDomain.VALIDATION).toBe('VALIDATION');
            expect(ErrorDomain.ORDER).toBe('ORDER');
            expect(ErrorDomain.SYSTEM).toBe('SYSTEM');
        });
    });

    describe('Backward Compatibility', () => {
        it('should support optional fields without breaking', () => {
            // Minimal error response (only required fields)
            const minimalResponse: StandardErrorResponse = {
                statusCode: 400,
                errorCode: StandardErrorCode.VALIDATION_FAILED,
                domain: ErrorDomain.VALIDATION,
                message: 'Validation failed',
                correlationId: '123e4567-e89b-12d3-a456-426614174000',
                timestamp: '2024-01-01T00:00:00.000Z',
                path: '/api/v1/orders',
                method: 'POST',
                severity: ErrorSeverity.ERROR,
                retryable: false,
                remediation: [],
            };

            // Should not throw when optional fields are missing
            expect(minimalResponse.details).toBeUndefined();
            expect(minimalResponse.metadata).toBeUndefined();
            expect(minimalResponse.validationErrors).toBeUndefined();
        });

        it('should support additional metadata without breaking', () => {
            const responseWithMetadata: StandardErrorResponse = {
                statusCode: 400,
                errorCode: StandardErrorCode.VALIDATION_FAILED,
                domain: ErrorDomain.VALIDATION,
                message: 'Validation failed',
                correlationId: '123e4567-e89b-12d3-a456-426614174000',
                timestamp: '2024-01-01T00:00:00.000Z',
                path: '/api/v1/orders',
                method: 'POST',
                severity: ErrorSeverity.ERROR,
                retryable: false,
                remediation: [],
                metadata: {
                    customField: 'customValue',
                    anotherField: 123,
                },
            };

            expect(responseWithMetadata.metadata?.customField).toBe('customValue');
            expect(responseWithMetadata.metadata?.anotherField).toBe(123);
        });
    });
});
