import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, LessThanOrEqual, MoreThanOrEqual, FindOptionsWhere } from 'typeorm';

import { FeePolicyEntity } from './entities/fee-policy.entity';
import { CreateFeePolicyDto, UpdateFeePolicyDto, FeePreviewDto, FeeBreakdownDto } from './dto/fee-policy.dto';
import { PartialType } from '@nestjs/mapped-types';

@Injectable()
export class FeePolicyService {
    constructor(
        @InjectRepository(FeePolicyEntity)
        private readonly repository: Repository<FeePolicyEntity>,
    ) { }

    async create(createDto: CreateFeePolicyDto): Promise<FeePolicyEntity> {
        const policy = this.repository.create(createDto);
        return this.repository.save(policy);
    }

    async findAll(): Promise<FeePolicyEntity[]> {
        return this.repository.find({
            order: {
                effectiveFrom: 'DESC'
            }
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

    private async findApplicablePolicy(dto: FeePreviewDto): Promise<FeePolicyEntity | null> {
        const where: FindOptionsWhere<FeePolicyEntity> = {
            geographyCode: dto.geographyCode,
            urgencyTier: dto.urgencyTier,
            serviceLevel: dto.serviceLevel,
            minDistanceKm: LessThanOrEqual(dto.distanceKm || 0),
            effectiveFrom: LessThanOrEqual(new Date()),
        };
        minDistanceKm: LessThanOrEqual(dto.distanceKm),
        };
    if(dto.distanceKm) {
        where.maxDistanceKm = MoreThanOrEqual(dto.distanceKm);
    }
        return this.repository.findOne({ where, order: { priority: 'DESC', effectiveFrom: 'DESC' } });
    }

    private computeBreakdown(policy: FeePolicyEntity, dto: FeePreviewDto): FeeBreakdownDto {
    // TODO: Implement based on rates, base price (e.g. quantity * unit), distance, etc.
    const baseAmount = dto.quantity * 100; // Placeholder unit price
    const deliveryFee = baseAmount * (policy.deliveryFeeRate / 100);
    const platformFee = deliveryFee * (policy.platformFeePct / 100);
    const performanceFee = dto.distanceKm * policy.performanceMultiplier;
    const totalFee = deliveryFee + platformFee + performanceFee;

    return {
        deliveryFee,
        platformFee,
        performanceFee,
        fixedFee: policy.fixedFee || 0,
        totalFee,
        baseAmount,
        appliedPolicyId: policy.id,
        auditHash: this.generateAuditHash(policy, dto), // Deterministic
    };
}

    private generateAuditHash(policy: FeePolicyEntity, dto: FeePreviewDto): string {
    // Simple deterministic hash for audit (use crypto in prod)
    const inputs = `${policy.id}${dto.geographyCode}${dto.distanceKm}${dto.urgencyTier}`;
    return inputs.split('').reduce((a, b) => ((a << 5) - a + b.charCodeAt(0)) | 0, 0).toString();
}

    async update(id: string, updateDto: UpdateFeePolicyDto): Promise < FeePolicyEntity > {
    await this.findOne(id);
    const policy = this.repository.create({ id, ...updateDto });
    return this.repository.save(policy);
}

    async remove(id: string): Promise < void> {
    const result = await this.repository.delete(id);
    if(result.affected === 0) throw new NotFoundException(`Policy ${id} not found`);
}
}
