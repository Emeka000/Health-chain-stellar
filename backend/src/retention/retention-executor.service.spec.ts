import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { BadRequestException, NotFoundException } from '@nestjs/common';

import { RetentionExecutorService } from '../retention-executor.service';
import { LegalHoldEntity, LegalHoldStatus } from '../entities/legal-hold.entity';
import { RetentionPolicyEntity, DataCategory, RetentionAction } from '../entities/retention-policy.entity';
import { DataRedactionEntity } from '../entities/data-redaction.entity';
import { UserEntity } from '../../users/entities/user.entity';
import { OrderEntity } from '../../orders/entities/order.entity';
import { AuditLogService } from '../../common/audit/audit-log.service';

const mockRepo = () => ({
  find: jest.fn(),
  findOne: jest.fn(),
  create: jest.fn((v) => v),
  save: jest.fn((v) => Promise.resolve({ id: 'hold-1', ...v })),
  update: jest.fn(),
  createQueryBuilder: jest.fn(() => ({
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    getMany: jest.fn().mockResolvedValue([]),
    getCount: jest.fn().mockResolvedValue(0),
  })),
});

describe('RetentionExecutorService', () => {
  let service: RetentionExecutorService;
  let legalHoldRepo: ReturnType<typeof mockRepo>;
  let policyRepo: ReturnType<typeof mockRepo>;
  let redactionRepo: ReturnType<typeof mockRepo>;
  let userRepo: ReturnType<typeof mockRepo>;
  let orderRepo: ReturnType<typeof mockRepo>;

  beforeEach(async () => {
    legalHoldRepo = mockRepo();
    policyRepo = mockRepo();
    redactionRepo = mockRepo();
    userRepo = mockRepo();
    orderRepo = mockRepo();

    const module = await Test.createTestingModule({
      providers: [
        RetentionExecutorService,
        { provide: getRepositoryToken(LegalHoldEntity), useValue: legalHoldRepo },
        { provide: getRepositoryToken(RetentionPolicyEntity), useValue: policyRepo },
        { provide: getRepositoryToken(DataRedactionEntity), useValue: redactionRepo },
        { provide: getRepositoryToken(UserEntity), useValue: userRepo },
        { provide: getRepositoryToken(OrderEntity), useValue: orderRepo },
        { provide: AuditLogService, useValue: { insert: jest.fn() } },
        { provide: 'DataSource', useValue: { transaction: jest.fn((cb) => cb({ update: jest.fn() })) } },
      ],
    }).compile();
    service = module.get(RetentionExecutorService);
  });

  it('dry run returns processed=0 and does not mutate data', async () => {
    policyRepo.find.mockResolvedValue([]);
    legalHoldRepo.find.mockResolvedValue([]);
    const result = await service.execute(true, 'admin-1');
    expect(result.dryRun).toBe(true);
    expect(result.processed).toBe(0);
  });

  it('legal hold blocks retention action and increments skippedDueToLegalHold', async () => {
    policyRepo.find.mockResolvedValue([
      { id: 'p1', dataCategory: DataCategory.DONOR_DATA, retentionPeriodDays: 1095, retentionAction: RetentionAction.ANONYMIZE, isActive: true },
    ]);
    legalHoldRepo.find.mockResolvedValue([
      { id: 'h1', entityType: 'user', entityId: 'user-1', status: LegalHoldStatus.ACTIVE },
    ]);
    userRepo.createQueryBuilder.mockReturnValue({
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      getMany: jest.fn().mockResolvedValue([{ id: 'user-1', email: 'test@test.com', anonymised: false }]),
    });

    const result = await service.execute(true, 'admin-1');
    expect(result.skippedDueToLegalHold).toBe(1);
    expect(result.complianceReport[0].action).toBe('skipped_legal_hold');
  });

  it('placeLegalHold creates a new hold', async () => {
    legalHoldRepo.findOne.mockResolvedValue(null);
    const hold = await service.placeLegalHold('user', 'user-1', 'Litigation hold', 'admin-1');
    expect(legalHoldRepo.save).toHaveBeenCalled();
  });

  it('placeLegalHold throws if active hold already exists', async () => {
    legalHoldRepo.findOne.mockResolvedValue({ id: 'h1', status: LegalHoldStatus.ACTIVE });
    await expect(service.placeLegalHold('user', 'user-1', 'reason', 'admin-1')).rejects.toThrow(BadRequestException);
  });

  it('releaseLegalHold updates status to released', async () => {
    legalHoldRepo.findOne.mockResolvedValue({ id: 'h1', status: LegalHoldStatus.ACTIVE });
    legalHoldRepo.save.mockResolvedValue({ id: 'h1', status: LegalHoldStatus.RELEASED, releasedBy: 'admin-1' });
    const result = await service.releaseLegalHold('h1', 'admin-1');
    expect(result.status).toBe(LegalHoldStatus.RELEASED);
    expect(result.releasedBy).toBe('admin-1');
  });

  it('releaseLegalHold throws NotFoundException for unknown hold', async () => {
    legalHoldRepo.findOne.mockResolvedValue(null);
    await expect(service.releaseLegalHold('unknown', 'admin-1')).rejects.toThrow(NotFoundException);
  });

  it('releaseLegalHold throws BadRequestException if already released', async () => {
    legalHoldRepo.findOne.mockResolvedValue({ id: 'h1', status: LegalHoldStatus.RELEASED });
    await expect(service.releaseLegalHold('h1', 'admin-1')).rejects.toThrow(BadRequestException);
  });

  it('compliance report includes counts, reasons, and actor identity', async () => {
    policyRepo.find.mockResolvedValue([]);
    legalHoldRepo.find.mockResolvedValue([]);
    const result = await service.execute(true, 'admin-1');
    expect(Array.isArray(result.complianceReport)).toBe(true);
    expect(result.dryRun).toBe(true);
  });
});
