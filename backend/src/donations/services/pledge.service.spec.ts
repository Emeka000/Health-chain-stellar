import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PledgeService } from './pledge.service';
import { PledgeEntity } from '../entities/pledge.entity';
import { ConsentService } from '../../consent/consent.service';
import { PledgeFrequency, PledgeStatus } from '../enums/pledge.enum';
import { DonationAsset } from '../enums/donation.enum';

describe('PledgeService', () => {
  let service: PledgeService;
  let pledgeRepo: Repository<PledgeEntity>;
  let consentService: ConsentService;

  const mockPledge: PledgeEntity = {
    id: 'pledge-1',
    amount: 50,
    payerAddress: 'GBBBB...',
    recipientId: 'hospital-1',
    frequency: PledgeFrequency.MONTHLY,
    asset: DonationAsset.XLM,
    status: PledgeStatus.ACTIVE,
    memo: 'PLG-XYZ789',
    donorUserId: 'user-1',
    causeTag: '',
    regionTag: '',
    emergencyPool: false,
    sorobanPledgeId: null,
    nextExecutionAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PledgeService,
        {
          provide: getRepositoryToken(PledgeEntity),
          useValue: {
            findOne: jest.fn(),
            save: jest.fn(),
          },
        },
        {
          provide: ConsentService,
          useValue: {
            assertCurrentConsent: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<PledgeService>(PledgeService);
    pledgeRepo = module.get<Repository<PledgeEntity>>(getRepositoryToken(PledgeEntity));
    consentService = module.get<ConsentService>(ConsentService);
  });

  describe('setStatus', () => {
    it('should allow ACTIVE -> PAUSED transition', async () => {
      const pledge = { ...mockPledge, status: PledgeStatus.ACTIVE };
      const updatedPledge = { ...pledge, status: PledgeStatus.PAUSED };

      jest.spyOn(pledgeRepo, 'findOne').mockResolvedValue(pledge);
      jest.spyOn(pledgeRepo, 'save').mockResolvedValue(updatedPledge);

      const result = await service.setStatus('pledge-1', PledgeStatus.PAUSED, 'user-1');

      expect(result.status).toBe(PledgeStatus.PAUSED);
      expect(pledgeRepo.save).toHaveBeenCalled();
    });

    it('should allow PAUSED -> ACTIVE transition', async () => {
      const pledge = { ...mockPledge, status: PledgeStatus.PAUSED };
      const updatedPledge = { ...pledge, status: PledgeStatus.ACTIVE };

      jest.spyOn(pledgeRepo, 'findOne').mockResolvedValue(pledge);
      jest.spyOn(pledgeRepo, 'save').mockResolvedValue(updatedPledge);

      const result = await service.setStatus('pledge-1', PledgeStatus.ACTIVE, 'user-1');

      expect(result.status).toBe(PledgeStatus.ACTIVE);
      expect(pledgeRepo.save).toHaveBeenCalled();
    });

    it('should allow ACTIVE -> COMPLETED transition', async () => {
      const pledge = { ...mockPledge, status: PledgeStatus.ACTIVE };
      const updatedPledge = { ...pledge, status: PledgeStatus.COMPLETED };

      jest.spyOn(pledgeRepo, 'findOne').mockResolvedValue(pledge);
      jest.spyOn(pledgeRepo, 'save').mockResolvedValue(updatedPledge);

      const result = await service.setStatus('pledge-1', PledgeStatus.COMPLETED, 'user-1');

      expect(result.status).toBe(PledgeStatus.COMPLETED);
      expect(pledgeRepo.save).toHaveBeenCalled();
    });

    it('should allow PAUSED -> COMPLETED transition', async () => {
      const pledge = { ...mockPledge, status: PledgeStatus.PAUSED };
      const updatedPledge = { ...pledge, status: PledgeStatus.COMPLETED };

      jest.spyOn(pledgeRepo, 'findOne').mockResolvedValue(pledge);
      jest.spyOn(pledgeRepo, 'save').mockResolvedValue(updatedPledge);

      const result = await service.setStatus('pledge-1', PledgeStatus.COMPLETED, 'user-1');

      expect(result.status).toBe(PledgeStatus.COMPLETED);
      expect(pledgeRepo.save).toHaveBeenCalled();
    });

    it('should reject COMPLETED -> ACTIVE transition', async () => {
      const pledge = { ...mockPledge, status: PledgeStatus.COMPLETED };
      jest.spyOn(pledgeRepo, 'findOne').mockResolvedValue(pledge);

      await expect(
        service.setStatus('pledge-1', PledgeStatus.ACTIVE, 'user-1'),
      ).rejects.toThrow(BadRequestException);
      expect(pledgeRepo.save).not.toHaveBeenCalled();
    });

    it('should reject ACTIVE -> ACTIVE transition (no-op)', async () => {
      const pledge = { ...mockPledge, status: PledgeStatus.ACTIVE };
      jest.spyOn(pledgeRepo, 'findOne').mockResolvedValue(pledge);

      await expect(
        service.setStatus('pledge-1', PledgeStatus.ACTIVE, 'user-1'),
      ).rejects.toThrow(BadRequestException);
      expect(pledgeRepo.save).not.toHaveBeenCalled();
    });

    it('should prevent non-owner from changing status', async () => {
      const pledge = { ...mockPledge, donorUserId: 'user-1' };
      jest.spyOn(pledgeRepo, 'findOne').mockResolvedValue(pledge);

      await expect(
        service.setStatus('pledge-1', PledgeStatus.PAUSED, 'user-2'),
      ).rejects.toThrow(BadRequestException); // Will throw from ownership check via getById
    });

    it('should not allow any transition from COMPLETED state', async () => {
      const completedPledge = { ...mockPledge, status: PledgeStatus.COMPLETED };
      jest.spyOn(pledgeRepo, 'findOne').mockResolvedValue(completedPledge);

      await expect(
        service.setStatus('pledge-1', PledgeStatus.PAUSED, 'user-1'),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('getById', () => {
    it('should return pledge for owner', async () => {
      jest.spyOn(pledgeRepo, 'findOne').mockResolvedValue(mockPledge);

      const result = await service.getById('pledge-1', 'user-1');

      expect(result).toEqual(mockPledge);
    });

    it('should throw 404 for non-owner', async () => {
      jest.spyOn(pledgeRepo, 'findOne').mockResolvedValue(mockPledge);

      await expect(service.getById('pledge-1', 'user-2')).rejects.toThrow(NotFoundException);
    });

    it('should throw 404 for non-existent pledge', async () => {
      jest.spyOn(pledgeRepo, 'findOne').mockResolvedValue(null);

      await expect(service.getById('nonexistent', 'user-1')).rejects.toThrow(NotFoundException);
    });
  });
});
