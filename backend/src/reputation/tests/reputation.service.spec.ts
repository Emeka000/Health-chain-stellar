import { NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { RiderEntity } from '../../riders/entities/rider.entity';
import { ReputationHistoryEntity } from '../entities/reputation-history.entity';
import { ReputationEntity } from '../entities/reputation.entity';
import { BadgeType } from '../enums/badge-type.enum';
import { ReputationEventType } from '../enums/reputation-event-type.enum';
import { ReputationService } from '../reputation.service';

const mockRep = (overrides = {}): ReputationEntity =>
  ({
    id: 'rep-1',
    riderId: 'rider-1',
    reputationScore: 50,
    badges: [],
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  }) as ReputationEntity;

const mockRider = (overrides = {}): RiderEntity =>
  ({
    id: 'rider-1',
    completedDeliveries: 5,
    rating: 4.5,
    ...overrides,
  }) as RiderEntity;

describe('ReputationService', () => {
  let service: ReputationService;

  const repRepo = {
    findOne: jest.fn(),
    findAndCount: jest.fn(),
    find: jest.fn(),
    create: jest.fn((d) => d),
    save: jest.fn((d) => Promise.resolve(d)),
    createQueryBuilder: jest.fn(),
  };
  const historyRepo = {
    findAndCount: jest.fn(),
    create: jest.fn((d) => d),
    save: jest.fn((d) => Promise.resolve(d)),
  };
  const riderRepo = {
    findOne: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ReputationService,
        { provide: getRepositoryToken(ReputationEntity), useValue: repRepo },
        {
          provide: getRepositoryToken(ReputationHistoryEntity),
          useValue: historyRepo,
        },
        { provide: getRepositoryToken(RiderEntity), useValue: riderRepo },
      ],
    }).compile();

    service = module.get<ReputationService>(ReputationService);
    jest.clearAllMocks();
  });

  describe('getReputation', () => {
    it('returns reputation when found', async () => {
      repRepo.findOne.mockResolvedValue(mockRep());
      const result = await service.getReputation('rider-1');
      expect(result.data.riderId).toBe('rider-1');
    });

    it('throws NotFoundException when not found', async () => {
      repRepo.findOne.mockResolvedValue(null);
      await expect(service.getReputation('missing')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('getLeaderboard', () => {
    it('returns paginated leaderboard with ranks', async () => {
      repRepo.findAndCount.mockResolvedValue([
        [mockRep(), mockRep({ id: 'rep-2', riderId: 'rider-2' })],
        2,
      ]);
      const result = await service.getLeaderboard({ page: 1, limit: 10 });
      expect(result.data).toHaveLength(2);
      expect(result.data[0].rank).toBe(1);
      expect(result.data[1].rank).toBe(2);
      expect(result.meta.total).toBe(2);
    });
  });

  describe('getBadges', () => {
    it('returns badges for a rider', async () => {
      repRepo.findOne.mockResolvedValue(
        mockRep({ badges: [BadgeType.FIRST_DELIVERY] }),
      );
      const result = await service.getBadges('rider-1');
      expect(result.data).toContain(BadgeType.FIRST_DELIVERY);
    });

    it('throws NotFoundException when rider has no reputation', async () => {
      repRepo.findOne.mockResolvedValue(null);
      await expect(service.getBadges('missing')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('getHistory', () => {
    it('returns paginated history', async () => {
      repRepo.findOne.mockResolvedValue(mockRep());
      historyRepo.findAndCount.mockResolvedValue([
        [
          {
            id: 'h1',
            eventType: ReputationEventType.DELIVERY_COMPLETED,
            pointsDelta: 10,
          },
        ],
        1,
      ]);
      const result = await service.getHistory('rider-1', {
        page: 1,
        limit: 20,
      });
      expect(result.data).toHaveLength(1);
      expect(result.meta.total).toBe(1);
    });

    it('filters history by type', async () => {
      repRepo.findOne.mockResolvedValue(mockRep());
      historyRepo.findAndCount.mockResolvedValue([[], 0]);
      await service.getHistory('rider-1', {
        type: ReputationEventType.DISPUTE_RAISED,
        page: 1,
        limit: 20,
      });
      expect(historyRepo.findAndCount).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            eventType: ReputationEventType.DISPUTE_RAISED,
          }),
        }),
      );
    });
  });

  describe('getRank', () => {
    it('returns rank based on score comparison', async () => {
      repRepo.findOne.mockResolvedValue(mockRep({ reputationScore: 100 }));
      const qb = {
        where: jest.fn().mockReturnThis(),
        getCount: jest.fn().mockResolvedValue(3),
      };
      repRepo.createQueryBuilder.mockReturnValue(qb);
      const result = await service.getRank('rider-1');
      expect(result.data.rank).toBe(4); // 3 riders above + 1
    });
  });

  describe('recordDelivery', () => {
    it('adds points for completed delivery', async () => {
      repRepo.findOne.mockResolvedValue(mockRep({ reputationScore: 50 }));
      riderRepo.findOne.mockResolvedValue(mockRider());
      await service.recordDelivery('rider-1', 'order-1', 'completed');
      expect(repRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ reputationScore: 60 }),
      );
    });

    it('deducts points for cancelled delivery', async () => {
      repRepo.findOne.mockResolvedValue(mockRep({ reputationScore: 50 }));
      riderRepo.findOne.mockResolvedValue(mockRider());
      await service.recordDelivery('rider-1', 'order-1', 'cancelled');
      expect(repRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ reputationScore: 45 }),
      );
    });

    it('score does not go below 0', async () => {
      repRepo.findOne.mockResolvedValue(mockRep({ reputationScore: 3 }));
      riderRepo.findOne.mockResolvedValue(mockRider());
      await service.recordDelivery('rider-1', 'order-1', 'failed');
      expect(repRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ reputationScore: 0 }),
      );
    });
  });

  describe('badge awarding', () => {
    it('awards FIRST_DELIVERY badge after first completed delivery', async () => {
      const rep = mockRep({ reputationScore: 0, badges: [] });
      repRepo.findOne.mockResolvedValue(rep);
      riderRepo.findOne.mockResolvedValue(
        mockRider({ completedDeliveries: 1 }),
      );
      await service.recordDelivery('rider-1', 'order-1', 'completed');
      expect(repRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          badges: expect.arrayContaining([BadgeType.FIRST_DELIVERY]),
        }),
      );
    });
  });
});
