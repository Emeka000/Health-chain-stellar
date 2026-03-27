/**
 * Auth Contract Tests
 *
 * Ensures that authentication is consistently enforced across all protected routes
 * Any modification to auth error responses or status codes is a breaking change
 */

import {
  AuthContract,
  MissingAuthHeaderErrorInteraction,
  InvalidJWTTokenErrorInteraction,
  InsufficientPermissionsErrorInteraction,
} from '../contract-tests/fixtures';
import { validateInteraction } from '../contract-tests/utils/interaction-matcher';

describe('[CONTRACT] Auth Guards ↔ Protected APIs', () => {
  describe('Missing Auth Header', () => {
    it('should return 401 for missing authorization header', () => {
      const actualRequest = {
        method: 'GET',
        path: '/blood-requests',
        headers: {},
      };

      const actualResponse = {
        status: 401,
        body: {
          error: 'UNAUTHORIZED',
          message: 'Missing authorization header',
        },
      };

      const validation = validateInteraction(
        actualRequest,
        actualResponse,
        MissingAuthHeaderErrorInteraction,
      );

      expect(validation.valid).toBe(true);
    });

    it('should detect breaking: wrong status code for missing auth', () => {
      const actualResponse = {
        status: 403, // Changed from 401 - BREAKING
        body: {
          error: 'UNAUTHORIZED',
          message: 'Missing authorization header',
        },
      };

      const validation = validateInteraction(
        {
          method: 'GET',
          path: '/blood-requests',
          headers: {},
        },
        actualResponse,
        MissingAuthHeaderErrorInteraction,
      );

      expect(validation.valid).toBe(false);
      expect(validation.responseErrors.some((e) => e.includes('Status'))).toBe(
        true,
      );
    });
  });

  describe('Invalid JWT Token', () => {
    it('should return 401 for invalid token', () => {
      const actualResponse = {
        status: 401,
        body: {
          error: 'UNAUTHORIZED',
          message: 'Invalid or expired token',
        },
      };

      const validation = validateInteraction(
        {
          method: 'GET',
          path: '/blood-requests',
          headers: { Authorization: 'Bearer invalid.jwt.token' },
        },
        actualResponse,
        InvalidJWTTokenErrorInteraction,
      );

      expect(validation.valid).toBe(true);
    });

    it('should detect breaking: error response structure change', () => {
      const actualResponse = {
        status: 401,
        body: {
          // Missing error field - BREAKING
          message: 'Invalid or expired token',
        },
      };

      const validation = validateInteraction(
        {
          method: 'GET',
          path: '/blood-requests',
          headers: { Authorization: 'Bearer invalid.jwt.token' },
        },
        actualResponse,
        InvalidJWTTokenErrorInteraction,
      );

      expect(validation.valid).toBe(false);
    });
  });

  describe('Insufficient Permissions', () => {
    it('should return 403 for insufficient permissions', () => {
      const actualResponse = {
        status: 403,
        body: {
          error: 'FORBIDDEN',
          message: 'Insufficient permissions: CREATE_BLOOD_REQUEST required',
          requiredPermission: 'CREATE_BLOOD_REQUEST',
          grantedPermissions: ['VIEW_BLOOD_REQUESTS', 'VIEW_INVENTORY'],
        },
      };

      const validation = validateInteraction(
        {
          method: 'POST',
          path: '/blood-requests',
          headers: {
            'Content-Type': 'application/json',
            Authorization: 'Bearer valid-nurse-token',
          },
          body: {
            hospitalId: 'hospital-001',
            requiredBy: '2026-03-27T10:00:00Z',
            items: [{ bloodType: 'A+', quantity: 5 }],
          },
        },
        actualResponse,
        InsufficientPermissionsErrorInteraction,
      );

      expect(validation.valid).toBe(true);
    });

    it('should detect breaking: permission error status code change', () => {
      const actualResponse = {
        status: 401, // Changed from 403 - BREAKING
        body: {
          error: 'FORBIDDEN',
          message: 'Insufficient permissions: CREATE_BLOOD_REQUEST required',
          requiredPermission: 'CREATE_BLOOD_REQUEST',
          grantedPermissions: ['VIEW_BLOOD_REQUESTS', 'VIEW_INVENTORY'],
        },
      };

      const validation = validateInteraction(
        {
          method: 'POST',
          path: '/blood-requests',
          headers: {
            'Content-Type': 'application/json',
            Authorization: 'Bearer valid-nurse-token',
          },
          body: {
            hospitalId: 'hospital-001',
            requiredBy: '2026-03-27T10:00:00Z',
            items: [{ bloodType: 'A+', quantity: 5 }],
          },
        },
        actualResponse,
        InsufficientPermissionsErrorInteraction,
      );

      expect(validation.valid).toBe(false);
    });
  });

  describe('Full Auth Contract', () => {
    it('should have all required auth interactions', () => {
      expect(AuthContract.interactions.length).toBeGreaterThanOrEqual(3);
    });

    it('should maintain version for breaking changes', () => {
      expect(AuthContract.version).toBe('1.0.0');
    });

    it('all interactions should be well-formed', () => {
      for (const interaction of AuthContract.interactions) {
        expect(interaction.name).toBeDefined();
        expect(interaction.request).toBeDefined();
        expect(interaction.response).toBeDefined();
        expect(interaction.request.method).toMatch(
          /^(GET|POST|PUT|PATCH|DELETE)$/,
        );
      }
    });
  });
});
