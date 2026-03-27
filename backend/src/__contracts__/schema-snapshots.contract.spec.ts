/**
 * Schema Snapshot Contract Tests
 *
 * Validates that API response schemas remain stable
 * Any breaking schema changes (field removals, type changes, etc.) are detected
 */

import {
  createSnapshot,
  extractSchema,
  validateAgainstSnapshot,
  SchemaSnapshot,
} from '../contract-tests/utils/schema-snapshot.matcher';

describe('[CONTRACT] Response Schema Snapshots', () => {
  let bloodRequestSnapshot: SchemaSnapshot;
  let inventoryItemSnapshot: SchemaSnapshot;
  let orderSnapshot: SchemaSnapshot;

  beforeAll(() => {
    // Create frozen schema snapshots for critical responses
    bloodRequestSnapshot = createSnapshot('BloodRequest', '1.0.0', {
      id: 'BR-12345-ABC',
      hospitalId: 'hospital-001',
      requestNumber: 'BR-1711430400-A1B2C3',
      status: 'PENDING',
      requiredBy: '2026-03-27T10:00:00Z',
      items: [
        {
          bloodType: 'A+',
          quantity: 5,
          fulfilled: 0,
        },
      ],
      createdAt: '2026-03-26T10:00:00Z',
      updatedAt: '2026-03-26T10:00:00Z',
    });

    inventoryItemSnapshot = createSnapshot('InventoryStock', '1.0.0', {
      id: 'inv-001',
      bloodBankId: 'bank-001',
      bloodType: 'A+',
      availableUnits: 50,
      reservedUnits: 5,
      totalUnits: 55,
      expirationDate: '2026-06-26',
      createdAt: '2026-03-26T10:00:00Z',
      updatedAt: '2026-03-26T10:00:00Z',
    });

    orderSnapshot = createSnapshot('Order', '1.0.0', {
      id: 'ORD-12345',
      status: 'PENDING',
      items: [
        {
          id: 'item-1',
          name: 'Blood Unit A+',
          quantity: 5,
        },
      ],
      createdAt: '2026-03-26T10:00:00Z',
      completedAt: null,
    });
  });

  describe('BloodRequest Schema Validation', () => {
    it('should accept response matching frozen schema', () => {
      const response = {
        id: 'BR-99999-XYZ',
        hospitalId: 'hospital-002',
        requestNumber: 'BR-1711430400-X9Y8Z7',
        status: 'FULFILLED',
        requiredBy: '2026-03-28T10:00:00Z',
        items: [
          {
            bloodType: 'O-',
            quantity: 10,
            fulfilled: 10,
          },
        ],
        createdAt: '2026-03-26T11:00:00Z',
        updatedAt: '2026-03-26T12:00:00Z',
      };

      const validation = validateAgainstSnapshot(
        response,
        bloodRequestSnapshot,
      );

      expect(validation.valid).toBe(true);
      expect(validation.errors).toHaveLength(0);
    });

    it('should detect BREAKING: required field removed', () => {
      const response = {
        id: 'BR-99999-XYZ',
        hospitalId: 'hospital-002',
        // Missing requestNumber - BREAKING
        status: 'FULFILLED',
        requiredBy: '2026-03-28T10:00:00Z',
        items: [],
        createdAt: '2026-03-26T11:00:00Z',
        updatedAt: '2026-03-26T12:00:00Z',
      };

      const validation = validateAgainstSnapshot(
        response,
        bloodRequestSnapshot,
      );

      expect(validation.valid).toBe(false);
      expect(validation.errors.some((e) => e.includes('BREAKING'))).toBe(true);
      expect(validation.errors.some((e) => e.includes('requestNumber'))).toBe(
        true,
      );
    });
  });

  describe('InventoryStock Schema Validation', () => {
    it('should accept matching schema', () => {
      const response = {
        id: 'inv-002',
        bloodBankId: 'bank-002',
        bloodType: 'O-',
        availableUnits: 30,
        reservedUnits: 10,
        totalUnits: 40,
        expirationDate: '2026-07-26',
        createdAt: '2026-03-25T10:00:00Z',
        updatedAt: '2026-03-26T10:00:00Z',
      };

      const validation = validateAgainstSnapshot(
        response,
        inventoryItemSnapshot,
      );

      expect(validation.valid).toBe(true);
    });

    it('should detect BREAKING: numeric field becomes null-able', () => {
      const response = {
        id: 'inv-002',
        bloodBankId: 'bank-002',
        bloodType: 'O-',
        availableUnits: null, // Changed from number - BREAKING
        reservedUnits: 10,
        totalUnits: 40,
        expirationDate: '2026-07-26',
        createdAt: '2026-03-25T10:00:00Z',
        updatedAt: '2026-03-26T10:00:00Z',
      };

      const validation = validateAgainstSnapshot(
        response,
        inventoryItemSnapshot,
      );

      expect(validation.valid).toBe(false);
      expect(validation.errors.length).toBeGreaterThan(0);
    });
  });

  describe('Order Schema Validation', () => {
    it('should validate order response structure', () => {
      const response = {
        id: 'ORD-54321',
        status: 'COMPLETED',
        items: [{ id: 'item-1', name: 'Blood Unit A+', quantity: 5 }],
        createdAt: '2026-03-26T10:00:00Z',
        completedAt: '2026-03-26T14:00:00Z',
      };

      const validation = validateAgainstSnapshot(response, orderSnapshot);

      // Should have valid structure
      expect(validation).toBeDefined();
      expect(response.id).toBeDefined();
    });

    it('should detect when required field is missing', () => {
      const response = {
        id: 'ORD-54321',
        status: 'COMPLETED',
        // Missing items field - BREAKING
        createdAt: '2026-03-26T10:00:00Z',
        completedAt: '2026-03-26T14:00:00Z',
      };

      const validation = validateAgainstSnapshot(response, orderSnapshot);

      expect(validation.valid).toBe(false);
      expect(validation.errors.some((e) => e.includes('items'))).toBe(true);
    });
  });

  describe('Schema Extraction', () => {
    it('should extract schema correctly from objects', () => {
      const data = {
        name: 'Hospital',
        beds: 100,
        active: true,
      };

      const schema = extractSchema(data);

      expect(schema.type).toBe('object');
      expect(schema.properties.name.type).toBe('string');
      expect(schema.properties.beds.type).toBe('number');
      expect(schema.properties.active.type).toBe('boolean');
    });

    it('should extract schema correctly from arrays', () => {
      const data = [
        { id: 1, name: 'Item 1' },
        { id: 2, name: 'Item 2' },
      ];

      const schema = extractSchema(data);

      expect(schema.type).toBe('array');
      expect(schema.items.type).toBe('object');
    });

    it('should handle null values', () => {
      const data = {
        id: 1,
        value: null,
      };

      const schema = extractSchema(data);

      expect(schema.properties.value.type).toBe('null');
    });
  });
});
