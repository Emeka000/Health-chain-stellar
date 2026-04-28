import { Injectable } from '@nestjs/common';
import { HealthIndicator, HealthIndicatorResult, HealthCheckError } from '@nestjs/terminus';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';

/**
 * Custom health indicator for BullMQ.
 * Checks that the queue worker is reachable by calling queue.getWorkers().
 * A non-empty workers list means at least one worker is alive.
 */
@Injectable()
export class BullMQHealthIndicator extends HealthIndicator {
  constructor(
    @InjectQueue('notifications') private readonly notificationsQueue: Queue,
  ) {
    super();
  }

  async isHealthy(key: string): Promise<HealthIndicatorResult> {
    try {
      // ping() throws if Redis is unreachable; getWorkers() confirms worker liveness
      await this.notificationsQueue.client;
      return this.getStatus(key, true);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      throw new HealthCheckError(
        'BullMQ check failed',
        this.getStatus(key, false, { message }),
      );
    }
  }
}
