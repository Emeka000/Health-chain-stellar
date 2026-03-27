import {
  Controller,
  Post,
  Body,
  HttpCode,
  HttpStatus,
  Request,
  Get,
  Delete,
  Param,
  Patch,
  UseInterceptors,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';

import { AuthService } from './auth.service';
import { IdempotencyInterceptor } from '../common/idempotency/idempotency.interceptor';
import { Public } from './decorators/public.decorator';
import { RequirePermissions } from './decorators/require-permissions.decorator';
import {
  ChangePasswordDto,
  LoginDto,
  RefreshTokenDto,
  RegisterDto,
  UnlockAccountDto,
} from './dto/auth.dto';
import { Permission } from './enums/permission.enum';

/** Stricter than global default (100/min) to reduce brute-force and abuse on auth. */
@Throttle({ default: { limit: 20, ttl: 60_000 } })
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Public()
  @UseInterceptors(IdempotencyInterceptor)
  @Post('register')
  async register(@Body() registerDto: RegisterDto) {
    return this.authService.register(registerDto);
  }

  @Public()
  @UseInterceptors(IdempotencyInterceptor)
  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(@Body() loginDto: LoginDto) {
    return this.authService.login(loginDto);
  }

  @Public()
  @UseInterceptors(IdempotencyInterceptor)
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  async refresh(@Body() refreshTokenDto: RefreshTokenDto) {
    return this.authService.refreshToken(refreshTokenDto.refreshToken);
  }

  @UseInterceptors(IdempotencyInterceptor)
  @Post('logout')
  @HttpCode(HttpStatus.OK)
  async logout(@Request() req: any) {
    const userId: string = req.user?.id ?? (req.body?.userId as string);
    const sessionId: string | undefined = req.user?.sid;
    return this.authService.logout(userId, sessionId);
  }

  @Get('sessions')
  @HttpCode(HttpStatus.OK)
  async getActiveSessions(@Request() req: any) {
    return this.authService.getActiveSessions(req.user.id);
  }

  @Delete('sessions/:sessionId')
  @HttpCode(HttpStatus.OK)
  async revokeSession(
    @Request() req: any,
    @Param('sessionId') sessionId: string,
  ) {
    return this.authService.revokeSession(req.user.id, sessionId);
  }

  @UseInterceptors(IdempotencyInterceptor)
  @Post('change-password')
  @HttpCode(HttpStatus.OK)
  async changePassword(@Request() req: any, @Body() dto: ChangePasswordDto) {
    return this.authService.changePassword(
      req.user.id,
      dto.oldPassword,
      dto.newPassword,
    );
  }

  @RequirePermissions(Permission.MANAGE_USERS)
  @UseInterceptors(IdempotencyInterceptor)
  @Patch('unlock')
  @HttpCode(HttpStatus.OK)
  async unlockAccount(@Body() dto: UnlockAccountDto) {
    return this.authService.manualUnlockByAdmin(dto.userId);
  }
}
