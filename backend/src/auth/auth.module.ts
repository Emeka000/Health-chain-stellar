import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { TypeOrmModule } from '@nestjs/typeorm';

import { IdempotencyModule } from '../common/idempotency/idempotency.module';
import { RedisModule } from '../redis/redis.module';
import { UserActivityModule } from '../user-activity/user-activity.module';
import { UserEntity } from '../users/entities/user.entity';
import { TwoFactorAuthEntity } from '../users/entities/two-factor-auth.entity';

import { AuthController } from './auth.controller';
import { PermissionsController } from './permissions.controller';
import { AuthService } from './auth.service';
import { EmailVerificationEntity } from './entities/email-verification.entity';
import { AuthSessionEntity } from './entities/auth-session.entity';
import { PasswordResetTokenEntity } from './entities/password-reset-token.entity';
import { RolePermissionEntity } from './entities/role-permission.entity';
import { RoleEntity } from './entities/role.entity';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { PermissionsGuard } from './guards/permissions.guard';
import { JwtKeyService } from './jwt-key.service';
import { JwtStrategy } from './jwt.strategy';
import { MfaController } from './mfa/mfa.controller';
import { MfaService } from './mfa/mfa.service';
import { PasswordResetService } from './password-reset.service';
import { PermissionsService } from './permissions.service';
import { AuthSessionRepository } from './repositories/auth-session.repository';

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
    TypeOrmModule.forFeature([
      RoleEntity,
      RolePermissionEntity,
      UserEntity,
      TwoFactorAuthEntity,
      AuthSessionEntity,
      EmailVerificationEntity,
      PasswordResetTokenEntity,
    ]),
    RedisModule,
    IdempotencyModule,
    UserActivityModule,
  ],
  controllers: [AuthController, PermissionsController],
  providers: [
    AuthService,
    MfaService,
    PasswordResetService,
    JwtStrategy,
    JwtAuthGuard,
    PermissionsGuard,
    PermissionsService,
    AuthSessionRepository,
  ],
  exports: [
    AuthService,
    MfaService,
    PasswordResetService,
    JwtStrategy,
    JwtAuthGuard,
    PermissionsGuard,
    PermissionsService,
    JwtModule,
    AuthSessionRepository,
  ],
})
export class AuthModule {}
