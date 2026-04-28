import { describe, it, expect } from 'vitest';
import type { RouteDeviationIncident } from '../../../lib/types/route-deviation';

// ── Pure logic helpers mirroring component display logic ──

const SEVERITY_ORDER: Record<string, number> = { severe: 0, moderate: 1, minor: 2 };

function sortBySeverity(incidents: RouteDeviationIncident[]): RouteDeviationIncident[] {
  return [...incidents].sort(
    (a, b) => (SEVERITY_ORDER[a.severity] ?? 3) - (SEVERITY_ORDER[b.severity] ?? 3),
  );
}

function filterBySeverity(
  incidents: RouteDeviationIncident[],
  filter: 'all' | 'severe' | 'moderate' | 'minor',
): RouteDeviationIncident[] {
  return filter === 'all' ? incidents : incidents.filter((i) => i.severity === filter);
}

function formatDeviationDistance(metres: number): string {
  return `${Math.round(metres)}m off route`;
}

function formatCoordinates(lat: number, lng: number): string {
  return `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
}

function makeIncident(
  overrides: Partial<RouteDeviationIncident> = {},
): RouteDeviationIncident {
  return {
    id: 'inc-1',
    orderId: 'order-1',
    riderId: 'rider-1',
    plannedRouteId: 'route-1',
    severity: 'minor',
    status: 'open',
    deviationDistanceM: 350,
    deviationDurationS: 90,
    lastKnownLatitude: 6.5244,
    lastKnownLongitude: 3.3792,
    reason: 'Rider deviated 350m from planned corridor for 90s',
    recommendedAction: 'Monitor rider position — minor deviation detected.',
    acknowledgedBy: null,
    acknowledgedAt: null,
    resolvedAt: null,
    scoringApplied: false,
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

describe('RouteDeviationPanel display logic', () => {
  describe('sortBySeverity', () => {
    it('orders severe before moderate before minor', () => {
      const incidents = [
        makeIncident({ id: '1', severity: 'minor' }),
        makeIncident({ id: '2', severity: 'severe' }),
        makeIncident({ id: '3', severity: 'moderate' }),
      ];
      const sorted = sortBySeverity(incidents);
      expect(sorted.map((i) => i.severity)).toEqual(['severe', 'moderate', 'minor']);
    });

    it('preserves order for same severity', () => {
      const incidents = [
        makeIncident({ id: '1', severity: 'moderate' }),
        makeIncident({ id: '2', severity: 'moderate' }),
      ];
      const sorted = sortBySeverity(incidents);
      expect(sorted[0].id).toBe('1');
      expect(sorted[1].id).toBe('2');
    });
  });

  describe('filterBySeverity', () => {
    const incidents = [
      makeIncident({ id: '1', severity: 'severe' }),
      makeIncident({ id: '2', severity: 'moderate' }),
      makeIncident({ id: '3', severity: 'minor' }),
    ];

    it('returns all incidents for "all" filter', () => {
      expect(filterBySeverity(incidents, 'all')).toHaveLength(3);
    });

    it('filters to only severe incidents', () => {
      const result = filterBySeverity(incidents, 'severe');
      expect(result).toHaveLength(1);
      expect(result[0].severity).toBe('severe');
    });

    it('returns empty array when no match', () => {
      const onlySevere = [makeIncident({ severity: 'severe' })];
      expect(filterBySeverity(onlySevere, 'minor')).toHaveLength(0);
    });
  });

  describe('formatDeviationDistance', () => {
    it('rounds and appends unit', () => {
      expect(formatDeviationDistance(350.7)).toBe('351m off route');
      expect(formatDeviationDistance(100)).toBe('100m off route');
    });
  });

  describe('formatCoordinates', () => {
    it('formats to 4 decimal places', () => {
      expect(formatCoordinates(6.5244, 3.3792)).toBe('6.5244, 3.3792');
    });

    it('pads to 4 decimal places', () => {
      expect(formatCoordinates(6.5, 3.4)).toBe('6.5000, 3.4000');
    });
  });

  describe('incident status logic', () => {
    it('open incident is not acknowledged', () => {
      const inc = makeIncident({ status: 'open', acknowledgedAt: null });
      expect(inc.acknowledgedAt).toBeNull();
    });

    it('acknowledged incident has acknowledgedAt set', () => {
      const inc = makeIncident({
        status: 'acknowledged',
        acknowledgedBy: 'user-1',
        acknowledgedAt: new Date().toISOString(),
      });
      expect(inc.acknowledgedAt).not.toBeNull();
      expect(inc.acknowledgedBy).toBe('user-1');
    });
  });

  describe('severity classification', () => {
    it('severe incidents have highest priority', () => {
      const inc = makeIncident({ severity: 'severe' });
      expect(SEVERITY_ORDER[inc.severity]).toBe(0);
    });

    it('minor incidents have lowest priority', () => {
      const inc = makeIncident({ severity: 'minor' });
      expect(SEVERITY_ORDER[inc.severity]).toBe(2);
    });
  });
});
