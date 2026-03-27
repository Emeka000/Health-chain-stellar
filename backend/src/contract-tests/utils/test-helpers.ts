/**
 * Contract Testing Utilities
 *
 * Common helpers for contract tests. Includes:
 * - Mock providers for testing consumers
 * - Assertion builders
 * - Test data builders
 */

import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';

/**
 * Create a mock provider for contract testing
 *
 * Use when testing a consumer to verify it calls the provider correctly
 */
export function createMockProvider() {
  const calls: any[] = [];
  const responses: Map<string, any> = new Map();

  return {
    /**
     * Mock a response for a specific route
     */
    mockResponse: (method: string, path: string, response: any) => {
      responses.set(`${method}:${path}`, response);
    },

    /**
     * Get the handler for this request
     */
    getHandler: (method: string, path: string) => {
      return responses.get(`${method}:${path}`);
    },

    /**
     * Record a call to this provider
     */
    recordCall: (method: string, path: string, body?: any, query?: any) => {
      calls.push({ method, path, body, query, timestamp: Date.now() });
    },

    /**
     * Get all recorded calls
     */
    getCalls: () => calls,

    /**
     * Verify a call was made
     */
    verifyCalled: (method: string, path: string) => {
      const found = calls.find((c) => c.method === method && c.path === path);
      if (!found) {
        throw new Error(
          `Provider not called with ${method} ${path}. Calls: ${JSON.stringify(calls)}`,
        );
      }
      return found;
    },

    /**
     * Verify a call was NOT made
     */
    verifyNotCalled: (method: string, path: string) => {
      const found = calls.find((c) => c.method === method && c.path === path);
      if (found) {
        throw new Error(`Provider unexpectedly called with ${method} ${path}`);
      }
    },

    /**
     * Clear all recorded calls
     */
    reset: () => {
      calls.length = 0;
      responses.clear();
    },
  };
}

/**
 * Wait for async condition with timeout
 */
export async function waitFor(
  condition: () => boolean,
  timeoutMs = 5000,
  intervalMs = 100,
): Promise<void> {
  const start = Date.now();
  while (!condition()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error(`Timeout waiting for condition after ${timeoutMs}ms`);
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}

/**
 * Create test user token
 */
export function createTestToken(
  userId: string,
  role: string,
  permissions: string[] = [],
) {
  // In real tests, this would be signed with the JWT secret
  return `test-token-${userId}-${role}`;
}

/**
 * Build blood request test data
 */
export function buildBloodRequest(overrides?: any) {
  return {
    hospitalId: 'hospital-001',
    requiredBy: new Date(Date.now() + 86400000).toISOString(), // 24h from now
    items: [
      {
        bloodType: 'A+',
        quantity: 5,
      },
    ],
    deliveryAddress: '123 Main St',
    notes: 'Urgent',
    ...overrides,
  };
}

/**
 * Build order test data
 */
export function buildOrder(overrides?: any) {
  return {
    id: 'ORD-' + Math.random().toString(36).substr(2, 9),
    status: 'pending',
    createdAt: new Date().toISOString(),
    items: [{ id: 'item-1', name: 'Blood Unit A+', quantity: 5 }],
    ...overrides,
  };
}

/**
 * Build rider test data
 */
export function buildRider(overrides?: any) {
  return {
    id: 'rider-' + Math.random().toString(36).substr(2, 9),
    name: 'John Doe',
    status: 'available',
    latitude: -1.2832,
    longitude: 36.8172,
    zone: 'Nairobi-Central',
    ...overrides,
  };
}

/**
 * Assert no breaking schema changes
 */
export function assertSchemaStable(
  actual: any,
  expectedSchema: any,
  context: string,
) {
  const actualKeys = new Set(Object.keys(actual || {}));
  const expectedKeys = new Set(Object.keys(expectedSchema || {}));

  // Check for removed required fields
  for (const key of expectedKeys) {
    if (!actualKeys.has(key)) {
      throw new Error(
        `BREAKING: Required field '${key}' missing in ${context}`,
      );
    }
  }

  // Check for type changes
  for (const key of expectedKeys) {
    if (actualKeys.has(key)) {
      const expectedType = typeof expectedSchema[key];
      const actualType = typeof actual[key];

      if (
        expectedType === 'object' &&
        actualType === 'object' &&
        Array.isArray(expectedSchema[key]) !== Array.isArray(actual[key])
      ) {
        throw new Error(
          `BREAKING: Field '${key}' array-ness changed in ${context}`,
        );
      } else if (expectedType !== actualType) {
        throw new Error(
          `BREAKING: Field '${key}' type changed from ${expectedType} to ${actualType} in ${context}`,
        );
      }
    }
  }
}
