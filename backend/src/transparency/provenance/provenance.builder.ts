import * as crypto from 'crypto';

export interface TransformationRule {
    field: string;
    transformation: 'REDACTED' | 'AGGREGATED' | 'THRESHOLDED' | 'NOISED' | 'SUPPRESSED';
    reason: string;
}

export interface ProvenanceMetadata {
    /** Unique publication artifact ID */
    artifactId: string;
    /** ISO-8601 timestamp of generation */
    generatedAt: string;
    /** Schema version of this publication contract */
    schemaVersion: string;
    /** Data sources that contributed to this artifact */
    sources: string[];
    /** Ordered list of transformations applied */
    transformations: TransformationRule[];
    /** Fields removed from the raw data */
    redactedFields: string[];
    /** Buckets suppressed due to low-count threshold */
    suppressedBuckets: string[];
    /** Fields that had differential privacy noise applied */
    noisedFields: string[];
    /** SHA-256 digest of the published payload (for tamper detection) */
    payloadDigest: string;
    /** Minimum count threshold used for suppression */
    lowCountThreshold: number;
    /** Differential privacy epsilon used */
    privacyEpsilon: number;
}

export class ProvenanceBuilder {
    private readonly sources: string[] = [];
    private readonly transformations: TransformationRule[] = [];
    private redactedFields: string[] = [];
    private suppressedBuckets: string[] = [];
    private noisedFields: string[] = [];
    private readonly schemaVersion: string;
    private readonly lowCountThreshold: number;
    private readonly privacyEpsilon: number;

    constructor(options: {
        schemaVersion?: string;
        lowCountThreshold?: number;
        privacyEpsilon?: number;
    } = {}) {
        this.schemaVersion = options.schemaVersion ?? '1.0.0';
        this.lowCountThreshold = options.lowCountThreshold ?? 5;
        this.privacyEpsilon = options.privacyEpsilon ?? 1.0;
    }

    addSource(source: string): this {
        this.sources.push(source);
        return this;
    }

    addTransformation(rule: TransformationRule): this {
        this.transformations.push(rule);
        return this;
    }

    setRedactedFields(fields: string[]): this {
        this.redactedFields = fields;
        return this;
    }

    setSuppressedBuckets(buckets: string[]): this {
        this.suppressedBuckets = buckets;
        return this;
    }

    setNoisedFields(fields: string[]): this {
        this.noisedFields = fields;
        return this;
    }

    build(payload: unknown): ProvenanceMetadata {
        const payloadDigest = crypto
            .createHash('sha256')
            .update(JSON.stringify(payload))
            .digest('hex');

        return {
            artifactId: crypto.randomUUID(),
            generatedAt: new Date().toISOString(),
            schemaVersion: this.schemaVersion,
            sources: [...this.sources],
            transformations: [...this.transformations],
            redactedFields: [...this.redactedFields],
            suppressedBuckets: [...this.suppressedBuckets],
            noisedFields: [...this.noisedFields],
            payloadDigest,
            lowCountThreshold: this.lowCountThreshold,
            privacyEpsilon: this.privacyEpsilon,
        };
    }
}
