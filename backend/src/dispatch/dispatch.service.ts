import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { EventEmitter2 } from '@nestjs/event-emitter';
import {
  OrderCancelledEvent,
  OrderStatusUpdatedEvent,
  OrderRiderAssignedEvent,
} from '../events';
import { RiderAssignmentService } from './rider-assignment.service';

@Injectable()
export class DispatchService {
  private readonly logger = new Logger(DispatchService.name);
  private readonly processedEvents = new Set<string>(); // For idempotency

  constructor(
    private readonly eventEmitter: EventEmitter2,
    private readonly riderAssignmentService: RiderAssignmentService,
  ) {}

  /**
   * Generate a unique key for event idempotency
   */
  private getEventKey(eventName: string, orderId: string, timestamp: Date): string {
    return `${eventName}:${orderId}:${timestamp.getTime()}`;
  }

  /**
   * Check if event has already been processed (idempotency check)
   */
  private isEventProcessed(eventKey: string): boolean {
    return this.processedEvents.has(eventKey);
  }

  /**
   * Mark event as processed
   */
  private markEventProcessed(eventKey: string): void {
    this.processedEvents.add(eventKey);
    // Clean up old entries after 1 hour to prevent memory leak
    const cleanupTimer = setTimeout(
      () => this.processedEvents.delete(eventKey),
      3600000,
    );
    cleanupTimer.unref?.();
  }

  @OnEvent('order.cancelled')
  async handleOrderCancelled(event: OrderCancelledEvent) {
    const eventKey = this.getEventKey('order.cancelled', event.orderId, event.timestamp);

    if (this.isEventProcessed(eventKey)) {
      this.logger.warn(`Duplicate event detected: ${eventKey}`);
      return;
    }

    this.logger.log(`Handling order cancelled: ${event.orderId}`);

    // TODO: Implement dispatch cancellation logic
    const result = {
      orderId: event.orderId,
      status: 'cancelled',
      reason: event.reason,
      cancelledAt: new Date(),
    };

    this.markEventProcessed(eventKey);

    this.logger.log(`Dispatch cancelled for order ${event.orderId}`);
    return result;
  }

  @OnEvent('order.status.updated')
  async handleOrderStatusUpdated(event: OrderStatusUpdatedEvent) {
    const eventKey = this.getEventKey('order.status.updated', event.orderId, event.timestamp);

    if (this.isEventProcessed(eventKey)) {
      this.logger.warn(`Duplicate event detected: ${eventKey}`);
      return;
    }

    this.logger.log(
      `Handling order status update: ${event.orderId} from ${event.previousStatus} to ${event.newStatus}`,
    );

    // TODO: Implement dispatch status update logic based on order status
    const result = {
      orderId: event.orderId,
      previousStatus: event.previousStatus,
      newStatus: event.newStatus,
      updatedAt: new Date(),
    };

    this.markEventProcessed(eventKey);

    this.logger.log(`Dispatch status updated for order ${event.orderId}`);
    return result;
  }

  @OnEvent('order.rider.assigned')
  async handleOrderRiderAssigned(event: OrderRiderAssignedEvent) {
    const eventKey = this.getEventKey('order.rider.assigned', event.orderId, event.timestamp);

    if (this.isEventProcessed(eventKey)) {
      this.logger.warn(`Duplicate event detected: ${eventKey}`);
      return;
    }

    this.logger.log(`Handling rider assignment: ${event.riderId} to order ${event.orderId}`);

    // TODO: Implement dispatch rider assignment logic
    const result = {
      orderId: event.orderId,
      riderId: event.riderId,
      status: 'assigned',
      assignedAt: new Date(),
    };

    this.markEventProcessed(eventKey);

    this.logger.log(`Rider ${event.riderId} assigned to dispatch for order ${event.orderId}`);
    return result;
  }

  async findAll(): Promise<{ message: string; data: unknown[] }> {
    return {
      message: 'Dispatches retrieved successfully',
      data: (await this.riderAssignmentService.getAssignmentLogs()).data,
    };
  }

  async findOne(id: string) {
    // TODO: Implement find dispatch by id logic
    return {
      message: 'Dispatch retrieved successfully',
      data: { id },
    };
  }

  async create(createDispatchDto: any) {
    // TODO: Implement create dispatch logic
    return {
      message: 'Dispatch created successfully',
      data: createDispatchDto,
    };
  }

  async update(id: string, updateDispatchDto: any) {
    // TODO: Implement update dispatch logic
    return {
      message: 'Dispatch updated successfully',
      data: { id, ...updateDispatchDto },
    };
  }

  async remove(id: string) {
    // TODO: Implement delete dispatch logic
    return {
      message: 'Dispatch deleted successfully',
      data: { id },
    };
  }

  async assignOrder(orderId: string, riderId: string) {
    this.eventEmitter.emit(
      'order.rider.assigned',
      new OrderRiderAssignedEvent(orderId, riderId),
    );
    return {
      message: 'Order assigned to rider successfully',
      data: { orderId, riderId },
    };
  }

  async completeDispatch(dispatchId: string) {
    // TODO: Implement complete dispatch logic
    return {
      message: 'Dispatch completed successfully',
      data: { id: dispatchId, status: 'completed' },
    };
  }

  async cancelDispatch(dispatchId: string, reason: string) {
    // TODO: Implement cancel dispatch logic
    return {
      message: 'Dispatch cancelled successfully',
      data: { id: dispatchId, status: 'cancelled', reason },
    };
  }

  getDispatchStats(): {
    message: string;
    data: {
      total: number;
      pending: number;
      accepted: number;
      escalated: number;
      timeout: number;
      rejected: number;
    };
  } {
    return this.riderAssignmentService.getDispatchStats();
  }

  async getAssignmentLogs(orderId?: string): Promise<{ message: string; data: unknown[] }> {
    return this.riderAssignmentService.getAssignmentLogs(orderId);
  }

  async respondToAssignment(orderId: string, riderId: string, accepted: boolean) {
    return this.riderAssignmentService.respondToAssignment(orderId, riderId, accepted);
  }
}
