import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import AfricasTalking from 'africastalking';

@Injectable()
export class SmsProvider {
  private readonly logger = new Logger(SmsProvider.name);
  private africastalking: any;

  constructor(private configService: ConfigService) {
    const apiKey = this.configService.get<string>('AT_API_KEY');
    const username = this.configService.get<string>('AT_USERNAME', 'sandbox');

    if (apiKey) {
      this.africastalking = AfricasTalking({
        apiKey,
        username,
      });
    } else {
      this.logger.warn(
        'AT_API_KEY is not set. SMS Provider initialized in dry-run mode.',
      );
    }
  }

  async send(to: string, message: string): Promise<void> {
    if (!this.africastalking) {
      this.logger.debug(`[Dry Run] SMS would be sent to ${to}: ${message}`);
      return;
    }

    try {
      const result = await this.africastalking.SMS.send({
        to: [to],
        message,
      });
      this.logger.log(`SMS sent to ${to}: ${JSON.stringify(result)}`);
    } catch (error) {
      this.logger.error(`Failed to send SMS to ${to}`, error);
      throw error;
    }
  }
}
