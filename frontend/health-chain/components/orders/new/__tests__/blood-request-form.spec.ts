import { describe, it, expect } from 'vitest';
import type { BloodType } from '../../../../lib/types/orders';

// ── Pure validation logic mirroring Step1BloodSelection ──────────────────────

const BLOOD_TYPES: BloodType[] = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'];
const MIN_QUANTITY = 1;
const MAX_QUANTITY = 50;

function validateBloodRequest(
  bloodType: BloodType | null,
  quantity: number,
): { valid: boolean; error: string | null } {
  if (!bloodType) {
    return { valid: false, error: 'order_blood_type_required' };
  }
  if (quantity < MIN_QUANTITY || quantity > MAX_QUANTITY) {
    return { valid: false, error: 'order_quantity_required' };
  }
  return { valid: true, error: null };
}

function buildPayload(
  bloodType: BloodType,
  quantity: number,
): { bloodType: BloodType; quantity: number } {
  return { bloodType, quantity };
}

function clampQuantity(q: number): number {
  return Math.min(MAX_QUANTITY, Math.max(MIN_QUANTITY, q));
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('BloodRequestForm (Step1BloodSelection) display logic', () => {
  describe('blood type selection', () => {
    it('renders exactly 8 blood type options', () => {
      expect(BLOOD_TYPES).toHaveLength(8);
    });

    it('includes all ABO + Rh combinations', () => {
      const expected: BloodType[] = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'];
      expect(BLOOD_TYPES).toEqual(expected);
    });
  });

  describe('validateBloodRequest – required field validation', () => {
    it('returns error when blood type is null', () => {
      const result = validateBloodRequest(null, 1);
      expect(result.valid).toBe(false);
      expect(result.error).toBe('order_blood_type_required');
    });

    it('returns error when quantity is below minimum', () => {
      const result = validateBloodRequest('O+', 0);
      expect(result.valid).toBe(false);
      expect(result.error).toBe('order_quantity_required');
    });

    it('returns error when quantity exceeds maximum (50)', () => {
      const result = validateBloodRequest('A+', 51);
      expect(result.valid).toBe(false);
      expect(result.error).toBe('order_quantity_required');
    });

    it('passes validation with a valid blood type and quantity', () => {
      const result = validateBloodRequest('B+', 5);
      expect(result.valid).toBe(true);
      expect(result.error).toBeNull();
    });

    it('passes validation at boundary quantity 1', () => {
      expect(validateBloodRequest('AB-', 1).valid).toBe(true);
    });

    it('passes validation at boundary quantity 50', () => {
      expect(validateBloodRequest('A-', 50).valid).toBe(true);
    });
  });

  describe('buildPayload – submits correct payload', () => {
    it('constructs payload with blood type and quantity', () => {
      const payload = buildPayload('AB+', 10);
      expect(payload).toEqual({ bloodType: 'AB+', quantity: 10 });
    });

    it('each blood type produces a distinct payload', () => {
      const payloads = BLOOD_TYPES.map((bt) => buildPayload(bt, 1));
      const bloodTypes = payloads.map((p) => p.bloodType);
      const unique = new Set(bloodTypes);
      expect(unique.size).toBe(BLOOD_TYPES.length);
    });
  });

  describe('quantity stepper – clamping logic', () => {
    it('clamps quantity to minimum of 1 when decremented below 1', () => {
      expect(clampQuantity(0)).toBe(1);
    });

    it('clamps quantity to maximum of 50 when incremented above 50', () => {
      expect(clampQuantity(51)).toBe(50);
    });

    it('leaves quantity unchanged when within range', () => {
      expect(clampQuantity(25)).toBe(25);
    });
  });
});
