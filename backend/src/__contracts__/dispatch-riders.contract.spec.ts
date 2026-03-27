/**
 * Dispatch ↔ Riders Contract Test
 *
 * Consumer: DispatchService
 * Provider: RidersService
 *
 * This test ensures that when Dispatch assigns an order to a rider,
 * the Riders service responds with the expected format and state transitions.
 */

import {
  DispatchRidersContract,
  AssignOrderToRiderInteraction,
  RiderAlreadyBusyErrorInteraction,
  ReleaseRiderFromOrderInteraction,
} from '../contract-tests/fixtures';
import { validateInteraction } from '../contract-tests/utils/interaction-matcher';

describe('[CONTRACT] Dispatch ↔ Riders (Order Assignment)', () => {
  /**
   * CONSUMER TEST: Verify Dispatch sends correct request format
   *
   * When dispatch assigns an order, it must send exactly:
   * - PATCH request
   * - To /riders/{riderId}/status
   * - With { status: 'busy', orderId, reason }
   * - Authorization header
   */
  describe('Consumer: Dispatch Service', () => {
    it('should send assignment request in contract format', () => {
      // Simulate what Dispatch service sends
      const dispatchRequest = {
        method: 'PATCH',
        path: '/riders/rider-001/status',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer valid-jwt-token',
        },
        body: {
          status: 'busy',
          reason: 'Assigned to order ORD-12345',
          orderId: 'ORD-12345',
        },
      };

      // Simulate what Riders responds with
      const riersResponse = {
        status: 200,
        body: {
          id: 'rider-001',
          status: 'busy',
          lastUpdated: '2026-03-26T10:00:00Z',
          currentOrderId: 'ORD-12345',
        },
      };

      // Validate against contract
      const validation = validateInteraction(
        dispatchRequest,
        riersResponse,
        AssignOrderToRiderInteraction,
      );

      expect(validation.valid).toBe(true);
      expect(validation.requestErrors).toHaveLength(0);
      expect(validation.responseErrors).toHaveLength(0);
    });

    it('should detect breaking: wrong request body format', () => {
      // Broken: Missing orderId from request body
      const brokenRequest = {
        method: 'PATCH',
        path: '/riders/rider-001/status',
        body: {
          status: 'busy',
          reason: 'Assigned to order ORD-12345',
          // Missing orderId - BREAKING for provider
        },
      };

      const riersResponse = {
        status: 200,
        body: {
          id: 'rider-001',
          status: 'busy',
          lastUpdated: '2026-03-26T10:00:00Z',
          currentOrderId: 'ORD-12345',
        },
      };

      const validation = validateInteraction(
        brokenRequest,
        riersResponse,
        AssignOrderToRiderInteraction,
      );

      expect(validation.valid).toBe(false);
      expect(validation.requestErrors.some((e) => e.includes('BREAKING'))).toBe(
        true,
      );
    });

    it('should detect breaking: response field missing', () => {
      const dispatchRequest = {
        method: 'PATCH',
        path: '/riders/rider-001/status',
        body: {
          status: 'busy',
          orderId: 'ORD-12345',
        },
      };

      // Broken: Missing currentOrderId from response
      const brokenResponse = {
        status: 200,
        body: {
          id: 'rider-001',
          status: 'busy',
          lastUpdated: '2026-03-26T10:00:00Z',
          // Missing currentOrderId - Dispatch expects this
        },
      };

      const validation = validateInteraction(
        dispatchRequest,
        brokenResponse,
        AssignOrderToRiderInteraction,
      );

      expect(validation.valid).toBe(false);
      expect(
        validation.responseErrors.some((e) => e.includes('BREAKING')),
      ).toBe(true);
    });
  });

  /**
   * PROVIDER TEST: Verify Riders handles all request scenarios
   */
  describe('Provider: Riders Service', () => {
    it('should successfully assign rider to order', () => {
      // Mock: Riders receives assignment request
      const actualRequest = {
        method: 'PATCH',
        path: '/riders/rider-001/status',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer valid-jwt-token',
        },
        body: {
          status: 'busy',
          reason: 'Assigned to order ORD-12345',
          orderId: 'ORD-12345',
        },
      };

      // Mock: Riders responds with updated rider state
      const actualResponse = {
        status: 200,
        body: {
          id: 'rider-001',
          status: 'busy',
          lastUpdated: '2026-03-26T10:00:00Z',
          currentOrderId: 'ORD-12345',
        },
      };

      const validation = validateInteraction(
        actualRequest,
        actualResponse,
        AssignOrderToRiderInteraction,
      );

      expect(validation.valid).toBe(true);
    });

    it('should return 409 when rider already busy', () => {
      const actualRequest = {
        method: 'PATCH',
        path: '/riders/rider-001/status',
        body: {
          status: 'busy',
          orderId: 'ORD-12346', // Different order
        },
      };

      const actualResponse = {
        status: 409,
        body: {
          error: 'RIDER_UNAVAILABLE',
          message: 'Rider is already assigned to order ORD-12345',
          currentStatus: 'busy',
          currentOrderId: 'ORD-12345',
        },
      };

      const validation = validateInteraction(
        actualRequest,
        actualResponse,
        RiderAlreadyBusyErrorInteraction,
      );

      expect(validation.valid).toBe(true);
    });

    it('should detect breaking: wrong error status code', () => {
      const actualResponse = {
        status: 400, // Wrong! Should be 409 for conflict
        body: {
          error: 'RIDER_UNAVAILABLE',
          message: 'Rider is already assigned to order ORD-12345',
          currentStatus: 'busy',
          currentOrderId: 'ORD-12345',
        },
      };

      const validation = validateInteraction(
        {
          method: 'PATCH',
          path: '/riders/rider-001/status',
          body: {},
        },
        actualResponse,
        RiderAlreadyBusyErrorInteraction,
      );

      expect(validation.valid).toBe(false);
      expect(validation.responseErrors.some((e) => e.includes('Status'))).toBe(
        true,
      );
    });
  });

  /**
   * END-TO-END: Full assignment workflow
   *
   * This simulates the complete workflow:
   * 1. Dispatch assigns rider to order
   * 2. Rider is now busy
   * 3. Dispatch later releases rider
   * 4. Rider is available again
   */
  describe('End-to-End: Complete Assignment Workflow', () => {
    it('should transition rider through state machines', () => {
      // Step 1: Assign rider
      const assignResponse = {
        status: 200,
        body: {
          id: 'rider-001',
          status: 'busy',
          currentOrderId: 'ORD-12345',
          lastUpdated: '2026-03-26T10:00:00Z',
        },
      };

      let validation = validateInteraction(
        {
          method: 'PATCH',
          path: '/riders/rider-001/status',
          headers: {
            'Content-Type': 'application/json',
            Authorization: 'Bearer valid-jwt-token',
          },
          body: {
            status: 'busy',
            reason: 'Assigned to order ORD-12345',
            orderId: 'ORD-12345',
          },
        },
        assignResponse,
        AssignOrderToRiderInteraction,
      );
      expect(validation.valid).toBe(true);

      // Step 2: Try double-assign (should fail)
      const doubleAssignResponse = {
        status: 409,
        body: {
          error: 'RIDER_UNAVAILABLE',
          message: 'Rider is already assigned to order ORD-12345',
          currentStatus: 'busy',
          currentOrderId: 'ORD-12345',
        },
      };

      validation = validateInteraction(
        {
          method: 'PATCH',
          path: '/riders/rider-001/status',
          headers: {
            'Content-Type': 'application/json',
            Authorization: 'Bearer valid-jwt-token',
          },
          body: {
            status: 'busy',
            reason: 'Assigned to order ORD-12346',
            orderId: 'ORD-12346',
          },
        },
        doubleAssignResponse,
        RiderAlreadyBusyErrorInteraction,
      );
      expect(validation.valid).toBe(true);

      // Step 3: Release rider
      const releaseResponse = {
        status: 200,
        body: {
          id: 'rider-001',
          status: 'available',
          currentOrderId: null,
          lastUpdated: '2026-03-26T10:05:00Z',
        },
      };

      validation = validateInteraction(
        {
          method: 'PATCH',
          path: '/riders/rider-001/status',
          headers: {
            'Content-Type': 'application/json',
            Authorization: 'Bearer valid-jwt-token',
          },
          body: { status: 'available', reason: 'Order ORD-12345 completed' },
        },
        releaseResponse,
        ReleaseRiderFromOrderInteraction,
      );
      expect(validation.valid).toBe(true);
    });

    it('should now allow reassignment after release', () => {
      // After release, rider should be assignable again
      const newAssignResponse = {
        status: 200,
        body: {
          id: 'rider-001',
          status: 'busy',
          currentOrderId: 'ORD-12346', // Different order
          lastUpdated: '2026-03-26T10:06:00Z',
        },
      };

      const validation = validateInteraction(
        {
          method: 'PATCH',
          path: '/riders/rider-001/status',
          headers: {
            'Content-Type': 'application/json',
            Authorization: 'Bearer valid-jwt-token',
          },
          body: {
            status: 'busy',
            reason: 'Assigned to order ORD-12346',
            orderId: 'ORD-12346',
          },
        },
        newAssignResponse,
        AssignOrderToRiderInteraction,
      );

      expect(validation.valid).toBe(true);
    });
  });

  describe('Contract Completeness', () => {
    it('should have all required interactions', () => {
      expect(DispatchRidersContract.interactions).toHaveLength(3);
      expect(DispatchRidersContract.interactions.map((i) => i.name)).toContain(
        'Assign order to rider',
      );
      expect(DispatchRidersContract.interactions.map((i) => i.name)).toContain(
        'Rider busy error',
      );
      expect(DispatchRidersContract.interactions.map((i) => i.name)).toContain(
        'Release rider from order',
      );
    });

    it('should maintain consumer-provider clarity', () => {
      for (const interaction of DispatchRidersContract.interactions) {
        expect(interaction.consumer).toBe('Dispatch');
        expect(interaction.provider).toBe('Riders');
      }
    });

    it('should define clear request/response contracts', () => {
      for (const interaction of DispatchRidersContract.interactions) {
        expect(interaction.request.method).toBeDefined();
        expect(interaction.request.path).toBeDefined();
        expect(interaction.response.status).toBeDefined();
        expect(interaction.response.body).toBeDefined();
      }
    });
  });
});
