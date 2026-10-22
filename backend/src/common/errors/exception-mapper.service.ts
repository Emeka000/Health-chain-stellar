import { Injectable, Logger } from '@nestjs/common';
import {
    BadRequestException,
    UnauthorizedException,
    ForbiddenException,
    NotFoundException,
    ConflictException,
    InternalServerErrorException,
    HttpException,
} from '@nestjs/common';
import { QueryFailedError } from 'typeorm';
import {
    StandardException,
    SystemInternalErrorException,
    ValidationFailedException,
    AuthTokenInvalidException,
    AuthorizationForbiddenException,
    InfraDatabaseException,
} from './standard-exception';
import { StandardErrorCode } from './error-taxonomy';

/**
 * Exception Mapper Service
 * 
 * Maps legacy and third-party exceptions to StandardException
 */
@Injectable()
export class ExceptionMapperService {
    private readonly logger = new Logger(ExceptionMapperService.name);

    /**
     * Map any exception to StandardException
     */
    mapException(error: Error, correlationId?: string): StandardException {
        // Already a StandardException
        if (error instanceof StandardException) {
            return error;
        }

        // NestJS built-in exceptions
        if (error instanceof UnauthorizedException) {
            return new AuthTokenInvalidException(correlationId);
        }

        if (error instanceof ForbiddenException) {
            return new AuthorizationForbiddenException(undefined, correlationId);
        }

        if (error instanceof NotFoundException) {
            return this.mapNotFoundException(error, correlationId);
        }

        if (error instanceof BadRequestException) {
            return this.mapBadRequestException(error, correlationId);
        }

        if (error instanceof ConflictException) {
            return this.mapConflictException(error, correlationId);
        }

        if (error instanceof HttpException) {
            return this.mapHttpException(error, correlationId);
        }

        // TypeORM exceptions
        if (error instanceof QueryFailedError) {
            return this.mapQueryFailedError(error, correlationId);
        }

        // Generic errors
        if (error.name === 'ValidationError') {
            return this.mapValidationError(error, correlationId);
        }

        if (error.name === 'TimeoutError') {
            return new StandardException({
                errorCode: StandardErrorCode.SYSTEM_TIMEOUT,
                details: error.message,
                correlationId,
                cause: error,
            });
        }

        // Default to internal error
        this.logger.error('Unmapped exception', error);
        return new SystemInternalErrorException(
            error.message,
            correlationId,
            error,
        );
    }

    /**
     * Map NotFoundException to domain-specific exception
     */
    private mapNotFoundException(
        error: NotFoundException,
        correlationId?: string,
    ): StandardException {
        const message = error.message.toLowerCase();

        // Try to extract resource type from message
        if (message.includes('order')) {
            return new StandardException({
                errorCode: StandardErrorCode.ORDER_NOT_FOUND,
                details: error.message,
                correlationId,
                cause: error,
            });
        }

        if (message.includes('rider')) {
            return new StandardException({
                errorCode: StandardErrorCode.RIDER_NOT_FOUND,
                details: error.message,
                correlationId,
                cause: error,
            });
        }

        if (message.includes('hospital')) {
            return new StandardException({
                errorCode: StandardErrorCode.HOSPITAL_NOT_FOUND,
                details: error.message,
                correlationId,
                cause: error,
            });
        }

        if (message.includes('inventory')) {
            return new StandardException({
                errorCode: StandardErrorCode.INVENTORY_NOT_FOUND,
                details: error.message,
                correlationId,
                cause: error,
            });
        }

        // Generic not found
        return new StandardException({
            errorCode: StandardErrorCode.SYSTEM_INTERNAL_ERROR,
            message: 'Resource not found',
            details: error.message,
            correlationId,
            cause: error,
        });
    }

    /**
     * Map BadRequestException to validation exception
     */
    private mapBadRequestException(
        error: BadRequestException,
        correlationId?: string,
    ): StandardException {
        const response = error.getResponse();

        // Check if it's a validation error from class-validator
        if (typeof response === 'object' && 'message' in response) {
            const messages = Array.isArray(response.message)
                ? response.message
                : [response.message];

            const validationErrors = messages.map((msg: string) => ({
                field: 'unknown',
                message: msg,
            }));

            return new ValidationFailedException(validationErrors, correlationId);
        }

        return new StandardException({
            errorCode: StandardErrorCode.VALIDATION_FAILED,
            details: error.message,
            correlationId,
            cause: error,
        });
    }

