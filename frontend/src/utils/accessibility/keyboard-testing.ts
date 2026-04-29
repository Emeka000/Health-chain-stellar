/**
 * Keyboard Testing Utilities
 * 
 * Utilities for testing keyboard accessibility
 */

/**
 * Simulate keyboard event
 */
export function simulateKeyPress(
    element: HTMLElement,
    key: string,
    options: Partial<KeyboardEventInit> = {},
): void {
    const event = new KeyboardEvent('keydown', {
        key,
        bubbles: true,
        cancelable: true,
        ...options,
    });

    element.dispatchEvent(event);
}

/**
 * Test if element is keyboard focusable
 */
export function isKeyboardFocusable(element: HTMLElement): boolean {
    const tabIndex = element.getAttribute('tabindex');

    // Elements with tabindex="-1" are programmatically focusable but not keyboard focusable
    if (tabIndex === '-1') return false;

    // Check if element is naturally focusable or has positive tabindex
    const naturallyFocusable = [
        'A',
        'BUTTON',
        'INPUT',
        'SELECT',
        'TEXTAREA',
    ].includes(element.tagName);

    const hasPositiveTabIndex = tabIndex !== null && parseInt(tabIndex, 10) >= 0;

    return naturallyFocusable || hasPositiveTabIndex;
}

/**
 * Get all keyboard focusable elements in order
 */
export function getKeyboardFocusableElements(
    container: HTMLElement = document.body,
): HTMLElement[] {
    const allElements = Array.from(
        container.querySelectorAll('*'),
    ) as HTMLElement[];

    return allElements
        .filter(isKeyboardFocusable)
        .sort((a, b) => {
            const aTabIndex = parseInt(a.getAttribute('tabindex') || '0', 10);
            const bTabIndex = parseInt(b.getAttribute('tabindex') || '0', 10);

            // Elements with positive tabindex come first, in order
            if (aTabIndex > 0 && bTabIndex > 0) {
                return aTabIndex - bTabIndex;
            }
            if (aTabIndex > 0) return -1;
            if (bTabIndex > 0) return 1;

            // Then natural tab order (DOM order)
            return 0;
        });
}

/**
 * Test focus trap
 */
export function testFocusTrap(container: HTMLElement): {
    isTrapped: boolean;
    issues: string[];
} {
    const focusableElements = getKeyboardFocusableElements(container);
    const issues: string[] = [];

    if (focusableElements.length === 0) {
        issues.push('No focusable elements found in container');
        return { isTrapped: false, issues };
    }

    // Test if focus stays within container
    const firstElement = focusableElements[0];
    const lastElement = focusableElements[focusableElements.length - 1];

    // Simulate Tab from last element
    lastElement.focus();
    simulateKeyPress(lastElement, 'Tab');

    if (document.activeElement !== firstElement) {
        issues.push('Focus does not wrap from last to first element');
    }

    // Simulate Shift+Tab from first element
    firstElement.focus();
    simulateKeyPress(firstElement, 'Tab', { shiftKey: true });

    if (document.activeElement !== lastElement) {
        issues.push('Focus does not wrap from first to last element');
    }

    return {
        isTrapped: issues.length === 0,
        issues,
    };
}

/**
 * Test keyboard navigation
 */
export function testKeyboardNavigation(container: HTMLElement): {
    passed: boolean;
    issues: string[];
} {
    const issues: string[] = [];
    const focusableElements = getKeyboardFocusableElements(container);

    if (focusableElements.length === 0) {
        issues.push('No keyboard focusable elements found');
        return { passed: false, issues };
    }

    // Test each focusable element
    for (const element of focusableElements) {
        // Check for visible focus indicator
        element.focus();
        const styles = window.getComputedStyle(element);
        const hasFocusIndicator =
            styles.outline !== 'none' ||
            styles.boxShadow !== 'none' ||
            element.classList.contains('focus:ring') ||
            element.classList.contains('focus:outline');

        if (!hasFocusIndicator) {
            issues.push(
                `Element ${element.tagName}${element.id ? `#${element.id}` : ''} lacks visible focus indicator`,
            );
        }

        // Check for accessible name
        const accessibleName =
            element.getAttribute('aria-label') ||
            element.getAttribute('aria-labelledby') ||
            element.textContent?.trim();

        if (!accessibleName && element.tagName === 'BUTTON') {
            issues.push(
                `Button ${element.id ? `#${element.id}` : ''} lacks accessible name`,
            );
        }
    }

    return {
        passed: issues.length === 0,
        issues,
    };
}

/**
 * Test ARIA attributes
 */
export function testAriaAttributes(container: HTMLElement): {
    passed: boolean;
    issues: string[];
} {
    const issues: string[] = [];

    // Check for required ARIA attributes
    const elementsWithRole = container.querySelectorAll('[role]');

    elementsWithRole.forEach((element) => {
        const role = element.getAttribute('role');

        // Check role-specific requirements
        switch (role) {
            case 'dialog':
            case 'alertdialog':
                if (!element.getAttribute('aria-labelledby') && !element.getAttribute('aria-label')) {
                    issues.push(`Dialog lacks aria-labelledby or aria-label`);
                }
                if (!element.getAttribute('aria-modal')) {
                    issues.push(`Dialog lacks aria-modal attribute`);
                }
                break;

            case 'button':
                if (!element.textContent?.trim() && !element.getAttribute('aria-label')) {
                    issues.push(`Button with role lacks accessible name`);
                }
                break;

            case 'listbox':
                const options = element.querySelectorAll('[role="option"]');
                if (options.length === 0) {
                    issues.push(`Listbox has no options`);
                }
                break;
        }
    });

    // Check for aria-invalid without error message
    const invalidElements = container.querySelectorAll('[aria-invalid="true"]');
    invalidElements.forEach((element) => {
        const describedBy = element.getAttribute('aria-describedby');
        if (!describedBy) {
            issues.push(
                `Element with aria-invalid lacks aria-describedby for error message`,
            );
        }
    });

    return {
        passed: issues.length === 0,
        issues,
    };
}

/**
 * Run all accessibility tests
 */
export function runAccessibilityTests(container: HTMLElement): {
    passed: boolean;
    results: {
        keyboardNavigation: ReturnType<typeof testKeyboardNavigation>;
        ariaAttributes: ReturnType<typeof testAriaAttributes>;
    };
} {
    const keyboardNavigation = testKeyboardNavigation(container);
    const ariaAttributes = testAriaAttributes(container);

    return {
        passed: keyboardNavigation.passed && ariaAttributes.passed,
        results: {
            keyboardNavigation,
            ariaAttributes,
        },
    };
}
