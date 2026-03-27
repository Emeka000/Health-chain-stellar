/**
 * Blood Requests ↔ Inventory Contract Fixture
 *
 * Contract: BloodRequests.create() must call Inventory.reserveStock()
 * - Consumer: BloodRequests service
 * - Provider: Inventory service
 *
 * This contract ensures that blood requests cannot be created without
 * actually reserving stock (transactional boundary enforcement).
 */

import {
  createInteraction,
  createServiceContract,
  ServiceInteraction,
} from '../utils/interaction-matcher';

/**
 * Request item structure expected by inventory
 */
export const BloodRequestInventoryItemFixture = {
  bloodType: 'A+',
  quantity: 5,
  bloodBankId: 'bank-001',
};

/**
 * Reserve stock request contract
 */
export const ReserveStockRequestInteraction: ServiceInteraction =
  createInteraction(
    'Reserve blood stock',
    'BloodRequests',
    'Inventory',
    {
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
    },
    {
      status: 200,
      body: {
        success: true,
        reservationId: 'RES-12345',
        bloodType: 'A+',
        quantity: 5,
        availableUnits: 45, // 50 - 5 reserved
        bloodBankId: 'bank-001',
      },
    },
  );

/**
 * Release stock (rollback) contract
 */
export const ReleaseStockRequestInteraction: ServiceInteraction =
  createInteraction(
    'Release blood stock on failure',
    'BloodRequests',
    'Inventory',
    {
      method: 'POST',
      path: '/inventory/release',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer valid-jwt-token',
      },
      body: {
        bloodType: 'A+',
        quantity: 5,
        bloodBankId: 'bank-001',
        reservationId: 'RES-12345',
      },
    },
    {
      status: 200,
      body: {
        success: true,
        bloodType: 'A+',
        quantity: 5,
        availableUnits: 50, // Back to original
        bloodBankId: 'bank-001',
      },
    },
  );

/**
 * Insufficient stock error contract
 */
export const InsufficientStockErrorInteraction: ServiceInteraction =
  createInteraction(
    'Insufficient stock error',
    'BloodRequests',
    'Inventory',
    {
      method: 'POST',
      path: '/inventory/reserve',
      body: {
        bloodType: 'O-',
        quantity: 100, // More than available
        bloodBankId: 'bank-001',
      },
    },
    {
      status: 409, // Conflict
      body: {
        success: false,
        error: 'INSUFFICIENT_STOCK',
        message: 'Not enough O- blood units available',
        availableUnits: 5,
        requestedQuantity: 100,
      },
    },
  );

/**
 * Full contract between BloodRequests and Inventory
 */
export const BloodRequestsInventoryContract = createServiceContract(
  'BloodRequests-Inventory',
  '1.0.0',
  [
    ReserveStockRequestInteraction,
    ReleaseStockRequestInteraction,
    InsufficientStockErrorInteraction,
  ],
);
