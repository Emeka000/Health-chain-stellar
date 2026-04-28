import {
  Controller,
  Get,
  Query,
  ParseIntPipe,
  DefaultValuePipe,
} from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';

import { RequirePermissions } from '../../auth/decorators/require-permissions.decorator';
import { Permission } from '../../auth/enums/permission.enum';

import { AuditLogService } from './audit-log.service';

@ApiTags('Audit Logs')
@Controller('audit-logs')
export class AuditLogController {
  constructor(private readonly auditLogService: AuditLogService) {}

  @RequirePermissions(Permission.ADMIN_ACCESS)
  @Get()
  @ApiOperation({ summary: 'Query audit logs by resource (ADMIN only)' })
  @ApiQuery({ name: 'resourceType', required: true })
  @ApiQuery({ name: 'resourceId', required: true })
  @ApiQuery({ name: 'limit', required: false })
  @ApiQuery({ name: 'offset', required: false })
  @ApiResponse({
    status: 200,
    schema: {
      example: {
        data: [
          {
            id: 'uuid',
            actorId: 'user-uuid',
            actorRole: 'admin',
            action: 'blood-unit.status-changed',
            category: 'data_modification',
            severity: 'high',
            resourceType: 'BloodUnit',
            resourceId: 'unit-uuid',
            previousValue: { status: 'AVAILABLE' },
            nextValue: { status: 'QUARANTINED' },
            ipAddress: '10.0.0.1',
            userAgent: 'Mozilla/5.0...',
            correlationId: 'abc-123',
            metadata: { reason: 'Quality control issue' },
            timestamp: '2026-01-01T00:00:00.000Z',
          },
        ],
        total: 1,
      },
    },
  })
  async findByResource(
    @Query('resourceType') resourceType: string,
    @Query('resourceId') resourceId: string,
    @Query('limit', new DefaultValuePipe(100), ParseIntPipe) limit: number,
    @Query('offset', new DefaultValuePipe(0), ParseIntPipe) offset: number,
  ) {
    return this.auditLogService.findByResource(
      resourceType,
      resourceId,
      limit,
      offset,
    );
  }

  @RequirePermissions(Permission.ADMIN_ACCESS)
  @Get('by-actor')
  @ApiOperation({ summary: 'Query audit logs by actor (ADMIN only)' })
  @ApiQuery({ name: 'actorId', required: true })
  @ApiQuery({ name: 'limit', required: false })
  @ApiQuery({ name: 'offset', required: false })
  @ApiResponse({ status: 200, description: 'Audit logs retrieved' })
  async findByActor(
    @Query('actorId') actorId: string,
    @Query('limit', new DefaultValuePipe(100), ParseIntPipe) limit: number,
    @Query('offset', new DefaultValuePipe(0), ParseIntPipe) offset: number,
  ) {
    return this.auditLogService.findByActor(actorId, limit, offset);
  }

  @RequirePermissions(Permission.ADMIN_ACCESS)
  @Get('by-correlation')
  @ApiOperation({
    summary: 'Query audit logs by correlation ID for tracing (ADMIN only)',
  })
  @ApiQuery({ name: 'correlationId', required: true })
  @ApiQuery({ name: 'limit', required: false })
  @ApiQuery({ name: 'offset', required: false })
  @ApiResponse({
    status: 200,
    description: 'Related audit logs retrieved in chronological order',
  })
  async findByCorrelationId(
    @Query('correlationId') correlationId: string,
    @Query('limit', new DefaultValuePipe(100), ParseIntPipe) limit: number,
    @Query('offset', new DefaultValuePipe(0), ParseIntPipe) offset: number,
  ) {
    return this.auditLogService.findByCorrelationId(
      correlationId,
      limit,
      offset,
    );
  }

  @RequirePermissions(Permission.ADMIN_ACCESS)
  @Get('by-category')
  @ApiOperation({ summary: 'Query audit logs by category (ADMIN only)' })
  @ApiQuery({
    name: 'category',
    required: true,
    description: 'authentication, financial, privileged_access, etc.',
  })
  @ApiQuery({ name: 'limit', required: false })
  @ApiQuery({ name: 'offset', required: false })
  @ApiResponse({ status: 200, description: 'Audit logs by category retrieved' })
  async findByCategory(
    @Query('category') category: string,
    @Query('limit', new DefaultValuePipe(100), ParseIntPipe) limit: number,
    @Query('offset', new DefaultValuePipe(0), ParseIntPipe) offset: number,
  ) {
    return this.auditLogService.findByCategory(category, limit, offset);
  }

  @RequirePermissions(Permission.ADMIN_ACCESS)
  @Get('critical')
  @ApiOperation({ summary: 'Query critical audit events (ADMIN only)' })
  @ApiQuery({ name: 'limit', required: false })
  @ApiQuery({ name: 'offset', required: false })
  @ApiResponse({ status: 200, description: 'Critical audit events retrieved' })
  async findCriticalEvents(
    @Query('limit', new DefaultValuePipe(100), ParseIntPipe) limit: number,
    @Query('offset', new DefaultValuePipe(0), ParseIntPipe) offset: number,
  ) {
    return this.auditLogService.findCriticalEvents(limit, offset);
  }
}
