import { SENSITIVE_FIELD_SET, SensitivityCategory, SENSITIVE_FIELD_CATEGORY_MAP } from './sensitive-field-taxonomy';

/**
 * Minimum count threshold below which a bucket is suppressed entirely.
 * Protects against re-identification via low-count disclosures.
 */
export const LOW_COUNT_THRESHOLD = 5;

/**
 * Laplace noise scale for differential privacy on numeric aggregates.
 * ε = 1.0 gives a reasonable privacy/utility trade-off for public reporting.
 */
const LAPLACE_EPSILON = 1.0;

export interface RedactionResult<T> {
    data: T;
    /** Fields that were removed during redaction */
    redactedFields: string[];
    /** Fields that had noise applied */
    noisedFields: string[];
    /** Buckets suppressed due to low-count threshold */
    suppressedBuckets: string[];
}

export class RedactionEngine {
    /**
     * Deep-redact all sensitive fields from an arbitrary object.
     * Returns the cleaned object plus a manifest of what was removed.
     */
    static redact<T extends Record<string, unknown>>(
        input: T,
        allowedCategories: SensitivityCategory[] = [],
    ): RedactionResult<Partial<T>> {
        const redactedFields: string[] = [];
        const cleaned = RedactionEngine.redactDeep(input, allowedCategories, redactedFields, '');
        return { data: cleaned as Partial<T>, redactedFields, noisedFields: [], suppressedBuckets: [] };
    }

    private static redactDeep(
        obj: unknown,
        allowedCategories: SensitivityCategory[],
        redactedFields: string[],
        path: string,
    ): unknown {
        if (obj === null || obj === undefined) return obj;
        if (Array.isArray(obj)) {
            return obj.map((item) => RedactionEngine.redactDeep(item, allowedCategories, redactedFields, path));
        }
        if (typeof obj !== 'object') return obj;

        const result: Record<string, unknown> = {};
        for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
            const fieldPath = path ? `${path}.${key}` : key;
            if (SENSITIVE_FIELD_SET.has(key)) {
                const category = SENSITIVE_FIELD_CATEGORY_MAP.get(key)!;
                if (!allowedCategories.includes(category)) {
                    redactedFields.push(fieldPath);
                    continue; // drop the field
                }
            }
            result[key] = RedactionEngine.redactDeep(value, allowedCategories, redactedFields, fieldPath);
        }
        return result;
    }

    /**
     * Apply low-count threshold suppression to a record map.
     * Buckets with count < LOW_COUNT_THRESHOLD are replaced with a suppressed marker.
     */
    static applyThreshold(
        breakdown: Record<string, number>,
        threshold = LOW_COUNT_THRESHOLD,
    ): { result: Record<string, number | null>; suppressedBuckets: string[] } {
        const result: Record<string, number | null> = {};
        const suppressedBuckets: string[] = [];

        for (const [key, count] of Object.entries(breakdown)) {
            if (count < threshold) {
                result[key] = null; // suppressed — do not disclose exact count
                suppressedBuckets.push(key);
            } else {
                result[key] = count;
            }
        }

        return { result, suppressedBuckets };
    }

    /**
     * Add calibrated Laplace noise to a numeric value for differential privacy.
     * Sensitivity = 1 (count query). Noise scale = sensitivity / epsilon.
     *
     * The result is rounded to the nearest integer and clamped to ≥ 0.
     */
    static addLaplaceNoise(value: number, sensitivity = 1, epsilon = LAPLACE_EPSILON): number {
        const scale = sensitivity / epsilon;
        const noise = RedactionEngine.sampleLaplace(scale);
        return Math.max(0, Math.round(value + noise));
    }

    /**
     * Apply Laplace noise to all values in a numeric breakdown map.
     */
    static applyDifferentialPrivacy(
        breakdown: Record<string, number>,
        sensitivity = 1,
        epsilon = LAPLACE_EPSILON,
    ): { result: Record<string, number>; noisedFields: string[] } {
        const result: Record<string, number> = {};
        const noisedFields: string[] = [];

        for (const [key, value] of Object.entries(breakdown)) {
            result[key] = RedactionEngine.addLaplaceNoise(value, sensitivity, epsilon);
            noisedFields.push(key);
        }

        return { result, noisedFields };
    }

    /**
     * Sample from a Laplace distribution with given scale using the inverse CDF method.
     */
    private static sampleLaplace(scale: number): number {
        // Use two uniform samples for better numerical stability
        const u = Math.random() - 0.5;
        return -scale * Math.sign(u) * Math.log(1 - 2 * Math.abs(u));
    }

    /**
     * Verify that a serialised JSON string contains no sensitive field names.
     * Used in tests and pre-publication checks.
     */
    static assertNoPHILeakage(json: string): { clean: boolean; leakedFields: string[] } {
        const leakedFields: string[] = [];
        for (const field of SENSITIVE_FIELD_SET) {
            // Match as a JSON key: "fieldName":
            const pattern = new RegExp(`"${field}"\\s*:`);
            if (pattern.test(json)) {
                leakedFields.push(field);
            }
        }
        return { clean: leakedFields.length === 0, leakedFields };
    }
}
