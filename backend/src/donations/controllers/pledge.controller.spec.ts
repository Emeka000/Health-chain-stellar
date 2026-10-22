import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException, ForbiddenException, BadRequestException } from '@nestjs/common';
import { PledgeController } from './pledge.controller';
import { PledgeService } from '../services/pledge.service';
import { PledgeEntity } from '../entities/pledge.entity';
import { PledgeFrequency, PledgeStatus } from '../enums/pledge.enum';
import { DonationAsset } from '../enums/donation.enum';

describe('PledgeController', () => {
  let controller: PledgeController;
  let pledgeService: PledgeService;

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
      controllers: [PledgeController],
      providers: [
        {
          provide: PledgeService,
          useValue: {
            getById: jest.fn(),
            setStatus: jest.fn(),
            createPledge: jest.fn(),
            listByPayer: jest.fn(),
          },
        },
      ],
    }).compile();

    controller = module.get<PledgeController>(PledgeController);
    pledgeService = module.get<PledgeService>(PledgeService);
  });

  describe('getOne', () => {
    it('should return pledge for authenticated owner', async () => {
      jest.spyOn(pledgeService, 'getById').mockResolvedValue(mockPledge);

      const req = { user: { id: 'user-1' } };
      const result = await controller.getOne('pledge-1', req);

      expect(result).toEqual(mockPledge);
      expect(pledgeService.getById).toHaveBeenCalledWith('pledge-1', 'user-1');
    });

    it('should return 404 when non-owner tries to access pledge', async () => {
      jest.spyOn(pledgeService, 'getById').mockRejectedValue(
        new NotFoundException('Pledge not found'),
      );

      const req = { user: { id: 'user-2' } };

      await expect(controller.getOne('pledge-1', req)).rejects.toThrow(NotFoundException);
      expect(pledgeService.getById).toHaveBeenCalledWith('pledge-1', 'user-2');
    });
  });

  describe('setStatus', () => {
    it('should allow owner to pause active pledge', async () => {
      const pausedPledge = { ...mockPledge, status: PledgeStatus.PAUSED };
      jest.spyOn(pledgeService, 'setStatus').mockResolvedValue(pausedPledge);

      const req = { user: { id: 'user-1' } };
      const dto = { status: PledgeStatus.PAUSED };
      const result = await controller.setStatus('pledge-1', dto, req);

      expect(result).toEqual(pausedPledge);
      expect(pledgeService.setStatus).toHaveBeenCalledWith('pledge-1', PledgeStatus.PAUSED, 'user-1');
    });

    it('should prevent non-owner from changing pledge status', async () => {
      jest.spyOn(pledgeService, 'setStatus').mockRejectedValue(
        new ForbiddenException('You are not authorized to modify this pledge'),
      );

      const req = { user: { id: 'user-2' } };
      const dto = { status: PledgeStatus.PAUSED };

      await expect(controller.setStatus('pledge-1', dto, req)).rejects.toThrow(ForbiddenException);
      expect(pledgeService.setStatus).toHaveBeenCalledWith('pledge-1', PledgeStatus.PAUSED, 'user-2');
    });

    it('should reject invalid status transitions', async () => {
      jest.spyOn(pledgeService, 'setStatus').mockRejectedValue(
        new BadRequestException('Invalid status transition'),
      );

      const req = { user: { id: 'user-1' } };
      const dto = { status: PledgeStatus.ACTIVE };

      // Attempting to transition COMPLETED back to ACTIVE
      await expect(controller.setStatus('pledge-1', dto, req)).rejects.toThrow(BadRequestException);
    });
  });
});
