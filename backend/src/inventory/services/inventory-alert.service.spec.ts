import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { Repository } from 'typeorm';

import { NotificationsService } from '../../notifications/notifications.service';
import { AlertPreferenceEntity } from '../entities/alert-preference.entity';
import {
  InventoryAlertEntity,
  AlertType,
  AlertSeverity,
  AlertStatus,
} from '../entities/inventory-alert.entity';
import { InventoryStockEntity } from '../entities/inventory-stock.entity';

import { InventoryAlertService } from './inventory-alert.service';

describe('InventoryAlertService', () => {
  let service: InventoryAlertService;
  let alertRepository: Repository<InventoryAlertEntity>;
  let preferenceRepository: Repository<AlertPreferenceEntity>;
  let inventoryRepository: Repository<InventoryStockEntity>;
  let notificationsService: NotificationsService;

  const mockAlert: InventoryAlertEntity = {
    id: 'alert-1',
    bloodBankId: 'bank-1',
    bloodType: 'A+',
    alertType: AlertType.LOW_STOCK,
    severity: AlertSeverity.HIGH,
    status: AlertStatus.ACTIVE,
    message: 'Low stock alert',
    thresholdValue: 10,
    currentValue: 5,
    metadata: null,
    dismissedAt: null,
    dismissedBy: null,
    resolvedAt: null,
    resolvedBy: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  } as InventoryAlertEntity;

  const mockPreference: AlertPreferenceEntity = {
    id: 'pref-1',
    organizationId: 'org-1',
    lowStockThreshold: 10,
    criticalStockThreshold: 5,
    expiringSoonDays: 7,
    enableLowStockAlerts: true,
    enableExpiringAlerts: true,
    enableExpiredAlerts: true,
    enableEmailNotifications: true,
    enableSmsNotifications: false,
    enableInAppNotifications: true,
    notificationEmails: ['test@example.com'],
    notificationPhones: null,
    preferences: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  } as AlertPreferenceEntity;

  const mockAlertRepository = {
    find: jest.fn(),
    findOne: jest.fn(),
    create: jest.fn(),
    save: jest.fn(),
    createQueryBuilder: jest.fn(),
  };

  const mockPreferenceRepository = {
    find: jest.fn(),
    findOne: jest.fn(),
    create: jest.fn(),
    save: jest.fn(),
  };

  const mockInventoryRepository = {
    find: jest.fn(),
  };

  const mockNotificationsService = {
    send: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        InventoryAlertService,
        {
          provide: getRepositoryToken(InventoryAlertEntity),
          useValue: mockAlertRepository,
        },
        {
          provide: getRepositoryToken(AlertPreferenceEntity),
          useValue: mockPreferenceRepository,
        },
        {
          provide: getRepositoryToken(InventoryStockEntity),
          useValue: mockInventoryRepository,
        },
        {
          provide: NotificationsService,
          useValue: mockNotificationsService,
        },
      ],
    }).compile();

    service = module.get<InventoryAlertService>(InventoryAlertService);
    alertRepository = module.get<Repository<InventoryAlertEntity>>(
      getRepositoryToken(InventoryAlertEntity),
    );
    preferenceRepository = module.get<Repository<AlertPreferenceEntity>>(
      getRepositoryToken(AlertPreferenceEntity),
    );
    inventoryRepository = module.get<Repository<InventoryStockEntity>>(
      getRepositoryToken(InventoryStockEntity),
    );
    notificationsService =
      module.get<NotificationsService>(NotificationsService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('createAlert', () => {
    it('should create a new alert', async () => {
      mockAlertRepository.findOne.mockResolvedValue(null);
      mockAlertRepository.create.mockReturnValue(mockAlert);
      mockAlertRepository.save.mockResolvedValue(mockAlert);
      mockPreferenceRepository.findOne.mockResolvedValue(mockPreference);
      mockNotificationsService.send.mockResolvedValue(undefined);

      const result = await service.createAlert({
        bloodBankId: 'bank-1',
        bloodType: 'A+',
        alertType: AlertType.LOW_STOCK,
        severity: AlertSeverity.HIGH,
        message: 'Low stock alert',
        thresholdValue: 10,
        currentValue: 5,
      });

      expect(result).toEqual(mockAlert);
      expect(mockAlertRepository.create).toHaveBeenCalled();
      expect(mockAlertRepository.save).toHaveBeenCalled();
    });

    it('should update existing alert if similar alert exists', async () => {
      mockAlertRepository.findOne.mockResolvedValue(mockAlert);
      mockAlertRepository.save.mockResolvedValue(mockAlert);

      const result = await service.createAlert({
        bloodBankId: 'bank-1',
        bloodType: 'A+',
        alertType: AlertType.LOW_STOCK,
        severity: AlertSeverity.HIGH,
        message: 'Updated alert',
        currentValue: 3,
      });

      expect(result).toEqual(mockAlert);
      expect(mockAlertRepository.save).toHaveBeenCalled();
    });
  });

  describe('dismissAlert', () => {
    it('should dismiss an alert', async () => {
      mockAlertRepository.findOne.mockResolvedValue(mockAlert);
      mockAlertRepository.save.mockResolvedValue({
        ...mockAlert,
        status: AlertStatus.DISMISSED,
        dismissedAt: new Date(),
        dismissedBy: 'user-1',
      });

      const result = await service.dismissAlert({
        alertId: 'alert-1',
        dismissedBy: 'user-1',
      });

      expect(result.status).toBe(AlertStatus.DISMISSED);
      expect(result.dismissedBy).toBe('user-1');
    });

    it('should throw error if alert not found', async () => {
      mockAlertRepository.findOne.mockResolvedValue(null);

      await expect(
        service.dismissAlert({
          alertId: 'alert-1',
          dismissedBy: 'user-1',
        }),
      ).rejects.toThrow('Alert with ID alert-1 not found');
    });
  });

  describe('resolveAlert', () => {
    it('should resolve an alert', async () => {
      mockAlertRepository.findOne.mockResolvedValue(mockAlert);
      mockAlertRepository.save.mockResolvedValue({
        ...mockAlert,
        status: AlertStatus.RESOLVED,
        resolvedAt: new Date(),
        resolvedBy: 'user-1',
      });

      const result = await service.resolveAlert({
        alertId: 'alert-1',
        resolvedBy: 'user-1',
      });

      expect(result.status).toBe(AlertStatus.RESOLVED);
      expect(result.resolvedBy).toBe('user-1');
    });

    it('should throw error if alert not found', async () => {
      mockAlertRepository.findOne.mockResolvedValue(null);

      await expect(
        service.resolveAlert({
          alertId: 'alert-1',
          resolvedBy: 'user-1',
        }),
      ).rejects.toThrow('Alert with ID alert-1 not found');
    });
  });

  describe('getAlerts', () => {
    it('should return alerts with filters', async () => {
      const mockQueryBuilder = {
        andWhere: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        take: jest.fn().mockReturnThis(),
        skip: jest.fn().mockReturnThis(),
        getManyAndCount: jest.fn().mockResolvedValue([[mockAlert], 1]),
      };
      mockAlertRepository.createQueryBuilder.mockReturnValue(mockQueryBuilder);

      const result = await service.getAlerts(
        {
          bloodBankId: 'bank-1',
          alertType: AlertType.LOW_STOCK,
          status: AlertStatus.ACTIVE,
        },
        50,
        0,
      );

      expect(result.data).toEqual([mockAlert]);
      expect(result.total).toBe(1);
    });
  });

  describe('getAlertStats', () => {
    it('should return alert statistics', async () => {
      mockAlertRepository.find.mockResolvedValue([mockAlert]);

      const result = await service.getAlertStats('bank-1');

      expect(result.totalActive).toBe(1);
      expect(result.byType[AlertType.LOW_STOCK]).toBe(1);
      expect(result.bySeverity[AlertSeverity.HIGH]).toBe(1);
    });
  });

  describe('getAlertPreferences', () => {
    it('should return alert preferences', async () => {
      mockPreferenceRepository.findOne.mockResolvedValue(mockPreference);

      const result = await service.getAlertPreferences('org-1');

      expect(result).toEqual(mockPreference);
    });

    it('should create default preferences if not found', async () => {
      mockPreferenceRepository.findOne.mockResolvedValue(null);
      mockPreferenceRepository.create.mockReturnValue(mockPreference);
      mockPreferenceRepository.save.mockResolvedValue(mockPreference);

      const result = await service.getAlertPreferences('org-1');

      expect(result).toEqual(mockPreference);
      expect(mockPreferenceRepository.create).toHaveBeenCalled();
    });
  });

  describe('updateAlertPreferences', () => {
    it('should update alert preferences', async () => {
      mockPreferenceRepository.findOne.mockResolvedValue(mockPreference);
      mockPreferenceRepository.save.mockResolvedValue({
        ...mockPreference,
        lowStockThreshold: 15,
      });

      const result = await service.updateAlertPreferences('org-1', {
        lowStockThreshold: 15,
      });

      expect(result.lowStockThreshold).toBe(15);
    });
  });

  describe('checkLowStockAlerts', () => {
    it('should check and create low stock alerts', async () => {
      const mockInventory = [
        {
          id: 'inv-1',
          bloodBankId: 'bank-1',
          bloodType: 'A+',
          availableUnits: 5,
        },
      ];

      mockPreferenceRepository.find.mockResolvedValue([mockPreference]);
      mockInventoryRepository.find.mockResolvedValue(mockInventory);
      mockAlertRepository.findOne.mockResolvedValue(null);
      mockAlertRepository.create.mockReturnValue(mockAlert);
      mockAlertRepository.save.mockResolvedValue(mockAlert);
      mockNotificationsService.send.mockResolvedValue(undefined);

      await service.checkLowStockAlerts();

      expect(mockInventoryRepository.find).toHaveBeenCalled();
    });
  });
});
