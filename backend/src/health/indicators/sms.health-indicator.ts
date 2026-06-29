import { Injectable } from '@nestjs/common';
import { HealthIndicator, HealthIndicatorResult, HealthCheckError } from '@nestjs/terminus';
import { SmsProvider } from '../../notifications/providers/sms.provider';

@Injectable()
export class SmsHealthIndicator extends HealthIndicator {
  constructor(private readonly smsProvider: SmsProvider) {
    super();
  }

  async isHealthy(key: string): Promise<HealthIndicatorResult> {
    const isHealthy = this.smsProvider.isHealthy();

    if (!isHealthy) {
      throw new HealthCheckError(
        'SMS check failed',
        this.getStatus(key, false, { message: 'Africa Talking API key not configured' }),
      );
    }

    return this.getStatus(key, true);
  }
}
