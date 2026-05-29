import { OrderStatus } from '../enums/order-status.enum';
import { OrderTransitionException } from '../exceptions/order-transition.exception';

import { OrderStateMachine } from './order-state-machine';

describe('OrderStateMachine', () => {
  let sm: OrderStateMachine;

  beforeEach(() => {
    sm = new OrderStateMachine();
  });

  // ── getAllowedTransitions ───────────────────────────────────────────────────

  describe('getAllowedTransitions', () => {
    it.each([
      [OrderStatus.PENDING, [OrderStatus.CONFIRMED, OrderStatus.CANCELLED]],
      [
        OrderStatus.CONFIRMED,
        [OrderStatus.DISPATCHED, OrderStatus.DELIVERED, OrderStatus.CANCELLED],
      ],
      [OrderStatus.DISPATCHED, [OrderStatus.IN_TRANSIT, OrderStatus.CANCELLED]],
      [
        OrderStatus.IN_TRANSIT,
        [OrderStatus.DELIVERED, OrderStatus.CANCELLED, OrderStatus.DISPUTED],
      ],
      [OrderStatus.DELIVERED, [OrderStatus.DISPUTED]],
      [OrderStatus.DISPUTED, [OrderStatus.RESOLVED]],
      [OrderStatus.RESOLVED, [OrderStatus.DELIVERED, OrderStatus.CANCELLED]],
      [OrderStatus.CANCELLED, []],
    ])('returns correct next states from %s', (from, expected) => {
      expect(sm.getAllowedTransitions(from)).toEqual(expected);
    });
  });

  // ── Valid transitions ──────────────────────────────────────────────────────

  describe('valid transitions', () => {
    it.each([
      [OrderStatus.PENDING, OrderStatus.CONFIRMED],
      [OrderStatus.PENDING, OrderStatus.CANCELLED],
      [OrderStatus.CONFIRMED, OrderStatus.DISPATCHED],
      [OrderStatus.CONFIRMED, OrderStatus.DELIVERED],
      [OrderStatus.CONFIRMED, OrderStatus.CANCELLED],
      [OrderStatus.DISPATCHED, OrderStatus.IN_TRANSIT],
      [OrderStatus.DISPATCHED, OrderStatus.CANCELLED],
      [OrderStatus.IN_TRANSIT, OrderStatus.DELIVERED],
      [OrderStatus.IN_TRANSIT, OrderStatus.CANCELLED],
      [OrderStatus.IN_TRANSIT, OrderStatus.DISPUTED],
      [OrderStatus.DELIVERED, OrderStatus.DISPUTED],
      [OrderStatus.DISPUTED, OrderStatus.RESOLVED],
      [OrderStatus.RESOLVED, OrderStatus.DELIVERED],
      [OrderStatus.RESOLVED, OrderStatus.CANCELLED],
    ])('allows %s → %s and returns the next status', (from, to) => {
      expect(sm.transition(from, to)).toBe(to);
    });
  });

  // ── Invalid transitions ────────────────────────────────────────────────────

  describe('invalid transitions', () => {
    it.each([
      // Skipping states from PENDING
      [OrderStatus.PENDING, OrderStatus.DISPATCHED],
      [OrderStatus.PENDING, OrderStatus.IN_TRANSIT],
      [OrderStatus.PENDING, OrderStatus.DELIVERED],
      [OrderStatus.PENDING, OrderStatus.DISPUTED],
      [OrderStatus.PENDING, OrderStatus.RESOLVED],
      // Invalid from CONFIRMED
      [OrderStatus.CONFIRMED, OrderStatus.PENDING],
      [OrderStatus.CONFIRMED, OrderStatus.IN_TRANSIT],
      [OrderStatus.CONFIRMED, OrderStatus.DISPUTED],
      [OrderStatus.CONFIRMED, OrderStatus.RESOLVED],
      // Invalid from DISPATCHED
      [OrderStatus.DISPATCHED, OrderStatus.PENDING],
      [OrderStatus.DISPATCHED, OrderStatus.CONFIRMED],
      [OrderStatus.DISPATCHED, OrderStatus.DELIVERED],
      [OrderStatus.DISPATCHED, OrderStatus.DISPUTED],
      [OrderStatus.DISPATCHED, OrderStatus.RESOLVED],
      // Invalid from IN_TRANSIT
      [OrderStatus.IN_TRANSIT, OrderStatus.PENDING],
      [OrderStatus.IN_TRANSIT, OrderStatus.CONFIRMED],
      [OrderStatus.IN_TRANSIT, OrderStatus.DISPATCHED],
      [OrderStatus.IN_TRANSIT, OrderStatus.RESOLVED],
      // Invalid from DISPUTED
      [OrderStatus.DISPUTED, OrderStatus.PENDING],
      [OrderStatus.DISPUTED, OrderStatus.CONFIRMED],
      [OrderStatus.DISPUTED, OrderStatus.DELIVERED],
      [OrderStatus.DISPUTED, OrderStatus.CANCELLED],
    ])('rejects %s → %s with OrderTransitionException', (from, to) => {
      expect(() => sm.transition(from, to)).toThrow(OrderTransitionException);
    });
  });

  // ── Terminal state: CANCELLED ──────────────────────────────────────────────

  describe('terminal state CANCELLED', () => {
    it.each(Object.values(OrderStatus))('rejects CANCELLED → %s', (to) => {
      expect(() =>
        sm.transition(OrderStatus.CANCELLED, to as OrderStatus),
      ).toThrow(OrderTransitionException);
    });
  });

  // ── Boundary state: DELIVERED ──────────────────────────────────────────────

  describe('boundary state DELIVERED', () => {
    it('allows DELIVERED → DISPUTED', () => {
      expect(sm.transition(OrderStatus.DELIVERED, OrderStatus.DISPUTED)).toBe(
        OrderStatus.DISPUTED,
      );
    });

    it.each([
      OrderStatus.PENDING,
      OrderStatus.CONFIRMED,
      OrderStatus.DISPATCHED,
      OrderStatus.IN_TRANSIT,
      OrderStatus.DELIVERED,
      OrderStatus.CANCELLED,
      OrderStatus.RESOLVED,
    ])('rejects DELIVERED → %s', (to) => {
      expect(() => sm.transition(OrderStatus.DELIVERED, to)).toThrow(
        OrderTransitionException,
      );
    });
  });

  // ── Boundary state: RESOLVED ───────────────────────────────────────────────

  describe('boundary state RESOLVED', () => {
    it.each([OrderStatus.DELIVERED, OrderStatus.CANCELLED])(
      'allows RESOLVED → %s',
      (to) => {
        expect(sm.transition(OrderStatus.RESOLVED, to)).toBe(to);
      },
    );

    it.each([
      OrderStatus.PENDING,
      OrderStatus.CONFIRMED,
      OrderStatus.DISPATCHED,
      OrderStatus.IN_TRANSIT,
      OrderStatus.DISPUTED,
      OrderStatus.RESOLVED,
    ])('rejects RESOLVED → %s', (to) => {
      expect(() => sm.transition(OrderStatus.RESOLVED, to)).toThrow(
        OrderTransitionException,
      );
    });
  });

  // ── Exception detail ───────────────────────────────────────────────────────

  describe('exception detail', () => {
    it('includes attemptedFrom and attemptedTo in thrown exception', () => {
      let caught: OrderTransitionException | undefined;
      try {
        sm.transition(OrderStatus.PENDING, OrderStatus.IN_TRANSIT);
      } catch (e) {
        caught = e as OrderTransitionException;
      }
      expect(caught).toBeInstanceOf(OrderTransitionException);
      expect(caught!.detail.attemptedFrom).toBe(OrderStatus.PENDING);
      expect(caught!.detail.attemptedTo).toBe(OrderStatus.IN_TRANSIT);
    });

    it('includes allowedTransitions in thrown exception', () => {
      let caught: OrderTransitionException | undefined;
      try {
        sm.transition(OrderStatus.PENDING, OrderStatus.DELIVERED);
      } catch (e) {
        caught = e as OrderTransitionException;
      }
      expect(caught!.detail.allowedTransitions).toEqual(
        expect.arrayContaining([OrderStatus.CONFIRMED, OrderStatus.CANCELLED]),
      );
    });

    it('includes empty allowedTransitions for terminal state', () => {
      let caught: OrderTransitionException | undefined;
      try {
        sm.transition(OrderStatus.CANCELLED, OrderStatus.PENDING);
      } catch (e) {
        caught = e as OrderTransitionException;
      }
      expect(caught!.detail.allowedTransitions).toEqual([]);
    });
  });
});
