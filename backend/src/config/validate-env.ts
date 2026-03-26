import { plainToInstance } from 'class-transformer';
import { validateSync, ValidationError } from 'class-validator';

import { EnvironmentVariables } from './env.schema';

/**
 * Formats a single ValidationError (including nested) into human-readable lines.
 */
function formatError(error: ValidationError, prefix = ''): string[] {
  const field = prefix ? `${prefix}.${error.property}` : error.property;

  if (error.constraints) {
    return Object.values(error.constraints).map(
      (msg) => `  ✗ ${field}: ${msg}`,
    );
  }

  // Nested errors
  if (error.children?.length) {
    return error.children.flatMap((child) => formatError(child, field));
  }

  return [`  ✗ ${field}: unknown validation error`];
}

/**
 * Validates raw process.env against the EnvironmentVariables schema.
 *
 * - Transforms string values to their declared types (number, boolean, etc.)
 * - Applies all class-validator rules
 * - On failure: logs a structured error report and throws
 * - On success: returns the fully-typed, validated config object
 *
 * Intended to be passed as the `validate` option to ConfigModule.forRoot().
 */
export function validateEnv(
  config: Record<string, unknown>,
): EnvironmentVariables {
  const validated = plainToInstance(EnvironmentVariables, config, {
    enableImplicitConversion: false,
    exposeDefaultValues: true,
  });

  const errors = validateSync(validated, {
    skipMissingProperties: false,
    whitelist: true,
    forbidUnknownValues: false,
  });

  if (errors.length > 0) {
    const lines = errors.flatMap((e) => formatError(e));

    const report = [
      '',
      '╔══════════════════════════════════════════════════════════════╗',
      '║          ENVIRONMENT VARIABLE VALIDATION FAILED              ║',
      '╚══════════════════════════════════════════════════════════════╝',
      '',
      `  ${errors.length} error(s) found. Application cannot start.`,
      '',
      ...lines,
      '',
      '  Fix the above variables in your .env file and restart.',
      '  See .env.example for reference values.',
      '',
    ].join('\n');

    // Write directly to stderr so it's visible even if the logger isn't up yet
    process.stderr.write(report + '\n');

    throw new Error('Environment validation failed — see output above.');
  }

  return validated;
}
