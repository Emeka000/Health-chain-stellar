import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';

import { AnomalyDriftService } from '../anomaly-drift.service';
import { AnomalyIncidentEntity } from '../entities/anomaly-incident.entity';
import { AnomalyType, AnomalySeverity, AnomalyStatus } from '../enums/anomaly-type.enum';

const mockRepo = () => ({
  find: jest.fn(),
  findOne: jest.fn(),
  create: jest.fn((v) => v),
  save: jest.fn((v) => Promise.resolve({ id: 'drift-1', ...v })),
  createQueryBuilder: jest.fn(() => ({
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    getMany: jest.fn().mockResolvedValue([]),
  })),
});

describe('AnomalyDriftService', () => {
  let service: AnomalyDriftService;
  let repo: ReturnType<typeof mockRepo>;
  let emitter: { emit: jest.Mock };

  beforeEach(async () => {
    repo = mockRepo();
    emitter = { emit: jest.fn() };
    const module = await Test.createTestingModule({
      providers: [
        AnomalyDriftService,
        { provide: getRepositoryToken(AnomalyIncidentEntity), useValue: repo },
        { provide: EventEmitter2, useValue: emitter },
      ],
    }).compile();
    service = module.get(AnomalyDriftService);
  });

  it('returns no drift when no baselines registered', async () => {
    repo.find.mockResolvedValue([]);
    const result = await service.evaluateDrift('1.0.0');
    expect(result.driftDetected).toBe(false);
    expect(result.driftedFeatures).toHaveLength(0);
    expect(result.incidentId).toBeNull();
  });

  it('detects drift when z-score exceeds threshold', async () => {
    // Register a baseline with mean=1 (LOW severity)
    service.registerBaseline({
      modelVersion: '1.0.0',
      featureName: 'severity_score',
      mean: 1.0,
      stdDev: 0.1,
      sampleSize: 100,
      capturedAt: new Date(),
    });

    // Recent incidents are all HIGH severity (score=3) — large drift
    repo.find.mockResolvedValue([
      { severity: 'HIGH', type: AnomalyType.DUPLICATE_EMERGENCY_REQUEST, createdAt: new Date() },
      { severity: 'HIGH', type: AnomalyType.SUDDEN_STOCK_SWING, createdAt: new Date() },
      { severity: 'HIGH', type: AnomalyType.RIDER_ROUTE_DEVIATION, createdAt: new Date() },
    ]);

    const result = await service.evaluateDrift('1.0.0');
    expect(result.driftDetected).toBe(true);
    expect(result.driftedFeatures).toContain('severity_score');
    expect(result.incidentId).toBe('drift-1');
  });

  it('emits drift event when drift is detected', async () => {
    service.registerBaseline({
      modelVersion: '1.0.0',
      featureName: 'severity_score',
      mean: 1.0,
      stdDev: 0.1,
      sampleSize: 100,
      capturedAt: new Date(),
    });
    repo.find.mockResolvedValue([
      { severity: 'HIGH', type: AnomalyType.DUPLICATE_EMERGENCY_REQUEST, createdAt: new Date() },
      { severity: 'HIGH', type: AnomalyType.SUDDEN_STOCK_SWING, createdAt: new Date() },
    ]);

    await service.evaluateDrift('1.0.0');
    expect(emitter.emit).toHaveBeenCalledWith(
      expect.stringMatching(/^anomaly\.drift\./),
      expect.objectContaining({ modelVersion: '1.0.0' }),
    );
  });

  it('shadow compare returns promote when agreement >= 95%', async () => {
    const current = [1, 2, 3, 4, 5];
    const candidate = [1, 2, 3, 4, 5]; // identical
    const result = await service.compareShadowScoring(current, candidate, '1.0.0', '1.1.0');
    expect(result.recommendation).toBe('promote');
    expect(result.agreementRate).toBe(1);
  });

  it('shadow compare returns rollback when agreement < 80%', async () => {
    const current = [1, 2, 3, 4, 5];
    const candidate = [10, 20, 30, 40, 50]; // very different
    const result = await service.compareShadowScoring(current, candidate, '1.0.0', '1.1.0');
    expect(result.recommendation).toBe('rollback');
  });

  it('shadow compare returns hold for empty arrays', async () => {
    const result = await service.compareShadowScoring([], [], '1.0.0', '1.1.0');
    expect(result.recommendation).toBe('hold');
    expect(result.totalCases).toBe(0);
  });

  it('getDriftReport returns incidents and baselines', async () => {
    service.registerBaseline({
      modelVersion: '1.0.0',
      featureName: 'severity_score',
      mean: 2.0,
      stdDev: 0.5,
      sampleSize: 50,
      capturedAt: new Date(),
    });
    const report = await service.getDriftReport('1.0.0');
    expect(Array.isArray(report.incidents)).toBe(true);
    expect(report.baselines).toHaveLength(1);
    expect(report.baselines[0].modelVersion).toBe('1.0.0');
  });
});
