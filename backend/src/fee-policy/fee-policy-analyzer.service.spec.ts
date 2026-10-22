import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { IsNull, LessThanOrEqual, MoreThan, MoreThanOrEqual, Or, Repository } from 'typeorm';
import { FeePolicyEntity, UrgencyTier, ServiceLevel } from '../entities/fee-policy.entity';
import { FeePolicyAnalyzerService } from '../fee-policy-analyzer.service';
import { FeePolicyService } from '../fee-policy.service';
import { FeePreviewDto } from '../dto/fee-policy.dto';

describe('FeePolicyAnalyzerService', () => {
  let service: FeePolicyAnalyzerService;
  let repository: jest.Mocked<Repository<FeePolicyEntity>>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FeePolicyAnalyzerService,
        {
          provide: getRepositoryToken(FeePolicyEntity),
          useValue: {
            find: jest.fn(),
            findOne: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<FeePolicyAnalyzerService>(FeePolicyAnalyzerService);
    repository = module.get(getRepositoryToken(FeePolicyEntity));
  });

  describe('analyzeConflicts', () => {
    it('should detect overlapping policies with same conditions', async () => {
      const policies: FeePolicyEntity[] = [
        {
          id: 'policy-1',
          geographyCode: 'LAG',
          urgencyTier: UrgencyTier.STANDARD,
          serviceLevel: ServiceLevel.BASIC,
          minDistanceKm: 0,
          maxDistanceKm: 50,
          priority: 1,
        } as FeePolicyEntity,
        {
          id: 'policy-2',
          geographyCode: 'LAG',
          urgencyTier: UrgencyTier.STANDARD,
          serviceLevel: ServiceLevel.BASIC,
          minDistanceKm: 10,
          maxDistanceKm: 30,
          priority: 2,
        } as FeePolicyEntity,
      ];

      repository.find.mockResolvedValue(policies);

      const result = await service.analyzeConflicts();

      expect(result.hasConflicts).toBe(true);
      expect(result.conflicts).toHaveLength(1);
      expect(result.conflicts[0].policyId).toBe('policy-1');
      expect(result.conflicts[0].severity).toBe('warning');
    });

    it('should not detect conflicts for different geographies', async () => {
      const policies: FeePolicyEntity[] = [
        {
          id: 'policy-1',
          geographyCode: 'LAG',
          urgencyTier: UrgencyTier.STANDARD,
          serviceLevel: ServiceLevel.BASIC,
          minDistanceKm: 0,
          maxDistanceKm: 50,
          priority: 1,
        } as FeePolicyEntity,
        {
          id: 'policy-2',
          geographyCode: 'ABJ',
          urgencyTier: UrgencyTier.STANDARD,
          serviceLevel: ServiceLevel.BASIC,
          minDistanceKm: 0,
          maxDistanceKm: 50,
          priority: 2,
        } as FeePolicyEntity,
      ];

      repository.find.mockResolvedValue(policies);

      const result = await service.analyzeConflicts();

      expect(result.hasConflicts).toBe(false);
    });
  });

  describe('dryRunCalculation', () => {
    it('should return detailed calculation trace', async () => {
      const mockPolicy: FeePolicyEntity = {
        id: 'policy-1',
        geographyCode: 'LAG',
        urgencyTier: UrgencyTier.STANDARD,
        serviceLevel: ServiceLevel.BASIC,
        deliveryFeeRate: 10,
        platformFeePct: 5,
        performanceMultiplier: 2,
        fixedFee: 100,
      } as FeePolicyEntity;

      const dto: FeePreviewDto = {
        geographyCode: 'LAG',
        urgencyTier: UrgencyTier.STANDARD as any,
        serviceLevel: ServiceLevel.BASIC as any,
        distanceKm: 20,
        quantity: 5,
      };

      repository.findOne.mockResolvedValue(mockPolicy);

      const result = await service.dryRunCalculation(dto);

      expect(result.policyId).toBe('policy-1');
      expect(result.calculationSteps).toHaveLength(5);
      expect(result.finalBreakdown.totalFee).toBeGreaterThan(0);
      expect(result.auditHash).toBeDefined();
    });

    it('should include fixedFee in totalFee as a number', async () => {
      const mockPolicy: FeePolicyEntity = {
        id: 'policy-1',
        geographyCode: 'LAG',
        urgencyTier: UrgencyTier.STANDARD,
        serviceLevel: ServiceLevel.BASIC,
        deliveryFeeRate: 10,
        platformFeePct: 5,
        performanceMultiplier: 2,
        fixedFee: 250,
      } as FeePolicyEntity;

      const dto: FeePreviewDto = {
        geographyCode: 'LAG',
        urgencyTier: UrgencyTier.STANDARD as any,
        serviceLevel: ServiceLevel.BASIC as any,
        distanceKm: 20,
        quantity: 5,
      };

      repository.findOne.mockResolvedValue(mockPolicy);

      const result = await service.dryRunCalculation(dto);

      expect(typeof result.finalBreakdown.totalFee).toBe('number');
      expect(result.finalBreakdown.totalFee).toBe(
        result.finalBreakdown.deliveryFee +
          result.finalBreakdown.platformFee +
          result.finalBreakdown.performanceFee +
          result.finalBreakdown.fixedFee,
      );
      expect(result.finalBreakdown.fixedFee).toBe(250);
    });

    it('should produce the same numeric total as previewFees for fixedFee = 250', async () => {
      const mockPolicy: FeePolicyEntity = {
        id: 'policy-1',
        geographyCode: 'LAG',
        urgencyTier: UrgencyTier.STANDARD,
        serviceLevel: ServiceLevel.BASIC,
        deliveryFeeRate: 10,
        platformFeePct: 5,
        performanceMultiplier: 2,
        fixedFee: 250,
      } as FeePolicyEntity;

      const dto: FeePreviewDto = {
        geographyCode: 'LAG',
        urgencyTier: UrgencyTier.STANDARD as any,
        serviceLevel: ServiceLevel.BASIC as any,
        distanceKm: 20,
        quantity: 5,
      };

      repository.findOne.mockResolvedValue(mockPolicy);

      const analyzerResult = await service.dryRunCalculation(dto);

      const feePolicyService = new FeePolicyService(repository as any);
      const previewResult = await feePolicyService.previewFees(dto);

      expect(typeof previewResult.totalFee).toBe('number');
      expect(typeof analyzerResult.finalBreakdown.totalFee).toBe('number');
      expect(previewResult.totalFee).toBe(analyzerResult.finalBreakdown.totalFee);
      expect(previewResult.fixedFee).toBe(250);
    });

    it('should apply a partner waiver', async () => {
      const mockPolicy: FeePolicyEntity = {
        id: 'policy-1',
        geographyCode: 'LAG',
        urgencyTier: UrgencyTier.STANDARD,
        serviceLevel: ServiceLevel.BASIC,
        deliveryFeeRate: 10,
        platformFeePct: 5,
        performanceMultiplier: 2,
        fixedFee: 250,
        waivedFor: 'partner-42',
      } as FeePolicyEntity;

      const dto: FeePreviewDto = {
        geographyCode: 'LAG',
        urgencyTier: UrgencyTier.STANDARD as any,
        serviceLevel: ServiceLevel.BASIC as any,
        distanceKm: 20,
        quantity: 5,
        partnerId: 'partner-42',
      };

      repository.findOne.mockResolvedValue(mockPolicy);

      const result = await service.dryRunCalculation(dto);

      expect(result.finalBreakdown.deliveryFee).toBe(0);
      expect(result.finalBreakdown.platformFee).toBe(0);
      expect(result.calculationSteps.some((s) => s.step === 'WAIVED')).toBe(true);
    });

    it('should apply an emergency waiver for CRITICAL urgency', async () => {
      const mockPolicy: FeePolicyEntity = {
        id: 'policy-1',
        geographyCode: 'LAG',
        urgencyTier: UrgencyTier.CRITICAL,
        serviceLevel: ServiceLevel.BASIC,
        deliveryFeeRate: 10,
        platformFeePct: 5,
        performanceMultiplier: 2,
        fixedFee: 250,
        waivedFor: 'emergency',
      } as FeePolicyEntity;

      const dto: FeePreviewDto = {
        geographyCode: 'LAG',
        urgencyTier: UrgencyTier.CRITICAL as any,
        serviceLevel: ServiceLevel.BASIC as any,
        distanceKm: 20,
        quantity: 5,
      };

      repository.findOne.mockResolvedValue(mockPolicy);

      const result = await service.dryRunCalculation(dto);

      expect(result.finalBreakdown.deliveryFee).toBe(0);
      expect(result.finalBreakdown.platformFee).toBe(0);
      expect(result.calculationSteps.some((s) => s.step === 'WAIVED')).toBe(true);
    });

    it('should not waive for a non-matching partner', async () => {
      const mockPolicy: FeePolicyEntity = {
        id: 'policy-1',
        geographyCode: 'LAG',
        urgencyTier: UrgencyTier.STANDARD,
        serviceLevel: ServiceLevel.BASIC,
        deliveryFeeRate: 10,
        platformFeePct: 5,
        performanceMultiplier: 2,
        fixedFee: 250,
        waivedFor: 'partner-42',
      } as FeePolicyEntity;

      const dto: FeePreviewDto = {
        geographyCode: 'LAG',
        urgencyTier: UrgencyTier.STANDARD as any,
        serviceLevel: ServiceLevel.BASIC as any,
        distanceKm: 20,
        quantity: 5,
        partnerId: 'partner-99',
      };

      repository.findOne.mockResolvedValue(mockPolicy);

      const result = await service.dryRunCalculation(dto);

      expect(result.finalBreakdown.deliveryFee).toBeGreaterThan(0);
      expect(result.finalBreakdown.platformFee).toBeGreaterThan(0);
      expect(result.calculationSteps.some((s) => s.step === 'WAIVED')).toBe(false);
    });
  });

  describe('policy selection', () => {
    it('should match an open-ended (NULL maxDistanceKm) tier for a 500 km order', async () => {
      const openEndedPolicy: FeePolicyEntity = {
        id: 'policy-open',
        geographyCode: 'LAG',
        urgencyTier: UrgencyTier.STANDARD,
        serviceLevel: ServiceLevel.BASIC,
        minDistanceKm: 100,
        maxDistanceKm: null,
        deliveryFeeRate: 10,
        platformFeePct: 5,
        performanceMultiplier: 2,
        fixedFee: 250,
      } as FeePolicyEntity;

      repository.findOne.mockResolvedValue(openEndedPolicy);

      const dto: FeePreviewDto = {
        geographyCode: 'LAG',
        urgencyTier: UrgencyTier.STANDARD as any,
        serviceLevel: ServiceLevel.BASIC as any,
        distanceKm: 500,
        quantity: 1,
      };

      const result = await service.dryRunCalculation(dto);

      expect(result.policyId).toBe('policy-open');

      const where = repository.findOne.mock.calls[0][0].where as any[];
      expect(Array.isArray(where)).toBe(true);
      expect(where).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ maxDistanceKm: MoreThanOrEqual(500) }),
          expect.objectContaining({ maxDistanceKm: IsNull() }),
        ]),
      );
    });

    it('should ignore a policy whose effectiveTo has passed', async () => {
      const now = new Date();
      const expiredPolicy: FeePolicyEntity = {
        id: 'policy-expired',
        geographyCode: 'LAG',
        urgencyTier: UrgencyTier.STANDARD,
        serviceLevel: ServiceLevel.BASIC,
        minDistanceKm: 0,
        maxDistanceKm: 50,
        deliveryFeeRate: 10,
        platformFeePct: 5,
        performanceMultiplier: 2,
        fixedFee: 250,
        effectiveTo: new Date(now.getTime() - 24 * 60 * 60 * 1000),
      } as FeePolicyEntity;

      repository.findOne.mockResolvedValue(null);

      const dto: FeePreviewDto = {
        geographyCode: 'LAG',
        urgencyTier: UrgencyTier.STANDARD as any,
        serviceLevel: ServiceLevel.BASIC as any,
        distanceKm: 20,
        quantity: 1,
      };

      await expect(service.dryRunCalculation(dto)).rejects.toThrow();

      const where = repository.findOne.mock.calls[0][0].where as any[];
      expect(where).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ effectiveTo: Or(IsNull(), MoreThan(expect.any(Date))) }),
        ]),
      );
      expect(expiredPolicy.effectiveTo!.getTime()).toBeLessThan(now.getTime());
    });
  });

  describe('validatePolicyForActivation', () => {
    it('should return conflicts for overlapping policies', async () => {
      const newPolicy: FeePolicyEntity = {
        id: 'new-policy',
        geographyCode: 'LAG',
        urgencyTier: UrgencyTier.STANDARD,
        serviceLevel: ServiceLevel.BASIC,
        minDistanceKm: 0,
        maxDistanceKm: 50,
        priority: 1,
      } as FeePolicyEntity;

      const existingPolicies: FeePolicyEntity[] = [
        {
          id: 'existing-policy',
          geographyCode: 'LAG',
          urgencyTier: UrgencyTier.STANDARD,
          serviceLevel: ServiceLevel.BASIC,
          minDistanceKm: 10,
          maxDistanceKm: 30,
          priority: 2,
        } as FeePolicyEntity,
      ];

      repository.find.mockResolvedValue(existingPolicies);

      const conflicts = await service.validatePolicyForActivation(newPolicy);

      expect(conflicts).toHaveLength(1);
      expect(conflicts[0].severity).toBe('warning');
    });
  });
});