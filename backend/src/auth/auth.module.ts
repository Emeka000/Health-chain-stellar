import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { TypeOrmModule } from '@nestjs/typeorm';

import { RedisModule } from '../redis/redis.module';
import { IdempotencyModule } from '../common/idempotency/idempotency.module';
import { UserActivityModule } from '../user-activity/user-activity.module';
import { UserEntity } from '../users/entities/user.entity';

import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { RolePermissionEntity } from './entities/role-permission.entity';
import { RoleEntity } from './entities/role.entity';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { PermissionsGuard } from './guards/permissions.guard';
import { JwtStrategy } from './jwt.strategy';
import { PermissionsService } from './permissions.service';

@Module({
  imports: [
    PassportModule.register({ defaultStrategy: 'jwt' }),
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => {
        const expiresIn = configService.get<string>('JWT_EXPIRES_IN') ?? '1h';
        return {
          secret: configService.get<string>('JWT_SECRET') ?? 'default-secret',
          signOptions: {
            expiresIn: expiresIn as any,
          },
        };
      },
    }),
    TypeOrmModule.forFeature([RoleEntity, RolePermissionEntity, UserEntity]),
    RedisModule,
    IdempotencyModule,
    UserActivityModule,
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    JwtStrategy,
    JwtAuthGuard,
    PermissionsGuard,
    PermissionsService,
  ],
  exports: [
    AuthService,
    JwtStrategy,
    JwtAuthGuard,
    PermissionsGuard,
    PermissionsService,
    JwtModule,
  ],
})
export class AuthModule {}
