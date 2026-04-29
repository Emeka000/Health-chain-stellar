import { HttpException, HttpStatus } from '@nestjs/common';
import {
    StandardErrorCode,
    ErrorDomain,
    ErrorSeverity,
    RemediationHint,
    ErrorMetadata,
    RemediationAction,
    ERROR_CODE_REGISTRY,
} from './error-taxonomy';

/**
 * Standard Exception
 * 
 * Base exception class that enforces standardized error responses
 */
export class StandardException extends HttpException {
    public readonly errorCode: StandardErrorCode;
    public readonly domain: ErrorDomain;
    public readonly severity: ErrorSeverity;
    public readonly retryable: boolean;
    public readonly remediation: RemediationHint[];
    public readonly metadata?: ErrorMetadata;
    public readonly correlationId?: string;

    constructor(params: {
        errorCode: StandardErrorCode;
        message?: string;
        details?: string;
        metadata?: ErrorMetadata;
        correlationId?: string;
        cause?: Error;
    }) {
        const registry = ERROR_CODE_REGISTRY[params.errorCode];

        if (!registry) {
            throw new Error(`Unknown error code: ${params.errorCode}`);
        }

        const message = params.message || registry.message;

        super(
            {
                errorCode: params.errorCode,
                message,
                details: params.details,
            },
            registry.httpStatus,
            {
                cause: params.cause,
            },
        );

        this.errorCode = params.errorCode;
        this.domain = registry.domain;
        this.severity = registry.severity;
        this.retryable = registry.retryable;
        this.remediation = this.buildRemediationHints(registry.remediationActions);
        this.metadata = params.metadata;
        this.correlationId = params.correlationId;
    }

    private buildRemediationHints(actions: RemediationAction[]): RemediationHint[] {
        const hints: RemediationHint[] = [];

        for (const action of actions) {
            hints.push({
                action,
                description: this.getRemediationDescription(action),
                params: this.getRemediationParams(action),
            });
        }

        return hints;
    }

    private getRemediationDescription(action: RemediationAction): string {
        const descriptions: Record<RemediationAction, string> = {
            [RemediationAction.RETRY]: 'Retry the request immediately',
            [RemediationAction.RETRY_WITH_BACKOFF]: 'Retry the request with exponential backoff',
            [RemediationAction.MODIFY_AND_RETRY]: 'Modify the request parameters and retry',
            [RemediationAction.CONTACT_SUPPORT]: 'Contact support for assistance',
            [RemediationAction.CHECK_CREDENTIALS]: 'Verify your authentication credentials',
            [RemediationAction.CHECK_PERMISSIONS]: 'Verify you have the required permissions',
            [RemediationAction.VALIDATE_INPUT]: 'Validate your input parameters',
            [RemediationAction.WAIT_AND_RETRY]: 'Wait before retrying the request',
            [RemediationAction.NO_ACTION]: 'No action can be taken',
        };

        return descriptions[action];
    }

    private getRemediationParams(action: RemediationAction): Record<string, unknown> | undefined {
        if (action === RemediationAction.WAIT_AND_RETRY && this.metadata?.retryAfter) {
            return { retryAfter: this.metadata.retryAfter };
        }

        if (action === RemediationAction.RETRY_WITH_BACKOFF) {
            return { initialDelay: 1000, maxDelay: 30000, multiplier: 2 };
        }

        return undefined;
    }
}

/**
 * Domain-specific exception classes
 */

// Authentication exceptions
export class AuthInvalidCredentialsException extends StandardException {
    constructor(correlationId?: string) {
        super({
            errorCode: StandardErrorCode.AUTH_INVALID_CREDENTIALS,
            correlationId,
        });
    }
}

export class AuthTokenExpiredException extends StandardException {
    constructor(correlationId?: string) {
        super({
            errorCode: StandardErrorCode.AUTH_TOKEN_EXPIRED,
            correlationId,
        });
    }
}

export class AuthTokenInvalidException extends StandardException {
    constructor(correlationId?: string) {
        super({
            errorCode: StandardErrorCode.AUTH_TOKEN_INVALID,
            correlationId,
        });
    }
}

// Authorization exceptions
export class AuthorizationForbiddenException extends StandardException {
    constructor(resource?: string, correlationId?: string) {
        super({
            errorCode: StandardErrorCode.AUTHORIZATION_FORBIDDEN,
            metadata: resource ? { resourceType: resource } : undefined,
            correlationId,
        });
    }
}

