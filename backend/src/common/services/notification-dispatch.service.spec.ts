import { Test, TestingModule } from '@nestjs/testing';
import { NotificationDispatchService } from './notification-dispatch.service';
import { NotificationsService } from '../../notifications/notifications.service';
import { NotificationChannel } from '../../notifications/enums/notification-channel.enum';

describe('NotificationDispatchService', () => {
  let service: NotificationDispatchService;
  const mockNotifications = { send: jest.fn().mockResolvedValue([]) };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NotificationDispatchService,
        { provide: NotificationsService, useValue: mockNotifications },
      ],
    }).compile();
    service = module.get(NotificationDispatchService);
  });

  it('calls notificationsService.send with IN_APP channel by default', async () => {
    await service.dispatch({ recipientId: 'user-1', templateKey: 'order.status.updated' });
    expect(mockNotifications.send).toHaveBeenCalledWith(
      expect.objectContaining({
        recipientId: 'user-1',
        templateKey: 'order.status.updated',
        channels: [NotificationChannel.IN_APP],
      }),
    );
  });

  it('uses caller-supplied channels when provided', async () => {
    await service.dispatch({
      recipientId: 'user-1',
      templateKey: 'order.status.updated',
      channels: [NotificationChannel.EMAIL],
    });
    expect(mockNotifications.send).toHaveBeenCalledWith(
      expect.objectContaining({ channels: [NotificationChannel.EMAIL] }),
    );
  });

  it('passes variables through to notificationsService.send', async () => {
    await service.dispatch({
      recipientId: 'user-1',
      templateKey: 'order.status.updated',
      variables: { orderId: 'o-1', newStatus: 'DELIVERED' },
    });
    expect(mockNotifications.send).toHaveBeenCalledWith(
      expect.objectContaining({ variables: { orderId: 'o-1', newStatus: 'DELIVERED' } }),
    );
  });

  it('swallows errors from notificationsService.send without throwing', async () => {
    mockNotifications.send.mockRejectedValueOnce(new Error('queue down'));
    await expect(
      service.dispatch({ recipientId: 'user-1', templateKey: 'any' }),
    ).resolves.toBeUndefined();
  });

  it('is a no-op when notificationsService is not injected', async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [NotificationDispatchService],
    }).compile();
    const svc = module.get(NotificationDispatchService);
    await expect(
      svc.dispatch({ recipientId: 'user-1', templateKey: 'any' }),
    ).resolves.toBeUndefined();
    expect(mockNotifications.send).not.toHaveBeenCalled();
  });
});
