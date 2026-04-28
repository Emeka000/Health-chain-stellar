import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { InjectRepository } from '@nestjs/typeorm';

import { Job } from 'bullmq';
import { Repository } from 'typeorm';

import { BloodRequestEntity } from '../entities/blood-request.entity';
import { BloodRequestStatus } from '../enums/blood-request-status.enum';
import { BLOOD_REQUEST_QUEUE, RequestUrgency, SLA_WINDOWS_MS } from '../enums/request-urgency.enum';

export interface BloodRequestJobData {
  requestId: string;
  urgency: RequestUrgency;
  enqueuedAt: number; // unix ms
}

@Injectable()
@Processor(BLOOD_REQUEST_QUEUE)
export class BloodRequestProcessor extends WorkerHost {
  private readonly logger = new Logger(BloodRequestProcessor.name);

  constructor(
    @InjectRepository(BloodRequestEntity)
    private readonly requestRepo: Repository<BloodRequestEntity>,
    private readonly eventEmitter: EventEmitter2,
  ) {
    super();
  }

  async process(job: Job<BloodRequestJobData>): Promise<void> {
    const { requestId, urgency, enqueuedAt } = job.data;

    this.logger.log(
      `Processing blood request ${requestId} [${urgency}] (job ${job.id})`,
    );

    const request = await this.requestRepo.findOne({ where: { id: requestId } });
    if (!request) {
      this.logger.warn(`Blood request ${requestId} not found — skipping`);
      return;
    }

    // Skip already-processed requests
    if (request.status !== BloodRequestStatus.PENDING) {
      this.logger.debug(
        `Blood request ${requestId} already in status ${request.status} — skipping`,
      );
      return;
    }

    // Check SLA breach before processing
    const slaWindowMs = SLA_WINDOWS_MS[urgency];
    const elapsedMs = Date.now() - enqueuedAt;
    if (elapsedMs > slaWindowMs) {
      this.logger.warn(
        `SLA BREACHED for request ${requestId} [${urgency}]: elapsed ${Math.round(elapsedMs / 1000)}s > window ${Math.round(slaWindowMs / 1000)}s`,
      );
      this.eventEmitter.emit('blood-request.sla-breached', {
        requestId,
        urgency,
        enqueuedAt,
        breachedAt: Date.now(),
        elapsedMs,
        slaWindowMs,
      });
    }

    // Emit processing event for downstream allocation logic
    this.eventEmitter.emit('blood-request.processing', {
      requestId,
      urgency,
      request,
    });
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job<BloodRequestJobData>, error: Error): void {
    this.logger.error(
      `Blood request job ${job.id} (requestId=${job.data.requestId}) failed: ${error.message}`,
    );
  }
}
