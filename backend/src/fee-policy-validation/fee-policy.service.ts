import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';

import { Repository } from 'typeorm';

import {
  CreateFeePolicyDto,
  FeeBreakdownDto,
  FeePolicyResponseDto,
  QuotePaymentDto,
  UpdateFeePolicyDto,
} from './fee-policy.dto';
import { FeePolicyEntity, FeePolicyStatus } from './fee-policy.entity';
import { FeePolicyValidator } from './fee-policy.validator';

@Injectable()
export class FeePolicyService {
  private readonly logger = new Logger(FeePolicyService.name);

  constructor(
    @InjectRepository(FeePolicyEntity)
    private readonly repo: Repository<FeePolicyEntity>,
  ) {}

  // ─── CRUD ──────────────────────────────────────────────────────────────────

  async create(dto: CreateFeePolicyDto): Promise<FeePolicyResponseDto> {
    const policy = this.repo.create({
      name: dto.name,
      recipientType: dto.recipientType,
      platformFeeBp: dto.platformFeeBp ?? 0,
      insuranceFeeBp: dto.insuranceFeeBp ?? 0,
      flatFeeStroops: dto.flatFeeStroops ?? 0,
      stellarNetworkFeeStroops: dto.stellarNetworkFeeStroops ?? 100,
      status: dto.status ?? FeePolicyStatus.DRAFT,
      description: dto.description ?? null,
    });

    this.assertValidStructure(policy);

    const saved = await this.repo.save(policy);
    this.logger.log(`Created fee policy "${saved.name}" (${saved.id})`);
    return this.toResponseDto(saved);
  }

  async findAll(): Promise<FeePolicyResponseDto[]> {
    const policies = await this.repo.find({ order: { createdAt: 'DESC' } });
    return policies.map((p) => this.toResponseDto(p));
  }

  async findOne(id: string): Promise<FeePolicyResponseDto> {
    const policy = await this.findEntityOrThrow(id);
    return this.toResponseDto(policy);
  }

  async update(
    id: string,
    dto: UpdateFeePolicyDto,
  ): Promise<FeePolicyResponseDto> {
    const policy = await this.findEntityOrThrow(id);

    // Merge proposed changes into a transient copy for validation
    const candidate = this.repo.merge({ ...policy }, dto);
    this.assertValidStructure(candidate);

    const updated = await this.repo.save(candidate);
    this.logger.log(`Updated fee policy "${updated.name}" (${updated.id})`);
    return this.toResponseDto(updated);
  }

  async remove(id: string): Promise<void> {
    const policy = await this.findEntityOrThrow(id);
    await this.repo.remove(policy);
    this.logger.log(`Removed fee policy (${id})`);
  }

  async activate(id: string): Promise<FeePolicyResponseDto> {
    return this.update(id, { status: FeePolicyStatus.ACTIVE });
  }

  async deactivate(id: string): Promise<FeePolicyResponseDto> {
    return this.update(id, { status: FeePolicyStatus.INACTIVE });
  }

  // ─── Quote / Simulation ────────────────────────────────────────────────────

  /**
   * Simulate a payment against a fee policy.
   * Validates both the amount and the policy, then returns a full breakdown.
   * Throws UnprocessableEntityException if any bound is violated.
   */
  async quotePayment(dto: QuotePaymentDto): Promise<FeeBreakdownDto> {
    const policy = await this.findEntityOrThrow(dto.feePolicyId);

    if (policy.status !== FeePolicyStatus.ACTIVE) {
      throw new BadRequestException(
        `Fee policy "${policy.name}" is not active (status: ${policy.status}).`,
      );
    }

    const result = FeePolicyValidator.validatePaymentWithPolicy(
      dto.grossAmountStroops,
      policy,
    );

    if (!result.valid) {
      this.logger.warn(
        `Payment quote rejected for policy ${policy.id}: ${result.errors.join(', ')}`,
      );
      throw new UnprocessableEntityException({
        message: 'Payment validation failed',
        errors: result.errors,
      });
    }

    return FeePolicyValidator.toBreakdownDto(
      dto.grossAmountStroops,
      result.components!,
    );
  }

  // ─── Internal helpers ──────────────────────────────────────────────────────

  private async findEntityOrThrow(id: string): Promise<FeePolicyEntity> {
    const policy = await this.repo.findOneBy({ id });
    if (!policy) {
      throw new NotFoundException(`Fee policy with id "${id}" not found.`);
    }
    return policy;
  }

  /**
   * Throws BadRequestException if the policy's structural bounds are violated.
   * Called on both create and update before hitting the database.
   */
  private assertValidStructure(
    policy: Pick<
      FeePolicyEntity,
      | 'platformFeeBp'
      | 'insuranceFeeBp'
      | 'flatFeeStroops'
      | 'stellarNetworkFeeStroops'
    >,
  ): void {
    const result = FeePolicyValidator.validatePolicyStructure(policy);
    if (!result.valid) {
      throw new BadRequestException({
        message: 'Invalid fee policy configuration',
        errors: result.errors,
      });
    }
  }

  private toResponseDto(entity: FeePolicyEntity): FeePolicyResponseDto {
    return {
      id: entity.id,
      name: entity.name,
      recipientType: entity.recipientType,
      platformFeeBp: entity.platformFeeBp,
      insuranceFeeBp: entity.insuranceFeeBp,
      flatFeeStroops: entity.flatFeeStroops,
      stellarNetworkFeeStroops: entity.stellarNetworkFeeStroops,
      status: entity.status,
      description: entity.description,
      createdAt: entity.createdAt,
      updatedAt: entity.updatedAt,
    };
  }
}
