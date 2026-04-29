import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { FeePolicyEntity, UrgencyTier, ServiceLevel } from '../entities/fee-policy.entity';
import { FeePolicyAnalyzerService } from '../fee-policy-analyzer.service';
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