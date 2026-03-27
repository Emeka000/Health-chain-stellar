import { BloodComponent } from '../../blood-units/enums/blood-component.enum';
import { BloodType } from '../../blood-units/enums/blood-type.enum';
import { BloodRequestStatus } from '../enums/blood-request-status.enum';

import { BloodRequestEntity, Urgency } from './blood-request.entity';

describe('BloodRequestEntity', () => {
  let bloodRequest: BloodRequestEntity;

  beforeEach(() => {
    bloodRequest = new BloodRequestEntity();
    bloodRequest.id = 'test-id';
    bloodRequest.requestNumber = 'BR-001';
    bloodRequest.hospitalId = 'hospital-001';
    bloodRequest.bloodType = BloodType.A_POSITIVE;
    bloodRequest.component = BloodComponent.WHOLE_BLOOD;
    bloodRequest.quantityMl = 500;
    bloodRequest.urgency = Urgency.ROUTINE;
    bloodRequest.createdTimestamp = Math.floor(Date.now() / 1000);
    bloodRequest.requiredByTimestamp =
      bloodRequest.createdTimestamp + 24 * 60 * 60; // 24 hours later
    bloodRequest.status = BloodRequestStatus.PENDING;
    bloodRequest.assignedUnits = [];
    bloodRequest.fulfilledQuantityMl = 0;
    bloodRequest.deliveryAddress = '123 Hospital St';
    bloodRequest.notes = 'Urgent need for surgery';
    bloodRequest.blockchainTxHash = null;
    bloodRequest.createdByUserId = 'user-001';
    bloodRequest.items = [];
    bloodRequest.createdAt = new Date();
    bloodRequest.updatedAt = new Date();
  });

  describe('isFulfilled', () => {
    it('should return false when fulfilled quantity is less than requested', () => {
      bloodRequest.fulfilledQuantityMl = 300;
      expect(bloodRequest.isFulfilled()).toBe(false);
    });

    it('should return true when fulfilled quantity equals requested', () => {
      bloodRequest.fulfilledQuantityMl = 500;
      expect(bloodRequest.isFulfilled()).toBe(true);
    });

    it('should return true when fulfilled quantity exceeds requested', () => {
      bloodRequest.fulfilledQuantityMl = 600;
      expect(bloodRequest.isFulfilled()).toBe(true);
    });
  });

  describe('timeRemaining', () => {
    it('should return positive time when not yet required', () => {
      const currentTimestamp = bloodRequest.createdTimestamp + 12 * 60 * 60; // 12 hours later
      const remaining = bloodRequest.timeRemaining(currentTimestamp);
      expect(remaining).toBeGreaterThan(0);
    });

    it('should return 0 when past required time', () => {
      const currentTimestamp = bloodRequest.requiredByTimestamp + 1000;
      const remaining = bloodRequest.timeRemaining(currentTimestamp);
      expect(remaining).toBe(0);
    });
  });

  describe('isOverdue', () => {
    it('should return false when not yet required and not fulfilled', () => {
      const currentTimestamp = bloodRequest.createdTimestamp + 12 * 60 * 60;
      expect(bloodRequest.isOverdue(currentTimestamp)).toBe(false);
    });

    it('should return true when past required time and not fulfilled', () => {
      const currentTimestamp = bloodRequest.requiredByTimestamp + 1000;
      expect(bloodRequest.isOverdue(currentTimestamp)).toBe(true);
    });

    it('should return false when past required time but fulfilled', () => {
      const currentTimestamp = bloodRequest.requiredByTimestamp + 1000;
      bloodRequest.fulfilledQuantityMl = 500;
      expect(bloodRequest.isOverdue(currentTimestamp)).toBe(false);
    });
  });

  describe('getUrgencyLevel', () => {
    it('should return CRITICAL when less than 2 hours remaining', () => {
      const currentTimestamp = bloodRequest.requiredByTimestamp - 1 * 60 * 60; // 1 hour remaining
      expect(bloodRequest.getUrgencyLevel(currentTimestamp)).toBe(
        Urgency.CRITICAL,
      );
    });

    it('should return URGENT when 2-6 hours remaining', () => {
      const currentTimestamp = bloodRequest.requiredByTimestamp - 4 * 60 * 60; // 4 hours remaining
      expect(bloodRequest.getUrgencyLevel(currentTimestamp)).toBe(
        Urgency.URGENT,
      );
    });

    it('should return ROUTINE when 6-24 hours remaining', () => {
      const currentTimestamp = bloodRequest.requiredByTimestamp - 12 * 60 * 60; // 12 hours remaining
      expect(bloodRequest.getUrgencyLevel(currentTimestamp)).toBe(
        Urgency.ROUTINE,
      );
    });

    it('should return SCHEDULED when more than 24 hours remaining', () => {
      const currentTimestamp = bloodRequest.requiredByTimestamp - 48 * 60 * 60; // 48 hours remaining
      expect(bloodRequest.getUrgencyLevel(currentTimestamp)).toBe(
        Urgency.SCHEDULED,
      );
    });
  });

  describe('validate', () => {
    it('should return valid for a correct blood request', () => {
      const result = bloodRequest.validate();
      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should return invalid when quantity is 0', () => {
      bloodRequest.quantityMl = 0;
      const result = bloodRequest.validate();
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('Quantity must be greater than 0');
    });

    it('should return invalid when quantity is negative', () => {
      bloodRequest.quantityMl = -100;
      const result = bloodRequest.validate();
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('Quantity must be greater than 0');
    });

    it('should return invalid when required by timestamp is before creation', () => {
      bloodRequest.requiredByTimestamp = bloodRequest.createdTimestamp - 1000;
      const result = bloodRequest.validate();
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain(
        'Required by timestamp must be after creation timestamp',
      );
    });

    it('should return invalid for invalid blood type', () => {
      (bloodRequest as any).bloodType = 'INVALID';
      const result = bloodRequest.validate();
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('Invalid blood type');
    });

    it('should return invalid for invalid component', () => {
      (bloodRequest as any).component = 'INVALID';
      const result = bloodRequest.validate();
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('Invalid blood component');
    });

    it('should return invalid for invalid urgency', () => {
      (bloodRequest as any).urgency = 'INVALID';
      const result = bloodRequest.validate();
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('Invalid urgency level');
    });

    it('should return invalid for invalid status', () => {
      (bloodRequest as any).status = 'INVALID';
      const result = bloodRequest.validate();
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('Invalid request status');
    });

    it('should return invalid when fulfilled quantity is negative', () => {
      bloodRequest.fulfilledQuantityMl = -100;
      const result = bloodRequest.validate();
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('Fulfilled quantity cannot be negative');
    });

    it('should return invalid when fulfilled quantity exceeds requested', () => {
      bloodRequest.fulfilledQuantityMl = 600;
      const result = bloodRequest.validate();
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain(
        'Fulfilled quantity cannot exceed requested quantity',
      );
    });
  });

  describe('getFulfillmentProgress', () => {
    it('should return correct progress when partially fulfilled', () => {
      bloodRequest.fulfilledQuantityMl = 250;
      const progress = bloodRequest.getFulfillmentProgress();
      expect(progress.requestedMl).toBe(500);
      expect(progress.fulfilledMl).toBe(250);
      expect(progress.remainingMl).toBe(250);
      expect(progress.percentage).toBe(50);
    });

    it('should return 100% when fully fulfilled', () => {
      bloodRequest.fulfilledQuantityMl = 500;
      const progress = bloodRequest.getFulfillmentProgress();
      expect(progress.percentage).toBe(100);
    });

    it('should return 0% when not fulfilled', () => {
      bloodRequest.fulfilledQuantityMl = 0;
      const progress = bloodRequest.getFulfillmentProgress();
      expect(progress.percentage).toBe(0);
    });
  });

  describe('addFulfilledQuantity', () => {
    it('should add quantity to fulfilled', () => {
      bloodRequest.addFulfilledQuantity(200);
      expect(bloodRequest.fulfilledQuantityMl).toBe(200);
    });

    it('should not exceed requested quantity', () => {
      bloodRequest.addFulfilledQuantity(600);
      expect(bloodRequest.fulfilledQuantityMl).toBe(500);
    });

    it('should handle multiple additions', () => {
      bloodRequest.addFulfilledQuantity(200);
      bloodRequest.addFulfilledQuantity(200);
      expect(bloodRequest.fulfilledQuantityMl).toBe(400);
    });
  });

  describe('assignUnit', () => {
    it('should add unit to assigned units', () => {
      bloodRequest.assignUnit('unit-001');
      expect(bloodRequest.assignedUnits).toContain('unit-001');
    });

    it('should not add duplicate units', () => {
      bloodRequest.assignUnit('unit-001');
      bloodRequest.assignUnit('unit-001');
      expect(bloodRequest.assignedUnits?.length).toBe(1);
    });

    it('should initialize array if null', () => {
      bloodRequest.assignedUnits = null;
      bloodRequest.assignUnit('unit-001');
      expect(bloodRequest.assignedUnits).toContain('unit-001');
    });
  });

  describe('removeUnit', () => {
    it('should remove unit from assigned units', () => {
      bloodRequest.assignedUnits = ['unit-001', 'unit-002'];
      bloodRequest.removeUnit('unit-001');
      expect(bloodRequest.assignedUnits).not.toContain('unit-001');
      expect(bloodRequest.assignedUnits).toContain('unit-002');
    });

    it('should handle null assigned units', () => {
      bloodRequest.assignedUnits = null;
      expect(() => bloodRequest.removeUnit('unit-001')).not.toThrow();
    });
  });

  describe('isUnitAssigned', () => {
    it('should return true when unit is assigned', () => {
      bloodRequest.assignedUnits = ['unit-001', 'unit-002'];
      expect(bloodRequest.isUnitAssigned('unit-001')).toBe(true);
    });

    it('should return false when unit is not assigned', () => {
      bloodRequest.assignedUnits = ['unit-001', 'unit-002'];
      expect(bloodRequest.isUnitAssigned('unit-003')).toBe(false);
    });

    it('should return false when assigned units is null', () => {
      bloodRequest.assignedUnits = null;
      expect(bloodRequest.isUnitAssigned('unit-001')).toBe(false);
    });
  });

  describe('getAssignedUnitsCount', () => {
    it('should return correct count', () => {
      bloodRequest.assignedUnits = ['unit-001', 'unit-002', 'unit-003'];
      expect(bloodRequest.getAssignedUnitsCount()).toBe(3);
    });

    it('should return 0 when null', () => {
      bloodRequest.assignedUnits = null;
      expect(bloodRequest.getAssignedUnitsCount()).toBe(0);
    });
  });

  describe('updateStatus', () => {
    it('should update the status', () => {
      bloodRequest.updateStatus(BloodRequestStatus.FULFILLED);
      expect(bloodRequest.status).toBe(BloodRequestStatus.FULFILLED);
    });
  });

  describe('markAsFulfilled', () => {
    it('should set status to FULFILLED', () => {
      bloodRequest.markAsFulfilled();
      expect(bloodRequest.status).toBe(BloodRequestStatus.FULFILLED);
    });

    it('should set fulfilled quantity to requested quantity', () => {
      bloodRequest.markAsFulfilled();
      expect(bloodRequest.fulfilledQuantityMl).toBe(500);
    });
  });

  describe('markAsCancelled', () => {
    it('should set status to CANCELLED', () => {
      bloodRequest.markAsCancelled();
      expect(bloodRequest.status).toBe(BloodRequestStatus.CANCELLED);
    });
  });

  describe('getSummary', () => {
    it('should return a summary object', () => {
      const currentTimestamp = bloodRequest.createdTimestamp + 12 * 60 * 60;
      const summary = bloodRequest.getSummary(currentTimestamp);
      expect(summary).toHaveProperty('id', bloodRequest.id);
      expect(summary).toHaveProperty(
        'requestNumber',
        bloodRequest.requestNumber,
      );
      expect(summary).toHaveProperty('hospitalId', bloodRequest.hospitalId);
      expect(summary).toHaveProperty('bloodType', bloodRequest.bloodType);
      expect(summary).toHaveProperty('component', bloodRequest.component);
      expect(summary).toHaveProperty('quantityMl', bloodRequest.quantityMl);
      expect(summary).toHaveProperty('urgency', bloodRequest.urgency);
      expect(summary).toHaveProperty('status', bloodRequest.status);
      expect(summary).toHaveProperty(
        'requiredByTimestamp',
        bloodRequest.requiredByTimestamp,
      );
      expect(summary).toHaveProperty('timeRemainingSeconds');
      expect(summary).toHaveProperty('isOverdue');
      expect(summary).toHaveProperty('isFulfilled');
      expect(summary).toHaveProperty('fulfillmentProgress');
      expect(summary).toHaveProperty('assignedUnitsCount');
      expect(summary).toHaveProperty('createdAt');
    });
  });

  describe('equals', () => {
    it('should return true for same id', () => {
      const other = new BloodRequestEntity();
      other.id = bloodRequest.id;
      expect(bloodRequest.equals(other)).toBe(true);
    });

    it('should return false for different id', () => {
      const other = new BloodRequestEntity();
      other.id = 'different-id';
      expect(bloodRequest.equals(other)).toBe(false);
    });
  });

  describe('toJSON', () => {
    it('should return a plain object representation', () => {
      const json = bloodRequest.toJSON();
      expect(json).toHaveProperty('id', bloodRequest.id);
      expect(json).toHaveProperty('requestNumber', bloodRequest.requestNumber);
      expect(json).toHaveProperty('hospitalId', bloodRequest.hospitalId);
      expect(json).toHaveProperty('bloodType', bloodRequest.bloodType);
      expect(json).toHaveProperty('component', bloodRequest.component);
      expect(json).toHaveProperty('quantityMl', bloodRequest.quantityMl);
      expect(json).toHaveProperty('urgency', bloodRequest.urgency);
      expect(json).toHaveProperty(
        'createdTimestamp',
        bloodRequest.createdTimestamp,
      );
      expect(json).toHaveProperty(
        'requiredByTimestamp',
        bloodRequest.requiredByTimestamp,
      );
      expect(json).toHaveProperty('status', bloodRequest.status);
      expect(json).toHaveProperty('assignedUnits', bloodRequest.assignedUnits);
      expect(json).toHaveProperty(
        'fulfilledQuantityMl',
        bloodRequest.fulfilledQuantityMl,
      );
      expect(json).toHaveProperty(
        'deliveryAddress',
        bloodRequest.deliveryAddress,
      );
      expect(json).toHaveProperty('notes', bloodRequest.notes);
      expect(json).toHaveProperty(
        'blockchainTxHash',
        bloodRequest.blockchainTxHash,
      );
      expect(json).toHaveProperty(
        'createdByUserId',
        bloodRequest.createdByUserId,
      );
      expect(json).toHaveProperty('createdAt');
      expect(json).toHaveProperty('updatedAt');
    });
  });
});
