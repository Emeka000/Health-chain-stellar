import {
  Body,
  Controller,
  Delete,
  HttpCode,
  HttpStatus,
  Post,
  Request,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { IsNotEmpty, IsString, Matches } from 'class-validator';

import { MfaService } from './mfa.service';

export class MfaVerifyDto {
  @IsString()
  @IsNotEmpty()
  @Matches(/^\d{6}$/, { message: 'token must be a 6-digit number' })
  token: string;
}

@ApiTags('MFA')
@ApiBearerAuth()
@Controller('auth/mfa')
export class MfaController {
  constructor(private readonly mfaService: MfaService) {}

  @Post('setup')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Initiate MFA setup',
    description:
      'Generates a TOTP secret and returns a QR code data URL. ' +
      'Call POST /auth/mfa/verify with a valid code to activate MFA.',
  })
  @ApiResponse({
    status: 200,
    schema: { example: { qrCodeDataUrl: 'data:image/png;base64,...' } },
  })
  async setup(@Request() req: any) {
    return this.mfaService.setupMfa(req.user.id as string);
  }

  @Post('verify')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Verify TOTP code and enable MFA (or complete MFA login)',
    description:
      'If MFA is not yet enabled, verifies the code and activates MFA. ' +
      'Returns a short-lived mfaToken (5 min) that must be exchanged for a ' +
      'full access token via POST /auth/mfa/exchange.',
  })
  @ApiResponse({
    status: 200,
    schema: { example: { mfaToken: 'eyJ...' } },
  })
  async verify(@Request() req: any, @Body() dto: MfaVerifyDto) {
    const userId = req.user.id as string;
    const isEnabled = await this.mfaService.isMfaEnabled(userId);

    if (!isEnabled) {
      // First-time setup: verify code and enable MFA
      return this.mfaService.verifyAndEnable(userId, dto.token);
    }
    // Subsequent logins: validate code and return mfaToken
    return this.mfaService.validateMfaCode(userId, dto.token);
  }

  @Delete('disable')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Disable MFA',
    description: 'Requires a valid TOTP code as confirmation.',
  })
  @ApiResponse({ status: 200, schema: { example: { message: 'MFA disabled successfully' } } })
  @ApiResponse({ status: 401, description: 'Invalid TOTP code' })
  async disable(@Request() req: any, @Body() dto: MfaVerifyDto) {
    return this.mfaService.disableMfa(req.user.id as string, dto.token);
  }
}
