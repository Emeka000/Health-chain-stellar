import {
  ArgumentsHost,
  BadRequestException,
  Catch,
  ExceptionFilter,
  Injectable,
} from '@nestjs/common';
import { Response, Request } from 'express';
import { ValidationErrorService } from '../services/validation-error.service';

/**
 * Global exception filter to format validation errors
 */
@Catch(BadRequestException)
@Injectable()
export class ValidationExceptionFilter implements ExceptionFilter {
  constructor(private validationErrorService: ValidationErrorService) {}

  catch(exception: BadRequestException, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    // Get language from request headers or query params
    const language = (request.query.lang || request.get('Accept-Language') || 'en')
      .toString()
      .split(',')[0]
      .split('-')[0];

    const exceptionResponse = exception.getResponse();

    // Check if this is a class-validator error
    if (
      typeof exceptionResponse === 'object' &&
      'message' in exceptionResponse &&
      Array.isArray((exceptionResponse as any).message)
    ) {
      const classValidatorErrors = (exceptionResponse as any).message;

      // Convert class-validator errors to our format
      const formattedErrors = this.validationErrorService.formatValidationErrors(
        classValidatorErrors,
        language
      );

      const errorResponse = this.validationErrorService.createValidationResponse(
        formattedErrors,
        language
      );

      response.status(400).json(errorResponse);
    } else {
      // Default handling for other BadRequestExceptions
      response.status(400).json(exceptionResponse);
    }
  }
}

/**
 * Global exception filter for other HTTP exceptions
 */
@Catch()
@Injectable()
export class GlobalExceptionFilter implements ExceptionFilter {
  constructor(private validationErrorService: ValidationErrorService) {}

  catch(exception: any, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();
    const status = exception.getStatus?.() || 500;

    // Get language from request
    const language = (request.query.lang || request.get('Accept-Language') || 'en')
      .toString()
      .split(',')[0]
      .split('-')[0];

    const errorResponse = {
      statusCode: status,
      message: exception.message || 'Internal Server Error',
      timestamp: new Date().toISOString(),
      path: request.url,
    };

    response.status(status).json(errorResponse);
  }
}
