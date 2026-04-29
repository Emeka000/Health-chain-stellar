import {
    ExceptionFilter,
    Catch,
    ArgumentsHost,
    HttpException,
    HttpStatus,
    Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { StandardException } from './standard-exception';
import { ExceptionMapperService } from './exception-mapper.service';
import { StandardErrorResponse, ErrorSeverity } from './error-taxonomy';

/**
 * Global Exception Filter
 * 
 * Catches all exceptions and transforms them into standardized error responses
 */
@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
    private readonly logger = new Logger(GlobalExceptionFilter.name);
    private readonly exceptionMapper: ExceptionMapperService;

    constructor() {
        this.exceptionMapper = new ExceptionMapperService();
    }

    catch(exception: Error, host: ArgumentsHost): void {
        const ctx = host.switchToHttp();
        const response = response<Response>();
        const request = ctx.getRequest<Request>();

        // Extract or generate correlation ID
        const correlationId =
            (request.headers['x-correlation-id'] as string) ||
            (request.headers['x-request-id'] as string) ||
            uuidv4();

        // Map exception to StandardException
        const standardException = this.exceptionMapper.mapException(
            exception,
            correlationId,
        );

        // Build standardized error response
        const errorResponse = this.buildErrorResponse(
            standardException,
            request,
            correlationId,
        );

        // Log error
        this.logError(errorResponse, exception);

        // Send response
        response.status(errorResponse.statusCode).json(errorResponse);
    }

    /**
     * Build standardized error response
     */
    private buildErrorResponse(
        exception: StandardException,
        request: Request,
        correlationId: string,
    ): StandardErrorResponse {
        const response = exception.getResponse() as any;
        const status = exception.getStatus();

        // Extract validation errors if present
        let validationErrors: StandardErrorResponse['validationErrors'];
        if (exception.metadata?.validationErrors) {
            validationErrors = exception.metadata.validationErrors as any;
        }

        const errorResponse: StandardErrorResponse = {
            statusCode: status,
            errorCode: exception.errorCode,
            domain: exception.domain,
            message: response.message || exception.message,
            details: response.details,
            correlationId,
            requestId: (request.headers['x-request-id'] as string) || correlationId,
            timestamp: new Date().toISOString(),
            path: request.url,
            method: request.method,
            severity: exception.severity,
            retryable: exception.retryable,
            remediation: exception.remediation,
            metadata: exception.metadata,
            validationErrors,
        };

        // Include stack trace only in development
        if (process.env.NODE_ENV === 'development') {
            errorResponse.stack = exception.stack;
        }

        return errorResponse;
    }

    /**
     * Log error with appropriate level
     */
    private logError(
        errorResponse: StandardErrorResponse,
        originalException: Error,
    ): void {
        const logContext = {
            errorCode: errorResponse.errorCode,
            correlationId: errorResponse.correlationId,
            path: errorResponse.path,
            method: errorResponse.method,
            statusCode: errorResponse.statusCode,
        };

        const logMessage = `${errorResponse.errorCode}: ${errorResponse.message}`;

        // Log based on severity
        switch (errorResponse.severity) {
            case ErrorSeverity.CRITICAL:
                this.logger.error(logMessage, originalException.stack, logContext);
                break;

            case ErrorSeverity.ERROR:
                this.logger.error(logMessage, logContext);
                break;

            case ErrorSeverity.WARNING:
                this.logger.warn(logMessage, logContext);
                break;

            case ErrorSeverity.INFO:
                this.logger.log(logMessage, logContext);
                break;
        }

        // Always log full stack for 5xx errors
        if (errorResponse.statusCode >= 500) {
            this.logger.error(
                'Internal error stack trace',
                originalException.stack,
                logContext,
            );
        }
    }
}
