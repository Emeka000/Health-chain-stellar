import { BloodComponent } from '../enums/blood-component.enum';
import { BloodStatus } from '../enums/blood-status.enum';
import { BloodType } from '../enums/blood-type.enum';

import { BloodUnit } from './blood-unit.entity';

describe('BloodUnit Entity', () => {
  let bloodUnit: BloodUnit;

  beforeEach(() => {
    bloodUnit = new BloodUnit();
    bloodUnit.id = 'test-id';
    bloodUnit.unitCode = 'BU-001';
    bloodUnit.bloodType = BloodType.A_POSITIVE;
    bloodUnit.component = BloodComponent.WHOLE_BLOOD;
    bloodUnit.status = BloodStatus.AVAILABLE;
    bloodUnit.organizationId = 'org-001';
    bloodUnit.volumeMl = 450;
    bloodUnit.collectedAt = new Date('2024-01-01T00:00:00Z');
    bloodUnit.expiresAt = new Date('2024-01-42T00:00:00Z'); // 42 days later
    bloodUnit.testResults = null;
    bloodUnit.storageTemperatureCelsius = 4;
    bloodUnit.storageLocation = 'Refrigerator A';
    bloodUnit.donorId = 'donor-001';
    bloodUnit.blockchainUnitId = null;
    bloodUnit.blockchainTxHash = null;
    bloodUnit.metadata = null;
    bloodUnit.statusHistory = [];
    bloodUnit.createdAt = new Date('2024-01-01T00:00:00Z');
    bloodUnit.updatedAt = new Date('2024-01-01T00:00:00Z');
  });

  describe('isExpired', () => {
    it('should return false when expiration date is in the future', () => {
      bloodUnit.expiresAt = new Date(Date.now() + 1000 * 60 * 60 * 24 * 30); // 30 days from now
      expect(bloodUnit.isExpired()).toBe(false);
    });

    it('should return true when expiration date is in the past', () => {
      bloodUnit.expiresAt = new Date(Date.now() - 1000 * 60 * 60 * 24); // 1 day ago
      expect(bloodUnit.isExpired()).toBe(true);
    });

    it('should return true when expiration date is exactly now', () => {
      bloodUnit.expiresAt = new Date();
      expect(bloodUnit.isExpired()).toBe(true);
    });
  });

  describe('isAvailable', () => {
    it('should return true when status is AVAILABLE and not expired', () => {
      bloodUnit.status = BloodStatus.AVAILABLE;
      bloodUnit.expiresAt = new Date(Date.now() + 1000 * 60 * 60 * 24 * 30);
      expect(bloodUnit.isAvailable()).toBe(true);
    });

    it('should return false when status is not AVAILABLE', () => {
      bloodUnit.status = BloodStatus.RESERVED;
      bloodUnit.expiresAt = new Date(Date.now() + 1000 * 60 * 60 * 24 * 30);
      expect(bloodUnit.isAvailable()).toBe(false);
    });

    it('should return false when expired', () => {
      bloodUnit.status = BloodStatus.AVAILABLE;
      bloodUnit.expiresAt = new Date(Date.now() - 1000 * 60 * 60 * 24);
      expect(bloodUnit.isAvailable()).toBe(false);
    });
  });

  describe('isReserved', () => {
    it('should return true when status is RESERVED', () => {
      bloodUnit.status = BloodStatus.RESERVED;
      expect(bloodUnit.isReserved()).toBe(true);
    });

    it('should return false when status is not RESERVED', () => {
      bloodUnit.status = BloodStatus.AVAILABLE;
      expect(bloodUnit.isReserved()).toBe(false);
    });
  });

  describe('isInTransit', () => {
    it('should return true when status is IN_TRANSIT', () => {
      bloodUnit.status = BloodStatus.IN_TRANSIT;
      expect(bloodUnit.isInTransit()).toBe(true);
    });

    it('should return false when status is not IN_TRANSIT', () => {
      bloodUnit.status = BloodStatus.AVAILABLE;
      expect(bloodUnit.isInTransit()).toBe(false);
    });
  });

  describe('isQuarantined', () => {
    it('should return true when status is QUARANTINED', () => {
      bloodUnit.status = BloodStatus.QUARANTINED;
      expect(bloodUnit.isQuarantined()).toBe(true);
    });

    it('should return false when status is not QUARANTINED', () => {
      bloodUnit.status = BloodStatus.AVAILABLE;
      expect(bloodUnit.isQuarantined()).toBe(false);
    });
  });

  describe('validate', () => {
    it('should return valid for a correct blood unit', () => {
      const result = bloodUnit.validate();
      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should return invalid when volume is 0', () => {
      bloodUnit.volumeMl = 0;
      const result = bloodUnit.validate();
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('Volume must be greater than 0');
    });

    it('should return invalid when volume is negative', () => {
      bloodUnit.volumeMl = -100;
      const result = bloodUnit.validate();
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('Volume must be greater than 0');
    });

    it('should return invalid when expiration date is before collection date', () => {
      bloodUnit.expiresAt = new Date('2023-12-01T00:00:00Z');
      bloodUnit.collectedAt = new Date('2024-01-01T00:00:00Z');
      const result = bloodUnit.validate();
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain(
        'Expiration date must be after collection date',
      );
    });

    it('should return invalid when blood unit is expired', () => {
      bloodUnit.expiresAt = new Date(Date.now() - 1000 * 60 * 60 * 24);
      const result = bloodUnit.validate();
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('Blood unit has expired');
    });

    it('should return invalid for invalid blood type', () => {
      (bloodUnit as any).bloodType = 'INVALID';
      const result = bloodUnit.validate();
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('Invalid blood type');
    });

    it('should return invalid for invalid component', () => {
      (bloodUnit as any).component = 'INVALID';
      const result = bloodUnit.validate();
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('Invalid blood component');
    });

    it('should return invalid for invalid status', () => {
      (bloodUnit as any).status = 'INVALID';
      const result = bloodUnit.validate();
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('Invalid blood status');
    });

    it('should return multiple errors for multiple issues', () => {
      bloodUnit.volumeMl = 0;
      bloodUnit.expiresAt = new Date(Date.now() - 1000 * 60 * 60 * 24);
      const result = bloodUnit.validate();
      expect(result.isValid).toBe(false);
      expect(result.errors.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe('getRemainingShelfLifeHours', () => {
    it('should return correct remaining hours', () => {
      const now = new Date();
      const hoursInFuture = 48;
      bloodUnit.expiresAt = new Date(
        now.getTime() + hoursInFuture * 60 * 60 * 1000,
      );
      const remaining = bloodUnit.getRemainingShelfLifeHours();
      expect(remaining).toBeCloseTo(hoursInFuture, 0);
    });

    it('should return 0 when expired', () => {
      bloodUnit.expiresAt = new Date(Date.now() - 1000 * 60 * 60 * 24);
      expect(bloodUnit.getRemainingShelfLifeHours()).toBe(0);
    });
  });

  describe('getRemainingShelfLifePercentage', () => {
    it('should return 100% when just collected', () => {
      const now = new Date();
      bloodUnit.collectedAt = now;
      bloodUnit.expiresAt = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000); // 30 days
      const percentage = bloodUnit.getRemainingShelfLifePercentage();
      expect(percentage).toBeCloseTo(100, 0);
    });

    it('should return 0% when expired', () => {
      bloodUnit.expiresAt = new Date(Date.now() - 1000 * 60 * 60 * 24);
      const percentage = bloodUnit.getRemainingShelfLifePercentage();
      expect(percentage).toBe(0);
    });

    it('should return approximately 50% when half expired', () => {
      const now = new Date();
      const totalDays = 30;
      bloodUnit.collectedAt = new Date(
        now.getTime() - (totalDays / 2) * 24 * 60 * 60 * 1000,
      );
      bloodUnit.expiresAt = new Date(
        now.getTime() + (totalDays / 2) * 24 * 60 * 60 * 1000,
      );
      const percentage = bloodUnit.getRemainingShelfLifePercentage();
      expect(percentage).toBeCloseTo(50, 0);
    });
  });

  describe('isCompatibleWith', () => {
    it('should return true for O- donating to O+', () => {
      bloodUnit.bloodType = BloodType.O_NEGATIVE;
      expect(bloodUnit.isCompatibleWith(BloodType.O_POSITIVE)).toBe(true);
    });

    it('should return true for O- donating to A+', () => {
      bloodUnit.bloodType = BloodType.O_NEGATIVE;
      expect(bloodUnit.isCompatibleWith(BloodType.A_POSITIVE)).toBe(true);
    });

    it('should return true for O- donating to AB+', () => {
      bloodUnit.bloodType = BloodType.O_NEGATIVE;
      expect(bloodUnit.isCompatibleWith(BloodType.AB_POSITIVE)).toBe(true);
    });

    it('should return false for A+ donating to O+', () => {
      bloodUnit.bloodType = BloodType.A_POSITIVE;
      expect(bloodUnit.isCompatibleWith(BloodType.O_POSITIVE)).toBe(false);
    });

    it('should return false for AB+ donating to A+', () => {
      bloodUnit.bloodType = BloodType.AB_POSITIVE;
      expect(bloodUnit.isCompatibleWith(BloodType.A_POSITIVE)).toBe(false);
    });

    it('should return true for same blood type', () => {
      bloodUnit.bloodType = BloodType.A_POSITIVE;
      expect(bloodUnit.isCompatibleWith(BloodType.A_POSITIVE)).toBe(true);
    });
  });

  describe('updateStatus', () => {
    it('should update the status', () => {
      bloodUnit.updateStatus(BloodStatus.RESERVED);
      expect(bloodUnit.status).toBe(BloodStatus.RESERVED);
    });
  });

  describe('markAsExpired', () => {
    it('should set status to EXPIRED', () => {
      bloodUnit.markAsExpired();
      expect(bloodUnit.status).toBe(BloodStatus.EXPIRED);
    });
  });

  describe('markAsReserved', () => {
    it('should set status to RESERVED', () => {
      bloodUnit.markAsReserved();
      expect(bloodUnit.status).toBe(BloodStatus.RESERVED);
    });
  });

  describe('markAsAvailable', () => {
    it('should set status to AVAILABLE when not expired', () => {
      bloodUnit.expiresAt = new Date(Date.now() + 1000 * 60 * 60 * 24 * 30);
      bloodUnit.markAsAvailable();
      expect(bloodUnit.status).toBe(BloodStatus.AVAILABLE);
    });

    it('should not set status to AVAILABLE when expired', () => {
      bloodUnit.expiresAt = new Date(Date.now() - 1000 * 60 * 60 * 24);
      bloodUnit.markAsAvailable();
      expect(bloodUnit.status).not.toBe(BloodStatus.AVAILABLE);
    });
  });

  describe('getSummary', () => {
    it('should return a summary object', () => {
      bloodUnit.expiresAt = new Date(Date.now() + 1000 * 60 * 60 * 24 * 30);
      const summary = bloodUnit.getSummary();
      expect(summary).toHaveProperty('id', bloodUnit.id);
      expect(summary).toHaveProperty('unitCode', bloodUnit.unitCode);
      expect(summary).toHaveProperty('bloodType', bloodUnit.bloodType);
      expect(summary).toHaveProperty('component', bloodUnit.component);
      expect(summary).toHaveProperty('volumeMl', bloodUnit.volumeMl);
      expect(summary).toHaveProperty('status', bloodUnit.status);
      expect(summary).toHaveProperty('expiresAt');
      expect(summary).toHaveProperty('isExpired');
      expect(summary).toHaveProperty('isAvailable');
      expect(summary).toHaveProperty('remainingShelfLifeHours');
      expect(summary).toHaveProperty(
        'organizationId',
        bloodUnit.organizationId,
      );
    });
  });

  describe('equals', () => {
    it('should return true for same id', () => {
      const other = new BloodUnit();
      other.id = bloodUnit.id;
      expect(bloodUnit.equals(other)).toBe(true);
    });

    it('should return false for different id', () => {
      const other = new BloodUnit();
      other.id = 'different-id';
      expect(bloodUnit.equals(other)).toBe(false);
    });
  });

  describe('toJSON', () => {
    it('should return a plain object representation', () => {
      const json = bloodUnit.toJSON();
      expect(json).toHaveProperty('id', bloodUnit.id);
      expect(json).toHaveProperty('unitCode', bloodUnit.unitCode);
      expect(json).toHaveProperty('bloodType', bloodUnit.bloodType);
      expect(json).toHaveProperty('component', bloodUnit.component);
      expect(json).toHaveProperty('volumeMl', bloodUnit.volumeMl);
      expect(json).toHaveProperty('status', bloodUnit.status);
      expect(json).toHaveProperty('organizationId', bloodUnit.organizationId);
      expect(json).toHaveProperty('donorId', bloodUnit.donorId);
      expect(json).toHaveProperty('collectedAt');
      expect(json).toHaveProperty('expiresAt');
      expect(json).toHaveProperty('testResults');
      expect(json).toHaveProperty('storageTemperatureCelsius');
      expect(json).toHaveProperty('storageLocation');
      expect(json).toHaveProperty('blockchainUnitId');
      expect(json).toHaveProperty('blockchainTxHash');
      expect(json).toHaveProperty('metadata');
      expect(json).toHaveProperty('createdAt');
      expect(json).toHaveProperty('updatedAt');
    });

    it('should return ISO string dates', () => {
      const json = bloodUnit.toJSON();
      expect(typeof json.collectedAt).toBe('string');
      expect(typeof json.expiresAt).toBe('string');
      expect(typeof json.createdAt).toBe('string');
      expect(typeof json.updatedAt).toBe('string');
    });
  });
});
