import { Module } from '@nestjs/common';
import { PassportModule } from '@nestjs/passport';
import { JwtModule } from '@nestjs/jwt';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule, ConfigService } from '@nestjs/config';

import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { JwtStrategy } from './jwt.strategy';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { PermissionsGuard } from './guards/permissions.guard';
import { PermissionsService } from './permissions.service';
import { RoleEntity } from './entities/role.entity';
import { RolePermissionEntity } from './entities/role-permission.entity';
import { RedisModule } from '../redis/redis.module';

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
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            expiresIn: expiresIn as any,
          },
        };
      },
    }),
    TypeOrmModule.forFeature([RoleEntity, RolePermissionEntity]),
    RedisModule,
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