export class AuthorizationInsufficientPermissionsException extends StandardException {
    constructor(requiredPermission?: string, correlationId?: string) {
        super({
            errorCode: StandardErrorCode.AUTHORIZATION_INSUFFICIENT_PERMISSIONS,
            metadata: requiredPermission ? { constraint: requiredPermission } : undefined,
            correlationId,
        });
    }
}

// Validation exceptions
export class ValidationFailedException extends StandardException {
    constructor(
        validationErrors: Array<{
            field: string;
            message: string;
            constraint?: string;
            value?: unknown;
        }>,
        correlationId?: string,
    ) {
        super({
            errorCode: StandardErrorCode.VALIDATION_FAILED,
            details: `${validationErrors.length} validation error(s)`,
            metadata: { validationErrors },
            correlationId,
        });
    }
}

export class ValidationRequiredFieldException extends StandardException {
    constructor(field: string, correlationId?: string) {
        super({
            errorCode: StandardErrorCode.VALIDATION_REQUIRED_FIELD,
            message: `Required field missing: ${field}`,
            metadata: { field },
            correlationId,
        });
    }
}

// Resource exceptions
export class OrderNotFoundException extends StandardException {
    constructor(orderId: string, correlationId?: string) {
        super({
            errorCode: StandardErrorCode.ORDER_NOT_FOUND,
            message: `Order not found: ${orderId}`,
            metadata: { resourceId: orderId, resourceType: 'Order' },
            correlationId,
        });
    }
}

export class OrderInvalidStateException extends StandardException {
    constructor(orderId: string, currentState: string, expectedState: string, correlationId?: string) {
        super({
            errorCode: StandardErrorCode.ORDER_INVALID_STATE,
            message: `Order ${orderId} is in invalid state`,
            metadata: {
                resourceId: orderId,
                resourceType: 'Order',
                actual: currentState,
                expected: expectedState,
            },
            correlationId,
        });
    }
}

export class InventoryInsufficientException extends StandardException {
    constructor(bloodType: string, requested: number, available: number, correlationId?: string) {
        super({
            errorCode: StandardErrorCode.INVENTORY_INSUFFICIENT,
            message: `Insufficient inventory for ${bloodType}`,
            metadata: {
                resourceType: 'Inventory',
                field: 'bloodType',
                actual: available.toString(),
                expected: requested.toString(),
            },
            correlationId,
        });
    }
}

export class DispatchNoRidersAvailableException extends StandardException {
    constructor(correlationId?: string) {
        super({
            errorCode: StandardErrorCode.DISPATCH_NO_RIDERS_AVAILABLE,
            correlationId,
        });
    }
}

export class RiderNotAvailableException extends StandardException {
    constructor(riderId: string, correlationId?: string) {
        super({
            errorCode: StandardErrorCode.RIDER_NOT_AVAILABLE,
            message: `Rider ${riderId} is not available`,
            metadata: { resourceId: riderId, resourceType: 'Rider' },
            correlationId,
        });
    }
}

// Rate limiting exceptions
export class RateLimitExceededException extends StandardException {
    constructor(retryAfter: number, correlationId?: string) {
        super({
            errorCode: StandardErrorCode.RATE_LIMIT_EXCEEDED,
            metadata: { retryAfter },
            correlationId,
        });
    }
}

// Infrastructure exceptions
export class InfraDatabaseException extends StandardException {
    constructor(details: string, correlationId?: string, cause?: Error) {
        super({
            errorCode: StandardErrorCode.INFRA_DATABASE_ERROR,
            details,
            correlationId,
            cause,
        });
    }
}

export class InfraExternalServiceException extends StandardException {
    constructor(service: string, details: string, correlationId?: string, cause?: Error) {
        super({
            errorCode: StandardErrorCode.INFRA_EXTERNAL_SERVICE_ERROR,
            message: `External service error: ${service}`,
            details,
            metadata: { resourceType: service },
            correlationId,
            cause,
        });
    }
}

// System exceptions
export class SystemInternalErrorException extends StandardException {
    constructor(details?: string, correlationId?: string, cause?: Error) {
        super({
            errorCode: StandardErrorCode.SYSTEM_INTERNAL_ERROR,
            details,
            correlationId,
            cause,
        });
    }
}

export class SystemServiceUnavailableException extends StandardException {
    constructor(service?: string, correlationId?: string) {
        super({
            errorCode: StandardErrorCode.SYSTEM_SERVICE_UNAVAILABLE,
            metadata: service ? { resourceType: service } : undefined,
            correlationId,
        });
    }
}
