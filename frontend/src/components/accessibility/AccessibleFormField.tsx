/**
 * Accessible Form Field Component
 * 
 * Form field with proper labels, error messages, and ARIA attributes
 */

import React from 'react';

export interface AccessibleFormFieldProps {
    /** Field ID (required for label association) */
    id: string;

    /** Field label */
    label: string;

    /** Field type */
    type?: 'text' | 'email' | 'password' | 'number' | 'tel' | 'url' | 'date' | 'time';

    /** Field value */
    value: string | number;

    /** Change handler */
    onChange: (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => void;

    /** Blur handler */
    onBlur?: (event: React.FocusEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => void;

    /** Error message */
    error?: string;

    /** Help text */
    helpText?: string;

    /** Whether field is required */
    required?: boolean;

    /** Whether field is disabled */
    disabled?: boolean;

    /** Placeholder text */
    placeholder?: string;

    /** Field variant */
    variant?: 'input' | 'textarea' | 'select';

    /** Select options (for select variant) */
    options?: Array<{ value: string | number; label: string }>;

    /** Textarea rows (for textarea variant) */
    rows?: number;

    /** Autocomplete attribute */
    autoComplete?: string;

    /** Input mode for mobile keyboards */
    inputMode?: 'text' | 'numeric' | 'tel' | 'email' | 'url';

    /** Pattern for validation */
    pattern?: string;

    /** Min value (for number inputs) */
    min?: number;

    /** Max value (for number inputs) */
    max?: number;

    /** Custom class name */
    className?: string;
}

export const AccessibleFormField: React.FC<AccessibleFormFieldProps> = ({
    id,
    label,
    type = 'text',
    value,
    onChange,
    onBlur,
    error,
    helpText,
    required = false,
    disabled = false,
    placeholder,
    variant = 'input',
    options = [],
    rows = 4,
    autoComplete,
    inputMode,
    pattern,
    min,
    max,
    className = '',
}) => {
    const hasError = Boolean(error);
    const errorId = `${id}-error`;
    const helpId = `${id}-help`;

    const baseInputClasses = `
    w-full px-4 py-2 border rounded-md
    focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent
    disabled:bg-gray-100 disabled:cursor-not-allowed
    ${hasError ? 'border-red-500' : 'border-gray-300'}
    ${className}
  `;

    const commonProps = {
        id,
        value,
        onChange,
        onBlur,
        required,
        disabled,
        placeholder,
        'aria-invalid': hasError,
        'aria-describedby': [
            hasError ? errorId : null,
            helpText ? helpId : null,
        ]
            .filter(Boolean)
            .join(' ') || undefined,
        'aria-required': required,
    };

    return (
        <div className="mb-4">
            {/* Label */}
            <label
                htmlFor={id}
                className="block text-sm font-medium text-gray-700 mb-1"
            >
                {label}
                {required && (
                    <span className="text-red-500 ml-1" aria-label="required">
                        *
                    </span>
                )}
            </label>

            {/* Help text */}
            {helpText && (
                <p id={helpId} className="text-sm text-gray-600 mb-2">
                    {helpText}
                </p>
            )}

            {/* Input field */}
            {variant === 'input' && (
                <input
                    {...commonProps}
                    type={type}
                    className={baseInputClasses}
                    autoComplete={autoComplete}
                    inputMode={inputMode}
                    pattern={pattern}
                    min={min}
                    max={max}
                />
            )}

            {/* Textarea */}
            {variant === 'textarea' && (
                <textarea
                    {...commonProps}
                    rows={rows}
                    className={baseInputClasses}
                />
            )}

            {/* Select */}
            {variant === 'select' && (
                <select {...commonProps} className={baseInputClasses}>
                    <option value="">Select an option</option>
                    {options.map((option) => (
                        <option key={option.value} value={option.value}>
                            {option.label}
                        </option>
                    ))}
                </select>
            )}

            {/* Error message */}
            {hasError && (
                <p
                    id={errorId}
                    className="mt-1 text-sm text-red-600"
                    role="alert"
                    aria-live="polite"
                >
                    {error}
                </p>
            )}
        </div>
    );
};

export default AccessibleFormField;
