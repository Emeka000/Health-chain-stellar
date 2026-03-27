/**
 * Blood Requests → Inventory Contract Tests
 *
 * Consumer: BloodRequests service
 * Provider: Inventory service
 *
 * Ensures that blood request creation always interacts with inventory
 * in the expected way (reserve, release on failure, check availability)
 */

import {
  BloodRequestsInventoryContract,
  ReserveStockRequestInteraction,
  InsufficientStockErrorInteraction,
} from '../contract-tests/fixtures';
import {
  validateInteraction,
  ServiceInteraction,
} from '../contract-tests/utils/interaction-matcher';

describe('[CONTRACT] BloodRequests ↔ Inventory', () => {
  describe('Reserve Stock Interaction', () => {
    it('should match contract when reserving stock', () => {
      // Simulate actual request/response from service
      const actualRequest = {
        method: 'POST',
        path: '/inventory/reserve',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer valid-jwt-token',
        },
        body: {
          bloodType: 'A+',
          quantity: 5,
          bloodBankId: 'bank-001',
          requestId: 'BR-12345-ABC',
        },
      };

      const actualResponse = {
        status: 200,
        body: {
          success: true,
          reservationId: 'RES-12345',
          bloodType: 'A+',
          quantity: 5,
          availableUnits: 45,
          bloodBankId: 'bank-001',
        },
      };

      const validation = validateInteraction(
        actualRequest,
        actualResponse,
        ReserveStockRequestInteraction,
      );

      expect(validation.valid).toBe(true);
      expect(validation.requestErrors).toHaveLength(0);
      expect(validation.responseErrors).toHaveLength(0);
    });

    it('should detect breaking change: status code mismatch', () => {
      const actualResponse = {
        status: 201, // Changed from 200
        body: {
          success: true,
          reservationId: 'RES-12345',
          bloodType: 'A+',
          quantity: 5,
          availableUnits: 45,
          bloodBankId: 'bank-001',
        },
      };

      const validation = validateInteraction(
        {
          method: 'POST',
          path: '/inventory/reserve',
          body: {},
        },
        actualResponse,
        ReserveStockRequestInteraction,
      );

      expect(validation.valid).toBe(false);
      expect(validation.responseErrors.length).toBeGreaterThan(0);
      expect(validation.responseErrors[0]).toContain('Status mismatch');
    });

    it('should detect breaking change: missing required response field', () => {
      const actualResponse = {
        status: 200,
        body: {
          success: true,
          // Missing reservationId - BREAKING
          bloodType: 'A+',
          quantity: 5,
          availableUnits: 45,
          bloodBankId: 'bank-001',
        },
      };

      const validation = validateInteraction(
        {
          method: 'POST',
          path: '/inventory/reserve',
          body: {},
        },
        actualResponse,
        ReserveStockRequestInteraction,
      );

      expect(validation.valid).toBe(false);
      expect(
        validation.responseErrors.some((e) => e.includes('BREAKING')),
      ).toBe(true);
    });

    it('should detect breaking change: response field type change', () => {
      const actualResponse = {
        status: 200,
        body: {
          success: true,
          reservationId: 12345, // Changed from string - BREAKING
          bloodType: 'A+',
          quantity: 5,
          availableUnits: 45,
          bloodBankId: 'bank-001',
        },
      };

      const validation = validateInteraction(
        {
          method: 'POST',
          path: '/inventory/reserve',
          body: {},
        },
        actualResponse,
        ReserveStockRequestInteraction,
      );

      expect(validation.valid).toBe(false);
      expect(
        validation.responseErrors.some((e) => e.includes('BREAKING')),
      ).toBe(true);
    });
  });

  describe('Insufficient Stock Error Contract', () => {
    it('should match contract for insufficient stock error', () => {
      const actualRequest = {
        method: 'POST',
        path: '/inventory/reserve',
        body: {
          bloodType: 'O-',
          quantity: 100,
          bloodBankId: 'bank-001',
        },
      };

      const actualResponse = {
        status: 409,
        body: {
          success: false,
          error: 'INSUFFICIENT_STOCK',
          message: 'Not enough O- blood units available',
          availableUnits: 5,
          requestedQuantity: 100,
        },
      };

      const validation = validateInteraction(
        actualRequest,
        actualResponse,
        InsufficientStockErrorInteraction,
      );

      expect(validation.valid).toBe(true);
    });

    it('should detect when error response structure changes', () => {
      const actualResponse = {
        status: 409,
        body: {
          error: 'INSUFFICIENT_STOCK',
          // Missing message - BREAKING
          availableUnits: 5,
          requestedQuantity: 100,
        },
      };

      const validation = validateInteraction(
        {
          method: 'POST',
          path: '/inventory/reserve',
          body: {},
        },
        actualResponse,
        InsufficientStockErrorInteraction,
      );

      expect(validation.valid).toBe(false);
    });
  });

  describe('Full Contract Validation', () => {
    it('should have all expected interactions', () => {
      expect(BloodRequestsInventoryContract.interactions).toHaveLength(3);
    });

    it('should maintain contract version for breaking changes', () => {
      expect(BloodRequestsInventoryContract.version).toBe('1.0.0');
    });
  });
});
