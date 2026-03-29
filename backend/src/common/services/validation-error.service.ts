import { Injectable } from '@nestjs/common';
import { ValidationError } from 'class-validator';
import {
  ValidationErrorCodes,
  ErrorMessageTemplates,
  ValidationErrorResponse,
  ValidationErrorsResponse,
} from '../constants/validation-errors.constants';

/**
 * Service for handling validation error formatting and localization
 */
@Injectable()
export class ValidationErrorService {
  /**
   * Format class-validator errors into localized error responses
   */
  formatValidationErrors(
    errors: ValidationError[],
    language: string = 'en'
  ): ValidationErrorResponse[] {
    return errors.flatMap((error) =>
      this.formatError(error, language)
    );
  }

  /**
   * Format a single validation error
   */
  private formatError(
    error: ValidationError,
    language: string
  ): ValidationErrorResponse[] {
    const results: ValidationErrorResponse[] = [];

    if (error.constraints) {
      for (const [constraintType, message] of Object.entries(error.constraints)) {
        const errorCode = this.mapConstraintToErrorCode(
          error.property,
          constraintType
        );

        const translatedMessage = this.getLocalizedMessage(
          errorCode,
          language,
          error.property,
          error.value
        );

        results.push({
          errorCode,
          message: translatedMessage,
          field: error.property,
          constraints: error.constraints,
        });
      }
    }

    // Handle nested validation errors
    if (error.children && error.children.length > 0) {
      error.children.forEach((child) => {
        results.push(
          ...this.formatError(child, language).map((e) => ({
            ...e,
            field: `${error.property}.${e.field || child.property}`,
          }))
        );
      });
    }

    return results;
  }

  /**
   * Map class-validator constraint types to error codes
   */
  private mapConstraintToErrorCode(field: string, constraint: string): string {
    const constraintMapping: Record<string, string> = {
      isString: ValidationErrorCodes.INVALID_FORMAT,
      isNumber: ValidationErrorCodes.INVALID_NUMBER,
      isDateString: ValidationErrorCodes.INVALID_DATE,
      isEnum: ValidationErrorCodes.INVALID_ENUM,
      minLength: ValidationErrorCodes.INVALID_LENGTH,
      maxLength: ValidationErrorCodes.INVALID_LENGTH,
      min: ValidationErrorCodes.INVALID_NUMBER,
      max: ValidationErrorCodes.INVALID_NUMBER,
      isEmail: ValidationErrorCodes.INVALID_FORMAT,
      isPhoneNumber: ValidationErrorCodes.INVALID_FORMAT,
      arrayMinSize: ValidationErrorCodes.INVALID_LENGTH,
      arrayMaxSize: ValidationErrorCodes.INVALID_LENGTH,
    };

    return constraintMapping[constraint] || ValidationErrorCodes.VALIDATION_ERROR;
  }

  /**
   * Get localized error message for an error code
   */
  getLocalizedMessage(
    errorCode: string,
    language: string = 'en',
    field?: string,
    value?: any,
    additionalParams?: Record<string, any>
  ): string {
    const template = ErrorMessageTemplates[errorCode];

    if (!template) {
      return `Error: ${errorCode}`;
    }

    let message = template[language] || template['en'];

    // Replace placeholders
    message = message.replace('{field}', field || '');
    message = message.replace('{value}', String(value || ''));
    message = message.replace('{actual}', additionalParams?.actual || '');
    message = message.replace('{expected}', additionalParams?.expected || '');
    message = message.replace('{min}', additionalParams?.min || '');
    message = message.replace('{max}', additionalParams?.max || '');

    return message;
  }

  /**
   * Create a validation error response for API responses
   */
  createValidationResponse(
    errors: ValidationErrorResponse[],
    language: string = 'en'
  ): ValidationErrorsResponse {
    return {
      statusCode: 400,
      message: this.getLocalizedMessage(
        ValidationErrorCodes.VALIDATION_ERROR,
        language
      ),
      errors,
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Map business logic errors to validation error codes
   */
  mapBusinessErrorToCode(errorType: string, context?: any): string {
    const errorCodeMapping: Record<string, string> = {
      'blood-unit-expired': ValidationErrorCodes.BLOOD_UNIT_EXPIRED,
      'insufficient-stock': ValidationErrorCodes.BLOOD_UNIT_INSUFFICIENT_STOCK,
      'invalid-status': ValidationErrorCodes.ORDER_INVALID_STATUS,
      'order-not-found': ValidationErrorCodes.ORDER_NOT_FOUND,
      'dispatch-not-found': ValidationErrorCodes.DISPATCH_NOT_FOUND,
      'temperature-out-of-range': ValidationErrorCodes.DISPATCH_TEMPERATURE_OUT_OF_RANGE,
      'unit-not-found': ValidationErrorCodes.BLOOD_UNIT_NOT_FOUND,
    };

    return errorCodeMapping[errorType] || ValidationErrorCodes.VALIDATION_ERROR;
  }

  /**
   * Create a localized error response from a business error
   */
  createBusinessErrorResponse(
    errorType: string,
    language: string = 'en',
    context?: Record<string, any>
  ): ValidationErrorResponse {
    const errorCode = this.mapBusinessErrorToCode(errorType);
    const message = this.getLocalizedMessage(
      errorCode,
      language,
      context?.field,
      context?.value,
      context
    );

    return {
      errorCode,
      message,
      field: context?.field,
    };
  }
}
