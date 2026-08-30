import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { ConfigService } from '@nestjs/config';

import { ColdChainService } from './cold-chain.service';
import { TemperatureSampleEntity } from './entities/temperature-sample.entity';
import { DeliveryComplianceEntity } from './entities/delivery-compliance.entity';

describe('ColdChainService', () => {
  let service: ColdChainService;
  let samples: Partial<TemperatureSampleEntity>[];
  let complianceRecord: Partial<DeliveryComplianceEntity> | null;

  const now = new Date('2026-01-01T10:00:00Z');
  const t = (offsetMs: number) => new Date(now.getTime() + offsetMs);

  const mockSampleRepo = {
    create: jest.fn((x) => x),
    save: jest.fn((x) => Promise.resolve({ ...x, id: 'sample-uuid' })),
    find: jest.fn(() => Promise.resolve(samples)),
  };

  const mockComplianceRepo = {
    create: jest.fn((x) => ({ ...x })),
    findOne: jest.fn(() => Promise.resolve(complianceRecord)),
    save: jest.fn((x) => {
      complianceRecord = { ...x };
      return Promise.resolve(complianceRecord);
    }),
  };

  const mockEventEmitter = {
    emit: jest.fn(),
  };

  const mockConfigService = {
    get: jest.fn((key: string, defaultValue: number) => defaultValue),
  };

  beforeEach(async () => {
    samples = [];
    complianceRecord = null;
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ColdChainService,
        { provide: getRepositoryToken(TemperatureSampleEntity), useValue: mockSampleRepo },
        { provide: getRepositoryToken(DeliveryComplianceEntity), useValue: mockComplianceRepo },
        { provide: EventEmitter2, useValue: mockEventEmitter },
        { provide: ConfigService, useValue: mockConfigService },
      ],
    }).compile();

    service = module.get(ColdChainService);
  });

  const sample = (
    id: string,
    temperatureCelsius: number,
    recordedAt: Date,
    isExcursion: boolean,
  ): Partial<TemperatureSampleEntity> => ({
    id,
    deliveryId: 'd1',
    orderId: null,
    temperatureCelsius,
    recordedAt,
    isExcursion,
  });

  it('marks a delivery compliant when all samples are within 2-8°C', async () => {
    samples = [
      sample('s1', 4, t(0), false),
      sample('s2', 6, t(60_000), false),
    ];

    await service.ingest({ deliveryId: 'd1', temperatureCelsius: 6, recordedAt: t(60_000).toISOString() });

    expect(complianceRecord?.isCompliant).toBe(true);
    expect(complianceRecord?.excursionCount).toBe(0);
    expect(complianceRecord?.breachDurationMinutes).toBe(0);
    expect(mockEventEmitter.emit).not.toHaveBeenCalled();
  });

  it('flags a single excursion above the safe range as non-compliant', async () => {
    samples = [
      sample('s1', 4, t(0), false),
      sample('s2', 10, t(60_000), true),
    ];

    await service.ingest({ deliveryId: 'd1', temperatureCelsius: 10, recordedAt: t(60_000).toISOString() });

    expect(complianceRecord?.isCompliant).toBe(false);
    expect(complianceRecord?.excursionCount).toBe(1);
    expect(complianceRecord?.maxTempCelsius).toBe(10);
  });

  it('flags a single excursion below the safe range as non-compliant', async () => {
    samples = [
      sample('s1', 4, t(0), false),
      sample('s2', 0, t(60_000), true),
    ];

    await service.ingest({ deliveryId: 'd1', temperatureCelsius: 0, recordedAt: t(60_000).toISOString() });

    expect(complianceRecord?.isCompliant).toBe(false);
    expect(complianceRecord?.excursionCount).toBe(1);
    expect(complianceRecord?.minTempCelsius).toBe(0);
  });

  it('treats exactly 2°C and 8°C as within the safe boundary (compliant)', async () => {
    samples = [
      sample('s1', 2, t(0), false),
      sample('s2', 8, t(60_000), false),
    ];

    await service.ingest({ deliveryId: 'd1', temperatureCelsius: 8, recordedAt: t(60_000).toISOString() });

    expect(complianceRecord?.isCompliant).toBe(true);
    expect(complianceRecord?.excursionCount).toBe(0);
  });

  it('accumulates breach duration across multiple separate excursion windows', async () => {
    // Window 1: 0 -> 5min excursion (5 minutes), safe sample, Window 2: 10 -> 16min excursion (6 minutes)
    samples = [
      sample('s1', 10, t(0), true),
      sample('s2', 11, t(5 * 60_000), true),
      sample('s3', 5, t(6 * 60_000), false),
      sample('s4', 9, t(10 * 60_000), true),
      sample('s5', 9.5, t(16 * 60_000), true),
    ];

    await service.ingest({
      deliveryId: 'd1',
      temperatureCelsius: 9.5,
      recordedAt: t(16 * 60_000).toISOString(),
    });

    // Window 1 = 5 minutes, Window 2 = 6 minutes -> cumulative 11 minutes
    expect(complianceRecord?.breachDurationMinutes).toBe(11);
  });

  it('fires the cold-chain.breach event exactly once when the suspension threshold is crossed', async () => {
    mockConfigService.get.mockImplementation((key: string, defaultValue: number) =>
      key === 'COLD_CHAIN_SUSPENSION_THRESHOLD_MINUTES' ? 15 : defaultValue,
    );

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ColdChainService,
        { provide: getRepositoryToken(TemperatureSampleEntity), useValue: mockSampleRepo },
        { provide: getRepositoryToken(DeliveryComplianceEntity), useValue: mockComplianceRepo },
        { provide: EventEmitter2, useValue: mockEventEmitter },
        { provide: ConfigService, useValue: mockConfigService },
      ],
    }).compile();
    service = module.get(ColdChainService);

    // First ingest: 20-minute breach window crosses the 15-minute threshold.
    samples = [
      sample('s1', 10, t(0), true),
      sample('s2', 10, t(20 * 60_000), true),
    ];

    await service.ingest({
      deliveryId: 'd1',
      temperatureCelsius: 10,
      recordedAt: t(20 * 60_000).toISOString(),
    });

    expect(complianceRecord?.suspensionTriggered).toBe(true);
    expect(mockEventEmitter.emit).toHaveBeenCalledTimes(1);
    expect(mockEventEmitter.emit).toHaveBeenCalledWith(
      'cold-chain.breach',
      expect.objectContaining({ deliveryId: 'd1', breachDurationMinutes: 20 }),
    );

    // Second ingest: still breaching, but suspension already triggered -> no repeat event.
    samples = [
      sample('s1', 10, t(0), true),
      sample('s2', 10, t(20 * 60_000), true),
      sample('s3', 10, t(25 * 60_000), true),
    ];

    await service.ingest({
      deliveryId: 'd1',
      temperatureCelsius: 10,
      recordedAt: t(25 * 60_000).toISOString(),
    });

    expect(mockEventEmitter.emit).toHaveBeenCalledTimes(1);
  });

  it('does not fire the breach event when the excursion duration stays below the threshold', async () => {
    samples = [
      sample('s1', 10, t(0), true),
      sample('s2', 10, t(5 * 60_000), true),
    ];

    await service.ingest({
      deliveryId: 'd1',
      temperatureCelsius: 10,
      recordedAt: t(5 * 60_000).toISOString(),
    });

    expect(complianceRecord?.suspensionTriggered).toBeFalsy();
    expect(mockEventEmitter.emit).not.toHaveBeenCalled();
  });
});
