import { ForbiddenException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { NotificationsService } from './notifications.service';
import { NotificationEntity } from './entities/notification.entity';
import { NotificationTemplateEntity } from './entities/notification-template.entity';
import { SecurityEventLoggerService } from '../user-activity/security-event-logger.service';

describe('NotificationsService tenant isolation', () => {
  let service: NotificationsService;

  const notificationRepo = {
    findAndCount: jest.fn(),
    findOne: jest.fn(),
    save: jest.fn(),
  };
  const templateRepo = {};
  const queue = { add: jest.fn() };
  const securityLogger = { logEvent: jest.fn() };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NotificationsService,
        { provide: getRepositoryToken(NotificationEntity), useValue: notificationRepo },
        {
          provide: getRepositoryToken(NotificationTemplateEntity),
          useValue: templateRepo,
        },
        { provide: 'BullQueue_notifications', useValue: queue },
        { provide: SecurityEventLoggerService, useValue: securityLogger },
      ],
    }).compile();

    service = module.get(NotificationsService);
  });

  it('denies querying another recipient notifications', async () => {
    await expect(
      service.findForRecipient(
        { recipientId: 'user-2', page: 1, limit: 10 },
        { userId: 'user-1', role: 'hospital', organizationId: 'org-1' },
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(securityLogger.logEvent).toHaveBeenCalled();
  });

  it('denies marking another user notification as read', async () => {
    notificationRepo.findOne.mockResolvedValue({
      id: 'n-1',
      recipientId: 'user-2',
      status: 'PENDING',
    });
    await expect(
      service.markRead('n-1', {
        userId: 'user-1',
        role: 'hospital',
        organizationId: 'org-1',
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(securityLogger.logEvent).toHaveBeenCalled();
  });
});
import { getQueueToken } from '@nestjs/bullmq';
import { NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { NotificationTemplateEntity } from './entities/notification-template.entity';
import { NotificationEntity } from './entities/notification.entity';
import { NotificationChannel } from './enums/notification-channel.enum';
import { NotificationStatus } from './enums/notification-status.enum';
import { NotificationsService } from './notifications.service';

describe('NotificationsService', () => {
  let service: NotificationsService;
  let mockNotificationRepo: any;
  let mockTemplateRepo: any;
  let mockQueue: any;

  beforeEach(async () => {
    mockNotificationRepo = {
      create: jest.fn(),
      save: jest.fn(),
      findAndCount: jest.fn(),
      findOne: jest.fn(),
    };

    mockTemplateRepo = {
      findOne: jest.fn(),
    };

    mockQueue = {
      add: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NotificationsService,
        {
          provide: getRepositoryToken(NotificationEntity),
          useValue: mockNotificationRepo,
        },
        {
          provide: getRepositoryToken(NotificationTemplateEntity),
          useValue: mockTemplateRepo,
        },
        {
          provide: getQueueToken('notifications'),
          useValue: mockQueue,
        },
      ],
    }).compile();

    service = module.get<NotificationsService>(NotificationsService);
  });

  describe('send', () => {
    it('should throw NotFoundException if template not found', async () => {
      mockTemplateRepo.findOne.mockResolvedValue(null);

      await expect(
        service.send({
          recipientId: 'user-1',
          channels: [NotificationChannel.EMAIL],
          templateKey: 'welcome',
          variables: {},
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it('should compile template, save notification and enqueue job for each channel', async () => {
      const template = {
        templateKey: 'welcome',
        channel: NotificationChannel.EMAIL,
        body: 'Hello {{name}}!',
      };
      mockTemplateRepo.findOne.mockResolvedValue(template);

      const savedNotification = {
        id: 'notif-1',
        recipientId: 'user-1',
        channel: NotificationChannel.EMAIL,
        templateKey: 'welcome',
        variables: { name: 'Alice' },
        renderedBody: 'Hello Alice!',
        status: NotificationStatus.PENDING,
      };

      mockNotificationRepo.create.mockReturnValue(savedNotification);
      mockNotificationRepo.save.mockResolvedValue(savedNotification);
      mockQueue.add.mockResolvedValue({ id: 'job-1' });

      const result = await service.send({
        recipientId: 'user-1',
        channels: [NotificationChannel.EMAIL],
        templateKey: 'welcome',
        variables: { name: 'Alice' },
      });

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('notif-1');
      expect(mockNotificationRepo.save).toHaveBeenCalledWith(savedNotification);
      expect(mockQueue.add).toHaveBeenCalledWith(
        'sendNotification',
        expect.objectContaining({
          notificationId: 'notif-1',
          renderedBody: 'Hello Alice!',
        }),
        expect.any(Object),
      );
    });
  });

  describe('findForRecipient', () => {
    it('should return paginated results', async () => {
      mockNotificationRepo.findAndCount.mockResolvedValue([
        [{ id: 'notif-1' }],
        1,
      ]);

      const result = await service.findForRecipient({
        recipientId: 'user-1',
        page: 2,
        limit: 5,
      });

      expect(result.meta.page).toBe(2);
      expect(result.meta.total).toBe(1);
      expect(mockNotificationRepo.findAndCount).toHaveBeenCalledWith(
        expect.objectContaining({
          skip: 5,
          take: 5,
          where: { recipientId: 'user-1' },
        }),
      );
    });
  });

  describe('markRead', () => {
    it('should update status to READ', async () => {
      const notification = { id: 'notif-1', status: NotificationStatus.SENT };
      mockNotificationRepo.findOne.mockResolvedValue(notification);
      mockNotificationRepo.save.mockResolvedValue({
        ...notification,
        status: NotificationStatus.READ,
      });

      const result = await service.markRead('notif-1');

      expect(result.data.status).toBe(NotificationStatus.READ);
      expect(mockNotificationRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ status: NotificationStatus.READ }),
      );
    });
  });
});
