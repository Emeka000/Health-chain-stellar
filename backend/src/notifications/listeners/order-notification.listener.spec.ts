import { Test, TestingModule } from '@nestjs/testing';

import {
  OrderConfirmedEvent,
  OrderCancelledEvent,
  OrderRiderAssignedEvent,
  OrderDispatchedEvent,
  OrderDeliveredEvent,
} from '../../events';
import { NotificationChannel } from '../enums/notification-channel.enum';
import { NotificationsService } from '../notifications.service';

import { OrderNotificationListener } from './order-notification.listener';

describe('OrderNotificationListener', () => {
  let listener: OrderNotificationListener;
  let notificationsService: jest.Mocked<NotificationsService>;

  beforeEach(async () => {
    const mockNotificationsService = {
      send: jest.fn().mockResolvedValue([]),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OrderNotificationListener,
        {
          provide: NotificationsService,
          useValue: mockNotificationsService,
        },
      ],
    }).compile();

    listener = module.get<OrderNotificationListener>(OrderNotificationListener);
    notificationsService = module.get(NotificationsService);
  });

  it('should be defined', () => {
    expect(listener).toBeDefined();
  });

  describe('handleOrderConfirmed', () => {
    it('should send notification when order is confirmed', async () => {
      const event = new OrderConfirmedEvent(
        'order-123',
        'hospital-456',
        'A+',
        2,
        '123 Main St',
      );

      await listener.handleOrderConfirmed(event);

      expect(notificationsService.send).toHaveBeenCalledWith({
        recipientId: 'hospital-456',
        channels: [NotificationChannel.SMS, NotificationChannel.IN_APP],
        templateKey: 'order.confirmed',
        variables: {
          orderId: 'order-123',
          bloodType: 'A+',
          quantity: '2',
          deliveryAddress: '123 Main St',
        },
      });
    });

    it('should not throw when notification service fails', async () => {
      notificationsService.send.mockRejectedValue(new Error('Queue down'));
      const event = new OrderConfirmedEvent(
        'order-123',
        'hospital-456',
        'A+',
        2,
        '123 Main St',
      );

      await expect(listener.handleOrderConfirmed(event)).resolves.not.toThrow();
    });
  });

  describe('handleOrderCancelled', () => {
    it('should send notification when order is cancelled', async () => {
      const event = new OrderCancelledEvent(
        'order-123',
        'hospital-456',
        'Out of stock',
      );

      await listener.handleOrderCancelled(event);

      expect(notificationsService.send).toHaveBeenCalledWith({
        recipientId: 'hospital-456',
        channels: [NotificationChannel.SMS, NotificationChannel.IN_APP],
        templateKey: 'order.cancelled',
        variables: {
          orderId: 'order-123',
          reason: 'Out of stock',
        },
      });
    });
  });

  describe('handleOrderRiderAssigned', () => {
    it('should send notification when rider is assigned', async () => {
      const event = new OrderRiderAssignedEvent('order-123', 'rider-789');

      await listener.handleOrderRiderAssigned(event);

      expect(notificationsService.send).toHaveBeenCalledWith({
        recipientId: 'rider-789',
        channels: [
          NotificationChannel.SMS,
          NotificationChannel.PUSH,
          NotificationChannel.IN_APP,
        ],
        templateKey: 'order.rider.assigned',
        variables: {
          orderId: 'order-123',
          riderId: 'rider-789',
        },
      });
    });
  });

  describe('handleOrderDispatched', () => {
    it('should send notification when order is dispatched', async () => {
      const event = new OrderDispatchedEvent('order-123', 'rider-789');

      await listener.handleOrderDispatched(event);

      expect(notificationsService.send).toHaveBeenCalledWith({
        recipientId: 'rider-789',
        channels: [NotificationChannel.PUSH, NotificationChannel.IN_APP],
        templateKey: 'order.dispatched',
        variables: {
          orderId: 'order-123',
        },
      });
    });
  });

  describe('handleOrderDelivered', () => {
    it('should send notification to the hospital when order is delivered', async () => {
      const event = new OrderDeliveredEvent('order-123', 'hospital-456');

      await listener.handleOrderDelivered(event);

      expect(notificationsService.send).toHaveBeenCalledWith({
        recipientId: 'hospital-456',
        channels: [NotificationChannel.SMS, NotificationChannel.IN_APP],
        templateKey: 'order.delivered',
        variables: {
          orderId: 'order-123',
        },
      });
    });
  });
});
