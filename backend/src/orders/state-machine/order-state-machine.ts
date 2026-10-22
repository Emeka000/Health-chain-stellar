import { Injectable } from '@nestjs/common';

import { OrderStatus } from '../enums/order-status.enum';
import { OrderTransitionException } from '../exceptions/order-transition.exception';

/**
 * Defines every legal edge in the order lifecycle DAG.
 * Terminal states (DELIVERED, CANCELLED) have an empty allowed-set.
 */
export const VALID_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  [OrderStatus.PENDING]: [OrderStatus.CONFIRMED, OrderStatus.CANCELLED],
  [OrderStatus.CONFIRMED]: [
    OrderStatus.DISPATCHED,
    OrderStatus.DELIVERED,
    OrderStatus.CANCELLED,
  ],
  [OrderStatus.DISPATCHED]: [OrderStatus.IN_TRANSIT, OrderStatus.CANCELLED],
  [OrderStatus.IN_TRANSIT]: [
    OrderStatus.DELIVERED,
    OrderStatus.CANCELLED,
    OrderStatus.DISPUTED,
  ],
  [OrderStatus.DELIVERED]: [OrderStatus.DISPUTED],
  [OrderStatus.DISPUTED]: [OrderStatus.RESOLVED],
  [OrderStatus.RESOLVED]: [OrderStatus.DELIVERED, OrderStatus.CANCELLED],
  [OrderStatus.CANCELLED]: [],
};

/** States from which no further transitions are permitted (Issue #617). */
export const TERMINAL_STATES = new Set<OrderStatus>([OrderStatus.CANCELLED]);

/** States that must never be reached by a backward transition (Issue #617). */
export const BACKWARD_FORBIDDEN_PAIRS: Array<[OrderStatus, OrderStatus]> = [
  [OrderStatus.DELIVERED, OrderStatus.PENDING],
  [OrderStatus.DELIVERED, OrderStatus.CONFIRMED],
  [OrderStatus.DELIVERED, OrderStatus.DISPATCHED],
  [OrderStatus.DELIVERED, OrderStatus.IN_TRANSIT],
  [OrderStatus.CANCELLED, OrderStatus.PENDING],
  [OrderStatus.CANCELLED, OrderStatus.CONFIRMED],
  [OrderStatus.CANCELLED, OrderStatus.DISPATCHED],
  [OrderStatus.CANCELLED, OrderStatus.IN_TRANSIT],
  [OrderStatus.RESOLVED, OrderStatus.PENDING],
  [OrderStatus.RESOLVED, OrderStatus.CONFIRMED],
  [OrderStatus.RESOLVED, OrderStatus.DISPATCHED],
  [OrderStatus.RESOLVED, OrderStatus.IN_TRANSIT],
];

@Injectable()
export class OrderStateMachine {
  /**
   * Returns all valid next states reachable from `currentStatus`.
   */
  getAllowedTransitions(currentStatus: OrderStatus): OrderStatus[] {
    return VALID_TRANSITIONS[currentStatus] ?? [];
  }

  /**
   * Validates the transition `currentStatus → nextStatus`.
   * Returns `nextStatus` when valid; throws `OrderTransitionException` otherwise.
   *
   * Invariant assertions (Issue #617):
   * 1. Terminal states cannot transition to any other state.
   * 2. Backward transitions to earlier lifecycle states are forbidden.
   * 3. The transition must appear in VALID_TRANSITIONS.
   */
  transition(currentStatus: OrderStatus, nextStatus: OrderStatus): OrderStatus {
    // Invariant 1: terminal state guard
    if (TERMINAL_STATES.has(currentStatus)) {
      throw new OrderTransitionException({
        attemptedFrom: currentStatus,
        attemptedTo: nextStatus,
        allowedTransitions: [],
      });
    }

    // Invariant 2: backward transition guard
    const isBackward = BACKWARD_FORBIDDEN_PAIRS.some(
      ([from, to]) => from === currentStatus && to === nextStatus,
    );
    if (isBackward) {
      throw new OrderTransitionException({
        attemptedFrom: currentStatus,
        attemptedTo: nextStatus,
        allowedTransitions: this.getAllowedTransitions(currentStatus),
      });
    }

    // Invariant 3: explicit allow-list check
    const allowed = this.getAllowedTransitions(currentStatus);
    if (!allowed.includes(nextStatus)) {
      throw new OrderTransitionException({
        attemptedFrom: currentStatus,
        attemptedTo: nextStatus,
        allowedTransitions: allowed,
      });
    }

    return nextStatus;
  }

  /**
   * Derives the current state by replaying an ordered sequence of statuses
   * (as recorded in the event store).  The last element IS the current state.
   * Throws when the sequence is empty.
   */
  replayFromEvents(orderedStatuses: OrderStatus[]): OrderStatus {
    if (orderedStatuses.length === 0) {
      throw new Error('Cannot replay state: event list is empty');
    }
    return orderedStatuses[orderedStatuses.length - 1];
  }

  /**
   * Assert that the replayed event-store state matches the materialised
   * status column.  Throws when they diverge (Issue #617).
   */
  assertConsistency(
    materializedStatus: OrderStatus,
    replayedStatus: OrderStatus,
    orderId: string,
  ): void {
    if (materializedStatus !== replayedStatus) {
      throw new Error(
        `Order '${orderId}' state inconsistency: materialized='${materializedStatus}' replayed='${replayedStatus}'`,
      );
    }
  }
}
