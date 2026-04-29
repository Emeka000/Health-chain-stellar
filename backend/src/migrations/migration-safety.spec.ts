import { Test, TestingModule } from '@nestjs/testing';
import { getDataSourceToken } from '@nestjs/typeorm';
import { MigrationPreflightService } from './migration-preflight.service';
import { MigrationIntegrityService } from './migration-integrity.service';
import { MigrationRepairService } from './migration-repair.service';

const mockDataSource = {
  query: jest.fn(),
  options: { migrations: [] },
};

describe('MigrationPreflightService', () => {
  let service: MigrationPreflightService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MigrationPreflightService,
        { provide: getDataSourceToken(), useValue: mockDataSource },
      ],
    }).compile();
    service = module.get(MigrationPreflightService);
    jest.clearAllMocks();
  });

  it('reports all passed when all checks succeed', async () => {
    mockDataSource.query.mockResolvedValue([{ exists: true }]);
    const report = await service.runPreflight();
    expect(report.allPassed).toBe(true);
    expect(report.checks.every((c) => c.passed)).toBe(true);
  });

  it('reports failure when a table is missing', async () => {
    mockDataSource.query
      .mockResolvedValueOnce([{ exists: false }]) // migrations table missing
      .mockResolvedValue([{ exists: true }]);
    const report = await service.runPreflight();
    expect(report.allPassed).toBe(false);
    const failed = report.checks.filter((c) => !c.passed);
    expect(failed.length).toBeGreaterThan(0);
  });
});

describe('MigrationIntegrityService', () => {
  let service: MigrationIntegrityService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MigrationIntegrityService,
        { provide: getDataSourceToken(), useValue: mockDataSource },
      ],
    }).compile();
    service = module.get(MigrationIntegrityService);
    jest.clearAllMocks();
  });

  it('detects duplicate timestamps', async () => {
    mockDataSource.query.mockResolvedValue([
      { id: 1, timestamp: '1000', name: 'MigA' },
      { id: 2, timestamp: '1000', name: 'MigB' },
    ]);
    const report = await service.generateReport();
    expect(report.duplicateTimestamps.length).toBe(1);
  });

  it('detects out-of-order migrations', async () => {
    mockDataSource.query.mockResolvedValue([
      { id: 1, timestamp: '2000', name: 'MigA' },
      { id: 2, timestamp: '1000', name: 'MigB' },
    ]);
    const report = await service.generateReport();
    expect(report.outOfOrderMigrations).toContain('MigB');
  });

  it('returns empty arrays for clean migration history', async () => {
    mockDataSource.query.mockResolvedValue([
      { id: 1, timestamp: '1000', name: 'MigA' },
      { id: 2, timestamp: '2000', name: 'MigB' },
    ]);
    const report = await service.generateReport();
    expect(report.duplicateTimestamps).toHaveLength(0);
    expect(report.outOfOrderMigrations).toHaveLength(0);
  });
});

describe('MigrationRepairService', () => {
  let service: MigrationRepairService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MigrationRepairService,
        { provide: getDataSourceToken(), useValue: mockDataSource },
      ],
    }).compile();
    service = module.get(MigrationRepairService);
    jest.clearAllMocks();
  });

  it('removes stale migration record', async () => {
    mockDataSource.query.mockResolvedValue([null, 1]);
    const result = await service.removeStaleMigrationRecord('StaleMig');
    expect(result.success).toBe(true);
    expect(mockDataSource.query).toHaveBeenCalledWith(
      expect.stringContaining('DELETE FROM migrations'),
      ['StaleMig'],
    );
  });

  it('returns failure on DB error', async () => {
    mockDataSource.query.mockRejectedValue(new Error('DB error'));
    const result = await service.removeStaleMigrationRecord('StaleMig');
    expect(result.success).toBe(false);
  });
});
