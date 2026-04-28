import { Injectable, Logger } from '@nestjs/common';
import { NotificationChannel } from '../enums/notification-channel.enum';
import { EmailProvider } from './email.provider';
import { SmsProvider } from './sms.provider';
import { PushProvider } from './push.provider';
import { InAppProvider } from './in-app.provider';

export interface ProviderAttemptResult {
  providerName: string;
  success: boolean;
  error?: string;
  durationMs: number;
}

export interface FailoverDeliveryResult {
  delivered: boolean;
  attempts: ProviderAttemptResult[];
  finalProvider?: string;
}

/**
 * Executes a provider chain for a given channel.
 * On primary failure, falls over to secondary providers in order.
 * All attempt results are returned for audit logging.
 */
@Injectable()
export class ProviderFailoverService {
  private readonly logger = new Logger(ProviderFailoverService.name);

  constructor(
    private readonly emailProvider: EmailProvider,
    private readonly smsProvider: SmsProvider,
    private readonly pushProvider: PushProvider,
    private readonly inAppProvider: InAppProvider,
  ) {}

  async deliver(
    channel: NotificationChannel,
    recipientId: string,
    renderedBody: string,
    variables?: Record<string, any>,
  ): Promise<FailoverDeliveryResult> {
    const chain = this.buildChain(
      channel,
      recipientId,
      renderedBody,
      variables,
    );
    const attempts: ProviderAttemptResult[] = [];

    for (const { name, fn } of chain) {
      const start = Date.now();
      try {
        await fn();
        const result: ProviderAttemptResult = {
          providerName: name,
          success: true,
          durationMs: Date.now() - start,
        };
        attempts.push(result);
        this.logger.log(
          `[Failover] Delivered via ${name} for channel=${channel}`,
        );
        return { delivered: true, attempts, finalProvider: name };
      } catch (err: any) {
        const result: ProviderAttemptResult = {
          providerName: name,
          success: false,
          error: err?.message ?? String(err),
          durationMs: Date.now() - start,
        };
        attempts.push(result);
        this.logger.warn(
          `[Failover] Provider ${name} failed for channel=${channel}: ${err?.message}`,
        );
      }
    }

    this.logger.error(
      `[Failover] All providers exhausted for channel=${channel} recipient=${recipientId}`,
    );
    return { delivered: false, attempts };
  }

  private buildChain(
    channel: NotificationChannel,
    recipientId: string,
    renderedBody: string,
    variables?: Record<string, any>,
  ): Array<{ name: string; fn: () => Promise<void> }> {
    switch (channel) {
      case NotificationChannel.EMAIL:
        return [
          {
            name: 'EmailProvider(primary)',
            fn: () =>
              this.emailProvider.send(
                recipientId,
                variables?.emailSubject ?? 'Notification',
                renderedBody,
              ),
          },
          // Fallback: in-app when email transport fails
          {
            name: 'InAppProvider(email-fallback)',
            fn: () =>
              this.inAppProvider.send(recipientId, {
                channel: 'email-fallback',
                body: renderedBody,
              }),
          },
        ];

      case NotificationChannel.SMS:
        return [
          {
            name: 'SmsProvider(primary)',
            fn: () => this.smsProvider.send(recipientId, renderedBody),
          },
          // Fallback: push then in-app
          {
            name: 'PushProvider(sms-fallback)',
            fn: () =>
              this.pushProvider.send(
                variables?.fcmToken ?? recipientId,
                variables?.pushTitle ?? 'Notification',
                renderedBody,
              ),
          },
          {
            name: 'InAppProvider(sms-fallback)',
            fn: () =>
              this.inAppProvider.send(recipientId, {
                channel: 'sms-fallback',
                body: renderedBody,
              }),
          },
        ];

      case NotificationChannel.PUSH:
        return [
          {
            name: 'PushProvider(primary)',
            fn: () =>
              this.pushProvider.send(
                variables?.fcmToken ?? recipientId,
                variables?.pushTitle ?? 'Notification',
                renderedBody,
              ),
          },
          // Fallback: in-app
          {
            name: 'InAppProvider(push-fallback)',
            fn: () =>
              this.inAppProvider.send(recipientId, {
                channel: 'push-fallback',
                body: renderedBody,
              }),
          },
        ];

      case NotificationChannel.IN_APP:
        return [
          {
            name: 'InAppProvider(primary)',
            fn: () =>
              this.inAppProvider.send(recipientId, {
                channel: 'in_app',
                body: renderedBody,
              }),
          },
        ];

      default:
        return [];
    }
  }
}
