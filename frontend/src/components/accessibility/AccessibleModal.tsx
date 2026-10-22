/**
 * Accessible Modal Component
 * 
 * Modal with proper focus management, keyboard navigation, and ARIA attributes
 */

import React, { useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { trapFocus } from '../../utils/accessibility/focus-management';
import { announce, AnnouncementPriority } from '../../utils/accessibility/live-announcer';

export interface AccessibleModalProps {
    /** Whether the modal is open */
    isOpen: boolean;

    /** Callback when modal should close */
    onClose: () => void;

    /** Modal title (required for accessibility) */
    title: string;

    /** Modal content */
    children: React.ReactNode;

    /** Optional description for screen readers */
    description?: string;

    /** Whether clicking overlay closes modal (default: true) */
    closeOnOverlayClick?: boolean;

    /** Whether pressing Escape closes modal (default: true) */
    closeOnEscape?: boolean;

    /** Custom class name */
    className?: string;

    /** Size of modal */
    size?: 'small' | 'medium' | 'large' | 'fullscreen';

    /** Whether to announce modal opening */
    announceOpen?: boolean;
}

export const AccessibleModal: React.FC<AccessibleModalProps> = ({
    isOpen,
    onClose,
    title,
    children,
    description,
    closeOnOverlayClick = true,
    closeOnEscape = true,
    className = '',
    size = 'medium',
    announceOpen = true,
}) => {
    const modalRef = useRef<HTMLDivElement>(null);
    const previouslyFocusedRef = useRef<HTMLElement | null>(null);
    const cleanupFocusTrapRef = useRef<(() => void) | null>(null);

    // Handle escape key
    const handleEscape = useCallback(
        (event: KeyboardEvent) => {
            if (closeOnEscape && event.key === 'Escape') {
                onClose();
            }
        },
        [closeOnEscape, onClose],
    );

    // Handle overlay click
    const handleOverlayClick = useCallback(
        (event: React.MouseEvent<HTMLDivElement>) => {
            if (closeOnOverlayClick && event.target === event.currentTarget) {
                onClose();
            }
        },
        [closeOnOverlayClick, onClose],
    );

    // Setup focus trap and keyboard handling
    useEffect(() => {
        if (!isOpen || !modalRef.current) return;

        // Store previously focused element
        previouslyFocusedRef.current = document.activeElement as HTMLElement;

        // Setup focus trap
        cleanupFocusTrapRef.current = trapFocus(modalRef.current);

        // Add escape key listener
        document.addEventListener('keydown', handleEscape);

        // Announce modal opening
        if (announceOpen) {
            announce(`Dialog opened: ${title}`, AnnouncementPriority.POLITE);
        }

        // Prevent body scroll
        document.body.style.overflow = 'hidden';

        return () => {
            // Cleanup focus trap
            if (cleanupFocusTrapRef.current) {
                cleanupFocusTrapRef.current();
            }

            // Remove escape key listener
            document.removeEventListener('keydown', handleEscape);

            // Restore body scroll
            document.body.style.overflow = '';

            // Restore focus
            if (previouslyFocusedRef.current) {
                previouslyFocusedRef.current.focus();
            }
        };
    }, [isOpen, handleEscape, title, announceOpen]);

    if (!isOpen) return null;

    const sizeClasses = {
        small: 'max-w-md',
        medium: 'max-w-2xl',
        large: 'max-w-4xl',
        fullscreen: 'max-w-full h-full',
    };

    const modalContent = (
        <div
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black bg-opacity-50"
            onClick={handleOverlayClick}
            role="presentation"
        >
            <div
                ref={modalRef}
                className={`bg-white rounded-lg shadow-xl ${sizeClasses[size]} w-full max-h-[90vh] overflow-auto ${className}`}
                role="dialog"
                aria-modal="true"
                aria-labelledby="modal-title"
                aria-describedby={description ? 'modal-description' : undefined}
            >
                {/* Modal Header */}
                <div className="flex items-center justify-between p-6 border-b">
                    <h2
                        id="modal-title"
                        className="text-2xl font-semibold text-gray-900"
                    >
                        {title}
                    </h2>
                    <button
                        type="button"
                        onClick={onClose}
                        className="p-2 text-gray-400 hover:text-gray-600 focus:outline-none focus:ring-2 focus:ring-blue-500 rounded"
                        aria-label="Close dialog"
                    >
                        <svg
                            className="w-6 h-6"
                            fill="none"
                            stroke="currentColor"
                            viewBox="0 0 24 24"
                            aria-hidden="true"
                        >
                            <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                strokeWidth={2}
                                d="M6 18L18 6M6 6l12 12"
                            />
                        </svg>
                    </button>
                </div>

                {/* Modal Description (if provided) */}
                {description && (
                    <p id="modal-description" className="sr-only">
                        {description}
                    </p>
                )}

                {/* Modal Content */}
                <div className="p-6">{children}</div>
            </div>
        </div>
    );

    return createPortal(modalContent, document.body);
};

export default AccessibleModal;
