import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';

import { CompensationModule } from '../common/compensation/compensation.module';

import { BlockchainController } from './controllers/blockchain.controller';
import { DlqReplayAuditEntity } from './entities/dlq-replay-audit.entity';
import { FailedSorobanTxEntity } from './entities/failed-soroban-tx.entity';
import { OnChainTxStateEntity } from './entities/on-chain-tx-state.entity';
import { AdminGuard } from './guards/admin.guard';
import { JobDeduplicationPlugin } from './plugins/job-deduplication.plugin';
import { SorobanDlqProcessor } from './processors/soroban-dlq.processor';
import { SorobanTxProcessor } from './processors/soroban-tx.processor';
import { BlockchainHealthService } from './services/blockchain-health.service';
import { ConfirmationService } from './services/confirmation.service';
import { DlqReplayAuditService } from './services/dlq-replay-audit.service';
import { FailedSorobanTxService } from './services/failed-soroban-tx.service';
import { IdempotencyService } from './services/idempotency.service';
import { QueueMetricsService } from './services/queue-metrics.service';
import { SorobanService } from './services/soroban.service';

@Module({
  imports: [
    ConfigModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        secret: configService.get<string>('JWT_SECRET', 'default-secret'),
        signOptions: { expiresIn: configService.get<string>('JWT_EXPIRES_IN', '1h') },
      }),
    }),
    CompensationModule,
    EventEmitterModule.forRoot(),
    TypeOrmModule.forFeature([DlqReplayAuditEntity, FailedSorobanTxEntity, OnChainTxStateEntity]),
    BullModule.registerQueueAsync(
      {
        name: 'soroban-tx-queue',
        useFactory: (configService: ConfigService) => ({
          connection: {
            host: configService.get<string>('REDIS_HOST'),
            port: configService.get<number>('REDIS_PORT'),
          },
          defaultJobOptions: {
            attempts: 5,
            backoff: {
              type: 'exponential',
              delay: 1000,
            },
            removeOnComplete: true,
            removeOnFail: false,
          },
        }),
        inject: [ConfigService],
      },
      {
        name: 'soroban-dlq',
        useFactory: (configService: ConfigService) => ({
          connection: {
            host: configService.get<string>('REDIS_HOST'),
            port: configService.get<number>('REDIS_PORT'),
          },
        }),
        inject: [ConfigService],
      },
    ),
  ],
  providers: [
    SorobanService,
    ConfirmationService,
    IdempotencyService,
    JobDeduplicationPlugin,
    SorobanTxProcessor,
    SorobanDlqProcessor,
    DlqReplayAuditService,
    FailedSorobanTxService,
    BlockchainHealthService,
    QueueMetricsService,
    AdminGuard,
  ],
  controllers: [BlockchainController],
  exports: [SorobanService, QueueMetricsService, DlqReplayAuditService],
})
export class BlockchainModule {}
