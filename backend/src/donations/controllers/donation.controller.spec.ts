import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException, ForbiddenException } from '@nestjs/common';
import { DonationController } from './donation.controller';
import { DonationService } from '../services/donation.service';
import { PledgeService } from '../services/pledge.service';
import { DonationEntity } from '../entities/donation.entity';
import { DonationStatus, DonationAsset } from '../enums/donation.enum';

describe('DonationController', () => {
  let controller: DonationController;
  let donationService: DonationService;

  const mockDonation: DonationEntity = {
    id: 'donation-1',
    amount: 100,
    payerAddress: 'GAAAA...',
    recipientId: 'hospital-1',
    asset: DonationAsset.XLM,
    memo: 'DON-ABC123',
    status: DonationStatus.COMPLETED,
    donorUserId: 'user-1',
    transactionHash: 'hash123',
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [DonationController],
      providers: [
        {
          provide: DonationService,
          useValue: {
            getDonationById: jest.fn(),
            createIntent: jest.fn(),
            confirmDonation: jest.fn(),
            getDonationsByDonorUserId: jest.fn(),
          },
        },
        {
          provide: PledgeService,
          useValue: {
            listByDonorUserId: jest.fn(),
          },
        },
      ],
    }).compile();

    controller = module.get<DonationController>(DonationController);
    donationService = module.get<DonationService>(DonationService);
  });

  describe('findOne', () => {
    it('should return donation for authenticated owner', async () => {
      jest.spyOn(donationService, 'getDonationById').mockResolvedValue(mockDonation);

      const req = { user: { id: 'user-1' } };
      const result = await controller.findOne('donation-1', req);

      expect(result).toEqual(mockDonation);
      expect(donationService.getDonationById).toHaveBeenCalledWith('donation-1', 'user-1');
    });

    it('should return 404 when non-owner tries to access donation', async () => {
      jest.spyOn(donationService, 'getDonationById').mockRejectedValue(
        new NotFoundException('Donation not found'),
      );

      const req = { user: { id: 'user-2' } };

      await expect(controller.findOne('donation-1', req)).rejects.toThrow(NotFoundException);
      expect(donationService.getDonationById).toHaveBeenCalledWith('donation-1', 'user-2');
    });

    it('should handle missing user gracefully', async () => {
      jest.spyOn(donationService, 'getDonationById').mockResolvedValue(mockDonation);

      const req = { user: { id: undefined } };
      const result = await controller.findOne('donation-1', req);

      expect(result).toEqual(mockDonation);
    });
  });
});
