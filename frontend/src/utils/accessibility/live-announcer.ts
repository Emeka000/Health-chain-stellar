/**
 * Live Announcer
 * 
 * Announces messages to screen readers using ARIA live regions
 */

export enum AnnouncementPriority {
    POLITE = 'polite',
    ASSERTIVE = 'assertive',
}

class LiveAnnouncer {
    private liveRegion: HTMLElement | null = null;
    private assertiveRegion: HTMLElement | null = null;

    constructor() {
        this.createLiveRegions();
    }

    /**
     * Create ARIA live regions
     */
    private createLiveRegions(): void {
        // Polite live region
        this.liveRegion = document.createElement('div');
        this.liveRegion.setAttribute('aria-live', 'polite');
        this.liveRegion.setAttribute('aria-atomic', 'true');
        this.liveRegion.setAttribute('aria-relevant', 'additions text');
        this.liveRegion.className = 'sr-only';
        this.liveRegion.style.position = 'absolute';
        this.liveRegion.style.left = '-10000px';
        this.liveRegion.style.width = '1px';
        this.liveRegion.style.height = '1px';
        this.liveRegion.style.overflow = 'hidden';

        // Assertive live region
        this.assertiveRegion = document.createElement('div');
        this.assertiveRegion.setAttribute('aria-live', 'assertive');
        this.assertiveRegion.setAttribute('aria-atomic', 'true');
        this.assertiveRegion.setAttribute('aria-relevant', 'additions text');
        this.assertiveRegion.className = 'sr-only';
        this.assertiveRegion.style.position = 'absolute';
        this.assertiveRegion.style.left = '-10000px';
        this.assertiveRegion.style.width = '1px';
        this.assertiveRegion.style.height = '1px';
        this.assertiveRegion.style.overflow = 'hidden';

        document.body.appendChild(this.liveRegion);
        document.body.appendChild(this.assertiveRegion);
    }

    /**
     * Announce a message to screen readers
     */
    announce(
        message: string,
        priority: AnnouncementPriority = AnnouncementPriority.POLITE,
    ): void {
        const region =
            priority === AnnouncementPriority.ASSERTIVE
                ? this.assertiveRegion
                : this.liveRegion;

        if (!region) return;

        // Clear previous message
        region.textContent = '';

        // Announce new message after a brief delay to ensure screen readers pick it up
        setTimeout(() => {
            region.textContent = message;
        }, 100);

        // Clear message after announcement
        setTimeout(() => {
            region.textContent = '';
        }, 5000);
    }

    /**
     * Announce validation error
     */
    announceError(message: string): void {
        this.announce(`Error: ${message}`, AnnouncementPriority.ASSERTIVE);
    }

    /**
     * Announce success message
     */
    announceSuccess(message: string): void {
        this.announce(`Success: ${message}`, AnnouncementPriority.POLITE);
    }

    /**
     * Announce loading state
     */
    announceLoading(message: string = 'Loading'): void {
        this.announce(message, AnnouncementPriority.POLITE);
    }

    /**
     * Announce navigation
     */
    announceNavigation(pageName: string): void {
        this.announce(`Navigated to ${pageName}`, AnnouncementPriority.POLITE);
    }

    /**
     * Announce form validation errors
     */
    announceValidationErrors(errors: Array<{ field: string; message: string }>): void {
        const errorCount = errors.length;
        const message =
            errorCount === 1
                ? `1 validation error: ${errors[0].message}`
                : `${errorCount} validation errors found. Please review the form.`;

        this.announceError(message);
    }

    /**
     * Announce status update
     */
    announceStatus(status: string, priority: AnnouncementPriority = AnnouncementPriority.POLITE): void {
        this.announce(`Status: ${status}`, priority);
    }

    /**
     * Cleanup live regions
     */
    destroy(): void {
        if (this.liveRegion) {
            document.body.removeChild(this.liveRegion);
            this.liveRegion = null;
        }
        if (this.assertiveRegion) {
            document.body.removeChild(this.assertiveRegion);
            this.assertiveRegion = null;
        }
    }
}

// Singleton instance
let announcer: LiveAnnouncer | null = null;

/**
 * Get the live announcer instance
 */
export function getLiveAnnouncer(): LiveAnnouncer {
    if (!announcer) {
        announcer = new LiveAnnouncer();
    }
    return announcer;
}

/**
 * Announce a message
 */
export function announce(
    message: string,
    priority: AnnouncementPriority = AnnouncementPriority.POLITE,
): void {
    getLiveAnnouncer().announce(message, priority);
}

/**
 * Announce error
 */
export function announceError(message: string): void {
    getLiveAnnouncer().announceError(message);
}

/**
 * Announce success
 */
export function announceSuccess(message: string): void {
    getLiveAnnouncer().announceSuccess(message);
}

/**
 * Announce loading
 */
export function announceLoading(message?: string): void {
    getLiveAnnouncer().announceLoading(message);
}

/**
 * Announce validation errors
 */
export function announceValidationErrors(
    errors: Array<{ field: string; message: string }>,
): void {
    getLiveAnnouncer().announceValidationErrors(errors);
}
