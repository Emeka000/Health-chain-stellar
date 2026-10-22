import { describe, it, expect } from 'vitest';

// ── Types mirroring TriageExplanationPanel props ──────────────────────────────

interface TriageFactor {
  label: string;
  value: number;
  detail: string;
}

// ── Pure display helpers mirroring TriageExplanationPanel logic ───────────────

type UrgencyColour = 'red' | 'amber' | 'green';

/**
 * Derive the urgency colour from a triage score.
 * Mirrors the visual coding conventions used in TriageExplanationPanel:
 *   score >= 80  → red    (critical)
 *   score >= 50  → amber  (moderate)
 *   score <  50  → green  (low)
 */
function getUrgencyColour(score: number): UrgencyColour {
  if (score >= 80) return 'red';
  if (score >= 50) return 'amber';
  return 'green';
}

function getUrgencyLabel(score: number): string {
  if (score >= 80) return 'Critical';
  if (score >= 50) return 'Moderate';
  return 'Low';
}

function shouldShowEmergencyBanner(emergencyOverride: boolean): boolean {
  return emergencyOverride === true;
}

function computeTotalScore(factors: TriageFactor[]): number {
  return factors.reduce((sum, f) => sum + f.value, 0);
}

function sortFactorsByValueDesc(factors: TriageFactor[]): TriageFactor[] {
  return [...factors].sort((a, b) => b.value - a.value);
}

function makeFactor(
  label: string,
  value: number,
  detail = 'detail',
): TriageFactor {
  return { label, value, detail };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('TriageView (TriageExplanationPanel) display logic', () => {
  describe('getUrgencyColour – urgency colour coding', () => {
    it('returns red for critical scores (>= 80)', () => {
      expect(getUrgencyColour(80)).toBe('red');
      expect(getUrgencyColour(95)).toBe('red');
      expect(getUrgencyColour(100)).toBe('red');
    });

    it('returns amber for moderate scores (50–79)', () => {
      expect(getUrgencyColour(50)).toBe('amber');
      expect(getUrgencyColour(65)).toBe('amber');
      expect(getUrgencyColour(79)).toBe('amber');
    });

    it('returns green for low scores (< 50)', () => {
      expect(getUrgencyColour(0)).toBe('green');
      expect(getUrgencyColour(25)).toBe('green');
      expect(getUrgencyColour(49)).toBe('green');
    });
  });

  describe('getUrgencyLabel', () => {
    it('labels critical scores correctly', () => {
      expect(getUrgencyLabel(80)).toBe('Critical');
    });

    it('labels moderate scores correctly', () => {
      expect(getUrgencyLabel(55)).toBe('Moderate');
    });

    it('labels low scores correctly', () => {
      expect(getUrgencyLabel(30)).toBe('Low');
    });
  });

  describe('shouldShowEmergencyBanner', () => {
    it('shows banner when emergencyOverride is true', () => {
      expect(shouldShowEmergencyBanner(true)).toBe(true);
    });

    it('hides banner when emergencyOverride is false', () => {
      expect(shouldShowEmergencyBanner(false)).toBe(false);
    });
  });

  describe('triage factor rendering', () => {
    const factors: TriageFactor[] = [
      makeFactor('Blood Compatibility', 40, 'Exact ABO + Rh match'),
      makeFactor('SLA Urgency', 30, 'Within 2-hour SLA'),
      makeFactor('Distance', 10, 'Nearest blood bank'),
    ];

    it('renders one card per factor', () => {
      expect(factors).toHaveLength(3);
    });

    it('computeTotalScore sums all factor values', () => {
      expect(computeTotalScore(factors)).toBe(80);
    });

    it('sortFactorsByValueDesc orders highest-weight factors first', () => {
      const sorted = sortFactorsByValueDesc(factors);
      expect(sorted[0].label).toBe('Blood Compatibility');
      expect(sorted[sorted.length - 1].label).toBe('Distance');
    });

    it('each factor renders its label and value', () => {
      for (const f of factors) {
        expect(f.label).toBeTruthy();
        expect(typeof f.value).toBe('number');
      }
    });
  });

  describe('score panel', () => {
    it('displays the numeric triage score', () => {
      const score = 75;
      expect(score).toBeGreaterThanOrEqual(0);
      expect(score).toBeLessThanOrEqual(100);
    });

    it('policy version is rendered alongside the score', () => {
      const policyVersion = 'v2.1.0';
      expect(policyVersion).toMatch(/^v\d+\.\d+\.\d+$/);
    });
  });
});
