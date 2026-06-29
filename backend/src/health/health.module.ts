import { Module } from '@nestjs/common';
import { TerminusModule } from '@nestjs/terminus';
import { BullModule } from '@nestjs/bullmq';
import { ConfigModule } from '@nestjs/config';

import { HealthController } from './health.controller';
import { SorobanRpcHealthIndicator } from './indicators/soroban-rpc.health-indicator';
import { BullMQHealthIndicator } from './indicators/bullmq.health-indicator';
import { RedisHealthIndicator } from './indicators/redis.health-indicator';
import { FirebaseHealthIndicator } from './indicators/firebase.health-indicator';
import { SmsHealthIndicator } from './indicators/sms.health-indicator';
import { PushProvider } from '../notifications/providers/push.provider';
import { SmsProvider } from '../notifications/providers/sms.provider';

@Module({
  imports: [
    TerminusModule.forRoot({ gracefulShutdownTimeoutMs: 1000 }),
    // Register the notifications queue so BullMQHealthIndicator can inject it
    BullModule.registerQueue({ name: 'notifications' }),
    ConfigModule,
  ],
  controllers: [HealthController],
  providers: [
    SorobanRpcHealthIndicator,
    BullMQHealthIndicator,
    RedisHealthIndicator,
    FirebaseHealthIndicator,
    SmsHealthIndicator,
    PushProvider,
    SmsProvider,
  ],
})
export class HealthModule {}
