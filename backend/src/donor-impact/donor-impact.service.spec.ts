import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { BloodUnitEntity } from '../blood-units/entities/blood-unit.entity';
import { DonorImpactService } from './donor-impact.service';

describe('DonorImpactService', () => {
  let service: DonorImpactService;
  let repository: Repository<BloodUnitEntity>;

  const donorId = '11111111-2222-3333-4444-555555555555';

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DonorImpactService,
        {
          provide: getRepositoryToken(BloodUnitEntity),
          useValue: {
            find: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<DonorImpactService>(DonorImpactService);
    repository = module.get<Repository<BloodUnitEntity>>(
      getRepositoryToken(BloodUnitEntity),
    );
  });

  it('sums quantityMl and exposes blockchain proofs for the donor units', async () => {
    jest.spyOn(repository, 'find').mockResolvedValue([
      { id: 'unit-1', donorId, quantityMl: 450, blockchainTxHash: '0xabc' },
      { id: 'unit-2', donorId, quantityMl: 350, blockchainTxHash: '0xdef' },
    ] as BloodUnitEntity[]);

    const result = await service.getDonorImpact(donorId);

    expect(result.totalUnits).toBe(2);
    expect(result.totalVolumeMl).toBe(800);
    expect(result.proofs).toEqual([
      { unitId: 'unit-1', txHash: '0xabc' },
      { unitId: 'unit-2', txHash: '0xdef' },
    ]);
  });

  it('derives a stable, non-linkable donor ref from an HMAC', async () => {
    jest.spyOn(repository, 'find').mockResolvedValue([] as BloodUnitEntity[]);

    const first = await service.getDonorImpact(donorId);
    const second = await service.getDonorImpact(donorId);

    expect(first.donorRef).toBe(second.donorRef);
    expect(first.donorRef).not.toContain(donorId.slice(0, 4));
    expect(first.donorRef).toMatch(/^DONOR-[0-9a-f]{16}$/);
  });
});
