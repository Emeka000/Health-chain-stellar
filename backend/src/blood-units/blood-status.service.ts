import {
  BadRequestException,
  ConflictException,
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
}

export const ALLOWED_TRANSITIONS: Record<BloodStatus, BloodStatus[]> = {
  [BloodStatus.AVAILABLE]: [
    BloodStatus.RESERVED,
    BloodStatus.IN_TRANSIT,
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
  [BloodStatus.DELIVERED]: [],
  [BloodStatus.EXPIRED]: [BloodStatus.DISCARDED],
  [BloodStatus.QUARANTINED]: [BloodStatus.AVAILABLE, BloodStatus.DISCARDED],
  [BloodStatus.DISCARDED]: [],
  [BloodStatus.PROCESSING]: [
    BloodStatus.AVAILABLE,
    BloodStatus.QUARANTINED,
    BloodStatus.DISCARDED,
  ],
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

  isValidTransition(from: BloodStatus, to: BloodStatus): boolean {
    return ALLOWED_TRANSITIONS[from]?.includes(to) ?? false;
  }

  private validateTransition(from: BloodStatus, to: BloodStatus): void {
    if (from === to) {
      throw new BadRequestException(`Blood unit is already in ${to} status`);
    }

    if (!this.isValidTransition(from, to)) {
      const allowed = ALLOWED_TRANSITIONS[from]?.join(', ') || 'none';
      throw new BadRequestException(
        `Invalid status transition from ${from} to ${to}. Allowed transitions: ${allowed}`,
      );
    }
  }

  private async syncStatusToBlockchain(
    unit: BloodUnit,
    previousStatus: BloodStatus,
    newStatus: BloodStatus,
    changedBy: string | null,
  ): Promise<void> {
    try {
      const uniqueSuffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      await this.blockchainEventRepository.save(
        this.blockchainEventRepository.create({
          eventType: 'BLOOD_UNIT_STATUS_CHANGED',
          transactionHash: `status-${unit.id}-${uniqueSuffix}`,
          eventData: {
            unitId: unit.id,
            unitCode: unit.unitCode,
            previousStatus,
            newStatus,
            changedBy,
          },
          blockchainTimestamp: new Date(),
          processed: false,
        }),
      );
    } catch (error) {
      this.logger.warn(
        `Blockchain sync failed for unit ${unit.id}: ${
          error instanceof Error ? error.message : 'unknown error'
        }`,
      );
    }
  }

  private async sendStatusChangeNotification(
    unit: BloodUnit,
    previousStatus: BloodStatus,
    newStatus: BloodStatus,
  ): Promise<void> {
    try {
      await this.notificationsService.send({
        recipientId: unit.organizationId,
        channels: [NotificationChannel.IN_APP],
        templateKey: 'blood_unit_status_changed',
        variables: {
          unitCode: unit.unitCode,
          bloodType: unit.bloodType,
          previousStatus,
          newStatus,
        },
      });
    } catch (error) {
      this.logger.warn(
        `Status change notification failed for unit ${unit.id}: ${
          error instanceof Error ? error.message : 'unknown error'
        }`,
      );
    }
  }
}