    /**
     * Map ConflictException to domain-specific exception
     */
    private mapConflictException(
        error: ConflictException,
        correlationId?: string,
    ): StandardException {
        const message = error.message.toLowerCase();

        if (message.includes('duplicate') || message.includes('already exists')) {
            return new StandardException({
                errorCode: StandardErrorCode.VALIDATION_DUPLICATE,
                details: error.message,
                correlationId,
                cause: error,
            });
        }

        if (message.includes('inventory') || message.includes('insufficient')) {
            return new StandardException({
                errorCode: StandardErrorCode.INVENTORY_INSUFFICIENT,
                details: error.message,
                correlationId,
                cause: error,
            });
        }

        return new StandardException({
            errorCode: StandardErrorCode.VALIDATION_CONSTRAINT_VIOLATION,
            details: error.message,
            correlationId,
            cause: error,
        });
    }

    /**
     * Map generic HttpException
     */
    private mapHttpException(
        error: HttpException,
        correlationId?: string,
    ): StandardException {
        const status = error.getStatus();

        // Map by status code
        const errorCodeMap: Record<number, StandardErrorCode> = {
            400: StandardErrorCode.VALIDATION_FAILED,
            401: StandardErrorCode.AUTH_TOKEN_INVALID,
            403: StandardErrorCode.AUTHORIZATION_FORBIDDEN,
            404: StandardErrorCode.SYSTEM_INTERNAL_ERROR,
            409: StandardErrorCode.VALIDATION_CONSTRAINT_VIOLATION,
            429: StandardErrorCode.RATE_LIMIT_EXCEEDED,
            500: StandardErrorCode.SYSTEM_INTERNAL_ERROR,
            502: StandardErrorCode.SYSTEM_BAD_GATEWAY,
            503: StandardErrorCode.SYSTEM_SERVICE_UNAVAILABLE,
            504: StandardErrorCode.SYSTEM_TIMEOUT,
        };

        const errorCode =
            errorCodeMap[status] || StandardErrorCode.SYSTEM_INTERNAL_ERROR;

        return new StandardException({
            errorCode,
            details: error.message,
            correlationId,
            cause: error,
        });
    }

    /**
     * Map TypeORM QueryFailedError
     */
    private mapQueryFailedError(
        error: QueryFailedError,
        correlationId?: string,
    ): StandardException {
        const message = error.message.toLowerCase();

        // Unique constraint violation
        if (message.includes('unique') || message.includes('duplicate')) {
            return new StandardException({
                errorCode: StandardErrorCode.VALIDATION_DUPLICATE,
                details: error.message,
                correlationId,
                cause: error,
            });
        }

        // Foreign key constraint violation
        if (message.includes('foreign key') || message.includes('violates')) {
            return new StandardException({
                errorCode: StandardErrorCode.VALIDATION_CONSTRAINT_VIOLATION,
                details: error.message,
                correlationId,
                cause: error,
            });
        }

        // Connection errors
        if (
            message.includes('connection') ||
            message.includes('connect') ||
            message.includes('econnrefused')
        ) {
            return new StandardException({
                errorCode: StandardErrorCode.INFRA_DATABASE_CONNECTION,
                details: error.message,
                correlationId,
                cause: error,
            });
        }

        // Timeout errors
        if (message.includes('timeout')) {
            return new StandardException({
                errorCode: StandardErrorCode.INFRA_DATABASE_TIMEOUT,
                details: error.message,
                correlationId,
                cause: error,
            });
        }

        // Generic database error
        return new InfraDatabaseException(error.message, correlationId, error);
    }

    /**
     * Map validation errors
     */
    private mapValidationError(
        error: Error,
        correlationId?: string,
    ): StandardException {
        // Try to extract validation errors from error object
        const validationErrors: Array<{
            field: string;
            message: string;
        }> = [];

        if ('errors' in error && Array.isArray((error as any).errors)) {
            for (const err of (error as any).errors) {
                validationErrors.push({
                    field: err.property || 'unknown',
                    message: err.message || err.toString(),
                });
            }
        }

        if (validationErrors.length > 0) {
            return new ValidationFailedException(validationErrors, correlationId);
        }

        return new StandardException({
            errorCode: StandardErrorCode.VALIDATION_FAILED,
            details: error.message,
            correlationId,
            cause: error,
        });
    }
}
