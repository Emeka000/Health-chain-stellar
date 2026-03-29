/**
 * Accessibility utilities for focus management, ARIA labels, and keyboard handling
 */

/**
 * Focus utilities
 */
export const focusUtils = {
  /**
   * Set focus to an element with optional scroll behavior
   */
  focus: (element: HTMLElement | null, options?: ScrollIntoViewOptions) => {
    if (element) {
      element.focus();
      if (options?.behavior) {
        element.scrollIntoView(options);
      }
    }
  },

  /**
   * Trap focus within an element (for modals)
   */
  trapFocus: (container: HTMLElement) => {
    const focusableElements = container.querySelectorAll<HTMLElement>(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    );

    if (focusableElements.length === 0) return () => {};

    const firstElement = focusableElements[0];
    const lastElement = focusableElements[focusableElements.length - 1];

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return;

      if (e.shiftKey) {
        if (document.activeElement === firstElement) {
          e.preventDefault();
          lastElement.focus();
        }
      } else {
        if (document.activeElement === lastElement) {
          e.preventDefault();
          firstElement.focus();
        }
      }
    };

    container.addEventListener('keydown', handleKeyDown);

    return () => {
      container.removeEventListener('keydown', handleKeyDown);
    };
  },

  /**
   * Manage initial focus for modals or dialogs
   */
  setInitialFocus: (container: HTMLElement, selector?: string) => {
    const element = selector
      ? container.querySelector<HTMLElement>(selector)
      : container.querySelector<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
        );

    if (element) {
      setTimeout(() => element.focus(), 0);
    }
  },
};

/**
 * ARIA label utilities
 */
export const ariaUtils = {
  /**
   * Get accessible label for button based on icon + context
   */
  getIconButtonLabel: (iconName: string, context?: string): string => {
    const labels: Record<string, string> = {
      close: 'Close',
      menu: 'Open menu',
      search: 'Search',
      delete: 'Delete',
      edit: 'Edit',
      save: 'Save',
      cancel: 'Cancel',
      add: 'Add',
      remove: 'Remove',
      expand: 'Expand',
      collapse: 'Collapse',
      download: 'Download',
      upload: 'Upload',
      sort: 'Sort',
      filter: 'Filter',
    };

    let label = labels[iconName] || iconName;
    if (context) {
      label = `${label} ${context}`;
    }
    return label;
  },

  /**
   * Create unique IDs for aria-labelledby and aria-describedby
   */
  createIds: (...suffixes: string[]): Record<string, string> => {
    const prefix = `a11y-${Date.now()}`;
    return suffixes.reduce(
      (acc, suffix) => {
        acc[suffix] = `${prefix}-${suffix}`;
        return acc;
      },
      {} as Record<string, string>
    );
  },

  /**
   * Build aria-describedby string from multiple IDs
   */
  buildDescribedBy: (...ids: (string | undefined)[]): string => {
    return ids.filter(Boolean).join(' ');
  },
};

/**
 * Keyboard utilities
 */
export const keyboardUtils = {
  /**
   * Check if a key event matches expected key(s)
   */
  isKey: (e: KeyboardEvent, ...keys: string[]): boolean => {
    return keys.includes(e.key);
  },

  /**
   * Stop propagation for handled keys
   */
  handleKey: (e: KeyboardEvent, handler: () => void, ...keys: string[]): void => {
    if (keyboardUtils.isKey(e, ...keys)) {
      e.preventDefault();
      e.stopPropagation();
      handler();
    }
  },

  /**
   * Keyboard shortcuts
   */
  shortcuts: {
    ENTER: 'Enter',
    ESCAPE: 'Escape',
    SPACE: ' ',
    TAB: 'Tab',
    ARROW_UP: 'ArrowUp',
    ARROW_DOWN: 'ArrowDown',
    ARROW_LEFT: 'ArrowLeft',
    ARROW_RIGHT: 'ArrowRight',
    HOME: 'Home',
    END: 'End',
    PAGE_UP: 'PageUp',
    PAGE_DOWN: 'PageDown',
  },
};

/**
 * Live region utilities for screen reader announcements
 */
export const liveRegionUtils = {
  /**
   * Create a live region element
   */
  createLiveRegion: (role: 'polite' | 'assertive' = 'polite'): HTMLElement => {
    const region = document.createElement('div');
    region.setAttribute('role', 'status');
    region.setAttribute('aria-live', role);
    region.setAttribute('aria-atomic', 'true');
    region.className = 'sr-only'; // Screen reader only
    document.body.appendChild(region);
    return region;
  },

  /**
   * Announce message to screen readers
   */
  announce: (message: string, role: 'polite' | 'assertive' = 'polite') => {
    const region = document.querySelector(`[role="status"][aria-live="${role}"]`) ||
      liveRegionUtils.createLiveRegion(role);
    region.textContent = message;

    // Clear after announcement to avoid redundant readings
    setTimeout(() => {
      region.textContent = '';
    }, 1000);
  },
};

/**
 * Screen reader only content class
 */
export const srOnly = `
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border-width: 0;
`;

/**
 * Skip link utilities
 */
export const skipLinkUtils = {
  /**
   * Focus main content with skip link
   */
  skipToMain: (mainSelector = 'main') => {
    const main = document.querySelector(mainSelector);
    if (main instanceof HTMLElement) {
      main.setAttribute('tabindex', '-1');
      focusUtils.focus(main, { behavior: 'smooth' });
      main.addEventListener('blur', () => {
        main.removeAttribute('tabindex');
      });
    }
  },
};

/**
 * Color contrast utilities
 */
export const contrastUtils = {
  /**
   * Check if contrast ratio meets WCAG AA standard
   * Normal text: 4.5:1, Large text: 3:1
   */
  meetsWCAGAA: (ratio: number, isLargeText = false): boolean => {
    return isLargeText ? ratio >= 3 : ratio >= 4.5;
  },

  /**
   * WCAG compliant color combinations
   */
  wcagCompliant: {
    lightText: '#FFFFFF',
    darkText: '#000000',
    vibrancy: {
      blue: '#0066CC',
      red: '#D13212',
      green: '#107C10',
      orange: '#FF8C00',
      purple: '#6B21A8',
    },
  },
};
