'use client';

import { useEffect, useRef, useCallback } from 'react';

/**
 * Hook for managing focus in multi-step forms
 */
export const useFocusManagement = () => {
  const containerRef = useRef<HTMLElement | null>(null);
  const previousActiveRef = useRef<HTMLElement | null>(null);

  const setFocusToElement = useCallback((selector: string) => {
    if (!containerRef.current) return;

    const element = containerRef.current.querySelector<HTMLElement>(selector);
    if (element) {
      element.focus();
      element.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, []);

  const setFocusToError = useCallback(() => {
    if (!containerRef.current) return;

    const errorElement = containerRef.current.querySelector<HTMLElement>(
      '[role="alert"]'
    );

    if (errorElement) {
      errorElement.focus();
      errorElement.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, []);

  const setContainer = useCallback((element: HTMLElement | null) => {
    containerRef.current = element;
  }, []);

  return {
    containerRef,
    setContainer,
    setFocusToElement,
    setFocusToError,
  };
};

/**
 * Hook for managing focus within a specific section (e.g., step in a wizard)
 */
export const useStepFocusManagement = (stepNumber: number, onStepChange?: () => void) => {
  const sectionRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (sectionRef.current) {
      // Focus first interactive element in section
      const firstFocusable = sectionRef.current.querySelector<HTMLElement>(
        'button, [href], input:not([type="hidden"]), select, textarea, [tabindex]:not([tabindex="-1"])'
      );

      if (firstFocusable) {
        setTimeout(() => {
          firstFocusable.focus();
          sectionRef.current?.scrollIntoView({ behavior: 'smooth' });
        }, 0);

        onStepChange?.();
      }
    }
  }, [stepNumber, onStepChange]);

  return sectionRef;
};

/**
 * Hook for managing focus in lists (table rows, menu items, etc.)
 */
export const useListFocusManagement = (itemsCount: number) => {
  const containerRef = useRef<HTMLElement | null>(null);
  const currentFocusRef = useRef<number>(0);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (!containerRef.current) return;

      const items = containerRef.current.querySelectorAll<HTMLElement>(
        '[role="button"], [role="menuitem"], [role="tab"], a'
      );

      if (items.length === 0) return;

      let newIndex = currentFocusRef.current;

      switch (e.key) {
        case 'ArrowDown':
        case 'ArrowRight':
          e.preventDefault();
          newIndex = (currentFocusRef.current + 1) % items.length;
          break;
        case 'ArrowUp':
        case 'ArrowLeft':
          e.preventDefault();
          newIndex = (currentFocusRef.current - 1 + items.length) % items.length;
          break;
        case 'Home':
          e.preventDefault();
          newIndex = 0;
          break;
        case 'End':
          e.preventDefault();
          newIndex = items.length - 1;
          break;
        default:
          return;
      }

      currentFocusRef.current = newIndex;
      items[newIndex].focus();
    },
    []
  );

  const focusItem = useCallback((index: number) => {
    if (!containerRef.current) return;

    const items = containerRef.current.querySelectorAll<HTMLElement>(
      '[role="button"], [role="menuitem"], [role="tab"], a'
    );

    if (items[index]) {
      currentFocusRef.current = index;
      items[index].focus();
    }
  }, []);

  return {
    containerRef,
    handleKeyDown,
    focusItem,
    currentFocus: currentFocusRef.current,
  };
};

/**
 * Hook for dialog/modal focus management
 */
export const useDialogFocusManagement = (isOpen: boolean) => {
  const dialogRef = useRef<HTMLElement | null>(null);
  const previousActiveRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!isOpen || !dialogRef.current) return;

    // Store the element that had focus before the dialog opened
    previousActiveRef.current = document.activeElement as HTMLElement;

    // Set focus to the first focusable element in the dialog
    const focusableElements = dialogRef.current.querySelectorAll<HTMLElement>(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    );

    if (focusableElements.length > 0) {
      focusableElements[0].focus();
    }

    // Handle escape key to close dialog
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        // Focus should return to trigger element
        previousActiveRef.current?.focus();
      }
    };

    document.addEventListener('keydown', handleEscape);

    return () => {
      document.removeEventListener('keydown', handleEscape);
    };
  }, [isOpen]);

  return dialogRef;
};
