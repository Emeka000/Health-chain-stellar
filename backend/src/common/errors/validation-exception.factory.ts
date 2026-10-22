import { ValidationError } from 'class-validator';
import { ValidationFailedException } from './standard-exception';

/**
 * Validation Exception Factory
 * 
 * Transforms class-validator errors into StandardException
 */
export function validationExceptionFactory(
    errors: ValidationError[],
    correlationId?: string,
): ValidationFailedException {
    const validationErrors = flattenValidationErrors(errors);

    return new ValidationFailedException(validationErrors, correlationId);
}

/**
 * Flatten nested validation errors
 */
function flattenValidationErrors(
    errors: ValidationError[],
    parentPath = '',
): Array<{
    field: string;
    message: string;
    constraint?: string;
    value?: unknown;
}> {
    const result: Array<{
        field: string;
        message: string;
        constraint?: string;
        value?: unknown;
    }> = [];

    for (const error of errors) {
        const fieldPath = parentPath
            ? `${parentPath}.${error.property}`
            : error.property;

        // Add constraints for this field
        if (error.constraints) {
            for (const [constraint, message] of Object.entries(error.constraints)) {
                result.push({
                    field: fieldPath,
                    message,
                    constraint,
                    value: error.value,
                });
            }
        }

        // Recursively process nested errors
        if (error.children && error.children.length > 0) {
            result.push(...flattenValidationErrors(error.children, fieldPath));
        }
    }

    return result;
}
