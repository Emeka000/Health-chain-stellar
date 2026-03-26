import { BullModule as BullClassicModule } from '@nestjs/bull';
import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';

import { AppConfigModule } from './config/config.module';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { TypeOrmModule } from '@nestjs/typeorm';

import { ThrottlerStorageRedisService } from '@nest-lab/throttler-storage-redis';

import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuthModule } from './auth/auth.module';
import { JwtAuthGuard } from './auth/guards/jwt-auth.guard';
import { PermissionsGuard } from './auth/guards/permissions.guard';
import { BlockchainModule } from './blockchain/blockchain.module';
import { BloodRequestsModule } from './blood-requests/blood-requests.module';
import { BloodUnitsModule } from './blood-units/blood-units.module';
import { DispatchModule } from './dispatch/dispatch.module';
import { HospitalsModule } from './hospitals/hospitals.module';
import { InventoryModule } from './inventory/inventory.module';
import { MapsModule } from './maps/maps.module';
import { NotificationsModule } from './notifications/notifications.module';
import { OrdersModule } from './orders/orders.module';
import { OrganizationsModule } from './organizations/organizations.module';
import { REDIS_CLIENT } from './redis/redis.constants';
import { RedisModule } from './redis/redis.module';
import { RidersModule } from './riders/riders.module';
import { throttleGetTracker } from './throttler/throttle-tracker.util';
import { ActivityLoggingInterceptor } from './user-activity/interceptors/activity-logging.interceptor';
import { UserActivityModule } from './user-activity/user-activity.module';
import { UsersModule } from './users/users.module';

import type Redis from 'ioredis';

@Module({
  imports: [
    AppConfigModule,
    ScheduleModule.forRoot(),
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        type: 'postgres',
        host: configService.get<string>('DATABASE_HOST', 'localhost'),
        port: configService.get<number>('DATABASE_PORT', 5432),
        username: configService.get<string>('DATABASE_USERNAME', 'postgres'),
        password: configService.get<string>('DATABASE_PASSWORD', ''),
        database: configService.get<string>('DATABASE_NAME', 'healthchain'),
        entities: [__dirname + '/**/*.entity{.ts,.js}'],
        synchronize:
          configService.get<string>('NODE_ENV', 'development') ===
          'development',
        logging: false,
      }),
    }),
    ThrottlerModule.forRootAsync({
      imports: [ConfigModule, RedisModule],
      inject: [ConfigService, REDIS_CLIENT],
      useFactory: (configService: ConfigService, redis: Redis) => {
        const useRedis =
          configService.get<string>('THROTTLER_USE_REDIS', 'true') === 'true';
        return {
          throttlers: [
            {
              name: 'default',
              ttl: 60_000,
              limit: 100,
            },
          ],
          ...(useRedis
            ? { storage: new ThrottlerStorageRedisService(redis) }
            : {}),
          getTracker: throttleGetTracker,
          errorMessage: 'Rate limit exceeded. Please try again later.',
        };
      },
    }),
    AuthModule,
    UsersModule,
    HospitalsModule,
    InventoryModule,
    OrdersModule,
    RidersModule,
    DispatchModule,
    MapsModule,
    BloodUnitsModule,
    BullModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        connection: {
          host: configService.get<string>('REDIS_HOST', 'localhost'),
          port: configService.get<number>('REDIS_PORT', 6379),
        },
      }),
    }),
    BullClassicModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        redis: {
          host: configService.get<string>('REDIS_HOST', 'localhost'),
          port: configService.get<number>('REDIS_PORT', 6379),
        },
      }),
    }),
    NotificationsModule,
    BlockchainModule,
    OrganizationsModule,
    BloodRequestsModule,
    UserActivityModule,
  ],
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
  ],
})
export class AppModule {}
