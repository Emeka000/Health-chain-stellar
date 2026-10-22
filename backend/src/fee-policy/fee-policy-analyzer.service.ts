import { Injectable, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, LessThanOrEqual, MoreThan, IsNull, Or } from 'typeorm';

import { FeePolicyEntity } from './entities/fee-policy.entity';
import { FeePreviewDto } from './dto/fee-policy.dto';
import { calculateFee } from './fee-calculator';

export interface PolicyConflict {
  policyId: string;
  conflictingPolicies: string[];
  overlapReason: string;
  severity: 'warning' | 'error';
}

export interface ConflictAnalysisResult {
  hasConflicts: boolean;
  conflicts: PolicyConflict[];
  precedenceOrder: string[];
}

export interface FeeCalculationTrace {
  policyId: string;
  policyName: string;
  input: FeePreviewDto;
  calculationSteps: Array<{
    step: string;
    value: number;
    formula: string;
  }>;
  finalBreakdown: {
    deliveryFee: number;
    platformFee: number;
    performanceFee: number;
    fixedFee: number;
    totalFee: number;
  };
  auditHash: string;
  timestamp: Date;
}

@Injectable()
export class FeePolicyAnalyzerService {
  constructor(
    @InjectRepository(FeePolicyEntity)
    private readonly repository: Repository<FeePolicyEntity>,
  ) {}

  /**
   * Analyzes all active fee policies for conflicts and overlapping conditions.
   * Returns detailed conflict information and recommended precedence order.
   */
  async analyzeConflicts(): Promise<ConflictAnalysisResult> {
    const activePolicies = await this.repository.find({
      where: { effectiveTo: null }, // Active policies (no end date)
      order: { priority: 'DESC', effectiveFrom: 'DESC' },
    });

    const conflicts: PolicyConflict[] = [];
    const precedenceOrder = activePolicies.map(p => p.id);

    // Check for overlapping conditions
    for (let i = 0; i < activePolicies.length; i++) {
      for (let j = i + 1; j < activePolicies.length; j++) {
        const conflict = this.checkPolicyOverlap(activePolicies[i], activePolicies[j]);
        if (conflict) {
          conflicts.push(conflict);
        }
      }
    }

    return {
      hasConflicts: conflicts.length > 0,
      conflicts,
      precedenceOrder,
    };
  }

  /**
   * Performs a dry-run fee calculation with full trace logging.
   * Returns the same result as runtime calculation but with detailed audit trail.
   */
  async dryRunCalculation(dto: FeePreviewDto): Promise<FeeCalculationTrace> {
    const applicablePolicy = await this.findApplicablePolicy(dto);
    if (!applicablePolicy) {
      throw new BadRequestException('No applicable fee policy found');
    }

    const trace = await this.computeBreakdownWithTrace(applicablePolicy, dto);

    return {
      policyId: applicablePolicy.id,
      policyName: `${applicablePolicy.geographyCode}-${applicablePolicy.urgencyTier}-${applicablePolicy.serviceLevel}`,
      input: dto,
      ...trace,
      timestamp: new Date(),
    };
  }

  /**
   * Validates that a new or updated policy won't create conflicts before activation.
   */
  async validatePolicyForActivation(policy: FeePolicyEntity): Promise<PolicyConflict[]> {
    const activePolicies = await this.repository.find({
      where: { effectiveTo: null },
    });

    const conflicts: PolicyConflict[] = [];

    for (const activePolicy of activePolicies) {
      const conflict = this.checkPolicyOverlap(policy, activePolicy);
      if (conflict) {
        conflicts.push(conflict);
      }
    }

    return conflicts;
  }

