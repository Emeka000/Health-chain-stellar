import { Injectable, Logger } from '@nestjs/common';
import Ajv, { ValidateFunction } from 'ajv';
import addFormats from 'ajv-formats';
import { EventSchemaDefinition } from './canonical-event.envelope';

/**
 * Event Schema Registry
 * 
 * Manages event schemas and validates event payloads
 */
@Injectable()
export class EventSchemaRegistryService {
    private readonly logger = new Logger(EventSchemaRegistryService.name);
    private readonly schemas = new Map<string, EventSchemaDefinition>();
    private readonly validators = new Map<string, ValidateFunction>();
    private readonly ajv: Ajv;

    constructor() {
        this.ajv = new Ajv({ allErrors: true, strict: false });
        addFormats(this.ajv);
    }

    /**
     * Register an event schema
     */
    registerSchema(schema: EventSchemaDefinition): void {
        const key = this.getSchemaKey(schema.eventType, schema.schemaVersion);

        if (this.schemas.has(key)) {
            this.logger.warn(
                `Schema already registered: ${schema.eventType}@${schema.schemaVersion}`,
            );
            return;
        }

        this.schemas.set(key, schema);

        // Compile validator
        try {
            const validator = this.ajv.compile(schema.payloadSchema);
            this.validators.set(key, validator);
            this.logger.log(
                `Registered schema: ${schema.eventType}@${schema.schemaVersion}`,
            );
        } catch (error) {
            this.logger.error(
                `Failed to compile schema: ${schema.eventType}@${schema.schemaVersion}`,
                error,
            );
            throw error;
        }
    }

    /**
     * Register multiple schemas
     */
    registerSchemas(schemas: EventSchemaDefinition[]): void {
        for (const schema of schemas) {
            this.registerSchema(schema);
        }
    }

    /**
     * Validate event payload against schema
     */
    validate(
        eventType: string,
        schemaVersion: string,
        payload: unknown,
    ): { valid: boolean; errors?: unknown[] } {
        const key = this.getSchemaKey(eventType, schemaVersion);
        const validator = this.validators.get(key);

        if (!validator) {
            this.logger.warn(
                `No schema registered for: ${eventType}@${schemaVersion}`,
            );
            return {
                valid: false,
                errors: [
                    {
                        message: `No schema registered for ${eventType}@${schemaVersion}`,
                    },
                ],
            };
        }

        const valid = validator(payload);

        if (!valid) {
            return {
                valid: false,
                errors: validator.errors || [],
            };
        }

        return { valid: true };
    }

    /**
     * Get schema definition
     */
    getSchema(eventType: string, schemaVersion: string): EventSchemaDefinition | undefined {
        const key = this.getSchemaKey(eventType, schemaVersion);
        return this.schemas.get(key);
    }

    /**
     * Get all registered schemas
     */
    getAllSchemas(): EventSchemaDefinition[] {
        return Array.from(this.schemas.values());
    }

    /**
     * Check if schema exists
     */
    hasSchema(eventType: string, schemaVersion: string): boolean {
        const key = this.getSchemaKey(eventType, schemaVersion);
        return this.schemas.has(key);
    }

    /**
     * Get all versions for an event type
     */
    getVersions(eventType: string): string[] {
        const versions: string[] = [];
        for (const [key, schema] of this.schemas.entries()) {
            if (schema.eventType === eventType) {
                versions.push(schema.schemaVersion);
            }
        }
        return versions.sort();
    }

    /**
     * Get latest version for an event type
     */
    getLatestVersion(eventType: string): string | undefined {
        const versions = this.getVersions(eventType);
        return versions.length > 0 ? versions[versions.length - 1] : undefined;
    }

    /**
     * Generate schema key
     */
    private getSchemaKey(eventType: string, schemaVersion: string): string {
        return `${eventType}@${schemaVersion}`;
    }
}
