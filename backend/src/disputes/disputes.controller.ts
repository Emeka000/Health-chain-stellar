import { Body, Controller, Get, Param, Patch, Post, Query, Res, UseGuards } from '@nestjs/common';
import { Response } from 'express';
import { User } from '../auth/decorators/user.decorator';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import { Permission } from '../auth/enums/permission.enum';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { DisputesService } from './disputes.service';
import { AddNoteDto, AssignDisputeDto, OpenDisputeDto, ResolveDisputeDto } from './dto/dispute.dto';
import { DisputeSeverity, DisputeStatus } from './enums/dispute.enum';

@Controller('disputes')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class DisputesController {
  constructor(private readonly service: DisputesService) {}

  @Post()
  open(@Body() dto: OpenDisputeDto, @User('id') userId: string) {
    return this.service.open(dto, userId);
  }

  @Get()
  @RequirePermissions(Permission.DISPUTE_RESOLVE)
  list(
    @Query('status') status?: DisputeStatus,
    @Query('severity') severity?: DisputeSeverity,
    @Query('assignedTo') assignedTo?: string,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
  ) {
    return this.service.list({ status, severity, assignedTo, cursor, limit: limit ? parseInt(limit, 10) : undefined });
  }

  @RequirePermissions(Permission.EXPORT_DISPUTES)
  @Get('export')
  async export(
    @Res() res: Response,
    @Query('status') status?: DisputeStatus,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.service.streamCsvExport(res, { status, from, to });
  }

  @Get(':id')
  @RequirePermissions(Permission.DISPUTE_RESOLVE)
  get(@Param('id') id: string) {
    return this.service.get(id);
  }

  @Auditable({ action: 'dispute.assigned', resourceType: 'Dispute' })
  @UseInterceptors(AuditLogInterceptor)
  @Patch(':id/assign')
  @RequirePermissions(Permission.DISPUTE_RESOLVE)
  assign(@Param('id') id: string, @Body() dto: AssignDisputeDto) {
    return this.service.assign(id, dto.operatorId);
  }

  @Auditable({ action: 'dispute.resolved', resourceType: 'Dispute' })
  @UseInterceptors(AuditLogInterceptor)
  @Patch(':id/resolve')
  @RequirePermissions(Permission.DISPUTE_RESOLVE)
  resolve(@Param('id') id: string, @Body() dto: ResolveDisputeDto) {
    return this.service.resolve(id, dto);
  }

  @Post(':id/notes')
  @RequirePermissions(Permission.DISPUTE_RESOLVE)
  addNote(@Param('id') id: string, @Body() dto: AddNoteDto, @User('id') userId: string) {
    return this.service.addNote(id, dto.content, userId);
  }

  @Get(':id/notes')
  @RequirePermissions(Permission.DISPUTE_RESOLVE)
  getNotes(@Param('id') id: string) {
    return this.service.getNotes(id);
  }

  @Post(':id/evidence')
  @RequirePermissions(Permission.DISPUTE_RESOLVE)
  addEvidence(@Param('id') id: string, @Body() body: { type: string; url: string }) {
    return this.service.addEvidence(id, body);
  }
}