  private checkPolicyOverlap(policy1: FeePolicyEntity, policy2: FeePolicyEntity): PolicyConflict | null {
    // Check if policies have overlapping geographic and urgency conditions
    if (policy1.geographyCode !== policy2.geographyCode) {
      return null; // Different geographies don't overlap
    }

    if (policy1.urgencyTier !== policy2.urgencyTier) {
      return null; // Different urgency tiers don't overlap
    }

    if (policy1.serviceLevel !== policy2.serviceLevel) {
      return null; // Different service levels don't overlap
    }

    // Check distance overlap
    const distanceOverlap = this.hasDistanceOverlap(
      policy1.minDistanceKm,
      policy1.maxDistanceKm,
      policy2.minDistanceKm,
      policy2.maxDistanceKm,
    );

    if (!distanceOverlap) {
      return null; // No distance overlap
    }

    // Determine severity based on priority difference
    const priorityDiff = Math.abs(policy1.priority - policy2.priority);
    const severity = priorityDiff === 0 ? 'error' : 'warning';

    return {
      policyId: policy1.id,
      conflictingPolicies: [policy2.id],
      overlapReason: `Overlapping conditions: geography=${policy1.geographyCode}, urgency=${policy1.urgencyTier}, service=${policy1.serviceLevel}, distance overlap detected`,
      severity,
    };
  }



  private async findApplicablePolicy(dto: FeePreviewDto): Promise<FeePolicyEntity | null> {
    const now = new Date();
    const distanceKm = dto.distanceKm || 0;

    const base: Record<string, any> = {
      geographyCode: dto.geographyCode,
      urgencyTier: dto.urgencyTier,
      serviceLevel: dto.serviceLevel,
      minDistanceKm: LessThanOrEqual(distanceKm),
      effectiveFrom: LessThanOrEqual(now),
      effectiveTo: Or(IsNull(), MoreThan(now)),
    };

    return this.repository.findOne({
      where: [
        { ...base, maxDistanceKm: MoreThan(distanceKm) },
        { ...base, maxDistanceKm: IsNull() },
      ],
      order: { priority: 'DESC', effectiveFrom: 'DESC' },
    });
  }

  private async computeBreakdownWithTrace(
    policy: FeePolicyEntity,
    dto: FeePreviewDto,
  ): Promise<Omit<FeeCalculationTrace, 'policyId' | 'policyName' | 'input' | 'timestamp'>> {
    const result = calculateFee(policy, dto);

    const calculationSteps: Array<{ step: string; value: number; formula: string }> = [
      {
        step: 'Base Amount',
        value: result.baseAmount,
        formula: `${dto.quantity} units × 100 (placeholder unit price)`,
      },
      {
        step: 'Delivery Fee',
        value: result.deliveryFee,
        formula: `${result.baseAmount} × ${result.deliveryFeeRate}%`,
      },
      {
        step: 'Platform Fee',
        value: result.platformFee,
        formula: `${result.deliveryFee} × ${result.platformFeePct}%`,
      },
      {
        step: 'Performance Fee',
        value: result.performanceFee,
        formula: `${dto.distanceKm || 0} km × ${result.performanceMultiplier}`,
      },
      {
        step: 'Fixed Fee',
        value: result.fixedFee,
        formula: `Fixed amount: ${result.fixedFee}`,
      },
    ];

    if (result.waived) {
      calculationSteps.push({
        step: 'WAIVED',
        value: 0,
        formula: `Delivery and platform fees waived (${result.waiverReason})`,
      });
    }

    calculationSteps.push({
      step: 'Total Fee',
      value: result.totalFee,
      formula: `${result.deliveryFee} + ${result.platformFee} + ${result.performanceFee} + ${result.fixedFee}`,
    });

    // Generate audit hash
    const auditHash = this.generateAuditHash(policy, dto);

    return {
      calculationSteps,
      finalBreakdown: {
        deliveryFee: result.deliveryFee,
        platformFee: result.platformFee,
        performanceFee: result.performanceFee,
        fixedFee: result.fixedFee,
        totalFee: result.totalFee,
      },
      auditHash,
    };
  }

  private generateAuditHash(policy: FeePolicyEntity, dto: FeePreviewDto): string {
    const inputs = `${policy.id}${dto.geographyCode}${dto.distanceKm}${dto.urgencyTier}${dto.quantity}`;
    return inputs
      .split('')
      .reduce((a, b) => ((a << 5) - a + b.charCodeAt(0)) | 0, 0)
      .toString();
  }
}