import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { InjectRepository } from '@nestjs/typeorm';
import { Cron, CronExpression } from '@nestjs/schedule';

import { In, LessThan, Not, Repository } from 'typeorm';

import { RiderEntity } from '../entities/rider.entity';
import { RiderStatus } from '../enums/rider-status.enum';

const INACTIVITY_TIMEOUT_MS = 30 * 60 * 1000;

@Injectable()
export class RiderAvailabilityService {
  private readonly logger = new Logger(RiderAvailabilityService.name);

  constructor(
    @InjectRepository(RiderEntity)
    private readonly riderRepository: Repository<RiderEntity>,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  @Cron(CronExpression.EVERY_5_MINUTES)
  async autoOfflineInactiveRiders(): Promise<void> {
    const cutoff = new Date(Date.now() - INACTIVITY_TIMEOUT_MS);

    const inactiveRiders = await this.riderRepository.find({
      where: {
        status: Not(In([RiderStatus.OFFLINE])),
        lastLocationUpdatedAt: LessThan(cutoff),
      },
    });

    if (inactiveRiders.length === 0) return;

    for (const rider of inactiveRiders) {
      rider.status = RiderStatus.OFFLINE;
    }

    await this.riderRepository.save(inactiveRiders);

    for (const rider of inactiveRiders) {
      this.eventEmitter.emit('rider.offline', {
        riderId: rider.id,
        userId: rider.userId,
        reason: 'inactivity',
      });
      this.eventEmitter.emit('rider.status.changed', {
        riderId: rider.id,
        userId: rider.userId,
        previousStatus: RiderStatus.AVAILABLE,
        newStatus: RiderStatus.OFFLINE,
        reason: 'inactivity',
      });
    }

    this.logger.log(
      `Auto-offline: marked ${inactiveRiders.length} rider(s) offline due to inactivity`,
    );
  }
}
