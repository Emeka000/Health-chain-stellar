import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { EventEmitterModule } from '@nestjs/event-emitter';

import { ThrottlerStorageRedisService } from '@nest-lab/throttler-storage-redis';

import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AnomalyModule } from './anomaly/anomaly.module';
import { BatchImportModule } from './batch-import/batch-import.module';
import { WorkflowModule } from './workflow/workflow.module';
import { AuthModule } from './auth/auth.module';
import { JwtAuthGuard } from './auth/guards/jwt-auth.guard';
import { PermissionsGuard } from './auth/guards/permissions.guard';
import { BlockchainModule } from './blockchain/blockchain.module';
import { BloodRequestsModule } from './blood-requests/blood-requests.module';
import { BloodUnitsModule } from './blood-units/blood-units.module';
import { EventsModule } from './events/events.module';
import { CorrelationIdMiddleware } from './common/middleware/correlation-id.middleware';
import { CorrelationIdService } from './common/middleware/correlation-id.service';
import { AppConfigModule } from './config/config.module';
import { DatabaseSyncGuard } from './config/database-sync.guard';
import { DispatchModule } from './dispatch/dispatch.module';
import { DonorImpactModule } from './donor-impact/donor-impact.module';
import { LocationHistoryModule } from './location-history/location-history.module';
import { HospitalsModule } from './hospitals/hospitals.module';
import { InventoryModule } from './inventory/inventory.module';
import { MapsModule } from './maps/maps.module';
import { NotificationsModule } from './notifications/notifications.module';
import { UserActivityModule } from './user-activity/user-activity.module';
import { UsersModule } from './users/users.module';
import { TrackingModule } from './tracking/tracking.module';

import type Redis from 'ioredis';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    EventEmitterModule.forRoot(),
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
    SorobanModule,
    ApprovalModule,
    DonationModule,
    OrdersModule,
    UsersModule,
    AuthModule,
    InventoryModule,
    NotificationsModule,
    UserActivityModule,
    EventsModule,
    RetentionModule,
    TrackingModule,
    FeePolicyModule,
    AnomalyModule,
    BatchImportModule,
    WorkflowModule,
  ]
  controllers: [AppController],
  providers: [
    AppService,
    /** JWT authentication applied globally; use @Public() to opt-out */
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    /**
     * Runs after JWT so throttling can use `req.user` on protected routes (IP otherwise).
     */
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    /** Permission enforcement applied globally; use @RequirePermissions() to specify */
    { provide: APP_GUARD, useClass: PermissionsGuard },
    { provide: APP_INTERCEPTOR, useClass: ActivityLoggingInterceptor },
    CorrelationIdService,
  ],
})
export class AppModule {}
