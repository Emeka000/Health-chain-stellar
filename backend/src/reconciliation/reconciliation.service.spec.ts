import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { DonationEntity } from '../../donations/entities/donation.entity';
import { DonationStatus } from '../../donations/enums/donation.enum';
import { DisputeEntity } from '../../disputes/entities/dispute.entity';
import { SorobanService } from '../../soroban/soroban.service';
import { ReconciliationMismatchEntity } from '../entities/reconciliation-mismatch.entity';
import { ReconciliationRunEntity } from '../entities/reconciliation-run.entity';
import { MismatchResolution, ReconciliationRunStatus } from '../enums/reconciliation.enum';
import { ReconciliationService } from '../reconciliation.service';

const mockRunRepo = () => ({
  create: jest.fn((d) => ({ ...d, id: 'run-1' })),
  save: jest.fn(async (e) => e),
  find: jest.fn(async () => []),
  count: jest.fn(async () => 0),
});

const mockMismatchRepo = () => ({
  create: jest.fn((d) => d),
  save: jest.fn(async (e) => e),
  find: jest.fn(async () => []),
  findOneOrFail: jest.fn(),
});

const mockDonationRepo = () => ({
  find: jest.fn(async () => []),
  count: jest.fn(async () => 5),
  update: jest.fn(),
});

const mockDisputeRepo = () => ({
  find: jest.fn(async () => []),
  count: jest.fn(async () => 2),
  update: jest.fn(),
});

const mockSoroban = () => ({
  executeWithRetry: jest.fn(async (fn: () => Promise<unknown>) => fn()),
});

describe('ReconciliationService', () => {
  let service: ReconciliationService;
  let runRepo: ReturnType<typeof mockRunRepo>;
  let mismatchRepo: ReturnType<typeof mockMismatchRepo>;
  let donationRepo: ReturnType<typeof mockDonationRepo>;

  beforeEach(async () => {
    runRepo = mockRunRepo();
    mismatchRepo = mockMismatchRepo();
    donationRepo = mockDonationRepo();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ReconciliationService,
        { provide: getRepositoryToken(ReconciliationRunEntity), useValue: runRepo },
        { provide: getRepositoryToken(ReconciliationMismatchEntity), useValue: mismatchRepo },
        { provide: getRepositoryToken(DonationEntity), useValue: donationRepo },
        { provide: getRepositoryToken(DisputeEntity), useValue: mockDisputeRepo() },
        { provide: SorobanService, useValue: mockSoroban() },
      ],
    }).compile();

    service = module.get(ReconciliationService);
  });

  it('triggerRun creates a run record and returns it', async () => {
    const run = await service.triggerRun('admin-user');
    expect(runRepo.create).toHaveBeenCalledWith({ triggeredBy: 'admin-user' });
    expect(runRepo.save).toHaveBeenCalled();
    expect(run).toMatchObject({ triggeredBy: 'admin-user' });
  });

  it('getRuns delegates to repo with limit', async () => {
    await service.getRuns(10);
    expect(runRepo.find).toHaveBeenCalledWith({ order: { createdAt: 'DESC' }, take: 10 });
  });

  it('getMismatches filters by runId and resolution', async () => {
    await service.getMismatches('run-1', MismatchResolution.PENDING, 25);
    expect(mismatchRepo.find).toHaveBeenCalledWith({
      where: { runId: 'run-1', resolution: MismatchResolution.PENDING },
      order: { createdAt: 'DESC' },
      take: 25,
    });
  });

  it('resync throws when mismatch is already resolved', async () => {
    mismatchRepo.findOneOrFail.mockResolvedValue({
      id: 'm-1',
      resolution: MismatchResolution.RESYNCED,
    });
    await expect(service.resync('m-1', 'admin')).rejects.toThrow('already resolved');
  });

  it('resync updates donation status from on-chain value', async () => {
    mismatchRepo.findOneOrFail.mockResolvedValue({
      id: 'm-1',
      resolution: MismatchResolution.PENDING,
      referenceType: 'donation',
      referenceId: 'don-1',
      onChainValue: { status: DonationStatus.COMPLETED },
    });
    mismatchRepo.save.mockResolvedValue({
      id: 'm-1',
      resolution: MismatchResolution.RESYNCED,
    });

    const result = await service.resync('m-1', 'admin');
    expect(donationRepo.update).toHaveBeenCalledWith('don-1', { status: DonationStatus.COMPLETED });
    expect(result.resolution).toBe(MismatchResolution.RESYNCED);
  });

  it('dismiss sets resolution to dismissed with note', async () => {
    const mismatch = {
      id: 'm-2',
      resolution: MismatchResolution.PENDING,
    };
    mismatchRepo.findOneOrFail.mockResolvedValue(mismatch);
    mismatchRepo.save.mockImplementation(async (e) => e);

    const result = await service.dismiss('m-2', 'admin', 'Not a real issue');
    expect(result.resolution).toBe(MismatchResolution.DISMISSED);
    expect(result.resolutionNote).toBe('Not a real issue');
  });

  it('executeRun marks run as completed on success', async () => {
    // Trigger and wait for async run to complete
    const run = { id: 'run-x', status: ReconciliationRunStatus.RUNNING } as ReconciliationRunEntity;
    runRepo.create.mockReturnValue(run);
    runRepo.save.mockResolvedValue(run);

    await service.triggerRun();
    // Give async run time to complete
    await new Promise((r) => setTimeout(r, 50));

    expect(runRepo.save).toHaveBeenCalledTimes(2); // initial + completion
  });
});
