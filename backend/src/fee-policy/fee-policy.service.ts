import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import {
  Repository,
  LessThanOrEqual,
  MoreThanOrEqual,
  MoreThan,
  IsNull,
  Or,
} from 'typeorm';

import {
  CreateFeePolicyDto,
  UpdateFeePolicyDto,
  FeePreviewDto,
  FeeBreakdownDto,
} from './dto/fee-policy.dto';
import { FeePolicyEntity } from './entities/fee-policy.entity';
import { FeePolicyAnalyzerService } from './fee-policy-analyzer.service';
import { calculateFee } from './fee-calculator';

@Injectable()
export class FeePolicyService {
  constructor(
    @InjectRepository(FeePolicyEntity)
    private readonly repository: Repository<FeePolicyEntity>,
    private readonly analyzerService: FeePolicyAnalyzerService,
  ) {}

  async create(createDto: CreateFeePolicyDto): Promise<FeePolicyEntity> {
    const policy = this.repository.create(createDto);

    // Check for conflicts before saving
    const conflicts =
      await this.analyzerService.validatePolicyForActivation(policy);
    if (conflicts.some((c) => c.severity === 'error')) {
      throw new BadRequestException({
        message: 'Policy conflicts detected',
        conflicts: conflicts.filter((c) => c.severity === 'error'),
      });
    }

    return this.repository.save(policy);
  }

  async findAll(): Promise<FeePolicyEntity[]> {
    return this.repository.find({
      order: {
        effectiveFrom: 'DESC',
      },
    });
  }

  async findOne(id: string): Promise<FeePolicyEntity> {
    const policy = await this.repository.findOne({ where: { id } });
    if (!policy) throw new NotFoundException(`Policy ${id} not found`);
    return policy;
  }

  async previewFees(dto: FeePreviewDto): Promise<FeeBreakdownDto> {
    const applicablePolicy = await this.findApplicablePolicy(dto);
    if (!applicablePolicy) {
      throw new BadRequestException('No applicable fee policy found');
    }
    return this.computeBreakdown(applicablePolicy, dto);
  }

  /**
   * Compute fees with an optional surge multiplier applied to the platform fee.
   * The surgeMultiplier and bloodType are recorded in the audit hash for traceability.
   */
  async computeFeeWithSurge(
    dto: FeePreviewDto,
    surgeMultiplier: number,
    bloodType: string,
  ): Promise<FeeBreakdownDto> {
    const applicablePolicy = await this.findApplicablePolicy(dto);
    if (!applicablePolicy) {
      throw new BadRequestException('No applicable fee policy found');
    }
    const breakdown = this.computeBreakdown(applicablePolicy, dto);
    const adjustedPlatformFee = breakdown.platformFee * surgeMultiplier;
    const feeDelta = adjustedPlatformFee - breakdown.platformFee;
    return {
      ...breakdown,
      platformFee: adjustedPlatformFee,
      totalFee: breakdown.totalFee + feeDelta,
      auditHash: this.generateSurgeAuditHash(
        applicablePolicy,
        dto,
        surgeMultiplier,
        bloodType,
      ),
    };
  }

  private generateSurgeAuditHash(
    policy: FeePolicyEntity,
    dto: FeePreviewDto,
    surgeMultiplier: number,
    bloodType: string,
  ): string {
    const inputs = `${policy.id}${dto.geographyCode}${dto.distanceKm}${dto.urgencyTier}|surge:${bloodType}:${surgeMultiplier}`;
    return inputs
      .split('')
      .reduce((a, b) => ((a << 5) - a + b.charCodeAt(0)) | 0, 0)
      .toString();
  }

  private async findApplicablePolicy(
    dto: FeePreviewDto,
  ): Promise<FeePolicyEntity | null> {
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

    // Bounded tiers match when maxDistanceKm >= distance; open-ended tiers
    // (maxDistanceKm IS NULL) have no upper bound and must also match.
    return this.repository.findOne({
      where: [
        { ...base, maxDistanceKm: MoreThanOrEqual(distanceKm) },
        { ...base, maxDistanceKm: IsNull() },
      ],
      order: { priority: 'DESC', effectiveFrom: 'DESC' },
    });
  }

  private computeBreakdown(
    policy: FeePolicyEntity,
    dto: FeePreviewDto,
  ): FeeBreakdownDto {
    const result = calculateFee(policy, {
      quantity: dto.quantity,
      distanceKm: dto.distanceKm,
      urgencyTier: dto.urgencyTier,
      partnerId: dto.partnerId,
    });

    return {
      deliveryFee: result.deliveryFee,
      platformFee: result.platformFee,
      performanceFee: result.performanceFee,
      fixedFee: result.fixedFee,
      totalFee: result.totalFee,
      baseAmount: result.baseAmount,
      appliedPolicyId: policy.id,
      auditHash: this.generateAuditHash(policy, dto), // Deterministic
      distanceKm: dto.distanceKm,
    };
  }

  private generateAuditHash(
    policy: FeePolicyEntity,
    dto: FeePreviewDto,
  ): string {
    // Simple deterministic hash for audit (use crypto in prod)
    const inputs = `${policy.id}${dto.geographyCode}${dto.distanceKm}${dto.urgencyTier}`;
    return inputs
      .split('')
      .reduce((a, b) => ((a << 5) - a + b.charCodeAt(0)) | 0, 0)
      .toString();
  }

  async update(
    id: string,
    updateDto: UpdateFeePolicyDto,
  ): Promise<FeePolicyEntity> {
    await this.findOne(id);
    const policy = this.repository.create({ id, ...updateDto });

    // Check for conflicts before saving
    const conflicts =
      await this.analyzerService.validatePolicyForActivation(policy);
    if (conflicts.some((c) => c.severity === 'error')) {
      throw new BadRequestException({
        message: 'Policy conflicts detected',
        conflicts: conflicts.filter((c) => c.severity === 'error'),
      });
    }

    return this.repository.save(policy);
  }

  async remove(id: string): Promise<void> {
    const result = await this.repository.delete(id);
    if (result.affected === 0)
      throw new NotFoundException(`Policy ${id} not found`);
  }
}
