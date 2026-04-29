/**
 * i18n locale bundle tests
 *
 * Validates:
 * - All EN keys exist in FR (no missing translations)
 * - Medical and emergency glossary completeness
 * - ICU pluralisation keys are present
 * - No empty string values
 */

import { describe, it, expect } from 'vitest';

import commonEN from '../../public/locales/en/common.json';
import commonFR from '../../public/locales/fr/common.json';
import formsEN from '../../public/locales/en/forms.json';
import formsFR from '../../public/locales/fr/forms.json';
import ordersEN from '../../public/locales/en/orders.json';
import ordersFR from '../../public/locales/fr/orders.json';
import dispatchEN from '../../public/locales/en/dispatch.json';
import dispatchFR from '../../public/locales/fr/dispatch.json';
import verificationEN from '../../public/locales/en/verification.json';
import verificationFR from '../../public/locales/fr/verification.json';
import errorsEN from '../../public/locales/en/errors.json';
import errorsFR from '../../public/locales/fr/errors.json';
import medicalEN from '../../public/locales/en/medical.json';
import medicalFR from '../../public/locales/fr/medical.json';
import emergencyEN from '../../public/locales/en/emergency.json';
import emergencyFR from '../../public/locales/fr/emergency.json';

type Bundle = Record<string, string>;

const NAMESPACE_PAIRS: Array<[string, Bundle, Bundle]> = [
  ['common',       commonEN,       commonFR],
  ['forms',        formsEN,        formsFR],
  ['orders',       ordersEN,       ordersFR],
  ['dispatch',     dispatchEN,     dispatchFR],
  ['verification', verificationEN, verificationFR],
  ['errors',       errorsEN,       errorsFR],
  ['medical',      medicalEN,      medicalFR],
  ['emergency',    emergencyEN,    emergencyFR],
];

describe('i18n locale bundles', () => {
  for (const [ns, en, fr] of NAMESPACE_PAIRS) {
    describe(`namespace: ${ns}`, () => {
      it('FR contains all EN keys', () => {
        const missingKeys = Object.keys(en).filter((k) => !(k in fr));
        expect(missingKeys, `Missing FR keys in "${ns}": ${missingKeys.join(', ')}`).toHaveLength(0);
      });

      it('EN contains all FR keys (no orphaned FR keys)', () => {
        const orphaned = Object.keys(fr).filter((k) => !(k in en));
        expect(orphaned, `Orphaned FR keys in "${ns}": ${orphaned.join(', ')}`).toHaveLength(0);
      });

      it('no empty string values in EN', () => {
        const empty = Object.entries(en).filter(([, v]) => v.trim() === '').map(([k]) => k);
        expect(empty, `Empty EN values in "${ns}": ${empty.join(', ')}`).toHaveLength(0);
      });

      it('no empty string values in FR', () => {
        const empty = Object.entries(fr).filter(([, v]) => v.trim() === '').map(([k]) => k);
        expect(empty, `Empty FR values in "${ns}": ${empty.join(', ')}`).toHaveLength(0);
      });
    });
  }

  describe('medical glossary', () => {
    it('contains all 8 blood type keys in EN', () => {
      const expected = [
        'blood_type_a_pos', 'blood_type_a_neg',
        'blood_type_b_pos', 'blood_type_b_neg',
        'blood_type_ab_pos', 'blood_type_ab_neg',
        'blood_type_o_pos', 'blood_type_o_neg',
      ];
      for (const key of expected) {
        expect(medicalEN).toHaveProperty(key);
      }
    });

    it('contains eligibility status keys', () => {
      expect(medicalEN).toHaveProperty('eligibility_eligible');
      expect(medicalEN).toHaveProperty('eligibility_deferred');
      expect(medicalEN).toHaveProperty('eligibility_permanently_excluded');
    });

    it('contains triage keys', () => {
      expect(medicalEN).toHaveProperty('triage_score_label');
      expect(medicalEN).toHaveProperty('triage_emergency_override');
      expect(medicalEN).toHaveProperty('triage_policy_version');
    });

    it('pluralisation keys for units are present', () => {
      expect(medicalEN).toHaveProperty('unit_units');
      expect(medicalEN).toHaveProperty('unit_units_plural');
      expect(medicalEN).toHaveProperty('expiry_days_remaining');
      expect(medicalEN).toHaveProperty('expiry_days_remaining_plural');
    });
  });

  describe('emergency glossary', () => {
    it('contains all tier labels', () => {
      expect(emergencyEN).toHaveProperty('tier_1_label');
      expect(emergencyEN).toHaveProperty('tier_2_label');
      expect(emergencyEN).toHaveProperty('tier_3_label');
    });

    it('contains all urgency levels', () => {
      const levels = [
        'urgency_routine', 'urgency_elevated', 'urgency_urgent',
        'urgency_critical', 'urgency_life_threatening', 'urgency_massive_transfusion',
      ];
      for (const key of levels) {
        expect(emergencyEN).toHaveProperty(key);
      }
    });

    it('contains SLA and acknowledge keys', () => {
      expect(emergencyEN).toHaveProperty('sla_expired');
      expect(emergencyEN).toHaveProperty('acknowledge');
      expect(emergencyEN).toHaveProperty('no_active_escalations');
    });
  });

  describe('locale snapshots', () => {
    it('EN medical bundle matches snapshot', () => {
      expect(medicalEN).toMatchSnapshot();
    });

    it('FR medical bundle matches snapshot', () => {
      expect(medicalFR).toMatchSnapshot();
    });

    it('EN emergency bundle matches snapshot', () => {
      expect(emergencyEN).toMatchSnapshot();
    });

    it('FR emergency bundle matches snapshot', () => {
      expect(emergencyFR).toMatchSnapshot();
    });
  });
});
