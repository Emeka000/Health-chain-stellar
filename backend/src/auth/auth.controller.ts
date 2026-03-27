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
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBody,
  ApiHeader,
  ApiBearerAuth,
  ApiParam,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';

import { RateLimit } from '../common/decorators/rate-limit.decorator';
import { IdempotencyInterceptor } from '../common/idempotency/idempotency.interceptor';

import { AuthService } from './auth.service';
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
@ApiTags('Authentication')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Public()
  @UseInterceptors(IdempotencyInterceptor)
  @Post('register')
  @ApiOperation({
    summary: 'Register a new user',
    description: 'Create a new user account with email and password',
  })
  @ApiBody({
    type: RegisterDto,
    examples: {
      example1: {
        value: {
          email: 'user@example.com',
          password: 'SecurePassword123!',
          name: 'John Doe',
          role: 'donor',
        },
      },
    },
  })
  @ApiResponse({
    status: 201,
    description: 'User registered successfully',
    schema: {
      example: {
        message: 'Registration successful',
        user: {
          id: 'uuid',
          email: 'user@example.com',
          role: 'donor',
          name: 'John Doe',
        },
      },
    },
  })
  @ApiResponse({
    status: 409,
    description: 'Email already registered',
    schema: {
      example: {
        code: 'AUTH_EMAIL_ALREADY_REGISTERED',
        message: 'Email already registered',
        statusCode: 409,
        timestamp: '2024-03-27T04:30:44.473Z',
      },
    },
  })
  @ApiHeader({
    name: 'Idempotency-Key',
    description: 'Optional unique key for idempotent requests',
    required: false,
  })
  async register(@Body() registerDto: RegisterDto) {
    return this.authService.register(registerDto);
  }

  @Public()
  @UseInterceptors(IdempotencyInterceptor)
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Login user',
    description: 'Authenticate user with email and password',
  })
  @ApiBody({
    type: LoginDto,
    examples: {
      example1: {
        value: {
          email: 'user@example.com',
          password: 'SecurePassword123!',
        },
      },
    },
  })
  @ApiResponse({
    status: 200,
    description: 'Login successful',
    schema: {
      example: {
        access_token: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
        refresh_token: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
      },
    },
  })
  @ApiResponse({
    status: 401,
    description: 'Invalid credentials',
    schema: {
      example: {
        code: 'AUTH_INVALID_CREDENTIALS',
        message: 'Invalid email or password',
        statusCode: 401,
        timestamp: '2024-03-27T04:30:44.473Z',
      },
    },
  })
  @ApiResponse({
    status: 403,
    description: 'Account locked',
    schema: {
      example: {
        code: 'AUTH_ACCOUNT_LOCKED',
        message: 'Account is locked. Please try again later',
        statusCode: 403,
        timestamp: '2024-03-27T04:30:44.473Z',
      },
    },
  })
  @ApiHeader({
    name: 'Idempotency-Key',
    description: 'Optional unique key for idempotent requests',
    required: false,
  })
  async login(@Body() loginDto: LoginDto) {
    return this.authService.login(loginDto);
  }

  @Public()
  @UseInterceptors(IdempotencyInterceptor)
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Refresh access token',
    description: 'Get a new access token using a valid refresh token',
  })
  @ApiBody({
    type: RefreshTokenDto,
    examples: {
      example1: {
        value: {
          refreshToken: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
        },
      },
    },
  })
  @ApiResponse({
    status: 200,
    description: 'Token refreshed successfully',
    schema: {
      example: {
        access_token: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
        refresh_token: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
      },
    },
  })
  @ApiResponse({
    status: 401,
    description: 'Invalid or expired refresh token',
    schema: {
      example: {
        code: 'AUTH_INVALID_REFRESH_TOKEN',
        message: 'Invalid or expired refresh token',
        statusCode: 401,
        timestamp: '2024-03-27T04:30:44.473Z',
      },
    },
  })
  @ApiHeader({
    name: 'Idempotency-Key',
    description: 'Optional unique key for idempotent requests',
    required: false,
  })
  async refresh(@Body() refreshTokenDto: RefreshTokenDto) {
    return this.authService.refreshToken(refreshTokenDto.refreshToken);
  }

  @UseInterceptors(IdempotencyInterceptor)
  @Post('logout')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Logout user',
    description: 'Revoke current session or all sessions',
  })
  @ApiResponse({
    status: 200,
    description: 'Logged out successfully',
    schema: {
      example: {
        message: 'Logged out successfully',
      },
    },
  })
  @ApiHeader({
    name: 'Idempotency-Key',
    description: 'Optional unique key for idempotent requests',
    required: false,
  })
  async logout(@Request() req: any) {
    const userId: string = req.user?.id ?? (req.body?.userId as string);
    const sessionId: string | undefined = req.user?.sid;
    return this.authService.logout(userId, sessionId);
  }

  @Get('sessions')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Get active sessions',
    description: 'Retrieve all active sessions for the current user',
  })
  @ApiResponse({
    status: 200,
    description: 'Active sessions retrieved',
    schema: {
      example: [
        {
          userId: 'uuid',
          email: 'user@example.com',
          role: 'donor',
          createdAt: '2024-03-27T04:30:44.473Z',
          expiresAt: '2024-03-28T04:30:44.473Z',
        },
      ],
    },
  })
  async getActiveSessions(@Request() req: any) {
    return this.authService.getActiveSessions(req.user.id);
  }

  @Delete('sessions/:sessionId')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Revoke a session',
    description: 'Revoke a specific session by ID',
  })
  @ApiParam({
    name: 'sessionId',
    description: 'Session ID to revoke',
    example: 'a1b2c3d4e5f6g7h8',
  })
  @ApiResponse({
    status: 200,
    description: 'Session revoked successfully',
    schema: {
      example: {
        message: 'Session revoked successfully',
      },
    },
  })
  @ApiResponse({
    status: 404,
    description: 'Session not found',
    schema: {
      example: {
        code: 'AUTH_SESSION_NOT_FOUND',
        message: 'Session not found',
        statusCode: 404,
        timestamp: '2024-03-27T04:30:44.473Z',
      },
    },
  })
  async revokeSession(
    @Request() req: any,
    @Param('sessionId') sessionId: string,
  ) {
    return this.authService.revokeSession(req.user.id, sessionId);
  }

  @UseInterceptors(IdempotencyInterceptor)
  @Post('change-password')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Change password',
    description: 'Change the password for the current user',
  })
  @ApiBody({
    type: ChangePasswordDto,
    examples: {
      example1: {
        value: {
          oldPassword: 'OldPassword123!',
          newPassword: 'NewPassword456!',
        },
      },
    },
  })
  @ApiResponse({
    status: 200,
    description: 'Password changed successfully',
    schema: {
      example: {
        message: 'Password changed successfully',
      },
    },
  })
  @ApiResponse({
    status: 400,
    description: 'Invalid password change request',
    schema: {
      example: {
        code: 'AUTH_PASSWORD_REUSE',
        message: 'Cannot reuse any of your last 3 passwords',
        statusCode: 400,
        timestamp: '2024-03-27T04:30:44.473Z',
      },
    },
  })
  @ApiHeader({
    name: 'Idempotency-Key',
    description: 'Optional unique key for idempotent requests',
    required: false,
  })
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
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Unlock user account (Admin only)',
    description: 'Manually unlock a locked user account',
  })
  @ApiBody({
    type: UnlockAccountDto,
    examples: {
      example1: {
        value: {
          userId: 'user-uuid',
        },
      },
    },
  })
  @ApiResponse({
    status: 200,
    description: 'Account unlocked successfully',
    schema: {
      example: {
        message: 'Account unlocked successfully',
      },
    },
  })
  @ApiResponse({
    status: 404,
    description: 'User not found',
    schema: {
      example: {
        code: 'USER_NOT_FOUND',
        message: 'User not found',
        statusCode: 404,
        timestamp: '2024-03-27T04:30:44.473Z',
      },
    },
  })
  @ApiHeader({
    name: 'Idempotency-Key',
    description: 'Optional unique key for idempotent requests',
    required: false,
  })
  async unlockAccount(@Body() dto: UnlockAccountDto) {
    return this.authService.manualUnlockByAdmin(dto.userId);
  }
}
