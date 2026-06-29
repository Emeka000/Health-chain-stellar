import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import * as admin from 'firebase-admin';

@Injectable()
export class PushProvider {
  private readonly logger = new Logger(PushProvider.name);
  private initialized = false;

  constructor(private configService: ConfigService) {
    const serviceAccountJson = this.configService.get<string>(
      'FIREBASE_SERVICE_ACCOUNT_JSON',
    );

    if (serviceAccountJson) {
      try {
        const serviceAccount = JSON.parse(serviceAccountJson);
        admin.initializeApp({
          credential: admin.credential.cert(serviceAccount),
        });
        this.initialized = true;
      } catch (err) {
        this.logger.error('Failed to parse FIREBASE_SERVICE_ACCOUNT_JSON', err);
      }
    } else {
      this.logger.warn(
        'FIREBASE_SERVICE_ACCOUNT_JSON not set. Push Provider initialized in dry-run mode.',
      );
    }
  }

  async send(
    fcmToken: string,
    title: string,
    body: string,
    data?: Record<string, string>,
  ): Promise<void> {
    if (!this.initialized) {
      this.logger.debug(
        `[Dry Run] Push would be sent to ${fcmToken}: ${title} - ${body}`,
      );
      return;
    }

    try {
      const message = {
        notification: {
          title,
          body,
        },
        data: data || {},
        token: fcmToken,
      };

      const response = await admin.messaging().send(message);
      this.logger.log(`Successfully sent push message: ${response}`);
    } catch (error) {
      this.logger.error(`Error sending push message to ${fcmToken}`, error);
      throw error;
    }
  }

  isHealthy(): boolean {
    return this.initialized;
  }
}
