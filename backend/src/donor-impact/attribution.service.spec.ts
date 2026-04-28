import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { AttributionService, AttributionGraphInput } from './attribution.service';
import { DonationAttributionEntity } from './entities/donation-attribution.entity';
import { LineageGapEntity } from './entities/lineage-gap.entity';

const mockAttributionRepo = () => ({
  create: jest.fn(),
  save: jest.fn(),
  findOne: jest.fn(),
  find: jest.fn(),
});

const mockGapRepo = () => ({
  create: jest.fn(),
  save: jest.fn(),
  find: jest.fn(),
});

describe('AttributionService', () => {
  let service: AttributionService;
  let attributionRepo: jest.Mocked<Partial<Repository<DonationAttributionEntity>>>;
  let gapRepo: jest.Mocked<Partial<Repository<LineageGapEntity>>>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AttributionService,
        { provide: getRepositoryToken(DonationAttributionEntity), useFactory: mockAttributionRepo },
        { provide: getRepositoryToken(LineageGapEntity), useFactory: mockGapRepo },
      ],
    }).compile();

    service = module.get<AttributionService>(AttributionService);
    attributionRepo = module.get(getRepositoryToken(DonationAttributionEntity));
    gapRepo = module.get(getRepositoryToken(LineageGapEntity));
  });

  describe('computeScores', () => {
    it('returns full confidence and score for complete lineage', () => {
      const input: AttributionGraphInput = {
        donorId: 'donor-1',
        pledgeId: 'pledge-1',
        donationId: 'donation-1',
        bloodUnitId: 'unit-1',
        orderId: 'order-1',
        beneficiaryId: 'hospital-1',
        lineagePath: [
          { eventType: 'pledge', eventId: 'pledge-1', timestamp: '2026-01-01T00:00:00Z' },
          { eventType: 'donation', eventId: 'donation-1', timestamp: '2026-01-02T00:00:00Z' },
          { eventType: 'allocation', eventId: 'unit-1', timestamp: '2026-01-03T00:00:00Z' },
          { eventType: 'delivery', eventId: 'order-1', timestamp: '2026-01-04T00:00:00Z' },
          { eventType: 'beneficiary', eventId: 'hospital-1', timestamp: '2026-01-05T00:00:00Z' },
        ],
      };

      const { attributionScore, confidenceScore, gaps } = service.computeScores(input);

      expect(attributionScore).toBe(1.0);
      expect(confidenceScore).toBe(1.0);
      expect(gaps).toHaveLength(0);
    });

    it('penalizes confidence for each missing lineage segment', () => {
      const input: AttributionGraphInput = {
        donorId: 'donor-1',
        donationId: 'donation-1',
        // Missing: allocation, delivery, beneficiary
        lineagePath: [
          { eventType: 'donation', eventId: 'donation-1', timestamp: '2026-01-01T00:00:00Z' },
        ],
      };

      const { confidenceScore, gaps } = service.computeScores(input);

      // 3 missing segments (allocation, delivery, beneficiary) × 0.15 penalty
      expect(confidenceScore).toBeCloseTo(1 - 3 * 0.15, 5);
      expect(gaps).toHaveLength(3);
      expect(gaps.map((g) => g.missingEventType)).toEqual(
        expect.arrayContaining(['allocation', 'delivery', 'beneficiary']),
      );
    });

    it('skips pledge in expected sequence for one-time donations', () => {
      const input: AttributionGraphInput = {
        donorId: 'donor-1',
        donationId: 'donation-1',
        // No pledgeId — pledge should not be expected
        lineagePath: [
          { eventType: 'donation', eventId: 'donation-1', timestamp: '2026-01-01T00:00:00Z' },
          { eventType: 'allocation', eventId: 'unit-1', timestamp: '2026-01-02T00:00:00Z' },
          { eventType: 'delivery', eventId: 'order-1', timestamp: '2026-01-03T00:00:00Z' },
          { eventType: 'beneficiary', eventId: 'hospital-1', timestamp: '2026-01-04T00:00:00Z' },
        ],
      };

      const { confidenceScore, gaps } = service.computeScores(input);

      expect(confidenceScore).toBe(1.0);
      expect(gaps).toHaveLength(0);
    });

    it('computes partial attribution score for pooled donations', () => {
      const input: AttributionGraphInput = {
        donorId: 'donor-1',
        donationId: 'donation-1',
        isPooled: true,
        poolContributionPct: 40,
        lineagePath: [
          { eventType: 'donation', eventId: 'donation-1', timestamp: '2026-01-01T00:00:00Z' },
          { eventType: 'allocation', eventId: 'unit-1', timestamp: '2026-01-02T00:00:00Z' },
          { eventType: 'delivery', eventId: 'order-1', timestamp: '2026-01-03T00:00:00Z' },
          { eventType: 'beneficiary', eventId: 'hospital-1', timestamp: '2026-01-04T00:00:00Z' },
        ],
      };

      const { attributionScore } = service.computeScores(input);

      expect(attributionScore).toBeCloseTo(0.4, 5);
    });

    it('caps attribution score at 1.0 for pooled donations over 100%', () => {
      const input: AttributionGraphInput = {
        donorId: 'donor-1',
        donationId: 'donation-1',
        isPooled: true,
        poolContributionPct: 150,
        lineagePath: [
          { eventType: 'donation', eventId: 'donation-1', timestamp: '2026-01-01T00:00:00Z' },
        ],
      };

      const { attributionScore } = service.computeScores(input);

      expect(attributionScore).toBe(1.0);
    });

    it('clamps confidence to 0 when all segments are missing', () => {
      const input: AttributionGraphInput = {
        donorId: 'donor-1',
        pledgeId: 'pledge-1',
        lineagePath: [],
      };

      const { confidenceScore } = service.computeScores(input);

      expect(confidenceScore).toBe(0);
    });
  });

  describe('recordAttribution', () => {
    it('persists attribution and gaps', async () => {
      const savedAttribution = {
        id: 'attr-1',
        correlationId: 'ATTR-abc',
        attributionScore: 1.0,
        confidenceScore: 0.85,
        lineagePath: [],
      } as DonationAttributionEntity;

      (attributionRepo.create as jest.Mock).mockReturnValue(savedAttribution);
      (attributionRepo.save as jest.Mock).mockResolvedValue(savedAttribution);
      (gapRepo.save as jest.Mock).mockImplementation((g) => Promise.resolve({ ...g, id: 'gap-1' }));

      const input: AttributionGraphInput = {
        donorId: 'donor-1',
        donationId: 'donation-1',
        lineagePath: [
          { eventType: 'donation', eventId: 'donation-1', timestamp: '2026-01-01T00:00:00Z' },
        ],
      };

      const result = await service.recordAttribution(input);

      expect(attributionRepo.save).toHaveBeenCalled();
      expect(result.attribution).toBe(savedAttribution);
      expect(result.correlationId).toBeDefined();
    });
  });

  describe('upsertAttribution (replay stability)', () => {
    it('returns existing attribution on replay without creating duplicate', async () => {
      const existing = {
        id: 'attr-1',
        correlationId: 'ATTR-abc',
        attributionScore: 1.0,
        confidenceScore: 1.0,
        lineagePath: [],
      } as DonationAttributionEntity;

      (attributionRepo.findOne as jest.Mock).mockResolvedValue(existing);
      (gapRepo.find as jest.Mock).mockResolvedValue([]);

      const input: AttributionGraphInput = {
        donorId: 'donor-1',
        donationId: 'donation-1',
        lineagePath: [
          { eventType: 'donation', eventId: 'donation-1', timestamp: '2026-01-01T00:00:00Z' },
        ],
      };

      const result = await service.upsertAttribution(input);

      expect(attributionRepo.save).not.toHaveBeenCalled();
      expect(result.attribution).toBe(existing);
    });
  });

  describe('split deliveries', () => {
    it('records separate attributions for split deliveries with correct scores', async () => {
      const savedAttribution = {
        id: 'attr-split',
        correlationId: 'ATTR-split',
        attributionScore: 0.5,
        confidenceScore: 1.0,
        lineagePath: [],
      } as DonationAttributionEntity;

      (attributionRepo.create as jest.Mock).mockReturnValue(savedAttribution);
      (attributionRepo.save as jest.Mock).mockResolvedValue(savedAttribution);
      (gapRepo.save as jest.Mock).mockImplementation((g) => Promise.resolve({ ...g, id: 'gap-1' }));

      const splitInput: AttributionGraphInput = {
        donorId: 'donor-1',
        donationId: 'donation-1',
        isPooled: true,
        poolContributionPct: 50,
        lineagePath: [
          { eventType: 'donation', eventId: 'donation-1', timestamp: '2026-01-01T00:00:00Z' },
          { eventType: 'allocation', eventId: 'unit-1', timestamp: '2026-01-02T00:00:00Z' },
          { eventType: 'delivery', eventId: 'order-1', timestamp: '2026-01-03T00:00:00Z' },
          { eventType: 'beneficiary', eventId: 'hospital-1', timestamp: '2026-01-04T00:00:00Z' },
        ],
      };

      const result = await service.recordAttribution(splitInput);

      expect(result.attributionScore).toBeCloseTo(0.5, 5);
      expect(result.confidenceScore).toBe(1.0);
    });
  });

  describe('merged funding paths', () => {
    it('records pooled attribution with correct contribution percentage', async () => {
      const input: AttributionGraphInput = {
        donorId: 'donor-2',
        donationId: 'donation-2',
        isPooled: true,
        poolContributionPct: 30,
        lineagePath: [
          { eventType: 'donation', eventId: 'donation-2', timestamp: '2026-01-01T00:00:00Z' },
          { eventType: 'allocation', eventId: 'unit-pool', timestamp: '2026-01-02T00:00:00Z' },
          { eventType: 'delivery', eventId: 'order-pool', timestamp: '2026-01-03T00:00:00Z' },
          { eventType: 'beneficiary', eventId: 'hospital-2', timestamp: '2026-01-04T00:00:00Z' },
        ],
      };

      const { attributionScore, confidenceScore } = service.computeScores(input);

      expect(attributionScore).toBeCloseTo(0.3, 5);
      expect(confidenceScore).toBe(1.0);
    });
  });
});
