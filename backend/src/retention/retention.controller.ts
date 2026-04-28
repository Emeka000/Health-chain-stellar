import { Controller, Post, Get, Patch, Param, Body, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiQuery, ApiResponse } from '@nestjs/swagger';

import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import { Permission } from '../auth/enums/permission.enum';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { User } from '../auth/decorators/user.decorator';

import { RetentionService } from './retention.service';
import { RetentionPolicyService } from './retention-policy.service';
import { RetentionExecutorService } from './retention-executor.service';
import { SensitiveDataService } from './sensitive-data.service';

@ApiTags('Retention')
@Controller('retention')
@UseGuards(JwtAuthGuard)
export class RetentionController {
  constructor(
    private readonly retentionService: RetentionService,
    private readonly retentionPolicyService: RetentionPolicyService,
    private readonly retentionExecutorService: RetentionExecutorService,
    private readonly sensitiveDataService: SensitiveDataService,
  ) {}

  @Post('trigger')
  @RequirePermissions(Permission.ADMIN_ACCESS)
  @ApiOperation({ summary: 'Manually trigger retention job' })
  async triggerRetention() {
    return this.retentionService.triggerRetention();
  }

  @Post('policy/run')
  @RequirePermissions(Permission.ADMIN_ACCESS)
  @ApiOperation({ summary: 'Run GDPR-equivalent retention policy' })
  @ApiQuery({ name: 'dryRun', required: false, type: Boolean })
  async runRetentionPolicy(@Query('dryRun') dryRun?: string) {
    return this.retentionPolicyService.run(dryRun === 'true');
  }

  /**
   * Execute retention across all modules with legal hold precedence.
   * Pass ?dryRun=true to preview without mutating data.
   */
  @Post('execute')
  @RequirePermissions(Permission.ADMIN_ACCESS)
  @ApiOperation({
    summary: 'Execute retention policies with legal hold enforcement',
    description: 'Processes expired records per policy. Legal-hold records are never altered. Returns compliance report.',
  })
  @ApiQuery({ name: 'dryRun', required: false, type: Boolean })
  async executeRetention(
    @Query('dryRun') dryRun: string | undefined,
    @User('id') actorId: string,
  ) {
    return this.retentionExecutorService.execute(dryRun === 'true', actorId ?? 'SYSTEM');
  }

  // ── Legal hold management ────────────────────────────────────────────────

  @Post('legal-holds')
  @RequirePermissions(Permission.ADMIN_ACCESS)
  @ApiOperation({ summary: 'Place a legal hold on an entity to block retention actions' })
  async placeLegalHold(
    @Body() body: { entityType: string; entityId: string; reason: string },
    @User('id') userId: string,
  ) {
    return this.retentionExecutorService.placeLegalHold(
      body.entityType,
      body.entityId,
      body.reason,
      userId,
    );
  }

  @Patch('legal-holds/:id/release')
  @RequirePermissions(Permission.ADMIN_ACCESS)
  @ApiOperation({ summary: 'Release a legal hold' })
  async releaseLegalHold(@Param('id') id: string, @User('id') userId: string) {
    return this.retentionExecutorService.releaseLegalHold(id, userId);
  }

  @Get('legal-holds')
  @RequirePermissions(Permission.ADMIN_ACCESS)
  @ApiOperation({ summary: 'List legal holds' })
  async listLegalHolds(
    @Query('entityType') entityType?: string,
    @Query('entityId') entityId?: string,
  ) {
    return this.retentionExecutorService.listLegalHolds(entityType, entityId);
  }

  // ── Existing endpoints ───────────────────────────────────────────────────

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
