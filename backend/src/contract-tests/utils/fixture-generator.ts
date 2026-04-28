/**
 * Fixture Generator
 *
 * Generates canonical contract test fixtures from DTO/entity schemas.
 * Ensures fixtures stay in sync with source definitions.
 */

export interface FixtureField {
  type: string;
  nullable?: boolean;
  enum?: string[];
  example?: any;
}

export interface FixtureSchema {
  fields: Record<string, FixtureField>;
  required: string[];
}

export interface GeneratedFixture {
  schemaVersion: string;
  generatedAt: string;
  sourceName: string;
  schema: FixtureSchema;
  example: Record<string, any>;
  provenance: {
    generatedFrom: string;
    generatorVersion: string;
  };
}

/** Current generator version — bump when generation logic changes */
const GENERATOR_VERSION = '1.0.0';

/**
 * Generate a fixture from a plain schema definition.
 * Use this to create canonical fixtures from DTO/entity field maps.
 */
export function generateFixture(
  sourceName: string,
  schemaVersion: string,
  schema: FixtureSchema,
  exampleOverrides: Partial<Record<string, any>> = {},
): GeneratedFixture {
  const example = buildExample(schema, exampleOverrides);

  return {
    schemaVersion,
    generatedAt: new Date().toISOString(),
    sourceName,
    schema,
    example,
    provenance: {
      generatedFrom: sourceName,
      generatorVersion: GENERATOR_VERSION,
    },
  };
}

/**
 * Build an example payload from a schema definition.
 */
function buildExample(
  schema: FixtureSchema,
  overrides: Partial<Record<string, any>>,
): Record<string, any> {
  const example: Record<string, any> = {};

  for (const [field, def] of Object.entries(schema.fields)) {
    if (field in overrides) {
      example[field] = overrides[field];
      continue;
    }

    if (def.example !== undefined) {
      example[field] = def.example;
      continue;
    }

    if (def.nullable) {
      example[field] = null;
      continue;
    }

    example[field] = defaultForType(def);
  }

  return example;
}

function defaultForType(def: FixtureField): any {
  if (def.enum && def.enum.length > 0) return def.enum[0];

  switch (def.type) {
    case 'string': return 'example-string';
    case 'uuid': return '00000000-0000-0000-0000-000000000001';
    case 'number':
    case 'decimal':
    case 'float': return 0;
    case 'boolean': return false;
    case 'date':
    case 'timestamp': return new Date(0).toISOString();
    case 'object': return {};
    case 'array': return [];
    default: return null;
  }
}

/**
 * Validate a runtime payload against a generated fixture schema.
 * Returns errors for unknown or missing required fields.
 */
export function validatePayloadAgainstFixture(
  payload: Record<string, any>,
  fixture: GeneratedFixture,
): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  const payloadKeys = new Set(Object.keys(payload));
  const schemaKeys = new Set(Object.keys(fixture.schema.fields));

  // Missing required fields
  for (const required of fixture.schema.required) {
    if (!payloadKeys.has(required)) {
      errors.push(`MISSING_REQUIRED: field '${required}' is required but absent`);
    }
  }

  // Unknown fields (not in schema)
  for (const key of payloadKeys) {
    if (!schemaKeys.has(key)) {
      errors.push(`UNKNOWN_FIELD: field '${key}' is not in fixture schema v${fixture.schemaVersion}`);
    }
  }

  // Type mismatches for present fields
  for (const key of payloadKeys) {
    if (!schemaKeys.has(key)) continue;
    const def = fixture.schema.fields[key];
    const value = payload[key];

    if (value === null) {
      if (!def.nullable) {
        errors.push(`NULL_VIOLATION: field '${key}' is not nullable`);
      }
      continue;
    }

    if (def.enum && !def.enum.includes(String(value))) {
      errors.push(`ENUM_VIOLATION: field '${key}' value '${value}' not in allowed enum values`);
    }
  }

  return { valid: errors.length === 0, errors };
}
