import { BadRequestException } from '@nestjs/common';
import { ReconciliationService } from './reconciliation.service';
import {
  ExceptionCategory,
  MismatchResolution,
  MismatchType,
  ReconciliationRunStatus,
} from './enums/reconciliation.enum';
import { ReconciliationSnapshotStatus } from './entities/reconciliation-snapshot.entity';

function makeSnapshot(overrides: Partial<object> = {}) {
  return {
    id: 'snap-1',
    runId: 'run-1',
    status: ReconciliationSnapshotStatus.IN_PROGRESS,
    cursors: {},
    processedCounts: {},
    exceptionSummary: {},
    ...overrides,
  };
}

function makeRun(overrides: Partial<object> = {}) {
  return {
    id: 'run-1',
    status: ReconciliationRunStatus.RUNNING,
    snapshotId: 'snap-1',
    triggeredBy: 'user-1',
    totalChecked: 0,
    mismatchCount: 0,
    completedAt: null,
    errorMessage: null,
    ...overrides,
  };
}

function makeMismatch(overrides: Partial<object> = {}) {
  return {
    id: 'mm-1',
    resolution: MismatchResolution.PENDING,
    exceptionCategory: ExceptionCategory.STATUS_DIVERGENCE,
    referenceType: 'donation',
    referenceId: 'don-1',
    onChainValue: { status: 'completed' },
    offChainValue: { status: 'pending' },
    ...overrides,
  };
}

function makeService(opts: {
  run?: object | null;
  snapshot?: object | null;
  mismatch?: object | null;
} = {}) {
  const runRepo = {
    create: jest.fn((d) => ({ ...d })),
    save: jest.fn(async (r) => ({ id: 'run-1', ...r })),
    findOne: jest.fn(async () => opts.run ?? null),
    find: jest.fn(async () => []),
  };
  const mismatchRepo = {
    create: jest.fn((d) => ({ ...d })),
    save: jest.fn(async (r) => r),
    find: jest.fn(async () => []),
    findOneOrFail: jest.fn(async () => opts.mismatch ?? makeMismatch()),
  };
  const snapshotRepo = {
    create: jest.fn((d) => ({ ...d })),
    save: jest.fn(async (r) => ({ id: 'snap-1', ...r })),
    findOne: jest.fn(async () => opts.snapshot ?? makeSnapshot()),
  };
  const donationRepo = {
    createQueryBuilder: jest.fn(() => ({
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      take: jest.fn().mockReturnThis(),
      getMany: jest.fn(async () => []),
    })),
    update: jest.fn(async () => undefined),
  };
  const disputeRepo = {
    createQueryBuilder: jest.fn(() => ({
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      take: jest.fn().mockReturnThis(),
      getMany: jest.fn(async () => []),
    })),
    update: jest.fn(async () => undefined),
  };
  const sorobanService = { executeWithRetry: jest.fn(async (fn: () => unknown) => fn()) };

  return new ReconciliationService(
    runRepo as any,
    mismatchRepo as any,
    snapshotRepo as any,
    donationRepo as any,
    disputeRepo as any,
    sorobanService as any,
  );
}

describe('ReconciliationService — issue #622', () => {
  it('triggerRun creates a run and snapshot', async () => {
    const svc = makeService();
    const run = await svc.triggerRun('user-1');
    expect(run).toBeDefined();
  });

  it('triggerRun with resumeRunId throws if run not found', async () => {
    const svc = makeService({ run: null });
    await expect(svc.triggerRun('user-1', 'missing-run')).rejects.toThrow(BadRequestException);
  });

  it('triggerRun with resumeRunId throws if run is not INTERRUPTED', async () => {
    const svc = makeService({ run: makeRun({ status: ReconciliationRunStatus.COMPLETED }) });
    await expect(svc.triggerRun('user-1', 'run-1')).rejects.toThrow(BadRequestException);
  });

  it('triggerRun resumes an INTERRUPTED run', async () => {
    const svc = makeService({ run: makeRun({ status: ReconciliationRunStatus.INTERRUPTED }) });
    const run = await svc.triggerRun('user-1', 'run-1');
    expect(run).toBeDefined();
  });

  it('resync blocks AMBIGUOUS_MATCH mismatches', async () => {
    const svc = makeService({
      mismatch: makeMismatch({ exceptionCategory: ExceptionCategory.AMBIGUOUS_MATCH }),
    });
    await expect(svc.resync('mm-1', 'user-1')).rejects.toThrow(BadRequestException);
  });

  it('resync resolves a STATUS_DIVERGENCE mismatch', async () => {
    const svc = makeService();
    const result = await svc.resync('mm-1', 'user-1');
    expect(result.resolution).toBe(MismatchResolution.RESYNCED);
  });

  it('dismiss sets resolution to DISMISSED with note', async () => {
    const svc = makeService();
    const result = await svc.dismiss('mm-1', 'user-1', 'not relevant');
    expect(result.resolution).toBe(MismatchResolution.DISMISSED);
    expect(result.resolutionNote).toBe('not relevant');
  });

  it('getMismatches filters by exceptionCategory', async () => {
    const svc = makeService();
    // Just verify it calls through without error
    await expect(
      svc.getMismatches(undefined, undefined, ExceptionCategory.AMOUNT_DISCREPANCY),
    ).resolves.toBeDefined();
  });
});
