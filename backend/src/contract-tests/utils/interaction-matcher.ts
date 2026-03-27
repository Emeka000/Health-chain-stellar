/**
 * Pact-Style Interaction Matcher
 *
 * Validates that service interactions match a frozen contract:
 * - Consumer expects provider to accept specific request format
 * - Provider guarantees to return response in specific format
 * - Breaking changes in either direction are detected
 *
 * Use for service-to-service boundaries.
 */

export interface InteractionRequest {
  method: string;
  path: string;
  headers?: Record<string, string>;
  body?: any;
  query?: Record<string, string>;
}

export interface InteractionResponse {
  status: number;
  headers?: Record<string, string>;
  body?: any;
}

export interface ServiceInteraction {
  name: string;
  consumer: string;
  provider: string;
  request: InteractionRequest;
  response: InteractionResponse;
}

export interface ServiceContract {
  name: string;
  version: string;
  interactions: ServiceInteraction[];
  timestamp: string;
}

/**
 * Validates an actual request/response against a contract
 */
export interface InteractionValidationResult {
  valid: boolean;
  interaction: ServiceInteraction;
  requestErrors: string[];
  responseErrors: string[];
}

/**
 * Deep equals with detailed diff reporting
 */
function deepEquals(
  actual: any,
  expected: any,
  path = 'root',
): { equal: boolean; errors: string[] } {
  const errors: string[] = [];

  if (typeof expected !== typeof actual) {
    errors.push(
      `BREAKING: Type mismatch at ${path}: expected ${typeof expected}, got ${typeof actual}`,
    );
    return { equal: false, errors };
  }

  if (expected === null || expected === undefined) {
    if (actual !== expected) {
      errors.push(
        `Value mismatch at ${path}: expected ${expected}, got ${actual}`,
      );
    }
    return { equal: errors.length === 0, errors };
  }

  if (typeof expected === 'object') {
    if (Array.isArray(expected)) {
      if (!Array.isArray(actual)) {
        errors.push(`Type mismatch at ${path}: expected array, got object`);
        return { equal: false, errors };
      }

      if (actual.length !== expected.length) {
        errors.push(
          `Array length at ${path}: expected ${expected.length}, got ${actual.length}`,
        );
      }

      for (let i = 0; i < Math.max(actual.length, expected.length); i++) {
        const item = deepEquals(actual[i], expected[i], `${path}[${i}]`);
        errors.push(...item.errors);
      }
    } else {
      const expectedKeys = Object.keys(expected).sort();
      const actualKeys = Object.keys(actual).sort();

      // Check for missing keys (breaking)
      for (const key of expectedKeys) {
        if (!actualKeys.includes(key)) {
          errors.push(`BREAKING: Required key '${key}' missing at ${path}`);
        }
      }

      // Check for extra keys (potentially breaking)
      for (const key of actualKeys) {
        if (!expectedKeys.includes(key)) {
          errors.push(
            `INFO: Unexpected key '${key}' at ${path} (may be non-breaking)`,
          );
        }
      }

      // Check existing keys
      for (const key of expectedKeys) {
        if (actualKeys.includes(key)) {
          const item = deepEquals(actual[key], expected[key], `${path}.${key}`);
          errors.push(...item.errors);
        }
      }
    }
  } else {
    // Primitive comparison
    if (actual !== expected) {
      errors.push(
        `Value mismatch at ${path}: expected ${expected}, got ${actual}`,
      );
    }
  }

  return { equal: errors.length === 0, errors };
}

/**
 * Validate an actual HTTP interaction against a contract
 */
export function validateInteraction(
  actualRequest: InteractionRequest,
  actualResponse: InteractionResponse,
  contract: ServiceInteraction,
): InteractionValidationResult {
  const requestErrors: string[] = [];
  const responseErrors: string[] = [];

  // Validate request
  if (actualRequest.method !== contract.request.method) {
    requestErrors.push(
      `Method mismatch: expected ${contract.request.method}, got ${actualRequest.method}`,
    );
  }

  if (actualRequest.path !== contract.request.path) {
    requestErrors.push(
      `Path mismatch: expected ${contract.request.path}, got ${actualRequest.path}`,
    );
  }

  if (contract.request.headers) {
    const headersCheck = deepEquals(
      actualRequest.headers,
      contract.request.headers,
    );
    requestErrors.push(...headersCheck.errors);
  }

  if (contract.request.body) {
    const bodyCheck = deepEquals(actualRequest.body, contract.request.body);
    requestErrors.push(...bodyCheck.errors);
  }

  if (contract.request.query) {
    const queryCheck = deepEquals(actualRequest.query, contract.request.query);
    requestErrors.push(...queryCheck.errors);
  }

  // Validate response
  if (actualResponse.status !== contract.response.status) {
    responseErrors.push(
      `BREAKING: Status mismatch: expected ${contract.response.status}, got ${actualResponse.status}`,
    );
  }

  if (contract.response.body) {
    const bodyCheck = deepEquals(actualResponse.body, contract.response.body);
    responseErrors.push(...bodyCheck.errors);
  }

  // Only count BREAKING errors as failures, INFO is just warnings
  const breakingRequestErrors = requestErrors.filter((e) =>
    e.includes('BREAKING'),
  );
  const breakingResponseErrors = responseErrors.filter((e) =>
    e.includes('BREAKING'),
  );

  return {
    valid:
      breakingRequestErrors.length === 0 && breakingResponseErrors.length === 0,
    interaction: contract,
    requestErrors,
    responseErrors,
  };
}

/**
 * Create a service interaction contract
 */
export function createInteraction(
  name: string,
  consumer: string,
  provider: string,
  request: InteractionRequest,
  response: InteractionResponse,
): ServiceInteraction {
  return { name, consumer, provider, request, response };
}

/**
 * Create a service contract with interactions
 */
export function createServiceContract(
  name: string,
  version: string,
  interactions: ServiceInteraction[],
): ServiceContract {
  return {
    name,
    version,
    interactions,
    timestamp: new Date().toISOString(),
  };
}
