'use client';

import { useState, useCallback, useRef } from 'react';

interface ValidationRule {
  validate: (value: any) => boolean;
  message: string;
}

interface FormErrors {
  [key: string]: string;
}

/**
 * Hook for managing form validation
 * Supports multiple validation rules per field
 * Integrates with accessible form components
 */
export const useFormValidation = (initialValues: Record<string, any>) => {
  const [values, setValues] = useState(initialValues);
  const [errors, setErrors] = useState<FormErrors>({});
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const validationRulesRef = useRef<Record<string, ValidationRule[]>>({});

  const registerField = useCallback(
    (fieldName: string, rules: ValidationRule[]) => {
      validationRulesRef.current[fieldName] = rules;
    },
    []
  );

  const validateField = useCallback(
    (fieldName: string, value: any): string | null => {
      const rules = validationRulesRef.current[fieldName] || [];

      for (const rule of rules) {
        if (!rule.validate(value)) {
          return rule.message;
        }
      }

      return null;
    },
    []
  );

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
      const { name, value, type } = e.target;

      let newValue = value;
      if (type === 'checkbox') {
        newValue = (e.target as HTMLInputElement).checked;
      }

      setValues((prev) => ({
        ...prev,
        [name]: newValue,
      }));

      // Validate on change if field was touched
      if (touched[name]) {
        const error = validateField(name, newValue);
        setErrors((prev) => ({
          ...prev,
          [name]: error || '',
        }));
      }
    },
    [touched, validateField]
  );

  const handleBlur = useCallback(
    (e: React.FocusEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
      const { name, value } = e.target;

      setTouched((prev) => ({
        ...prev,
        [name]: true,
      }));

      const error = validateField(name, value);
      setErrors((prev) => ({
        ...prev,
        [name]: error || '',
      }));
    },
    [validateField]
  );

  const validateForm = useCallback((): boolean => {
    const newErrors: FormErrors = {};

    Object.keys(validationRulesRef.current).forEach((fieldName) => {
      const error = validateField(fieldName, values[fieldName]);
      if (error) {
        newErrors[fieldName] = error;
      }
    });

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  }, [values, validateField]);

  const handleSubmit = useCallback(
    async (onSubmit: () => void | Promise<void>) => {
      return async (e: React.FormEvent<HTMLFormElement>) => {
        e.preventDefault();

        if (validateForm()) {
          setIsSubmitting(true);
          try {
            await onSubmit();
          } finally {
            setIsSubmitting(false);
          }
        }
      };
    },
    [validateForm]
  );

  const resetForm = useCallback(() => {
    setValues(initialValues);
    setErrors({});
    setTouched({});
  }, [initialValues]);

  return {
    values,
    errors,
    touched,
    isSubmitting,
    setValues,
    setErrors,
    handleChange,
    handleBlur,
    handleSubmit,
    validateField,
    validateForm,
    resetForm,
    registerField,
  };
};

/**
 * Common validation rules
 */
export const validationRules = {
  required: (value: any): ValidationRule => ({
    validate: (val) => {
      if (typeof val === 'string') {
        return val.trim().length > 0;
      }
      return val !== undefined && val !== null && val !== '';
    },
    message: value || 'This field is required',
  }),

  email: (message = 'Please enter a valid email address'): ValidationRule => ({
    validate: (val) => {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      return emailRegex.test(val);
    },
    message,
  }),

  minLength: (length: number, message?: string): ValidationRule => ({
    validate: (val) => val.length >= length,
    message: message || `Minimum length is ${length} characters`,
  }),

  maxLength: (length: number, message?: string): ValidationRule => ({
    validate: (val) => val.length <= length,
    message: message || `Maximum length is ${length} characters`,
  }),

  minValue: (min: number, message?: string): ValidationRule => ({
    validate: (val) => Number(val) >= min,
    message: message || `Value must be at least ${min}`,
  }),

  maxValue: (max: number, message?: string): ValidationRule => ({
    validate: (val) => Number(val) <= max,
    message: message || `Value must be no more than ${max}`,
  }),

  phone: (message = 'Please enter a valid phone number'): ValidationRule => ({
    validate: (val) => {
      const phoneRegex = /^[\d\s\-\+\(\)]+$/;
      return phoneRegex.test(val) && val.replace(/\D/g, '').length >= 10;
    },
    message,
  }),

  custom: (validate: (val: any) => boolean, message: string): ValidationRule => ({
    validate,
    message,
  }),
};
