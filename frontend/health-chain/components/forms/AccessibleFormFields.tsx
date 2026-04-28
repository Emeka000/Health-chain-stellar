'use client';

import React, { InputHTMLAttributes, ReactNode } from 'react';

interface AccessibleInputProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
  error?: string;
  hint?: string;
  required?: boolean;
  helpText?: string;
}

/**
 * Accessible input field component
 * Features:
 * - Proper label association
 * - Error aria-describedby
 * - Required field indication
 * - Keyboard navigation support
 * - Screen reader friendly
 */
export const AccessibleInput = React.forwardRef<HTMLInputElement, AccessibleInputProps>(
  ({ label, error, hint, required, helpText, id, ...props }, ref) => {
    const inputId = id || `input-${Math.random().toString(36).substr(2, 9)}`;
    const errorId = error ? `${inputId}-error` : undefined;
    const hintId = hint ? `${inputId}-hint` : undefined;

    const describedBy = [errorId, hintId].filter(Boolean).join(' ');

    return (
      <div className="mb-4">
        <label
          htmlFor={inputId}
          className="block text-sm font-medium text-gray-700 mb-1"
        >
          {label}
          {required && <span className="text-red-600 ml-1" aria-label="required">*</span>}
        </label>

        {hint && (
          <p id={hintId} className="text-xs text-gray-500 mb-2">
            {hint}
          </p>
        )}

        <input
          ref={ref}
          id={inputId}
          aria-required={required}
          aria-invalid={!!error}
          aria-describedby={describedBy || undefined}
          className={`w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 ${
            error
              ? 'border-red-500 focus:ring-red-500'
              : 'border-gray-300 focus:ring-blue-500'
          }`}
          {...props}
        />

        {error && (
          <p id={errorId} className="mt-1 text-sm text-red-600" role="alert">
            {error}
          </p>
        )}

        {helpText && (
          <p className="mt-1 text-xs text-gray-500">
            {helpText}
          </p>
        )}
      </div>
    );
  }
);

AccessibleInput.displayName = 'AccessibleInput';

interface AccessibleSelectProps extends InputHTMLAttributes<HTMLSelectElement> {
  label: string;
  options: Array<{ value: string; label: string }>;
  error?: string;
  hint?: string;
  required?: boolean;
  placeholder?: string;
}

/**
 * Accessible select field component
 * Features:
 * - Proper label association
 * - Keyboard navigation (Tab, Arrow keys)
 * - Error handling
 * - Screen reader friendly
 */
export const AccessibleSelect = React.forwardRef<HTMLSelectElement, AccessibleSelectProps>(
  ({ label, options, error, hint, required, placeholder, id, ...props }, ref) => {
    const selectId = id || `select-${Math.random().toString(36).substr(2, 9)}`;
    const errorId = error ? `${selectId}-error` : undefined;
    const hintId = hint ? `${selectId}-hint` : undefined;

    const describedBy = [errorId, hintId].filter(Boolean).join(' ');

    return (
      <div className="mb-4">
        <label
          htmlFor={selectId}
          className="block text-sm font-medium text-gray-700 mb-1"
        >
          {label}
          {required && <span className="text-red-600 ml-1" aria-label="required">*</span>}
        </label>

        {hint && (
          <p id={hintId} className="text-xs text-gray-500 mb-2">
            {hint}
          </p>
        )}

        <select
          ref={ref}
          id={selectId}
          aria-required={required}
          aria-invalid={!!error}
          aria-describedby={describedBy || undefined}
          className={`w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 ${
            error
              ? 'border-red-500 focus:ring-red-500'
              : 'border-gray-300 focus:ring-blue-500'
          }`}
          {...props}
        >
          {placeholder && (
            <option value="">{placeholder}</option>
          )}
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>

        {error && (
          <p id={errorId} className="mt-1 text-sm text-red-600" role="alert">
            {error}
          </p>
        )}
      </div>
    );
  }
);

AccessibleSelect.displayName = 'AccessibleSelect';

interface AccessibleTextAreaProps extends InputHTMLAttributes<HTMLTextAreaElement> {
  label: string;
  error?: string;
  hint?: string;
  required?: boolean;
}

/**
 * Accessible textarea field component
 */
export const AccessibleTextArea = React.forwardRef<HTMLTextAreaElement, AccessibleTextAreaProps>(
  ({ label, error, hint, required, id, ...props }, ref) => {
    const textareaId = id || `textarea-${Math.random().toString(36).substr(2, 9)}`;
    const errorId = error ? `${textareaId}-error` : undefined;
    const hintId = hint ? `${textareaId}-hint` : undefined;

    const describedBy = [errorId, hintId].filter(Boolean).join(' ');

    return (
      <div className="mb-4">
        <label
          htmlFor={textareaId}
          className="block text-sm font-medium text-gray-700 mb-1"
        >
          {label}
          {required && <span className="text-red-600 ml-1" aria-label="required">*</span>}
        </label>

        {hint && (
          <p id={hintId} className="text-xs text-gray-500 mb-2">
            {hint}
          </p>
        )}

        <textarea
          ref={ref}
          id={textareaId}
          aria-required={required}
          aria-invalid={!!error}
          aria-describedby={describedBy || undefined}
          className={`w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 resize-vertical ${
            error
              ? 'border-red-500 focus:ring-red-500'
              : 'border-gray-300 focus:ring-blue-500'
          }`}
          {...props}
        />

        {error && (
          <p id={errorId} className="mt-1 text-sm text-red-600" role="alert">
            {error}
          </p>
        )}
      </div>
    );
  }
);

AccessibleTextArea.displayName = 'AccessibleTextArea';

interface AccessibleCheckboxProps extends InputHTMLAttributes<HTMLInputElement> {
  label: ReactNode;
  error?: string;
  hint?: string;
}

/**
 * Accessible checkbox component
 */
export const AccessibleCheckbox = React.forwardRef<HTMLInputElement, AccessibleCheckboxProps>(
  ({ label, error, hint, id, ...props }, ref) => {
    const checkboxId = id || `checkbox-${Math.random().toString(36).substr(2, 9)}`;
    const errorId = error ? `${checkboxId}-error` : undefined;

    return (
      <div className="mb-4">
        <div className="flex items-center">
          <input
            ref={ref}
            type="checkbox"
            id={checkboxId}
            aria-invalid={!!error}
            aria-describedby={errorId}
            className="w-4 h-4 rounded border-gray-300 focus:ring-2 focus:ring-blue-500"
            {...props}
          />
          <label htmlFor={checkboxId} className="ml-2 text-sm text-gray-700">
            {label}
          </label>
        </div>

        {hint && (
          <p className="text-xs text-gray-500 mt-1 ml-6">
            {hint}
          </p>
        )}

        {error && (
          <p id={errorId} className="mt-1 text-sm text-red-600 ml-6" role="alert">
            {error}
          </p>
        )}
      </div>
    );
  }
);

AccessibleCheckbox.displayName = 'AccessibleCheckbox';
