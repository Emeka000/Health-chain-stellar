import { Injectable } from '@nestjs/common';

/**
 * Backend localization service
 * Handles server-side message localization for API responses
 */
@Injectable()
export class LocalizationService {
  private supportedLanguages = ['en', 'fr'];
  private defaultLanguage = 'en';

  /**
   * Messages that can be returned by the API
   * Used for localizing system messages, status descriptions, etc.
   */
  private messages: Record<string, Record<string, string>> = {
    // Order statuses
    order_status_pending: {
      en: 'Pending',
      fr: 'En attente',
    },
    order_status_confirmed: {
      en: 'Confirmed',
      fr: 'Confirmée',
    },
    order_status_dispatched: {
      en: 'Dispatched',
      fr: 'Expédiée',
    },
    order_status_delivered: {
      en: 'Delivered',
      fr: 'Livrée',
    },
    order_status_cancelled: {
      en: 'Cancelled',
      fr: 'Annulée',
    },

    // Dispatch statuses
    dispatch_status_pending: {
      en: 'Pending',
      fr: 'En attente',
    },
    dispatch_status_picked_up: {
      en: 'Picked Up',
      fr: 'Récupéré',
    },
    dispatch_status_in_transit: {
      en: 'In Transit',
      fr: 'En transit',
    },
    dispatch_status_delivered: {
      en: 'Delivered',
      fr: 'Livré',
    },
    dispatch_status_failed: {
      en: 'Delivery Failed',
      fr: 'Livraison échouée',
    },

    // Blood unit conditions
    blood_unit_condition_good: {
      en: 'Good',
      fr: 'Bon',
    },
    blood_unit_condition_damaged: {
      en: 'Damaged',
      fr: 'Endommagé',
    },
    blood_unit_condition_compromised: {
      en: 'Compromised',
      fr: 'Compromis',
    },

    // Request urgency
    request_urgency_low: {
      en: 'Low',
      fr: 'Faible',
    },
    request_urgency_medium: {
      en: 'Medium',
      fr: 'Moyen',
    },
    request_urgency_high: {
      en: 'High',
      fr: 'Élevée',
    },
    request_urgency_critical: {
      en: 'Critical',
      fr: 'Critique',
    },

    // Blood types
    blood_type_a_positive: {
      en: 'A+',
      fr: 'A+',
    },
    blood_type_a_negative: {
      en: 'A-',
      fr: 'A-',
    },
    blood_type_b_positive: {
      en: 'B+',
      fr: 'B+',
    },
    blood_type_b_negative: {
      en: 'B-',
      fr: 'B-',
    },
    blood_type_ab_positive: {
      en: 'AB+',
      fr: 'AB+',
    },
    blood_type_ab_negative: {
      en: 'AB-',
      fr: 'AB-',
    },
    blood_type_o_positive: {
      en: 'O+',
      fr: 'O+',
    },
    blood_type_o_negative: {
      en: 'O-',
      fr: 'O-',
    },

    // Generic messages
    success: {
      en: 'Success',
      fr: 'Succès',
    },
    error: {
      en: 'Error',
      fr: 'Erreur',
    },
    processing: {
      en: 'Processing...',
      fr: 'Traitement en cours...',
    },
    not_available: {
      en: 'Not available',
      fr: 'Non disponible',
    },
  };

  /**
   * Get normalized language code
   */
  normalizeLanguage(lang?: string): string {
    if (!lang) return this.defaultLanguage;

    const normalized = lang.toLowerCase().split('-')[0];
    return this.supportedLanguages.includes(normalized)
      ? normalized
      : this.defaultLanguage;
  }

  /**
   * Get localized message
   */
  getMessage(key: string, language?: string, fallback?: string): string {
    const lang = this.normalizeLanguage(language);
    return this.messages[key]?.[lang] || fallback || key;
  }

  /**
   * Get multiple messages at once
   */
  getMessages(
    keys: string[],
    language?: string
  ): Record<string, string> {
    const lang = this.normalizeLanguage(language);
    return keys.reduce(
      (acc, key) => {
        acc[key] = this.getMessage(key, lang);
        return acc;
      },
      {} as Record<string, string>
    );
  }

  /**
   * Check if language is supported
   */
  isSupportedLanguage(language?: string): boolean {
    if (!language) return true;
    return this.supportedLanguages.includes(this.normalizeLanguage(language));
  }

  /**
   * Get all supported languages
   */
  getSupportedLanguages(): string[] {
    return this.supportedLanguages;
  }

  /**
   * Add custom messages for a module
   */
  addMessages(messageMap: Record<string, Record<string, string>>): void {
    Object.assign(this.messages, messageMap);
  }

  /**
   * Localize an array of objects with a specific field
   */
  localizeArray<T extends Record<string, any>>(
    items: T[],
    fieldKey: string,
    language?: string
  ): T[] {
    return items.map((item) => ({
      ...item,
      [fieldKey]: this.getMessage(
        `${fieldKey}_${item[fieldKey]}`,
        language,
        item[fieldKey]
      ),
    }));
  }

  /**
   * Create a localization middleware response
   * Includes language-specific metadata
   */
  createLocalizedResponse<T>(
    data: T,
    language?: string,
    metadata?: any
  ): {
    data: T;
    language: string;
    supportedLanguages: string[];
    metadata?: any;
  } {
    return {
      data,
      language: this.normalizeLanguage(language),
      supportedLanguages: this.supportedLanguages,
      metadata,
    };
  }
}
