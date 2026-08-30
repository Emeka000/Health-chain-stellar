import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { BloodRequestEntity } from '../entities/blood-request.entity';
import {
  FulfillmentLegEntity,
  FulfillmentLegStatus,
} from '../entities/fulfillment-leg.entity';

export const ALLOWED_LEG_TRANSITIONS: Record<
  FulfillmentLegStatus,
  FulfillmentLegStatus[]
> = {
  [FulfillmentLegStatus.PENDING]: [
    FulfillmentLegStatus.ALLOCATED,
    FulfillmentLegStatus.CANCELLED,
  ],
  [FulfillmentLegStatus.ALLOCATED]: [
    FulfillmentLegStatus.RIDER_ASSIGNED,
    FulfillmentLegStatus.CANCELLED,
    FulfillmentLegStatus.FAILED,
  ],
  [FulfillmentLegStatus.RIDER_ASSIGNED]: [
    FulfillmentLegStatus.IN_TRANSIT,
    FulfillmentLegStatus.CANCELLED,
    FulfillmentLegStatus.FAILED,
  ],
  [FulfillmentLegStatus.IN_TRANSIT]: [
    FulfillmentLegStatus.DELIVERED,
    FulfillmentLegStatus.FAILED,
  ],
  [FulfillmentLegStatus.DELIVERED]: [],
  [FulfillmentLegStatus.FAILED]: [],
  [FulfillmentLegStatus.CANCELLED]: [],
};

export interface AllocationSource {
  bloodBankId: string;
  bloodBankName: string;
  availableUnits: string[];
  quantityMl: number;
  pickupLocation: string;
}

export interface SplitOrderResult {
  parentRequestId: string;
  legs: FulfillmentLegEntity[];
  totalLegs: number;
}

@Injectable()
export class OrderSplittingService {
  private readonly logger = new Logger(OrderSplittingService.name);

  constructor(
    @InjectRepository(FulfillmentLegEntity)
    private readonly fulfillmentLegRepository: Repository<FulfillmentLegEntity>,
    @InjectRepository(BloodRequestEntity)
    private readonly bloodRequestRepository: Repository<BloodRequestEntity>,
  ) {}

  async createSplitOrder(
    parentRequest: BloodRequestEntity,
    allocationSources: AllocationSource[],
  ): Promise<SplitOrderResult> {
    this.logger.log(
      `Creating split order for request ${parentRequest.id} across ${allocationSources.length} sources`,
    );

    const legs: FulfillmentLegEntity[] = [];

    for (let i = 0; i < allocationSources.length; i++) {
      const source = allocationSources[i];
      const leg = this.fulfillmentLegRepository.create({
        parentRequestId: parentRequest.id,
        legNumber: i + 1,
        bloodBankId: source.bloodBankId,
        bloodBankName: source.bloodBankName,
        allocatedUnits: source.availableUnits,
        quantityMl: source.quantityMl,
        status: FulfillmentLegStatus.ALLOCATED,
        pickupLocation: source.pickupLocation,
        deliveryLocation: parentRequest.deliveryAddress,
      });

      const savedLeg = await this.fulfillmentLegRepository.save(leg);
      legs.push(savedLeg);
    }

    return {
      parentRequestId: parentRequest.id,
      legs,
      totalLegs: legs.length,
    };
  }

  async getFulfillmentLegs(
    parentRequestId: string,
  ): Promise<FulfillmentLegEntity[]> {
    return this.fulfillmentLegRepository.find({
      where: { parentRequestId },
      order: { legNumber: 'ASC' },
    });
  }

  async updateLegStatus(
    legId: string,
    status: FulfillmentLegStatus,
    metadata?: { failureReason?: string; deliveryTime?: number },
  ): Promise<FulfillmentLegEntity> {
    const leg = await this.fulfillmentLegRepository.findOne({
      where: { id: legId },
    });

    if (!leg) {
      throw new NotFoundException(`Fulfillment leg ${legId} not found`);
    }

    this.validateLegTransition(leg.status, status);

    leg.status = status;

    if (metadata?.failureReason) {
      leg.failureReason = metadata.failureReason;
    }

    if (metadata?.deliveryTime) {
      leg.actualDeliveryTime = metadata.deliveryTime;
    }

    return this.fulfillmentLegRepository.save(leg);
  }

  async getParentOrderProgress(parentRequestId: string): Promise<{
    totalLegs: number;
    completedLegs: number;
    failedLegs: number;
    inProgressLegs: number;
    overallStatus: string;
    legs: FulfillmentLegEntity[];
  }> {
    const legs = await this.getFulfillmentLegs(parentRequestId);

    const completedLegs = legs.filter((leg) => leg.isCompleted()).length;
    const failedLegs = legs.filter((leg) => leg.isFailed()).length;
    const inProgressLegs = legs.filter((leg) => leg.isInProgress()).length;

    let overallStatus = 'PENDING';
    if (completedLegs === legs.length) {
      overallStatus = 'FULLY_DELIVERED';
    } else if (completedLegs > 0) {
      overallStatus = 'PARTIALLY_DELIVERED';
    } else if (failedLegs === legs.length) {
      overallStatus = 'ALL_FAILED';
    } else if (inProgressLegs > 0) {
      overallStatus = 'IN_PROGRESS';
    }

    return {
      totalLegs: legs.length,
      completedLegs,
      failedLegs,
      inProgressLegs,
      overallStatus,
      legs,
    };
  }

  private validateLegTransition(
    from: FulfillmentLegStatus,
    to: FulfillmentLegStatus,
  ): void {
    if (from === to) {
      throw new BadRequestException(`Fulfillment leg is already in ${to} status`);
    }

    const allowed = ALLOWED_LEG_TRANSITIONS[from] ?? [];
    if (!allowed.includes(to)) {
      throw new BadRequestException(
        `Invalid leg status transition from ${from} to ${to}. Allowed transitions: ${
          allowed.join(', ') || 'none'
        }`,
      );
    }
  }

  async handleLegFailure(
    legId: string,
    failureReason: string,
  ): Promise<void> {
    const leg = await this.fulfillmentLegRepository.findOne({
      where: { id: legId },
    });

    if (!leg) {
      throw new Error(`Fulfillment leg ${legId} not found`);
    }

    leg.markAsFailed(failureReason);
    await this.fulfillmentLegRepository.save(leg);

    this.logger.warn(
      `Leg ${legId} failed: ${failureReason}. Other legs continue.`,
    );

    const progress = await this.getParentOrderProgress(leg.parentRequestId);
    if (progress.completedLegs > 0) {
      this.logger.log(
        `Parent order ${leg.parentRequestId} has ${progress.completedLegs} successful legs despite failure`,
      );
    }
  }
}
