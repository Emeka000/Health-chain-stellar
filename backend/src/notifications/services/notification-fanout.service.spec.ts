import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { NotificationFanoutService } from './notification-fanout.service';
import { NotificationPreference, NotificationCategory, NotificationChannel, EmergencyTier } from '../entities/notification-preference.entity';
import { NotificationDeliveryLog, DeliveryStatus } from '../entities/notification-delivery-log.entity';
import { NotificationFanoutAttemptEntity } from '../entities/notification-fanout-attempt.entity';

const mockPreferenceRepo = { findOne: jest.fn(), find: jest.fn() };
const mockDeliveryLogRepo = { findOne: jest.fn(), count: jest.fn(), save: jest.fn(), create: jest.fn((x) => x) };
const mockAttemptRepo = { findOne: jest.fn(), save: jest.fn(), create: jest.fn((x) => x) };

describe('NotificationFanoutService', () => {
  let service: NotificationFanoutService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NotificationFanoutService,
        { provide: getRepositoryToken(NotificationPreference), useValue: mockPreferenceRepo },
        { provide: getRepositoryToken(NotificationDeliveryLog), useValue: mockDeliveryLogRepo },
        { provide: getRepositoryToken(NotificationFanoutAttemptEntity), useValue: mockAttemptRepo },
      ],
    }).compile();
    service = module.get(NotificationFanoutService);
    jest.clearAllMocks();
  });

  it('dispatches to all enabled channels', async () => {
    mockPreferenceRepo.findOne.mockResolvedValue({
      enabled: true,
      channels: [NotificationChannel.EMAIL, NotificationChannel.SMS],
    });
    mockDeliveryLogRepo.findOne.mockResolvedValue(null);
    mockDeliveryLogRepo.count.mockResolvedValue(0);
    mockAttemptRepo.findOne.mockResolvedValue(null);

    const result = await service.fanout({
      userId: 'user-1',
      category: NotificationCategory.DELIVERY_UPDATE,
      payload: {},
    });

    expect(result.dispatched).toHaveLength(2);
    expect(result.dispatched.every((d) => d.status === DeliveryStatus.SENT)).toBe(true);
  });

  it('skips duplicate idempotency key', async () => {
    mockAttemptRepo.findOne.mockResolvedValue({ id: 'existing' });

    const result = await service.fanout({
      userId: 'user-1',
      category: NotificationCategory.DELIVERY_UPDATE,
      payload: {},
      idempotencyKey: 'key-123',
    });

    expect(result.dispatched).toHaveLength(0);
  });

  it('applies critical override for CRITICAL_SHORTAGE + CRITICAL tier', async () => {
    mockPreferenceRepo.findOne.mockResolvedValue(null); // no preference set
    mockDeliveryLogRepo.findOne.mockResolvedValue(null);
    mockAttemptRepo.findOne.mockResolvedValue(null);

    const result = await service.fanout({
      userId: 'user-1',
      category: NotificationCategory.CRITICAL_SHORTAGE,
      emergencyTier: EmergencyTier.CRITICAL,
      payload: {},
    });

    expect(result.criticalOverride).toBe(true);
    expect(result.dispatched.length).toBeGreaterThan(0);
  });

  it('skips channel in cooldown', async () => {
    mockPreferenceRepo.findOne.mockResolvedValue({
      enabled: true,
      channels: [NotificationChannel.EMAIL],
    });
    mockAttemptRepo.findOne.mockResolvedValue(null);
    mockDeliveryLogRepo.count.mockResolvedValue(1);
    // Last sent 10 seconds ago — within 60s cooldown for DELIVERY_UPDATE
    mockDeliveryLogRepo.findOne.mockResolvedValue({ createdAt: new Date(Date.now() - 10_000) });

    const result = await service.fanout({
      userId: 'user-1',
      category: NotificationCategory.DELIVERY_UPDATE,
      payload: {},
    });

    expect(result.dispatched[0].status).toBe(DeliveryStatus.SKIPPED);
    expect(result.dispatched[0].reason).toBe('cooldown');
  });
});
