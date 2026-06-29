import { describe, it, expect } from 'vitest';

// ── Types ─────────────────────────────────────────────────────────────────────

interface Rider {
  id: string;
  name: string;
  status: 'available' | 'assigned' | 'offline';
  latitude: number;
  longitude: number;
  currentOrderId: string | null;
}

interface Assignment {
  riderId: string;
  orderId: string;
  assignedAt: string;
}

// ── Pure dispatch logic helpers ───────────────────────────────────────────────

function getAvailableRiders(riders: Rider[]): Rider[] {
  return riders.filter((r) => r.status === 'available');
}

function assignRider(
  riderId: string,
  orderId: string,
  riders: Rider[],
): { riders: Rider[]; assignment: Assignment } {
  const updated = riders.map((r) =>
    r.id === riderId
      ? { ...r, status: 'assigned' as const, currentOrderId: orderId }
      : r,
  );
  const assignment: Assignment = {
    riderId,
    orderId,
    assignedAt: new Date().toISOString(),
  };
  return { riders: updated, assignment };
}

function getRiderById(id: string, riders: Rider[]): Rider | undefined {
  return riders.find((r) => r.id === id);
}

function isRiderAssignable(rider: Rider): boolean {
  return rider.status === 'available' && rider.currentOrderId === null;
}

function distanceKm(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function nearestRider(
  orderLat: number,
  orderLon: number,
  riders: Rider[],
): Rider | undefined {
  const available = getAvailableRiders(riders);
  if (available.length === 0) return undefined;
  return available.reduce((nearest, r) => {
    const dNearest = distanceKm(orderLat, orderLon, nearest.latitude, nearest.longitude);
    const dR = distanceKm(orderLat, orderLon, r.latitude, r.longitude);
    return dR < dNearest ? r : nearest;
  });
}

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makeRider(overrides: Partial<Rider> = {}): Rider {
  return {
    id: 'rider-1',
    name: 'Ada Okafor',
    status: 'available',
    latitude: 6.5244,
    longitude: 3.3792,
    currentOrderId: null,
    ...overrides,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('DispatchPanel display and assignment logic', () => {
  describe('getAvailableRiders – rider list rendering', () => {
    const riders: Rider[] = [
      makeRider({ id: 'r1', status: 'available' }),
      makeRider({ id: 'r2', status: 'assigned', currentOrderId: 'order-99' }),
      makeRider({ id: 'r3', status: 'offline' }),
      makeRider({ id: 'r4', status: 'available' }),
    ];

    it('returns only available riders', () => {
      const result = getAvailableRiders(riders);
      expect(result).toHaveLength(2);
      expect(result.every((r) => r.status === 'available')).toBe(true);
    });

    it('returns empty list when no riders are available', () => {
      const allBusy = riders.map((r) => ({ ...r, status: 'assigned' as const }));
      expect(getAvailableRiders(allBusy)).toHaveLength(0);
    });
  });

  describe('assignRider – assignment click handling', () => {
    it('marks the selected rider as assigned', () => {
      const riders = [makeRider({ id: 'r1' }), makeRider({ id: 'r2' })];
      const { riders: updated } = assignRider('r1', 'order-42', riders);
      const r1 = getRiderById('r1', updated);
      expect(r1?.status).toBe('assigned');
      expect(r1?.currentOrderId).toBe('order-42');
    });

    it('does not change other riders during assignment', () => {
      const riders = [makeRider({ id: 'r1' }), makeRider({ id: 'r2' })];
      const { riders: updated } = assignRider('r1', 'order-42', riders);
      const r2 = getRiderById('r2', updated);
      expect(r2?.status).toBe('available');
    });

    it('creates an assignment record with riderId and orderId', () => {
      const riders = [makeRider({ id: 'r1' })];
      const { assignment } = assignRider('r1', 'order-99', riders);
      expect(assignment.riderId).toBe('r1');
      expect(assignment.orderId).toBe('order-99');
      expect(assignment.assignedAt).toBeTruthy();
    });
  });

  describe('isRiderAssignable', () => {
    it('returns true for a free available rider', () => {
      expect(isRiderAssignable(makeRider())).toBe(true);
    });

    it('returns false for an already-assigned rider', () => {
      expect(
        isRiderAssignable(makeRider({ status: 'assigned', currentOrderId: 'order-1' })),
      ).toBe(false);
    });

    it('returns false for an offline rider', () => {
      expect(isRiderAssignable(makeRider({ status: 'offline' }))).toBe(false);
    });
  });

  describe('nearestRider – proximity-based dispatch', () => {
    const hospitalLat = 6.5244;
    const hospitalLon = 3.3792;

    const riders: Rider[] = [
      makeRider({ id: 'r-close', latitude: 6.527, longitude: 3.381 }),
      makeRider({ id: 'r-far', latitude: 6.6, longitude: 3.5 }),
    ];

    it('returns the closest available rider', () => {
      const nearest = nearestRider(hospitalLat, hospitalLon, riders);
      expect(nearest?.id).toBe('r-close');
    });

    it('returns undefined when no riders are available', () => {
      const allAssigned = riders.map((r) => ({
        ...r,
        status: 'assigned' as const,
      }));
      expect(nearestRider(hospitalLat, hospitalLon, allAssigned)).toBeUndefined();
    });
  });

  describe('getRiderById', () => {
    const riders = [makeRider({ id: 'r1' }), makeRider({ id: 'r2' })];

    it('finds a rider by id', () => {
      expect(getRiderById('r1', riders)?.id).toBe('r1');
    });

    it('returns undefined for unknown id', () => {
      expect(getRiderById('unknown', riders)).toBeUndefined();
    });
  });
});
