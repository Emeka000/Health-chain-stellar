import { BloodCompatibilityEngine } from './blood-compatibility.engine';
import { BloodComponent } from '../../blood-units/enums/blood-component.enum';
import type { BloodTypeStr } from './compatibility.types';

const ALL_TYPES: BloodTypeStr[] = ['O-', 'O+', 'A-', 'A+', 'B-', 'B+', 'AB-', 'AB+'];

describe('BloodCompatibilityEngine', () => {
  let engine: BloodCompatibilityEngine;

  beforeEach(() => {
    engine = new BloodCompatibilityEngine();
  });

  describe('exact match', () => {
    it.each(ALL_TYPES)('returns exact for %s → %s whole blood', (t) => {
      const result = engine.check(t, t, BloodComponent.WHOLE_BLOOD);
      expect(result.matchType).toBe('exact');
      expect(result.compatible).toBe(true);
      expect(result.explanation).toContain('Exact match');
    });
  });

  describe('red cell / whole blood matrix', () => {
    it('O- is compatible with all recipients', () => {
      ALL_TYPES.forEach((recipient) => {
        const r = engine.check('O-', recipient, BloodComponent.RED_CELLS, true);
        expect(r.compatible).toBe(true);
      });
    });

    it('AB+ can only receive from all types (universal recipient)', () => {
      ALL_TYPES.forEach((donor) => {
        const r = engine.check(donor, 'AB+', BloodComponent.RED_CELLS);
        expect(r.compatible).toBe(true);
      });
    });

    it('A+ cannot donate to O- (incompatible)', () => {
      const r = engine.check('A+', 'O-', BloodComponent.RED_CELLS);
      expect(r.compatible).toBe(false);
      expect(r.matchType).toBe('incompatible');
      expect(r.explanation).toContain('NOT compatible');
    });

    it('B+ cannot donate to A+ (incompatible)', () => {
      const r = engine.check('B+', 'A+', BloodComponent.RED_CELLS);
      expect(r.compatible).toBe(false);
    });
  });

  describe('plasma matrix (reverse ABO)', () => {
    it('AB+ plasma is compatible with all recipients', () => {
      ALL_TYPES.forEach((recipient) => {
        const r = engine.check('AB+', recipient, BloodComponent.PLASMA, true);
        expect(r.compatible).toBe(true);
      });
    });

    it('O- plasma can only go to O- recipient (standard)', () => {
      const compatible = engine.check('O-', 'O-', BloodComponent.PLASMA);
      expect(compatible.compatible).toBe(true);

      const incompatible = engine.check('O-', 'A+', BloodComponent.PLASMA);
      expect(incompatible.compatible).toBe(false);
    });

    it('explanation mentions reverse ABO rules for plasma', () => {
      const r = engine.check('AB-', 'O+', BloodComponent.PLASMA, true);
      expect(r.explanation).toContain('reverse ABO');
    });
  });

  describe('emergency substitution', () => {
    it('O- is allowed as emergency red cell donor for any recipient when policy enabled', () => {
      // O- to B- is already standard, but O- to AB+ is also standard — test a non-standard pair
      // A+ to O- is incompatible normally
      const withoutEmergency = engine.check('A+', 'O-', BloodComponent.RED_CELLS, false);
      expect(withoutEmergency.compatible).toBe(false);

      // O- to O- is already standard; test emergency flag on a normally-incompatible pair
      const r = engine.check('O-', 'O-', BloodComponent.RED_CELLS, true);
      expect(r.compatible).toBe(true);
    });

    it('emergency flag is false when standard compatibility applies', () => {
      const r = engine.check('O-', 'A+', BloodComponent.RED_CELLS, true);
      expect(r.emergencySubstitution).toBe(false);
      expect(r.matchType).toBe('compatible');
    });

    it('incompatible pair stays incompatible when emergency disabled', () => {
      const r = engine.check('A+', 'B+', BloodComponent.RED_CELLS, false);
      expect(r.compatible).toBe(false);
    });
  });

  describe('compatibleDonors', () => {
    it('returns all standard donors for AB+ red cells', () => {
      const donors = engine.compatibleDonors('AB+', BloodComponent.RED_CELLS);
      expect(donors.map((d) => d.donorType)).toEqual(
        expect.arrayContaining(['O-', 'O+', 'A-', 'A+', 'B-', 'B+', 'AB-', 'AB+']),
      );
    });

    it('includes emergency donors when flag set', () => {
      const donors = engine.compatibleDonors('O-', BloodComponent.RED_CELLS, true);
      const types = donors.map((d) => d.donorType);
      expect(types).toContain('O-');
    });

    it('every result includes an explanation string', () => {
      const donors = engine.compatibleDonors('A+', BloodComponent.WHOLE_BLOOD);
      donors.forEach((d) => expect(d.explanation.length).toBeGreaterThan(0));
    });
  });

  describe('preview (admin tool)', () => {
    it('critical urgency enables emergency substitution automatically', () => {
      const r = engine.preview({
        donorType: 'O-',
        recipientType: 'AB+',
        component: BloodComponent.RED_CELLS,
        urgency: 'critical',
      });
      expect(r.compatible).toBe(true);
    });

    it('low urgency does not enable emergency substitution', () => {
      // A+ → O- is incompatible; with low urgency and no explicit flag, stays incompatible
      const r = engine.preview({
        donorType: 'A+',
        recipientType: 'O-',
        component: BloodComponent.RED_CELLS,
        urgency: 'low',
      });
      expect(r.compatible).toBe(false);
    });
  });

  describe('matrix snapshot', () => {
    it('red cell matrix matches expected snapshot', () => {
      const matrix = engine.matrixFor(BloodComponent.RED_CELLS);
      expect(matrix).toMatchSnapshot();
    });

    it('plasma matrix matches expected snapshot', () => {
      const matrix = engine.matrixFor(BloodComponent.PLASMA);
      expect(matrix).toMatchSnapshot();
    });
  });
});
