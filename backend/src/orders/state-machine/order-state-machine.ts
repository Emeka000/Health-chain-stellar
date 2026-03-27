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
   */
  transition(currentStatus: OrderStatus, nextStatus: OrderStatus): OrderStatus {
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
}
