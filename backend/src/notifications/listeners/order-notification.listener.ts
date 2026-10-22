import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';

import {
  OrderConfirmedEvent,
  OrderCancelledEvent,
  OrderRiderAssignedEvent,
  OrderDispatchedEvent,
  OrderDeliveredEvent,
} from '../../events';
import { NotificationChannel } from '../enums/notification-channel.enum';
import { NotificationsService } from '../notifications.service';

/**
 * Event-driven notification listener for order-related events.
 * Handles all notification dispatch asynchronously via BullMQ jobs.
 * HTTP responses are never blocked by notification delivery.
 */
@Injectable()
export class OrderNotificationListener {
  private readonly logger = new Logger(OrderNotificationListener.name);

  constructor(private readonly notificationsService: NotificationsService) {}

  @OnEvent('order.confirmed')
  async handleOrderConfirmed(event: OrderConfirmedEvent) {
    this.logger.log(
      `Handling order.confirmed notification for order ${event.orderId}`,
    );

    try {
      // Send notification to hospital
      await this.notificationsService.send({
        recipientId: event.hospitalId,
        channels: [NotificationChannel.SMS, NotificationChannel.IN_APP],
        templateKey: 'order.confirmed',
        variables: {
          orderId: event.orderId,
          bloodType: event.bloodType,
          quantity: event.quantity.toString(),
          deliveryAddress: event.deliveryAddress,
        },
      });
    } catch (error) {
      // Log error but don't throw - notifications are best-effort
      this.logger.error(
        `Failed to queue notification for order.confirmed: ${event.orderId}`,
        error.stack,
      );
    }
  }

  @OnEvent('order.cancelled')
  async handleOrderCancelled(event: OrderCancelledEvent) {
    this.logger.log(
      `Handling order.cancelled notification for order ${event.orderId}`,
    );

    try {
      // Send notification to hospital
      await this.notificationsService.send({
        recipientId: event.hospitalId,
        channels: [NotificationChannel.SMS, NotificationChannel.IN_APP],
        templateKey: 'order.cancelled',
        variables: {
          orderId: event.orderId,
          reason: event.reason,
        },
      });
    } catch (error) {
      this.logger.error(
        `Failed to queue notification for order.cancelled: ${event.orderId}`,
        error.stack,
      );
    }
  }

  @OnEvent('order.rider.assigned')
  async handleOrderRiderAssigned(event: OrderRiderAssignedEvent) {
    this.logger.log(
      `Handling order.rider.assigned notification for order ${event.orderId}`,
    );

    try {
      // Send notification to rider
      await this.notificationsService.send({
        recipientId: event.riderId,
        channels: [
          NotificationChannel.SMS,
          NotificationChannel.PUSH,
          NotificationChannel.IN_APP,
        ],
        templateKey: 'order.rider.assigned',
        variables: {
          orderId: event.orderId,
          riderId: event.riderId,
        },
      });
    } catch (error) {
      this.logger.error(
        `Failed to queue notification for order.rider.assigned: ${event.orderId}`,
        error.stack,
      );
    }
  }

  @OnEvent('order.dispatched')
  async handleOrderDispatched(event: OrderDispatchedEvent) {
    this.logger.log(
      `Handling order.dispatched notification for order ${event.orderId}`,
    );

    try {
      // Send notification to rider
      await this.notificationsService.send({
        recipientId: event.riderId,
        channels: [NotificationChannel.PUSH, NotificationChannel.IN_APP],
        templateKey: 'order.dispatched',
        variables: {
          orderId: event.orderId,
        },
      });
    } catch (error) {
      this.logger.error(
        `Failed to queue notification for order.dispatched: ${event.orderId}`,
        error.stack,
      );
    }
  }

  @OnEvent('order.delivered')
  async handleOrderDelivered(event: OrderDeliveredEvent) {
    this.logger.log(
      `Handling order.delivered notification for order ${event.orderId}`,
    );

    try {
      await this.notificationsService.send({
        recipientId: event.hospitalId,
        channels: [NotificationChannel.SMS, NotificationChannel.IN_APP],
        templateKey: 'order.delivered',
        variables: {
          orderId: event.orderId,
        },
      });
    } catch (error) {
      this.logger.error(
        `Failed to queue notification for order.delivered: ${event.orderId}`,
        error.stack,
      );
    }
  }
}
