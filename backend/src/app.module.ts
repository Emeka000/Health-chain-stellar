import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { APP_GUARD } from '@nestjs/core';
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
import { NotificationsModule } from './notifications/notifications.module';
import { BullModule } from '@nestjs/bullmq';
import { JwtAuthGuard } from './auth/guards/jwt-auth.guard';
import { PermissionsGuard } from './auth/guards/permissions.guard';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),
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
    /** JWT authentication applied globally; use @Public() to opt-out */
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    /** Permission enforcement applied globally; use @RequirePermissions() to specify */
    { provide: APP_GUARD, useClass: PermissionsGuard },
  ],
})
export class AppModule {}
