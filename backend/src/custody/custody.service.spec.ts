import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { SorobanService } from '../../soroban/soroban.service';
import { BloodUnit } from '../../blood-units/entities/blood-unit.entity';
import { ConfirmHandoffDto, RecordHandoffDto } from '../dto/custody.dto';
import { CustodyHandoffEntity } from '../entities/custody-handoff.entity';
import { CustodyActor, CustodyHandoffStatus } from '../enums/custody.enum';
import { CustodyService } from '../custody.service';

const mockRepo = () => ({
  create: jest.fn((d) => ({ ...d, id: 'h-1' })),
  save: jest.fn(async (e) => e),
  findOne: jest.fn(),
  find: jest.fn(async () => []),
});

const mockSoroban = () => ({
  transferCustody: jest.fn(async () => ({ transactionHash: 'tx-abc' })),
});

const mockBloodUnitRepo = () => ({
  findOne: jest.fn(async () => ({ id: '42', organizationId: 'bank-1' })),
});

describe('CustodyService', () => {
  let service: CustodyService;
  let repo: ReturnType<typeof mockRepo>;
  let bloodUnitRepo: ReturnType<typeof mockBloodUnitRepo>;

  beforeEach(async () => {
    repo = mockRepo();
    bloodUnitRepo = mockBloodUnitRepo();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CustodyService,
        { provide: getRepositoryToken(CustodyHandoffEntity), useValue: repo },
        { provide: getRepositoryToken(BloodUnit), useValue: bloodUnitRepo },
        { provide: SorobanService, useValue: mockSoroban() },
      ],
    }).compile();
    service = module.get(CustodyService);
  });

  const baseDto: RecordHandoffDto = {
    bloodUnitId: '42',
    orderId: 'order-1',
    fromActorId: 'bank-1',
    fromActorType: CustodyActor.BLOOD_BANK,
    toActorId: 'rider-1',
    toActorType: CustodyActor.RIDER,
    latitude: 6.5,
    longitude: 3.3,
  };

  it('recordHandoff persists handoff with contract event id', async () => {
    const result = await service.recordHandoff(baseDto, 'bank-1');
    expect(repo.create).toHaveBeenCalledWith(expect.objectContaining({
      bloodUnitId: '42',
      fromActorType: CustodyActor.BLOOD_BANK,
      toActorType: CustodyActor.RIDER,
      contractEventId: 'tx-abc',
      status: CustodyHandoffStatus.PENDING,
    }));
    expect(repo.save).toHaveBeenCalled();
    expect(result).toBeDefined();
  });

  it('rejects a handoff when the caller is not the from actor', async () => {
    await expect(service.recordHandoff(baseDto, 'attacker-1')).rejects.toThrow(ForbiddenException);

    expect(bloodUnitRepo.findOne).not.toHaveBeenCalled();
    expect(repo.save).not.toHaveBeenCalled();
  });

  it('anchors the first handoff to the blood unit owning bank', async () => {
    await expect(
      service.recordHandoff({ ...baseDto, fromActorId: 'other-bank' }, 'other-bank'),
    ).rejects.toThrow(BadRequestException);

    expect(repo.save).not.toHaveBeenCalled();
  });

  it('rejects another handoff while one for the unit is pending', async () => {
    repo.findOne.mockResolvedValueOnce({ id: 'pending-1' });

    await expect(service.recordHandoff(baseDto, 'bank-1')).rejects.toThrow(
      'A custody handoff is already pending',
    );

    expect(repo.save).not.toHaveBeenCalled();
  });

  it('recordHandoff still persists if on-chain call fails', async () => {
    const soroban = { transferCustody: jest.fn(async () => { throw new Error('rpc down'); }) };
    const mod = await Test.createTestingModule({
      providers: [
        CustodyService,
        { provide: getRepositoryToken(CustodyHandoffEntity), useValue: repo },
        { provide: getRepositoryToken(BloodUnit), useValue: bloodUnitRepo },
        { provide: SorobanService, useValue: soroban },
      ],
    }).compile();
    const svc = mod.get(CustodyService);
    const result = await svc.recordHandoff(baseDto, 'bank-1');
    expect(result).toBeDefined();
    expect(repo.save).toHaveBeenCalled();
  });

  it('confirmHandoff transitions status to CONFIRMED', async () => {
    const pending = {
      id: 'h-1',
      status: CustodyHandoffStatus.PENDING,
      toActorId: 'rider-1',
    };
    repo.findOne.mockResolvedValue(pending);
    repo.save.mockImplementation(async (e) => e);

    const dto: ConfirmHandoffDto = { proofReference: 'ipfs://abc' };
    const result = await service.confirmHandoff('h-1', dto, 'rider-1');

    expect(result.status).toBe(CustodyHandoffStatus.CONFIRMED);
    expect(result.proofReference).toBe('ipfs://abc');
    expect(result.confirmedAt).toBeInstanceOf(Date);
  });

  it('does not allow the initiating user to confirm their own handoff', async () => {
    repo.findOne.mockResolvedValue({
      id: 'h-1',
      status: CustodyHandoffStatus.PENDING,
      toActorId: 'rider-1',
      performedByUserId: 'rider-1',
    });

    await expect(service.confirmHandoff('h-1', {}, 'rider-1')).rejects.toThrow(ForbiddenException);
    expect(repo.save).not.toHaveBeenCalled();
  });

  it('confirmHandoff throws if handoff not found', async () => {
    repo.findOne.mockResolvedValue(null);
    await expect(service.confirmHandoff('bad-id', {}, 'rider-1')).rejects.toThrow('not found');
  });

  it('confirmHandoff throws if already confirmed', async () => {
    repo.findOne.mockResolvedValue({ id: 'h-1', status: CustodyHandoffStatus.CONFIRMED });
    await expect(service.confirmHandoff('h-1', {}, 'rider-1')).rejects.toThrow(BadRequestException);
  });

  it('assertCustodyComplete throws when bank→rider handoff missing', async () => {
    repo.find.mockResolvedValue([
      { status: CustodyHandoffStatus.CONFIRMED, fromActorType: 'rider', toActorType: 'hospital' },
    ]);
    await expect(service.assertCustodyComplete('order-1')).rejects.toThrow(BadRequestException);
  });

  it('assertCustodyComplete throws when rider→hospital handoff missing', async () => {
    repo.find.mockResolvedValue([
      { status: CustodyHandoffStatus.CONFIRMED, fromActorType: 'blood_bank', toActorType: 'rider' },
    ]);
    await expect(service.assertCustodyComplete('order-1')).rejects.toThrow(BadRequestException);
  });

  it('assertCustodyComplete passes when both handoffs confirmed', async () => {
    repo.find.mockResolvedValue([
      { status: CustodyHandoffStatus.CONFIRMED, fromActorType: 'blood_bank', toActorType: 'rider' },
      { status: CustodyHandoffStatus.CONFIRMED, fromActorType: 'rider', toActorType: 'hospital' },
    ]);
    await expect(service.assertCustodyComplete('order-1')).resolves.toBeUndefined();
  });
});
