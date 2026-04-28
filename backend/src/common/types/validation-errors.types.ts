import {
  createParamDecorator,
  ExecutionContext,
  HttpStatus,
  HttpException,
} from '@nestjs/common';
import { Request } from 'express';
import { ValidationErrorService } from '../services/validation-error.service';

/**
 * Decorator to get the language from the request
 */
export const GetLanguage = createParamDecorator(
  (data: unknown, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest<Request>();

    const language =
      (request.query.lang as string) ||
      request.get('Accept-Language')?.split(',')[0].split('-')[0] ||
      'en';

    return language.toLowerCase() === 'fr' ? 'fr' : 'en';
  }
);

/**
 * Type guard to check if error is a validation error
 */
export function isValidationError(error: any): error is {
  statusCode: number;
  message: string[];
  error: string;
} {
  return (
    error &&
    !Array.isArray(error.message) &&
    Array.isArray((error as any).message)
  );
}

/**
 * Validation error response DTOs
 */
export class ValidationErrorDto {
  errorCode: string;
  message: string;
  field?: string;
}

export class ValidationErrorsResponseDto {
  statusCode: number;
  message: string;
  errors: ValidationErrorDto[];
  timestamp: string;
}

/**
 * Utility to create a business validation error
 */
export class BusinessValidationError extends HttpException {
  constructor(
    private validationErrorService: ValidationErrorService,
    private errorType: string,
    private language: string = 'en',
    private context?: Record<string, any>
  ) {
    const errorResponse = validationErrorService.createBusinessErrorResponse(
      errorType,
      language,
      context
    );

    super(
      {
        statusCode: HttpStatus.BAD_REQUEST,
        message: errorResponse.message,
        errors: [errorResponse],
        timestamp: new Date().toISOString(),
      },
      HttpStatus.BAD_REQUEST
    );
  }
}

/**
 * Validation error response formatter
 */
export class ValidationErrorFormatter {
  constructor(private validationErrorService: ValidationErrorService) {}

  /**
   * Format errors for API response with pagination support
   */
  formatResponse(
    errors: any[],
    language: string = 'en',
    additionalInfo?: any
  ): ValidationErrorsResponseDto {
    const formattedErrors = this.validationErrorService.formatValidationErrors(
      errors,
      language
    );

    return this.validationErrorService.createValidationResponse(
      formattedErrors,
      language
    );
  }
}

/**
 * Error mapping for frontend consumption
 * Maps error codes to frontend translation keys
 */
export const ErrorCodeToFrontendKeyMapping: Record<string, string> = {
  // Blood Requests
  blood_request_invalid_hospital_id: 'errors:error_422',
  blood_request_required_by_must_be_future: 'errors:error_422',
  blood_request_no_items: 'errors:error_422',
  blood_request_invalid_urgency: 'errors:error_422',
  blood_request_invalid_delivery_address: 'errors:error_422',

  // Blood Units
  blood_unit_invalid_type: 'errors:error_422',
  blood_unit_invalid_quantity: 'errors:error_422',
  blood_unit_expired: 'errors:error_422',
  blood_unit_not_found: 'errors:error_404',
  blood_unit_insufficient_stock: 'errors:error_422',

  // Orders
  order_invalid_blood_bank: 'errors:error_422',
  order_invalid_status: 'errors:error_422',
  order_not_found: 'errors:error_404',
  order_already_dispatched: 'errors:error_422',
  order_cannot_cancel: 'errors:error_422',

  // Dispatch
  dispatch_invalid_rider: 'errors:error_422',
  dispatch_invalid_vehicle: 'errors:error_422',
  dispatch_temperature_out_of_range: 'errors:error_422',
  dispatch_not_found: 'errors:error_404',

  // Verification
  verification_invalid_blood_id: 'errors:error_422',
  verification_unit_not_found: 'errors:error_404',
  verification_unit_expired: 'errors:error_422',
  verification_invalid_condition: 'errors:error_422',

  // Generic
  validation_error: 'errors:error_422',
  required_field: 'forms:form_required_field',
  invalid_format: 'forms:form_invalid_email',
  invalid_enum: 'errors:error_422',
  invalid_length: 'errors:error_422',
  invalid_date: 'forms:form_invalid_email',
  invalid_number: 'errors:error_422',
  duplicate_entry: 'errors:error_422',
  unauthorized: 'errors:error_401',
  forbidden: 'errors:error_403',
  not_found: 'errors:error_404',
};
