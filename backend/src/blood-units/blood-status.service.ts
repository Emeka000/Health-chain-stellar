import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';

import { LessThan, Repository } from 'typeorm';

import { NotificationChannel } from '../notifications/enums/notification-channel.enum';
import { NotificationsService } from '../notifications/notifications.service';
import { BlockchainEvent } from '../soroban/entities/blockchain-event.entity';
import { SorobanService } from '../soroban/soroban.service';

import {
  BulkUpdateBloodStatusDto,
  ReserveBloodUnitDto,
  UpdateBloodStatusDto,
} from './dto/update-blood-status.dto';
import { BloodStatusHistory } from './entities/blood-status-history.entity';
import { BloodUnit } from './entities/blood-unit.entity';
import { BloodStatus } from './enums/blood-status.enum';

interface AuthenticatedUserContext {
  id: string;
  role: string;
  organizationId?: string | null;
}

export const ALLOWED_TRANSITIONS: Record<BloodStatus, BloodStatus[]> = {
  [BloodStatus.AVAILABLE]: [
    BloodStatus.RESERVED,
    BloodStatus.IN_TRANSIT,
    BloodStatus.IN_TRANSFER,
    BloodStatus.QUARANTINED,
    BloodStatus.PROCESSING,
    BloodStatus.EXPIRED,
    BloodStatus.DISCARDED,
  ],
  [BloodStatus.RESERVED]: [
    BloodStatus.AVAILABLE,
    BloodStatus.IN_TRANSIT,
    BloodStatus.DISCARDED,
    BloodStatus.EXPIRED,
  ],
  [BloodStatus.IN_TRANSIT]: [BloodStatus.DELIVERED, BloodStatus.DISCARDED],
  [BloodStatus.IN_TRANSFER]: [],
  [BloodStatus.DELIVERED]: [],
  [BloodStatus.EXPIRED]: [BloodStatus.DISCARDED],
  [BloodStatus.QUARANTINED]: [],
  [BloodStatus.DISCARDED]: [],
  [BloodStatus.PROCESSING]: [
    BloodStatus.AVAILABLE,
    BloodStatus.QUARANTINED,
    BloodStatus.DISCARDED,
  ],
};

/**
 * Statuses that may only be exited through a dedicated workflow rather than
 * the generic status endpoint. QUARANTINED units must be released/discarded
 * via QuarantineService.finalizeCase (which records reviewer approval), and
 * IN_TRANSFER units must be resolved via the inter-org transfer accept/cancel
 * flow so the TransferRecord cannot be left PENDING.
 */
export const WORKFLOW_MANAGED_STATUSES: Partial<Record<BloodStatus, string>> = {
  [BloodStatus.QUARANTINED]:
    'Quarantined units must be released or discarded through QuarantineService.finalizeCase',
  [BloodStatus.IN_TRANSFER]:
    'Units in transfer must be resolved through the transfer accept/cancel flow',
};


@Injectable()
export class BloodStatusService {
  private readonly logger = new Logger(BloodStatusService.name);

  constructor(
    @InjectRepository(BloodUnit)
    private readonly bloodUnitRepository: Repository<BloodUnit>,
    @InjectRepository(BloodStatusHistory)
    private readonly statusHistoryRepository: Repository<BloodStatusHistory>,
    @InjectRepository(BlockchainEvent)
    private readonly blockchainEventRepository: Repository<BlockchainEvent>,
    private readonly notificationsService: NotificationsService,
    private readonly sorobanService: SorobanService,
  ) {}

  async updateStatus(
    unitId: string,
    dto: UpdateBloodStatusDto,
    user?: AuthenticatedUserContext,
  ) {
    const unit = await this.bloodUnitRepository.findOne({
      where: { id: unitId },
    });
    if (!unit) {
      throw new NotFoundException(`Blood unit ${unitId} not found`);
    }

    this.assertOwnsUnit(unit, user);

    this.validateTransition(unit.status, dto.status);

    const previousStatus = unit.status;
    unit.status = dto.status;

    if (
      previousStatus === BloodStatus.RESERVED &&
      dto.status !== BloodStatus.RESERVED
    ) {
      unit.reservedFor = null;
      unit.reservedUntil = null;
    }

    await this.bloodUnitRepository.save(unit);

    const historyEntry = this.statusHistoryRepository.create({
      bloodUnitId: unitId,
      previousStatus,
      newStatus: dto.status,
      reason: dto.reason ?? null,
      changedBy: user?.id ?? null,
    });
    await this.statusHistoryRepository.save(historyEntry);

    await this.syncStatusToBlockchain(
      unit,
      previousStatus,
      dto.status,
      user?.id ?? null,
    );
    await this.sendStatusChangeNotification(unit, previousStatus, dto.status);

    return {
      success: true,
      unitId,
      previousStatus,
      newStatus: dto.status,
      historyId: historyEntry.id,
    };
  }

