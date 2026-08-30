import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { SorobanService } from '../soroban/soroban.service';
import { CustodyHandoffEntity } from './entities/custody-handoff.entity';
import { CustodyHandoffStatus } from './enums/custody.enum';
import { ConfirmHandoffDto, RecordHandoffDto } from './dto/custody.dto';

@Injectable()
export class CustodyService {
  private readonly logger = new Logger(CustodyService.name);

  constructor(
    @InjectRepository(CustodyHandoffEntity)
    private readonly handoffRepo: Repository<CustodyHandoffEntity>,
    private readonly sorobanService: SorobanService,
  ) {}

  async recordHandoff(dto: RecordHandoffDto, performedByUserId: string): Promise<CustodyHandoffEntity> {
    // Chain-continuity check: fromActorId must match the toActorId of the last confirmed handoff for this unit
    const lastConfirmed = await this.handoffRepo.findOne({
      where: { bloodUnitId: dto.bloodUnitId, status: CustodyHandoffStatus.CONFIRMED },
      order: { createdAt: 'DESC' },
    });

    if (lastConfirmed && lastConfirmed.toActorId !== dto.fromActorId) {
      throw new BadRequestException(
        `Chain-of-custody break: fromActorId must be the current custodian (${lastConfirmed.toActorId})`,
      );
    }

    // Initiate on-chain custody transfer
    let contractEventId: string | null = null;
    try {
      const result = await this.sorobanService.transferCustody({
        unitId: parseInt(dto.bloodUnitId, 10),
        fromAccount: dto.fromActorId,
        toAccount: dto.toActorId,
        condition: `${dto.fromActorType}→${dto.toActorType}`,
      });
      contractEventId = result.transactionHash;
    } catch (err: unknown) {
      this.logger.warn(
        `On-chain custody transfer failed for unit ${dto.bloodUnitId}: ${(err as Error).message}. Persisting off-chain record only.`,
      );
    }

    const handoff = this.handoffRepo.create({
      bloodUnitId: dto.bloodUnitId,
      orderId: dto.orderId ?? null,
      fromActorId: dto.fromActorId,
      fromActorType: dto.fromActorType,
      toActorId: dto.toActorId,
      toActorType: dto.toActorType,
      latitude: dto.latitude ?? null,
      longitude: dto.longitude ?? null,
      proofReference: dto.proofReference ?? null,
      contractEventId,
      performedByUserId,
      status: CustodyHandoffStatus.PENDING,
    });

    return this.handoffRepo.save(handoff);
  }

  async confirmHandoff(id: string, dto: ConfirmHandoffDto, callerUserId: string): Promise<CustodyHandoffEntity> {
    const handoff = await this.handoffRepo.findOne({ where: { id } });
    if (!handoff) throw new NotFoundException('Custody handoff not found');
    if (handoff.status !== CustodyHandoffStatus.PENDING) {
      throw new BadRequestException('Handoff is not in pending state');
    }

    // Only the intended recipient (toActorId) may confirm receipt
    if (callerUserId !== handoff.toActorId) {
      throw new ForbiddenException(
        'Only the intended recipient of this handoff may confirm it',
      );
    }

    handoff.status = CustodyHandoffStatus.CONFIRMED;
    handoff.confirmedAt = new Date();
    handoff.performedByUserId = callerUserId;
    if (dto.proofReference) handoff.proofReference = dto.proofReference;

    return this.handoffRepo.save(handoff);
  }

  async getTimeline(bloodUnitId: string): Promise<CustodyHandoffEntity[]> {
    return this.handoffRepo.find({
      where: { bloodUnitId },
      order: { createdAt: 'ASC' },
    });
  }

  async getOrderTimeline(orderId: string): Promise<CustodyHandoffEntity[]> {
    return this.handoffRepo.find({
      where: { orderId },
      order: { createdAt: 'ASC' },
    });
  }

  /**
   * Checks that all required custody steps are confirmed before delivery completion.
   * Required chain: blood_bank → rider → hospital (all CONFIRMED).
   */
  async assertCustodyComplete(orderId: string): Promise<void> {
    const handoffs = await this.handoffRepo.find({ where: { orderId } });
    const confirmed = handoffs.filter((h) => h.status === CustodyHandoffStatus.CONFIRMED);

    const hasBankToRider = confirmed.some(
      (h) => h.fromActorType === 'blood_bank' && h.toActorType === 'rider',
    );
    const hasRiderToHospital = confirmed.some(
      (h) => h.fromActorType === 'rider' && h.toActorType === 'hospital',
    );

    if (!hasBankToRider || !hasRiderToHospital) {
      throw new BadRequestException(
        'Delivery cannot be completed: missing confirmed custody handoffs (blood_bank→rider and rider→hospital required)',
      );
    }
  }
}
