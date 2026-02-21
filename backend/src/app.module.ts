import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { CacheModule } from '@nestjs/cache-manager';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { HospitalsModule } from './hospitals/hospitals.module';
import { InventoryModule } from './inventory/inventory.module';
import { OrdersModule } from './orders/orders.module';
import { RidersModule } from './riders/riders.module';
import { DispatchModule } from './dispatch/dispatch.module';
import { MapsModule } from './maps/maps.module';
import { JwtAuthGuard } from './auth/guards/jwt-auth.guard';
import { PermissionsGuard } from './auth/guards/permissions.guard';
import { NotificationsModule } from './notifications/notifications.module';
import { BullModule } from '@nestjs/bullmq';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),
    CacheModule.register({ isGlobal: true, ttl: 300_000 }),
    AuthModule,
    UsersModule,
    HospitalsModule,
    InventoryModule,
    OrdersModule,
    RidersModule,
    DispatchModule,
    MapsModule,
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
    NotificationsModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    /** JwtAuthGuard runs first — establishes req.user from the Bearer token. */
    {
      provide: APP_GUARD,
      useClass: JwtAuthGuard,
    },
    /** PermissionsGuard runs second — enforces @RequirePermissions() metadata. */
    {
      provide: APP_GUARD,
      useClass: PermissionsGuard,
    },
  ],
})
export class AppModule {}
