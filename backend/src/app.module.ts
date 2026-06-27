import { BullModule } from '@nestjs/bullmq';
import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { ThrottlerModule } from '@nestjs/throttler';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ScheduleModule } from '@nestjs/schedule';

import { ThrottlerStorageRedisService } from '@nest-lab/throttler-storage-redis';
import type Redis from 'ioredis';

import { AnomalyModule } from './anomaly/anomaly.module';
import { ApprovalModule } from './approvals/approval.module';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuthModule } from './auth/auth.module';
import { JwtAuthGuard } from './auth/guards/jwt-auth.guard';
import { PermissionsGuard } from './auth/guards/permissions.guard';
import { BatchImportModule } from './batch-import/batch-import.module';
import { BlockchainModule } from './blockchain/blockchain.module';
import { BloodMatchingModule } from './blood-matching/blood-matching.module';
import { BloodRequestsModule } from './blood-requests/blood-requests.module';
import { BloodUnitsModule } from './blood-units/blood-units.module';
import { ColdChainModule } from './cold-chain/cold-chain.module';
import { ConsentModule } from './consent/consent.module';
import { AppConfigModule } from './config/config.module';
import { THROTTLE_TTL_MS } from './config/throttle-limits.config';
import { ContractEventIndexerModule } from './contract-event-indexer/contract-event-indexer.module';
import { CustodyModule } from './custody/custody.module';
import { DeliveryProofModule } from './delivery-proof/delivery-proof.module';
import { DispatchModule } from './dispatch/dispatch.module';
import { DisputesModule } from './disputes/disputes.module';
import { DonationModule } from './donations/donation.module';
import { DonorEligibilityModule } from './donor-eligibility/donor-eligibility.module';
import { DonorImpactModule } from './donor-impact/donor-impact.module';
import { EscalationModule } from './escalation/escalation.module';
import { EscrowGovernanceModule } from './escrow-governance/escrow-governance.module';
import { EventsModule } from './events/events.module';
import { FeeCorrectionModule } from './fee-correction/fee-correction.module';
import { FileMetadataModule } from './file-metadata/file-metadata.module';
import { HealthModule } from './health/health.module';
import { HospitalsModule } from './hospitals/hospitals.module';
import { IncidentReviewsModule } from './incident-reviews/incident-reviews.module';
import { InventoryModule } from './inventory/inventory.module';
import { LocationHistoryModule } from './location-history/location-history.module';
import { MapsModule } from './maps/maps.module';
import { MigrationSafetyModule } from './migrations/migration-safety.module';
import { NotificationsModule } from './notifications/notifications.module';
import { OnboardingModule } from './onboarding/onboarding.module';
import { OrdersModule } from './orders/orders.module';
import { OrganizationsModule } from './organizations/organizations.module';
import { PolicyCenterModule } from './policy-center/policy-center.module';
import { ProofBundleModule } from './proof-bundle/proof-bundle.module';
import { ReadinessModule } from './readiness/readiness.module';
import { ReconciliationModule } from './reconciliation/reconciliation.module';
import { RedisModule } from './redis/redis.module';
import { RegionsModule } from './regions/regions.module';
import { ReportingModule } from './reporting/reporting.module';
import { ReputationModule } from './reputation/reputation.module';
import { RetentionModule } from './retention/retention.module';
import { RidersModule } from './riders/riders.module';
import { RouteDeviationModule } from './route-deviation/route-deviation.module';
import { SlaModule } from './sla/sla.module';
import { SorobanModule } from './soroban/soroban.module';
import { SurgeSimulationModule } from './surge-simulation/surge-simulation.module';
import { TrackingModule } from './tracking/tracking.module';
import { TransparencyModule } from './transparency/transparency.module';
import { UsersModule } from './users/users.module';
import { CorrelationIdMiddleware } from './common/middleware/correlation-id.middleware';
import { CorrelationIdService } from './common/middleware/correlation-id.service';
import { RoleAwareThrottlerGuard } from './throttler/role-aware-throttler.guard';
import { ApiCompatibilityInterceptor } from './common/versioning/api-compatibility.interceptor';
import { throttleGetTracker } from './throttler/throttle-tracker.util';

@Module({
  imports: [
    // ── Single authoritative configuration bootstrap ──────────────────────
    AppConfigModule,

    EventEmitterModule.forRoot(),
    ScheduleModule.forRoot(),

    // Global BullMQ Redis connection
    BullModule.forRootAsync({
      useFactory: (configService: ConfigService) => ({
        connection: {
          host: configService.get<string>('REDIS_HOST', 'localhost'),
          port: configService.get<number>('REDIS_PORT', 6379),
        },
      }),
      inject: [ConfigService],
    }),

    TypeOrmModule.forRootAsync({
      useFactory: (config: ConfigService) => {
        const nodeEnv = config.get<string>('NODE_ENV', 'development');
        const synchronize = nodeEnv === 'development' || nodeEnv === 'test';
        return {
          type: 'postgres',
          host: config.get<string>('DATABASE_HOST', 'localhost'),
          port: config.get<number>('DATABASE_PORT', 5432),
          username: config.get<string>('DATABASE_USERNAME', 'postgres'),
          password: config.get<string>('DATABASE_PASSWORD', ''),
          database: config.get<string>('DATABASE_NAME'),
          autoLoadEntities: true,
          synchronize,
          migrations: ['dist/migrations/*.js'],
          migrationsRun: false,
        };
      },
      inject: [ConfigService],
    }),

    ThrottlerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        throttlers: [
          {
            name: 'default',
            ttl: THROTTLE_TTL_MS,
            limit: 30,
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

    // ── Core infrastructure ───────────────────────────────────────────────
    RedisModule,
    UsersModule,
    AuthModule,

    // ── Health & observability ────────────────────────────────────────────
    HealthModule,

    // ── Domain modules ────────────────────────────────────────────────────
    AnomalyModule,
    ApprovalModule,
    BatchImportModule,
    BlockchainModule,
    BloodMatchingModule,
    BloodRequestsModule,
    BloodUnitsModule,
    ColdChainModule,
    ConsentModule,
    ContractEventIndexerModule,
    CustodyModule,
    DeliveryProofModule,
    DispatchModule,
    DisputesModule,
    DonationModule,
    DonorEligibilityModule,
    DonorImpactModule,
    EscalationModule,
    EscrowGovernanceModule,
    EventsModule,
    FeeCorrectionModule,
    FileMetadataModule,
    HospitalsModule,
    IncidentReviewsModule,
    InventoryModule,
    LocationHistoryModule,
    MapsModule,
    MigrationSafetyModule,
    NotificationsModule,
    OnboardingModule,
    OrdersModule,
    OrganizationsModule,
    PolicyCenterModule,
    ProofBundleModule,
    ReadinessModule,
    ReconciliationModule,
    RegionsModule,
    ReportingModule,
    ReputationModule,
    RetentionModule,
    RidersModule,
    RouteDeviationModule,
    SlaModule,
    SorobanModule,
    SurgeSimulationModule,
    TrackingModule,
    TransparencyModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RoleAwareThrottlerGuard },
    { provide: APP_GUARD, useClass: PermissionsGuard },
    { provide: APP_INTERCEPTOR, useClass: ApiCompatibilityInterceptor },
    CorrelationIdService,
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(CorrelationIdMiddleware).forRoutes('*');
  }
}
