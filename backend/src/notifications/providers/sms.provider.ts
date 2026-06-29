import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import AfricasTalking, { AfricasTalkingOptions } from 'africastalking';

// Known placeholder patterns left in .env.example / unconfigured deployments.
const PLACEHOLDER_AT_API_KEY_PATTERNS = [
  'your-at-api-key',
  'your-africastalking-api-key',
  'changeme',
  'placeholder',
];

function isPlaceholderApiKey(apiKey: string): boolean {
  const normalized = apiKey.trim().toLowerCase();
  return PLACEHOLDER_AT_API_KEY_PATTERNS.some((pattern) =>
    normalized.includes(pattern),
  );
}

@Injectable()
export class SmsProvider {
  private readonly logger = new Logger(SmsProvider.name);
  private africastalking: ReturnType<typeof AfricasTalking> | null = null;

  constructor(private configService: ConfigService) {
    const apiKey = this.configService.get<string>('AT_API_KEY');
    const username = this.configService.get<string>('AT_USERNAME', 'sandbox');

    if (apiKey && !isPlaceholderApiKey(apiKey)) {
      this.africastalking = AfricasTalking({
        apiKey,
        username,
      });
    } else if (apiKey) {
      this.logger.warn(
        'AT_API_KEY is set to a placeholder value. SMS delivery is DISABLED — ' +
          'SMS Provider initialized in dry-run mode and patient notifications will not be sent.',
      );
    } else {
      this.logger.warn(
        'AT_API_KEY is not set. SMS delivery is DISABLED — SMS Provider initialized in dry-run mode.',
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

  isHealthy(): boolean {
    return this.africastalking !== null;
  }
}
