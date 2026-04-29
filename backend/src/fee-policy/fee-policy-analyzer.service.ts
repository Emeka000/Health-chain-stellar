import { Injectable, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, LessThanOrEqual, MoreThanOrEqual } from 'typeorm';

import { FeePolicyEntity } from './entities/fee-policy.entity';
import { FeePreviewDto } from './dto/fee-policy.dto';

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
    const where: Record<string, any> = {
      geographyCode: dto.geographyCode,
      urgencyTier: dto.urgencyTier,
      serviceLevel: dto.serviceLevel,
      minDistanceKm: LessThanOrEqual(dto.distanceKm || 0),
      effectiveFrom: LessThanOrEqual(new Date()),
    };

    if (dto.distanceKm) {
      where.maxDistanceKm = MoreThanOrEqual(dto.distanceKm);
    }

    return this.repository.findOne({
      where,
      order: { priority: 'DESC', effectiveFrom: 'DESC' },
    });
  }

  private async computeBreakdownWithTrace(
    policy: FeePolicyEntity,
    dto: FeePreviewDto,
  ): Promise<Omit<FeeCalculationTrace, 'policyId' | 'policyName' | 'input' | 'timestamp'>> {
    const calculationSteps: Array<{ step: string; value: number; formula: string }> = [];

    // Base amount calculation
    const baseAmount = dto.quantity * 100; // Placeholder unit price
    calculationSteps.push({
      step: 'Base Amount',
      value: baseAmount,
      formula: `${dto.quantity} units × 100 (placeholder unit price)`,
    });

    // Delivery fee calculation
    const deliveryFee = baseAmount * (policy.deliveryFeeRate / 100);
    calculationSteps.push({
      step: 'Delivery Fee',
      value: deliveryFee,
      formula: `${baseAmount} × ${policy.deliveryFeeRate}%`,
    });

    // Platform fee calculation
    const platformFee = deliveryFee * (policy.platformFeePct / 100);
    calculationSteps.push({
      step: 'Platform Fee',
      value: platformFee,
      formula: `${deliveryFee} × ${policy.platformFeePct}%`,
    });

    // Performance fee calculation
    const performanceFee = (dto.distanceKm || 0) * policy.performanceMultiplier;
    calculationSteps.push({
      step: 'Performance Fee',
      value: performanceFee,
      formula: `${dto.distanceKm || 0} km × ${policy.performanceMultiplier}`,
    });

    // Fixed fee
    const fixedFee = policy.fixedFee || 0;
    calculationSteps.push({
      step: 'Fixed Fee',
      value: fixedFee,
      formula: `Fixed amount: ${fixedFee}`,
    });

    // Total fee
    const totalFee = deliveryFee + platformFee + performanceFee + fixedFee;
    calculationSteps.push({
      step: 'Total Fee',
      value: totalFee,
      formula: `${deliveryFee} + ${platformFee} + ${performanceFee} + ${fixedFee}`,
    });

    // Generate audit hash
    const auditHash = this.generateAuditHash(policy, dto);

    return {
      calculationSteps,
      finalBreakdown: {
        deliveryFee,
        platformFee,
        performanceFee,
        fixedFee,
        totalFee,
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