import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { FeePolicyService } from '../../fee-policy/fee-policy.service';
import { FeePreviewDto } from '../../fee-policy/dto/fee-policy.dto';
import { OrderEntity } from '../entities/order.entity';

@Injectable()
export class OrderFeeService {
  constructor(
    @InjectRepository(OrderEntity)
    private readonly orderRepo: Repository<OrderEntity>,
    private readonly feePolicyService: FeePolicyService,
  ) {}

  async computeAndPersist(order: OrderEntity): Promise<void> {
    const breakdown = await this.feePolicyService.previewFees(
      this.buildDto(order),
    );
    order.feeBreakdown = breakdown as any;
    order.appliedPolicyId = breakdown.appliedPolicyId;
    await this.orderRepo.save(order);
  }

  preview(order: OrderEntity, overrides: Partial<FeePreviewDto> = {}) {
    return this.feePolicyService.previewFees({
      ...this.buildDto(order),
      ...overrides,
    });
  }

  private buildDto(order: OrderEntity): FeePreviewDto {
    return {
      geographyCode: 'LAG',
      urgencyTier: 'STANDARD' as any,
      distanceKm: 10,
      serviceLevel: 'BASIC' as any,
      quantity: order.quantity,
    };
  }
}
