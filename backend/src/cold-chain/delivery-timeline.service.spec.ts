import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { TemperatureSampleEntity } from './entities/temperature-sample.entity';
import { DeliveryComplianceEntity } from './entities/delivery-compliance.entity';
import { RouteDeviationIncidentEntity, DeviationSeverity, DeviationStatus } from '../route-deviation/entities/route-deviation-incident.entity';
import { DeliveryTimelineService } from './delivery-timeline.service';

const mockRepo = (items: any[]) => ({
  find: jest.fn().mockResolvedValue(items),
  findOne: jest.fn().mockResolvedValue(items[0] ?? null),
});

describe('DeliveryTimelineService', () => {
  let service: DeliveryTimelineService;

  const now = new Date('2026-01-01T10:00:00Z');
  const t = (offsetMs: number) => new Date(now.getTime() + offsetMs);

  const samples: Partial<TemperatureSampleEntity>[] = [
    { id: 's1', deliveryId: 'd1', temperatureCelsius: 4, isExcursion: false, recordedAt: t(0) },
    { id: 's2', deliveryId: 'd1', temperatureCelsius: 10, isExcursion: true, recordedAt: t(60_000) },
    { id: 's3', deliveryId: 'd1', temperatureCelsius: 12, isExcursion: true, recordedAt: t(120_000) },
    { id: 's4', deliveryId: 'd1', temperatureCelsius: 5, isExcursion: false, recordedAt: t(180_000) },
  ];

  const incidents: Partial<RouteDeviationIncidentEntity>[] = [
    {
      id: 'i1',
      orderId: 'o1',
      riderId: 'r1',
      plannedRouteId: 'pr1',
      severity: DeviationSeverity.MODERATE,
      status: DeviationStatus.RESOLVED,
      deviationDistanceM: 600,
      deviationDurationS: 150,
      lastKnownLatitude: 1,
      lastKnownLongitude: 1,
      reason: null,
      recommendedAction: null,
      acknowledgedBy: null,
      acknowledgedAt: null,
      resolvedAt: t(150_000),
      scoringApplied: false,
      metadata: null,
      createdAt: t(50_000),
    },
  ];

  const compliance: Partial<DeliveryComplianceEntity> = {
    deliveryId: 'd1',
    isCompliant: false,
    excursionCount: 2,
    evaluatedAt: t(200_000),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DeliveryTimelineService,
        { provide: getRepositoryToken(TemperatureSampleEntity), useValue: mockRepo(samples) },
        { provide: getRepositoryToken(DeliveryComplianceEntity), useValue: mockRepo([compliance]) },
        { provide: getRepositoryToken(RouteDeviationIncidentEntity), useValue: mockRepo(incidents) },
      ],
    }).compile();

    service = module.get(DeliveryTimelineService);
  });

  it('builds a timeline with all event kinds', async () => {
    const bundle = await service.buildTimeline('d1', 'o1');
    expect(bundle.deliveryId).toBe('d1');
    expect(bundle.timeline.length).toBeGreaterThan(0);
    const kinds = bundle.timeline.map((e) => e.kind);
    expect(kinds).toContain('TEMPERATURE_SAMPLE');
    expect(kinds).toContain('BREACH_START');
    expect(kinds).toContain('BREACH_END');
    expect(kinds).toContain('ROUTE_DEVIATION_START');
    expect(kinds).toContain('ROUTE_DEVIATION_END');
    expect(kinds).toContain('COMPLIANCE_EVALUATED');
  });

  it('identifies breach-during-deviation correlation', async () => {
    const bundle = await service.buildTimeline('d1', 'o1');
    const overlapping = bundle.correlationWindows.filter(
      (w) => w.adjudication === 'BREACH_DURING_DEVIATION',
    );
    expect(overlapping.length).toBeGreaterThan(0);
    expect(overlapping[0].deviationIncidentIds).toContain('i1');
  });

  it('timeline events are sorted by normalizedAt', async () => {
    const bundle = await service.buildTimeline('d1', 'o1');
    for (let i = 1; i < bundle.timeline.length; i++) {
      expect(bundle.timeline[i].normalizedAt.getTime()).toBeGreaterThanOrEqual(
        bundle.timeline[i - 1].normalizedAt.getTime(),
      );
    }
  });

  it('reevaluate returns updated lastEvaluatedAt', async () => {
    const before = Date.now();
    const bundle = await service.reevaluate('d1', 'o1');
    expect(new Date(bundle.lastEvaluatedAt).getTime()).toBeGreaterThanOrEqual(before);
  });
});
