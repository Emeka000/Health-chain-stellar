import { Injectable } from '@nestjs/common';
import { HealthIndicator, HealthIndicatorResult, HealthCheckError } from '@nestjs/terminus';
import { PushProvider } from '../../notifications/providers/push.provider';

@Injectable()
export class FirebaseHealthIndicator extends HealthIndicator {
  constructor(private readonly pushProvider: PushProvider) {
    super();
  }

  async isHealthy(key: string): Promise<HealthIndicatorResult> {
    const isHealthy = this.pushProvider.isHealthy();

    if (!isHealthy) {
      throw new HealthCheckError(
        'Firebase check failed',
        this.getStatus(key, false, { message: 'Firebase credentials not initialized' }),
      );
    }

    return this.getStatus(key, true);
  }
}
