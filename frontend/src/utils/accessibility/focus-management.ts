/**
 * Focus Management Utilities
 * 
 * Utilities for managing focus in accessible web applications
 */

/**
 * Get all focusable elements within a container
 */
export function getFocusableElements(container: HTMLElement): HTMLElement[] {
    const focusableSelectors = [
        'a[href]',
        'button:not([disabled])',
        'textarea:not([disabled])',
        'input:not([disabled])',
        'select:not([disabled])',
        '[tabindex]:not([tabindex="-1"])',
        '[contenteditable="true"]',
    ].join(', ');

    return Array.from(container.querySelectorAll(focusableSelectors)).filter(
        (element) => {
            // Check if element is visible
            const style = window.getComputedStyle(element);
            return (
                style.display !== 'none' &&
                style.visibility !== 'hidden' &&
                (element as HTMLElement).offsetParent !== null
            );
        },
    ) as HTMLElement[];
}

/**
 * Trap focus within a container (for modals, dialogs)
 */
export function trapFocus(container: HTMLElement): () => void {
    const focusableElements = getFocusableElements(container);
    const firstFocusable = focusableElements[0];
    const lastFocusable = focusableElements[focusableElements.length - 1];

    // Store previously focused element
    const previouslyFocused = document.activeElement as HTMLElement;

    // Focus first element
    firstFocusable?.focus();

    const handleKeyDown = (event: KeyboardEvent) => {
        if (event.key !== 'Tab') return;

        if (event.shiftKey) {
            // Shift + Tab
            if (document.activeElement === firstFocusable) {
                event.preventDefault();
                lastFocusable?.focus();
            }
        } else {
            // Tab
            if (document.activeElement === lastFocusable) {
                event.preventDefault();
                firstFocusable?.focus();
            }
        }
    };

    container.addEventListener('keydown', handleKeyDown);

    // Return cleanup function
    return () => {
        container.removeEventListener('keydown', handleKeyDown);
        previouslyFocused?.focus();
    };
}

/**
 * Focus first error in a form
 */
export function focusFirstError(container: HTMLElement): boolean {
    const errorElement = container.querySelector(
        '[aria-invalid="true"], .error-field, [data-error="true"]',
    ) as HTMLElement;

    if (errorElement) {
        errorElement.focus();
        return true;
    }

    return false;
}

/**
 * Manage focus for route navigation
 */
export function manageFocusOnRouteChange(targetElement?: HTMLElement): void {
    const target =
        targetElement ||
        (document.querySelector('main') as HTMLElement) ||
        (document.querySelector('#root') as HTMLElement);

    if (target) {
        // Set tabindex temporarily to make it focusable
        const originalTabIndex = target.getAttribute('tabindex');
        target.setAttribute('tabindex', '-1');
        target.focus();

        // Remove tabindex after focus
        if (originalTabIndex === null) {
            target.removeAttribute('tabindex');
        } else {
            target.setAttribute('tabindex', originalTabIndex);
        }
    }
}

/**
 * Create a focus guard for preventing focus escape
 */
export function createFocusGuard(): HTMLElement {
    const guard = document.createElement('div');
    guard.setAttribute('tabindex', '0');
    guard.setAttribute('aria-hidden', 'true');
    guard.style.position = 'fixed';
    guard.style.opacity = '0';
    guard.style.pointerEvents = 'none';
    return guard;
}

/**
 * Restore focus to a previously focused element
 */
export function restoreFocus(element: HTMLElement | null): void {
    if (element && document.body.contains(element)) {
        element.focus();
    }
}

/**
 * Check if element is focusable
 */
export function isFocusable(element: HTMLElement): boolean {
    const focusableElements = getFocusableElements(document.body);
    return focusableElements.includes(element);
}

/**
 * Get next focusable element
 */
export function getNextFocusable(
    current: HTMLElement,
    container: HTMLElement = document.body,
): HTMLElement | null {
    const focusableElements = getFocusableElements(container);
    const currentIndex = focusableElements.indexOf(current);

    if (currentIndex === -1) return null;

    return focusableElements[currentIndex + 1] || focusableElements[0];
}

/**
 * Get previous focusable element
 */
export function getPreviousFocusable(
    current: HTMLElement,
    container: HTMLElement = document.body,
): HTMLElement | null {
    const focusableElements = getFocusableElements(container);
    const currentIndex = focusableElements.indexOf(current);

    if (currentIndex === -1) return null;

    return (
        focusableElements[currentIndex - 1] ||
        focusableElements[focusableElements.length - 1]
    );
}
