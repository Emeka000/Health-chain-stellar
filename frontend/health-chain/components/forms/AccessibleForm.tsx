'use client';

import React, { ButtonHTMLAttributes, ReactNode } from 'react';

interface AccessibleButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  children: ReactNode;
  variant?: 'primary' | 'secondary' | 'danger' | 'success';
  size?: 'sm' | 'md' | 'lg';
  isLoading?: boolean;
  loadingText?: string;
}

const variantClasses = {
  primary: 'bg-blue-600 hover:bg-blue-700 text-white focus:ring-blue-500',
  secondary: 'bg-gray-200 hover:bg-gray-300 text-gray-900 focus:ring-gray-500',
  danger: 'bg-red-600 hover:bg-red-700 text-white focus:ring-red-500',
  success: 'bg-green-600 hover:bg-green-700 text-white focus:ring-green-500',
};

const sizeClasses = {
  sm: 'px-3 py-1 text-sm',
  md: 'px-4 py-2 text-base',
  lg: 'px-6 py-3 text-lg',
};

/**
 * Accessible button component
 * Features:
 * - Proper keyboard focus styling
 * - Loading state management
 * - ARIA attributes for disabled/loading states
 * - Semantic button element
 */
export const AccessibleButton = React.forwardRef<HTMLButtonElement, AccessibleButtonProps>(
  (
    {
      children,
      variant = 'primary',
      size = 'md',
      isLoading = false,
      loadingText,
      disabled,
      className,
      ...props
    },
    ref
  ) => {
    return (
      <button
        ref={ref}
        disabled={disabled || isLoading}
        aria-busy={isLoading}
        className={`
          font-medium rounded-md transition-colors
          focus:outline-none focus:ring-2 focus:ring-offset-2
          disabled:opacity-50 disabled:cursor-not-allowed
          ${variantClasses[variant]}
          ${sizeClasses[size]}
          ${className || ''}
        `}
        {...props}
      >
        {isLoading ? loadingText || 'Loading...' : children}
      </button>
    );
  }
);

AccessibleButton.displayName = 'AccessibleButton';

interface FormValidationErrorsProps {
  errors?: Record<string, string>;
  title?: string;
}

/**
 * Form validation error summary
 * Displays all errors at the top of a form for screen reader users
 */
export const FormValidationErrors: React.FC<FormValidationErrorsProps> = ({
  errors,
  title = 'Form Errors',
}) => {
  const errorList = errors ? Object.entries(errors) : [];

  if (errorList.length === 0) {
    return null;
  }

  return (
    <div
      role="alert"
      className="mb-4 p-4 bg-red-50 border border-red-200 rounded-md"
      aria-live="polite"
    >
      <h2 className="font-semibold text-red-900 mb-2">{title}</h2>
      <ul className="space-y-1">
        {errorList.map(([field, message]) => (
          <li key={field} className="text-sm text-red-800">
            • {message}
          </li>
        ))}
      </ul>
    </div>
  );
};

interface AccessibleFormProps {
  children: ReactNode;
  onSubmit: (e: React.FormEvent<HTMLFormElement>) => void;
  validationErrors?: Record<string, string>;
  title?: string;
  description?: string;
  className?: string;
}

/**
 * Accessible form wrapper
 * Features:
 * - Proper heading structure
 * - Validation error summary
 * - Keyboard navigation support
 */
export const AccessibleForm: React.FC<AccessibleFormProps> = ({
  children,
  onSubmit,
  validationErrors,
  title,
  description,
  className,
}) => {
  return (
    <form
      onSubmit={onSubmit}
      className={className}
      noValidate
      aria-label={title}
    >
      {title && (
        <h1 className="text-2xl font-bold mb-2">{title}</h1>
      )}

      {description && (
        <p className="text-gray-600 mb-4">{description}</p>
      )}

      {validationErrors && Object.keys(validationErrors).length > 0 && (
        <FormValidationErrors errors={validationErrors} />
      )}

      {children}
    </form>
  );
};
