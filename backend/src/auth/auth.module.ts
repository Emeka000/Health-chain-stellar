import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { TypeOrmModule } from '@nestjs/typeorm';

import { IdempotencyModule } from '../common/idempotency/idempotency.module';
import { RedisModule } from '../redis/redis.module';
import { UserActivityModule } from '../user-activity/user-activity.module';
import { TwoFactorAuthEntity } from '../users/entities/two-factor-auth.entity';
import { UserEntity } from '../users/entities/user.entity';

import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { AuthSessionEntity } from './entities/auth-session.entity';
import { EmailVerificationEntity } from './entities/email-verification.entity';
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
import { PermissionsController } from './permissions.controller';
import { PermissionsService } from './permissions.service';
import { AuthSessionRepository } from './repositories/auth-session.repository';
import { ScopeResolutionService } from './scope-resolution.service';
import { SessionRiskService } from './session-risk.service';

import type { JwtModuleOptions } from '@nestjs/jwt';

@Module({
  imports: [
    PassportModule.register({ defaultStrategy: 'jwt' }),
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService): JwtModuleOptions => {
        const expiresIn = (configService.get<string>('JWT_EXPIRES_IN') ??
          '1h') as NonNullable<JwtModuleOptions['signOptions']>['expiresIn'];
        return {
          secret: configService.get<string>('JWT_SECRET') ?? 'default-secret',
          signOptions: {
            expiresIn,
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
  controllers: [AuthController, PermissionsController, MfaController],
  providers: [
    AuthService,
    MfaService,
    PasswordResetService,
    JwtKeyService,
    JwtStrategy,
    JwtAuthGuard,
    PermissionsGuard,
    PermissionsService,
    AuthSessionRepository,
    ScopeResolutionService,
    SessionRiskService,
  ],
  exports: [
    AuthService,
    MfaService,
    PasswordResetService,
    JwtKeyService,
    JwtStrategy,
    JwtAuthGuard,
    PermissionsGuard,
    PermissionsService,
    ScopeResolutionService,
    JwtModule,
    AuthSessionRepository,
    SessionRiskService,
  ],
})
export class AuthModule {}
