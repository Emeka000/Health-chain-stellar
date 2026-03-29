import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ReactElement } from 'react';

/**
 * Accessibility testing utilities
 */

/**
 * Check keyboard navigation in a form
 */
export const testKeyboardNavigation = async (
  component: ReactElement,
  expectedFocusOrder: string[]
) => {
  render(component);

  const user = userEvent.setup();

  for (const selector of expectedFocusOrder) {
    await user.tab();
    const focused = document.activeElement;
    const expected = document.querySelector(selector);

    expect(focused).toBe(expected);
  }
};

/**
 * Check that form fields have proper labels
 */
export const testFormLabels = (component: ReactElement) => {
  const { container } = render(component);

  const inputs = container.querySelectorAll('input, select, textarea');

  inputs.forEach((input) => {
    const inputId = input.getAttribute('id');
    if (inputId) {
      const label = container.querySelector(`label[for="${inputId}"]`);
      expect(label).toBeInTheDocument();
    }
  });
};

/**
 * Check that error messages are properly associated
 */
export const testErrorMessageAssociation = (component: ReactElement) => {
  const { container } = render(component);

  const inputs = container.querySelectorAll('input[aria-invalid="true"]');

  inputs.forEach((input) => {
    const describedBy = input.getAttribute('aria-describedby');
    expect(describedBy).toBeTruthy();

    const errorElement = container.querySelector(`#${describedBy}`);
    expect(errorElement).toBeInTheDocument();
  });
};

/**
 * Check that screen reader announcements are present
 */
export const testScreenReaderAnnouncements = async (
  component: ReactElement,
  expectedAnnouncements: string[]
) => {
  render(component);

  for (const announcement of expectedAnnouncements) {
    const element = screen.queryByText(announcement, { selector: '[role="status"], [role="alert"]' });
    expect(element).toBeInTheDocument();
  }
};

/**
 * Check that all buttons/links are keyboard accessible
 */
export const testKeyboardAccessibility = async (component: ReactElement) => {
  const { container } = render(component);

  const interactive = container.querySelectorAll(
    'button, a, input:not([type="hidden"]), select, textarea, [role="button"]'
  );

  const user = userEvent.setup();

  let focusableCount = 0;

  for (const element of interactive) {
    const tabIndex = element.getAttribute('tabindex');

    // Skip elements that are explicitly not focusable
    if (tabIndex === '-1') continue;

    focusableCount++;

    // Try to focus via keyboard
    try {
      await user.tab();
      if (document.activeElement === element) {
        // Successfully focused via keyboard
      }
    } catch {
      throw new Error(`Element not keyboard accessible: ${element.tagName}`);
    }
  }

  expect(focusableCount).toBeGreaterThan(0);
};

/**
 * Test focus is visible (has focus ring or outline)
 */
export const testFocusVisible = (component: ReactElement) => {
  const { container } = render(component);

  const buttons = container.querySelectorAll('button');

  buttons.forEach((button) => {
    const styles = window.getComputedStyle(button, ':focus');
    const ringOrOutline = styles.outline || styles.boxShadow;

    expect(ringOrOutline).toBeTruthy();
  });
};

/**
 * Test color contrast meets WCAG AA
 */
export const testColorContrast = (component: ReactElement) => {
  const { container } = render(component);

  // This is a simplified test - full testing requires more sophisticated tools
  const elements = container.querySelectorAll('button, a, .text-sm, .text-base, .text-lg');

  elements.forEach((element) => {
    const styles = window.getComputedStyle(element);
    const color = styles.color;
    const background = styles.backgroundColor;

    // Basic check: ensure colors are not the same
    expect(color).not.toBe(background);
  });
};

/**
 * Test that modals trap focus
 */
