import { Body, Controller, Get, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';

import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import { Permission } from '../auth/enums/permission.enum';
import { User } from '../auth/decorators/user.decorator';
import { ConsentService } from './consent.service';
import { PublishConsentTermDto, RecordConsentDto } from './dto/consent.dto';

@ApiTags('Consent')
@ApiBearerAuth()
@Controller('consent')
export class ConsentController {
  constructor(private readonly consentService: ConsentService) {}

  /** Admin-only: publish a new consent term version and make it active. */
  @ApiOperation({ summary: 'Post terms' })
  @ApiResponse({ status: 201, description: 'Resource created successfully' })
  @Post('terms')
  @RequirePermissions(Permission.ADMIN_ACCESS)
  publishTerm(@Body() dto: PublishConsentTermDto) {
    return this.consentService.publishTerm(dto);
  }

  @ApiOperation({ summary: 'Get terms active' })
  @ApiResponse({ status: 200, description: 'Resource retrieved successfully' })
  @Get('terms/active')
  getActiveTerm() {
    return this.consentService.getActiveTerm();
  }

  /** Record the authenticated caller's own consent to the currently active terms. */
  @ApiOperation({ summary: 'Post consent' })
  @ApiResponse({ status: 201, description: 'Resource created successfully' })
  @Post('consent')
  recordConsent(@Body() dto: RecordConsentDto, @User('id') userId: string) {
    return this.consentService.recordConsent({
      participantId: userId,
      consentSource: dto.consentSource,
    });
  }

  /** Whether the authenticated caller's consent is current. */
  @ApiOperation({ summary: 'Get status' })
  @ApiResponse({ status: 200, description: 'Resource retrieved successfully' })
  @Get('status')
  getConsentStatus(@User('id') userId: string) {
    return this.consentService.checkConsentCurrency(userId);
  }
}
