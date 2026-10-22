import { OrderStatus } from '../enums/order-status.enum';
import { OrderTransitionException } from '../exceptions/order-transition.exception';
import { OrderStateMachine, TERMINAL_STATES } from './order-state-machine';

describe('OrderStateMachine invariants (Issue #617)', () => {
  let sm: OrderStateMachine;

  beforeEach(() => {
    sm = new OrderStateMachine();
  });

  it('rejects any transition from a terminal state (CANCELLED)', () => {
    expect(() => sm.transition(OrderStatus.CANCELLED, OrderStatus.PENDING)).toThrow(
      OrderTransitionException,
    );
    expect(() => sm.transition(OrderStatus.CANCELLED, OrderStatus.CONFIRMED)).toThrow(
      OrderTransitionException,
    );
  });

  it('rejects backward transitions from DELIVERED', () => {
    expect(() => sm.transition(OrderStatus.DELIVERED, OrderStatus.PENDING)).toThrow(
      OrderTransitionException,
    );
    expect(() => sm.transition(OrderStatus.DELIVERED, OrderStatus.IN_TRANSIT)).toThrow(
      OrderTransitionException,
    );
  });

  it('rejects backward transitions from RESOLVED', () => {
    expect(() => sm.transition(OrderStatus.RESOLVED, OrderStatus.PENDING)).toThrow(
      OrderTransitionException,
    );
  });

  it('assertConsistency passes when statuses match', () => {
    expect(() =>
      sm.assertConsistency(OrderStatus.PENDING, OrderStatus.PENDING, 'order-1'),
    ).not.toThrow();
  });

  it('assertConsistency throws when statuses diverge', () => {
    expect(() =>
      sm.assertConsistency(OrderStatus.CONFIRMED, OrderStatus.PENDING, 'order-1'),
    ).toThrow(/state inconsistency/);
  });

  it('TERMINAL_STATES contains CANCELLED', () => {
    expect(TERMINAL_STATES.has(OrderStatus.CANCELLED)).toBe(true);
  });

  it('replayFromEvents returns last status', () => {
    const statuses = [OrderStatus.PENDING, OrderStatus.CONFIRMED, OrderStatus.DISPATCHED];
    expect(sm.replayFromEvents(statuses)).toBe(OrderStatus.DISPATCHED);
  });

  it('replayFromEvents throws on empty list', () => {
    expect(() => sm.replayFromEvents([])).toThrow();
  });
});
