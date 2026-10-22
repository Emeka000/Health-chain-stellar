/**
 * Accessible Form Component
 * 
 * Form with proper validation announcements, error handling, and keyboard navigation
 */

import React, { useEffect, useRef } from 'react';
import { focusFirstError } from '../../utils/accessibility/focus-management';
import { announceValidationErrors } from '../../utils/accessibility/live-announcer';

export interface FormError {
    field: string;
    message: string;
}

export interface AccessibleFormProps {
    /** Form submission handler */
    onSubmit: (event: React.FormEvent<HTMLFormElement>) => void;

    /** Form children */
    children: React.ReactNode;

    /** Validation errors */
    errors?: FormError[];

    /** Whether form is submitting */
    isSubmitting?: boolean;

    /** Form title for screen readers */
    ariaLabel?: string;

    /** Custom class name */
    className?: string;

    /** Whether to auto-focus first error */
    autoFocusError?: boolean;
}

export const AccessibleForm: React.FC<AccessibleFormProps> = ({
    onSubmit,
    children,
    errors = [],
    isSubmitting = false,
    ariaLabel,
    className = '',
    autoFocusError = true,
}) => {
    const formRef = useRef<HTMLFormElement>(null);
    const previousErrorCountRef = useRef(0);

    // Announce validation errors
    useEffect(() => {
        if (errors.length > 0 && errors.length !== previousErrorCountRef.current) {
            announceValidationErrors(errors);

            // Focus first error field
            if (autoFocusError && formRef.current) {
                setTimeout(() => {
                    if (formRef.current) {
                        focusFirstError(formRef.current);
                    }
                }, 100);
            }
        }

        previousErrorCountRef.current = errors.length;
    }, [errors, autoFocusError]);

    const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        onSubmit(event);
    };

    return (
        <form
            ref={formRef}
            onSubmit={handleSubmit}
            className={className}
            aria-label={ariaLabel}
            noValidate
        >
            {/* Error summary for screen readers */}
            {errors.length > 0 && (
                <div
                    className="mb-4 p-4 bg-red-50 border border-red-200 rounded"
                    role="alert"
                    aria-live="assertive"
                >
                    <h3 className="text-lg font-semibold text-red-800 mb-2">
                        {errors.length === 1
                            ? '1 error found'
                            : `${errors.length} errors found`}
                    </h3>
                    <ul className="list-disc list-inside space-y-1">
                        {errors.map((error, index) => (
                            <li key={index} className="text-red-700">
                                <a
                                    href={`#${error.field}`}
                                    className="underline hover:text-red-900 focus:outline-none focus:ring-2 focus:ring-red-500"
                                    onClick={(e) => {
                                        e.preventDefault();
                                        const field = document.getElementById(error.field);
                                        field?.focus();
                                    }}
                                >
                                    {error.message}
                                </a>
                            </li>
                        ))}
                    </ul>
                </div>
            )}

            {children}

            {/* Loading indicator for screen readers */}
            {isSubmitting && (
                <div className="sr-only" role="status" aria-live="polite">
                    Submitting form, please wait...
                </div>
            )}
        </form>
    );
};

export default AccessibleForm;
