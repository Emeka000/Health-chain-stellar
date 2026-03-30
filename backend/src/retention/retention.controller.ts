import { Controller, Post, Get, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiQuery, ApiResponse } from '@nestjs/swagger';

import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import { Permission } from '../auth/enums/permission.enum';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

import { RetentionService } from './retention.service';
import { RetentionPolicyService } from './retention-policy.service';
import { SensitiveDataService } from './sensitive-data.service';

@ApiTags('Retention')
@Controller('retention')
@UseGuards(JwtAuthGuard)
export class RetentionController {
  constructor(
    private readonly retentionService: RetentionService,
    private readonly retentionPolicyService: RetentionPolicyService,
    private readonly sensitiveDataService: SensitiveDataService,
  ) {}

  @Post('trigger')
  @RequirePermissions(Permission.ADMIN_ACCESS)
  @ApiOperation({
    summary: 'Manually trigger retention job',
    description: 'Cleans up stale sessions, old activity logs, and sensitive data. Admin only.',
  })
  async triggerRetention() {
    return this.retentionService.triggerRetention();
  }

  @Post('policy/run')
  @RequirePermissions(Permission.ADMIN_ACCESS)
  @ApiOperation({
    summary: 'Run GDPR-equivalent retention policy',
    description:
      'Anonymises inactive users (>3 years), purges USSD sessions (>90 days), strips patientId from old orders (>10 years). ' +
      'Pass ?dryRun=true to preview changes without mutating data.',
  })
  @ApiQuery({ name: 'dryRun', required: false, type: Boolean })
  @ApiResponse({
    status: 200,
    schema: {
      example: {
        usersAnonymised: 3,
        ussdSessionsDeleted: 12,
        orderPatientIdsStripped: 5,
        dryRun: false,
      },
    },
  })
  async runRetentionPolicy(@Query('dryRun') dryRun?: string) {
    return this.retentionPolicyService.run(dryRun === 'true');
  }

  @Get('sensitive-fields')
  @RequirePermissions(Permission.ADMIN_ACCESS)
  @ApiOperation({ summary: 'Get sensitive fields classification' })
  async getSensitiveFields() {
    return this.sensitiveDataService.getSensitiveFields();
  }

  @Get('policies')
  @RequirePermissions(Permission.ADMIN_ACCESS)
  @ApiOperation({ summary: 'Get retention policies' })
  async getRetentionPolicies() {
    return this.sensitiveDataService.getRetentionPolicies();
  }

  @Get('redactions')
  @RequirePermissions(Permission.ADMIN_ACCESS)
  @ApiOperation({ summary: 'Get data redaction audit log' })
  async getRedactionAudit() {
    return this.sensitiveDataService.getRedactionAudit();
  }
}