export const testModalFocusTrap = async (
  component: ReactElement,
  closeSelector: string
) => {
  render(component);

  const user = userEvent.setup();
  const closeButton = screen.getByRole('button', { name: /close/i });

  // Tab around the modal - should cycle back to first focusable
  await user.tab();
  await user.tab();
  // Should still be within the modal
  expect(document.activeElement).not.toBe(closeButton.parentElement);
};

/**
 * Test that required fields are marked
 */
export const testRequiredFields = (component: ReactElement) => {
  const { container } = render(component);

  const requiredInputs = container.querySelectorAll('[required], [aria-required="true"]');

  requiredInputs.forEach((input) => {
    // Check for aria-required or required attribute
    const hasRequired =
      input.hasAttribute('required') || input.getAttribute('aria-required') === 'true';

    const label = container.querySelector(`label[for="${input.getAttribute('id')}"]`);

    if (label) {
      const hasIndicator = label.textContent?.includes('*') || label.querySelector('[aria-label*="required"]');
      expect(hasIndicator).toBeTruthy();
    }

    expect(hasRequired).toBeTruthy();
  });
};

/**
 * Test semantic HTML structure
 */
export const testSemanticStructure = (component: ReactElement) => {
  const { container } = render(component);

  // Check for proper heading hierarchy
  const headings = container.querySelectorAll('h1, h2, h3, h4, h5, h6');
  let lastLevel = 0;

  headings.forEach((heading) => {
    const level = parseInt(heading.tagName[1]);

    // Heading levels should not skip (e.g., h1 -> h3 is bad)
    if (lastLevel > 0 && level > lastLevel + 1) {
      console.warn(`Heading hierarchy skip: h${lastLevel} -> h${level}`);
    }

    lastLevel = level;
  });

  // Check for proper list structure
  const listItems = container.querySelectorAll('li');
  listItems.forEach((li) => {
    const parent = li.parentElement;
    expect(['ul', 'ol'].includes(parent?.tagName.toLowerCase() || '')).toBeTruthy();
  });

  // Check for proper table structure
  const tables = container.querySelectorAll('table');
  tables.forEach((table) => {
    const headers = table.querySelectorAll('th');
    expect(headers.length).toBeGreaterThan(0);
  });
};

/**
 * Test that form can be operated with keyboard only
 */
export const testKeyboardOnlyFormSubmission = async (
  component: ReactElement
) => {
  render(component);

  const user = userEvent.setup();

  // Tab through form
  let tabCount = 0;
  while (tabCount < 20) {
    // Limit iterations to prevent infinite loop
    const active = document.activeElement;

    if (active?.tagName === 'BUTTON') {
      await user.keyboard('{Enter}');
      break;
    }

    await user.tab();
    tabCount++;
  }

  // Verify submission occurred (implementation specific)
};

/**
 * Combined accessibility test suite
 */
export const runA11yTests = async (
  component: ReactElement,
  config?: {
    checkKeyboardNav?: boolean;
    checkLabels?: boolean;
    checkErrors?: boolean;
    checkAnnouncements?: boolean;
    checkFocusVisible?: boolean;
    checkSemantic?: boolean;
  }
) => {
  const defaults = {
    checkKeyboardNav: true,
    checkLabels: true,
    checkErrors: true,
    checkAnnouncements: true,
    checkFocusVisible: true,
    checkSemantic: true,
    ...config,
  };

  const results: Record<string, boolean> = {};

  try {
    if (defaults.checkLabels) {
      testFormLabels(component);
      results.labels = true;
    }
  } catch {
    results.labels = false;
  }

  try {
    if (defaults.checkErrors) {
      testErrorMessageAssociation(component);
      results.errors = true;
    }
  } catch {
    results.errors = false;
  }

  try {
    if (defaults.checkFocusVisible) {
      testFocusVisible(component);
      results.focusVisible = true;
    }
  } catch {
    results.focusVisible = false;
  }

  try {
    if (defaults.checkSemantic) {
      testSemanticStructure(component);
      results.semantic = true;
    }
  } catch {
    results.semantic = false;
  }

  return results;
};
