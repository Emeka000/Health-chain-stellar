import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { ThrottlerModule } from '@nestjs/throttler';
import { TypeOrmModule } from '@nestjs/typeorm';

import { ThrottlerStorageRedisService } from '@nest-lab/throttler-storage-redis';

import { AnomalyModule } from './anomaly/anomaly.module';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuthModule } from './auth/auth.module';
import { JwtAuthGuard } from './auth/guards/jwt-auth.guard';
import { PermissionsGuard } from './auth/guards/permissions.guard';
import { BatchImportModule } from './batch-import/batch-import.module';
import { BlockchainModule } from './blockchain/blockchain.module';
import { BloodRequestsModule } from './blood-requests/blood-requests.module';
import { BloodUnitsModule } from './blood-units/blood-units.module';
import { AuditLogModule } from './common/audit/audit-log.module';
import { CorrelationIdMiddleware } from './common/middleware/correlation-id.middleware';
import { CorrelationIdService } from './common/middleware/correlation-id.service';
import { AppConfigModule } from './config/config.module';
import { DatabaseSyncGuard } from './config/database-sync.guard';
import { DispatchModule } from './dispatch/dispatch.module';
import { DonorImpactModule } from './donor-impact/donor-impact.module';
import { EscalationModule } from './escalation/escalation.module';
import { EventsModule } from './events/events.module';
import { HospitalsModule } from './hospitals/hospitals.module';
import { InventoryModule } from './inventory/inventory.module';
import { LocationHistoryModule } from './location-history/location-history.module';
import { MapsModule } from './maps/maps.module';
import { NotificationsModule } from './notifications/notifications.module';
import { PolicyCenterModule } from './policy-center/policy-center.module';
import { ProofBundleModule } from './proof-bundle/proof-bundle.module';
import { ReconciliationModule } from './reconciliation/reconciliation.module';
import { RouteDeviationModule } from './route-deviation/route-deviation.module';
import { FileMetadataModule } from './file-metadata/file-metadata.module';
import { TrackingModule } from './tracking/tracking.module';
import { TransparencyModule } from './transparency/transparency.module';
import { UserActivityModule } from './user-activity/user-activity.module';
import { UsersModule } from './users/users.module';
import { WorkflowModule } from './workflow/workflow.module';

import type Redis from 'ioredis';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    EventEmitterModule.forRoot(),
    // Global BullMQ Redis connection — individual modules register their own queues
    BullModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: (configService: ConfigService) => ({
        connection: {
          host: configService.get<string>('REDIS_HOST', 'localhost'),
          port: configService.get<number>('REDIS_PORT', 6379),
        },
      }),
      inject: [ConfigService],
    }),
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: (config: ConfigService) => ({
        type: 'postgres',
        host: config.get<string>('DB_HOST', 'localhost'),
        port: config.get<number>('DB_PORT', 5432),
        username: config.get<string>('DB_USERNAME', 'postgres'),
        password: config.get<string>('DB_PASSWORD', 'postgres'),
        database: config.get<string>('DB_DATABASE', 'health_chain'),
        autoLoadEntities: true,
        synchronize: true, // DEV ONLY
      }),
      inject: [ConfigService],
    }),
    /**
     * ThrottlerModule with Redis storage for distributed rate limiting.
     * Per-role limits are resolved at request time by RoleAwareThrottlerGuard;
     * the base limit here acts as a fallback only.
     */
    ThrottlerModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        throttlers: [
          {
            name: 'default',
            ttl: THROTTLE_TTL_MS,
            limit: 30, // fallback; overridden per-role by RoleAwareThrottlerGuard
          },
        ],
        storage: new ThrottlerStorageRedisService({
          host: config.get<string>('REDIS_HOST', 'localhost'),
          port: config.get<number>('REDIS_PORT', 6379),
          password: config.get<string>('REDIS_PASSWORD', undefined),
        } as unknown as Redis),
        getTracker: throttleGetTracker,
      }),
    }),
    UsersModule,
    AuthModule,
    InventoryModule,
    NotificationsModule,
    UserActivityModule,
    EventsModule,
    TrackingModule,
    AnomalyModule,
    BatchImportModule,
    WorkflowModule,
    BloodRequestsModule,
    BloodUnitsModule,
    BlockchainModule,
    DispatchModule,
    EscalationModule,
    DonorImpactModule,
    LocationHistoryModule,
    HospitalsModule,
    MapsModule,
    TransparencyModule,
    ProofBundleModule,
    PolicyCenterModule,
    ReconciliationModule,
    RouteDeviationModule,
    FileMetadataModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    /**
     * Runs after JWT so req.user is populated before role resolution.
     * Replaces the generic ThrottlerGuard with role-aware limits.
     */
    { provide: APP_GUARD, useClass: RoleAwareThrottlerGuard },
    /** Permission enforcement applied globally; use @RequirePermissions() to specify */
    { provide: APP_GUARD, useClass: PermissionsGuard },
    CorrelationIdService,
  ],
})
export class AppModule {}