  async bulkUpdateStatus(
    dto: BulkUpdateBloodStatusDto,
    user?: AuthenticatedUserContext,
  ) {
    const updateDto: UpdateBloodStatusDto = {
      status: dto.status,
      reason: dto.reason,
    };

    const results = await Promise.allSettled(
      dto.unitIds.map((unitId) => this.updateStatus(unitId, updateDto, user)),
    );

    const successful = results.filter((r) => r.status === 'fulfilled');
    const failed = results.filter((r) => r.status === 'rejected');

    return {
      success: failed.length === 0,
      total: dto.unitIds.length,
      successful: successful.length,
      failed: failed.length,
      results: successful.map((r) => r.value),
      errors: failed.map((r, i) => ({
        index: i,
        message: r.reason instanceof Error ? r.reason.message : 'Unknown error',
      })),
    };
  }

  async reserveUnit(
    unitId: string,
    dto: ReserveBloodUnitDto,
    user?: AuthenticatedUserContext,
  ) {
    const unit = await this.bloodUnitRepository.findOne({
      where: { id: unitId },
    });
    if (!unit) {
      throw new NotFoundException(`Blood unit ${unitId} not found`);
    }

    this.assertOwnsUnit(unit, user);

    if (unit.status !== BloodStatus.AVAILABLE) {
      throw new ConflictException(
        `Blood unit ${unitId} is not available for reservation (current status: ${unit.status})`,
      );
    }

    const previousStatus = unit.status;
    unit.status = BloodStatus.RESERVED;
    unit.reservedFor = dto.reservedFor;
    unit.reservedUntil = new Date(dto.reservedUntil);

    await this.bloodUnitRepository.save(unit);

    const historyEntry = this.statusHistoryRepository.create({
      bloodUnitId: unitId,
      previousStatus,
      newStatus: BloodStatus.RESERVED,
      reason:
        dto.reason ??
        `Reserved for ${dto.reservedFor} until ${dto.reservedUntil}`,
      changedBy: user?.id ?? null,
    });
    await this.statusHistoryRepository.save(historyEntry);

    await this.syncStatusToBlockchain(
      unit,
      previousStatus,
      BloodStatus.RESERVED,
      user?.id ?? null,
    );

    return {
      success: true,
      unitId,
      reservedFor: dto.reservedFor,
      reservedUntil: unit.reservedUntil,
      historyId: historyEntry.id,
    };
  }

  async getStatusHistory(unitId: string) {
    const exists = await this.bloodUnitRepository.findOne({
      where: { id: unitId },
      select: ['id'],
    });
    if (!exists) {
      throw new NotFoundException(`Blood unit ${unitId} not found`);
    }

    const history = await this.statusHistoryRepository.find({
      where: { bloodUnitId: unitId },
      order: { changedAt: 'DESC' },
    });

    return { unitId, history };
  }

  @Cron(CronExpression.EVERY_5_MINUTES)
  async releaseExpiredReservations(): Promise<void> {
    const expiredUnits = await this.bloodUnitRepository.find({
      where: {
        status: BloodStatus.RESERVED,
        reservedUntil: LessThan(new Date()),
      },
    });

    if (expiredUnits.length === 0) {
      return;
    }

    this.logger.log(`Releasing ${expiredUnits.length} expired reservation(s)`);

    for (const unit of expiredUnits) {
      try {
        const previousReservedFor = unit.reservedFor;
        unit.status = BloodStatus.AVAILABLE;
        unit.reservedFor = null;
        unit.reservedUntil = null;

        await this.bloodUnitRepository.save(unit);

        await this.statusHistoryRepository.save(
          this.statusHistoryRepository.create({
            bloodUnitId: unit.id,
            previousStatus: BloodStatus.RESERVED,
            newStatus: BloodStatus.AVAILABLE,
            reason: `Reservation expired (was reserved for ${previousReservedFor ?? 'unknown'})`,
            changedBy: null,
          }),
        );

        await this.syncStatusToBlockchain(
          unit,
          BloodStatus.RESERVED,
          BloodStatus.AVAILABLE,
          null,
        );
      } catch (error) {
        this.logger.error(
          `Failed to release reservation for unit ${unit.id}: ${
            error instanceof Error ? error.message : 'unknown error'
          }`,
        );
      }
    }
  }

  isValid

/* … truncated 3340 chars — edit only what you need near the top … */
