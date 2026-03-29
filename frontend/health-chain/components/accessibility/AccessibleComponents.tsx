'use client';

import React, { useEffect, useRef } from 'react';
import { focusUtils } from '@/lib/a11y';

interface AccessibleModalProps {
  isOpen: boolean;
  onClose: () => void;
  children: React.ReactNode;
  title: string;
  initialFocusSelector?: string;
}

/**
 * Accessible modal component
 * Features:
 * - Focus trapping
 * - Focus restoration on close
 * - Escape key handling
 * - Semantic structure
 */
export const AccessibleModal: React.FC<AccessibleModalProps> = ({
  isOpen,
  onClose,
  children,
  title,
  initialFocusSelector,
}) => {
  const modalRef = useRef<HTMLDivElement>(null);
  const previousActiveElement = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!isOpen || !modalRef.current) return;

    // Store previously focused element
    previousActiveElement.current = document.activeElement as HTMLElement;

    // Set initial focus
    focusUtils.setInitialFocus(modalRef.current, initialFocusSelector);

    // Trap focus within modal
    const cleanupFocusTrap = focusUtils.trapFocus(modalRef.current);

    // Handle Escape key
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };

    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      cleanupFocusTrap();

      // Restore focus to previously focused element
      if (previousActiveElement.current) {
        previousActiveElement.current.focus();
      }
    };
  }, [isOpen, onClose, initialFocusSelector]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      role="presentation"
    >
      <div
        ref={modalRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-title"
        className="bg-white rounded-lg p-6 max-w-md w-full mx-4 shadow-lg"
      >
        <h2 id="modal-title" className="text-xl font-bold mb-4">
          {title}
        </h2>

        {children}

        <button
          onClick={onClose}
          className="absolute top-4 right-4 p-2 hover:bg-gray-200 rounded"
          aria-label="Close modal"
        >
          ✕
        </button>
      </div>
    </div>
  );
};

/**
 * Skip to main content link
 * Should be the first interactive element on the page
 */
export const SkipLink: React.FC<{ href?: string }> = ({ href = '#main-content' }) => {
  return (
    <a
      href={href}
      onClick={(e) => {
        e.preventDefault();
        const target = document.querySelector(href);
        if (target instanceof HTMLElement) {
          focusUtils.skipToMain(href);
        }
      }}
      className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 bg-blue-600 text-white px-4 py-2 rounded"
    >
      Skip to main content
    </a>
  );
};

/**
 * Screen reader only text
 */
export const ScreenReaderOnly: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  return (
    <span className="sr-only">
      {children}
    </span>
  );
};
