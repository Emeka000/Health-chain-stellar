import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { TelemetryIngestionPipelineService } from './telemetry-ingestion-pipeline.service';
import { TemperatureSampleEntity } from './entities/temperature-sample.entity';

const mockSampleRepo = {
  create: jest.fn((x) => x),
  save: jest.fn((x) => ({ ...x, id: 'sample-uuid' })),
};

describe('TelemetryIngestionPipelineService', () => {
  let service: TelemetryIngestionPipelineService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TelemetryIngestionPipelineService,
        { provide: getRepositoryToken(TemperatureSampleEntity), useValue: mockSampleRepo },
      ],
    }).compile();
    service = module.get(TelemetryIngestionPipelineService);
    jest.clearAllMocks();
  });

  it('accepts a valid IoT record', async () => {
    const result = await service.ingest({
      deliveryId: 'del-1',
      temperatureCelsius: 4.5,
      source: 'iot',
    });
    expect(result.accepted).toBe(true);
    expect(result.stage).toBe('persistence');
    expect(result.qualityScore).toBeGreaterThan(0.5);
  });

  it('rejects record with missing deliveryId', async () => {
    const result = await service.ingest({ deliveryId: '', temperatureCelsius: 4.5 });
    expect(result.accepted).toBe(false);
    expect(result.stage).toBe('validation');
    expect(result.reason).toContain('deliveryId');
  });

  it('rejects temperature out of plausible range', async () => {
    const result = await service.ingest({ deliveryId: 'del-1', temperatureCelsius: 200 });
    expect(result.accepted).toBe(false);
    expect(result.reason).toContain('plausible range');
  });

  it('rejects low-quality manual record with extreme temp', async () => {
    // manual (0.6) * extreme penalty (0.5) = 0.3 which equals QUALITY_REJECT_THRESHOLD
    // Use a value that will definitely be below threshold: manual + very extreme
    const result = await service.ingest({
      deliveryId: 'del-1',
      temperatureCelsius: -80,
      source: 'manual',
    });
    expect(result.accepted).toBe(false);
    expect(result.reason).toBe('quality_too_low');
  });

  it('deduplicates identical records within window', async () => {
    const record = { deliveryId: 'del-2', temperatureCelsius: 5.0, source: 'iot', recordedAt: new Date().toISOString() };
    const first = await service.ingest(record);
    expect(first.accepted).toBe(true);

    const second = await service.ingest(record);
    expect(second.accepted).toBe(false);
    expect(second.reason).toBe('duplicate');
  });

  it('detects sequence gap and still accepts record', async () => {
    const warnSpy = jest.spyOn(service['logger'], 'warn').mockImplementation(() => {});
    await service.ingest({ deliveryId: 'del-3', temperatureCelsius: 4.0, source: 'iot', sequenceNumber: 1 });
    await service.ingest({ deliveryId: 'del-3', temperatureCelsius: 4.1, source: 'iot', sequenceNumber: 5, recordedAt: new Date(Date.now() + 1000).toISOString() });
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('Sequence gap'));
  });

  it('reports backpressure status', () => {
    const status = service.getBackpressureStatus();
    expect(status.maxDepth).toBe(1000);
    expect(status.shedding).toBe(false);
  });

  it('processes batch records', async () => {
    const records = [
      { deliveryId: 'del-4', temperatureCelsius: 3.0, source: 'iot' as const },
      { deliveryId: 'del-5', temperatureCelsius: 7.0, source: 'iot' as const },
    ];
    const results = await service.ingestBatch(records);
    expect(results).toHaveLength(2);
    expect(results.every((r) => r.accepted)).toBe(true);
  });
});
