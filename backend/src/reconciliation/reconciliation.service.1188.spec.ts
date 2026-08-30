/**
 * Tests for ReconciliationService — issue #1188
 *
 * Verifies:
 *  1. fetchPaymentState / fetchDisputeState are no longer stubs — they delegate
 *     to SorobanService (payments client / getDisputeState).
 *  2. Mismatch rows are deduplicated: a second run must NOT create a duplicate
 *     PENDING mismatch row for the same (referenceId, type) pair.
 */

import { DisputeStatus } from '../disputes/enums/dispute.enum';
import { DonationStatus } from '../donations/enums/donation.enum';

import { ReconciliationSnapshotStatus } from './entities/reconciliation-snapshot.entity';
import {
  MismatchResolution,
  MismatchType,
  ReconciliationRunStatus,
} from './enums/reconciliation.enum';
import { ReconciliationService } from './reconciliation.service';

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeSnapshot(overrides: Record<string, unknown> = {}) {
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

function makeRun(overrides: Record<string, unknown> = {}) {
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

interface MakeServiceOpts {
  /** Donations returned by createQueryBuilder */
  donations?: Record<string, unknown>[];
  /** Disputes returned by createQueryBuilder */
  disputes?: Record<string, unknown>[];
  /** Existing mismatch returned by mismatchRepo.findOne (dedup probe) */
  existingMismatch?: Record<string, unknown> | null;
  /** Response from SorobanService.executeWithRetry (wraps the RPC call) */
  sorobanPaymentState?: Record<string, unknown> | null;
  /** Response from SorobanService.getDisputeState */
  sorobanDisputeState?: Record<string, unknown> | null;
}

function makeService(opts: MakeServiceOpts = {}) {
  const savedMismatches: Record<string, unknown>[][] = [];

  const runRepo = {
    create: jest.fn((d: Record<string, unknown>) => ({ ...d })),
    save: jest.fn((r: Record<string, unknown>) =>
      Promise.resolve({ id: 'run-1', ...r }),
    ),
    findOne: jest.fn(() => Promise.resolve(makeRun())),
    find: jest.fn(() => Promise.resolve([])),
  };

  const mismatchRepo = {
    create: jest.fn((d: Record<string, unknown>) => ({ id: 'mm-new', ...d })),
    save: jest.fn(
      (rows: Record<string, unknown> | Record<string, unknown>[]) => {
        const arr = Array.isArray(rows) ? rows : [rows];
        savedMismatches.push(arr);
        return Promise.resolve(rows);
      },
    ),
    find: jest.fn(() => Promise.resolve([])),
    findOne: jest.fn(() => Promise.resolve(opts.existingMismatch ?? null)),
    findOneOrFail: jest.fn(() => Promise.resolve({})),
  };

  const snapshotRepo = {
    create: jest.fn((d: Record<string, unknown>) => ({ ...d })),
    save: jest.fn((r: Record<string, unknown>) =>
      Promise.resolve({ id: 'snap-1', ...r }),
    ),
    findOne: jest.fn(() => Promise.resolve(makeSnapshot())),
  };

  const donationRepo = {
    createQueryBuilder: jest.fn(() => ({
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      take: jest.fn().mockReturnThis(),
      getMany: jest.fn(() => Promise.resolve(opts.donations ?? [])),
    })),
    update: jest.fn(() => Promise.resolve(undefined)),
  };

  const disputeRepo = {
    createQueryBuilder: jest.fn(() => ({
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      take: jest.fn().mockReturnThis(),
      getMany: jest.fn(() => Promise.resolve(opts.disputes ?? [])),
    })),
    update: jest.fn(() => Promise.resolve(undefined)),
  };

  const paymentsClientGetPayment = jest.fn(() =>
    Promise.resolve(opts.sorobanPaymentState ?? null),
  );

  const sorobanService = {
    // executeWithRetry invokes the provided callback — mirrors real SorobanService
    executeWithRetry: jest.fn((fn: () => unknown) => Promise.resolve(fn())),
    getDisputeState: jest.fn(() =>
      Promise.resolve(opts.sorobanDisputeState ?? null),
    ),
    // Expose a minimal payments client so fetchPaymentState can call get_payment
    paymentsClient: {
      get_payment: paymentsClientGetPayment,
    },
  };

  const svc = new ReconciliationService(
    runRepo as never,
    mismatchRepo as never,
    snapshotRepo as never,
    donationRepo as never,
    disputeRepo as never,
    sorobanService as never,
  );

  return {
    svc,
    mismatchRepo,
    savedMismatches,
    paymentsClientGetPayment,
    sorobanService,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('ReconciliationService — issue #1188', () => {
  describe('fetchPaymentState — real Soroban RPC call', () => {
    it('calls payments client get_payment instead of returning null unconditionally', async () => {
      const onChainPayment = { status: DonationStatus.COMPLETED, amount: 100 };

      const { svc, paymentsClientGetPayment } = makeService({
        donations: [
          {
            id: 'don-1',
            transactionHash: 'tx-hash-abc',
            status: DonationStatus.PENDING,
            amount: 100,
            createdAt: new Date(),
          },
        ],
        sorobanPaymentState: onChainPayment,
      });

      // Trigger a reconciliation run; executeRun fires async so give it a tick
      const run = await svc.triggerRun('test-user');
      await new Promise<void>((resolve) => setImmediate(resolve));

      // The payments client must have been called with the tx hash
      expect(paymentsClientGetPayment).toHaveBeenCalledWith('tx-hash-abc');
      expect(run).toBeDefined();
    });

    it('creates a STATUS mismatch when on-chain status differs from off-chain', async () => {
      const { svc, savedMismatches } = makeService({
        donations: [
          {
            id: 'don-2',
            transactionHash: 'tx-hash-xyz',
            status: DonationStatus.PENDING,
            amount: 50,
            createdAt: new Date(),
          },
        ],
        sorobanPaymentState: {
          status: DonationStatus.COMPLETED,
          amount: 50,
        },
        existingMismatch: null,
      });

      await svc.triggerRun('test-user');
      await new Promise<void>((resolve) => setImmediate(resolve));

      const allSaved = savedMismatches.flat();
      const statusMismatch = allSaved.find(
        (m) => m['type'] === MismatchType.STATUS,
      );
      expect(statusMismatch).toBeDefined();
    });
  });

  describe('fetchDisputeState — real Soroban RPC call', () => {
    it('calls sorobanService.getDisputeState instead of returning null', async () => {
      const { svc, sorobanService } = makeService({
        disputes: [
          {
            id: 'disp-1',
            contractDisputeId: 'contract-dispute-42',
            status: DisputeStatus.OPEN,
          },
        ],
        sorobanDisputeState: { status: 'RESOLVED' },
      });

      await svc.triggerRun('test-user');
      await new Promise<void>((resolve) => setImmediate(resolve));

      expect(sorobanService.getDisputeState).toHaveBeenCalledWith(
        'contract-dispute-42',
      );
    });
  });

  describe('Mismatch deduplication', () => {
    it('does NOT create a new mismatch row when a PENDING row already exists for (referenceId, type)', async () => {
      const existingPendingMismatch = {
        id: 'mm-existing',
        referenceId: 'don-3',
        type: MismatchType.MISSING_ON_CHAIN,
        resolution: MismatchResolution.PENDING,
      };

      const { svc, mismatchRepo, savedMismatches } = makeService({
        donations: [
          {
            id: 'don-3',
            transactionHash: 'tx-not-on-chain',
            status: DonationStatus.PENDING,
            amount: 25,
            createdAt: new Date(),
          },
        ],
        // sorobanPaymentState = null → MISSING_ON_CHAIN mismatch candidate generated
        sorobanPaymentState: null,
        // mismatchRepo.findOne returns an existing PENDING mismatch for this record
        existingMismatch: existingPendingMismatch,
      });

      await svc.triggerRun('test-user');
      await new Promise<void>((resolve) => setImmediate(resolve));

      // The dedup check must have fired for each mismatch candidate
      expect(mismatchRepo.findOne).toHaveBeenCalled();
      // No new mismatch entity should have been persisted
      expect(savedMismatches.flat()).toHaveLength(0);
    });

    it('DOES create a mismatch row when no PENDING row exists for that (referenceId, type)', async () => {
      const { svc, savedMismatches, mismatchRepo } = makeService({
        donations: [
          {
            id: 'don-4',
            transactionHash: 'tx-missing',
            status: DonationStatus.PENDING,
            amount: 75,
            createdAt: new Date(),
          },
        ],
        sorobanPaymentState: null,
        existingMismatch: null,
      });

      await svc.triggerRun('test-user');
      await new Promise<void>((resolve) => setImmediate(resolve));

      expect(mismatchRepo.findOne).toHaveBeenCalled();
      expect(savedMismatches.flat().length).toBeGreaterThan(0);
    });

    it('skips donations without a transactionHash', async () => {
      const { svc, savedMismatches } = makeService({
        donations: [
          {
            id: 'don-5',
            transactionHash: null,
            status: DonationStatus.PENDING,
            amount: 10,
            createdAt: new Date(),
          },
        ],
        sorobanPaymentState: null,
      });

      await svc.triggerRun('test-user');
      await new Promise<void>((resolve) => setImmediate(resolve));

      // No mismatch should be generated for records without a transactionHash
      expect(savedMismatches.flat()).toHaveLength(0);
    });
  });
});
