import { Controller, Get, Query, Res, Header, UseGuards, HttpStatus, Param } from '@nestjs/common';

import { Response } from 'express';

import { RequirePermissions } from '../../auth/decorators/require-permissions.decorator';
import { Permission } from '../../auth/enums/permission.enum';
import { User } from '../../auth/decorators/user.decorator';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../auth/guards/permissions.guard';
import { QueryRequestsDto } from '../dto/query-requests.dto';
import { RequestQueryService } from '../services/request-query.service';

@Controller('blood-requests/query')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class RequestQueryController {
  constructor(private readonly queryService: RequestQueryService) {}

  @RequirePermissions(Permission.VIEW_BLOOD_REQUESTS)
  @Get()
  queryRequests(@Query() queryDto: QueryRequestsDto) {
    return this.queryService.queryRequests(queryDto);
  }

  @RequirePermissions(Permission.VIEW_BLOOD_REQUESTS)
  @Get('statistics')
  getRequestStatistics(
    @Query('hospitalId') hospitalId?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    return this.queryService.getRequestStatistics(
      hospitalId,
      startDate ? new Date(startDate) : undefined,
      endDate ? new Date(endDate) : undefined,
    );
  }

  @RequirePermissions(Permission.VIEW_BLOOD_REQUESTS)
  @Get('sla-compliance')
  getSLAComplianceReport(
    @Query('hospitalId') hospitalId?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    return this.queryService.getSLAComplianceReport(
      hospitalId,
      startDate ? new Date(startDate) : undefined,
      endDate ? new Date(endDate) : undefined,
    );
  }

  @RequirePermissions(Permission.VIEW_BLOOD_REQUESTS)
  @Get('export/csv')
  async exportToCSV(
    @Query() queryDto: QueryRequestsDto,
    @User() user: any,
    @Res() res: Response,
  ) {
    const result = await this.queryService.initiateExport(queryDto, user, 'csv');

    if (Buffer.isBuffer(result)) {
      res.set({
        'Content-Type': 'text/csv',
        'Content-Disposition': 'attachment; filename="blood-requests.csv"',
      });
      return res.send(result);
    }

    return res.status(HttpStatus.ACCEPTED).json({
      message: 'Export initiated asynchronously',
      reportId: result.id,
      status: result.status,
    });
  }

  @RequirePermissions(Permission.VIEW_BLOOD_REQUESTS)
  @Get('export/pdf')
  async exportToPDF(
    @Query() queryDto: QueryRequestsDto,
    @User() user: any,
    @Res() res: Response,
  ) {
    const result = await this.queryService.initiateExport(queryDto, user, 'pdf');

    if (Buffer.isBuffer(result)) {
      res.set({
        'Content-Type': 'application/pdf',
        'Content-Disposition': 'attachment; filename="blood-requests.pdf"',
      });
      return res.send(result);
    }

    return res.status(HttpStatus.ACCEPTED).json({
      message: 'Export initiated asynchronously',
      reportId: result.id,
      status: result.status,
    });
  }

  @RequirePermissions(Permission.VIEW_BLOOD_REQUESTS)
  @Get('export/status/:id')
  async getExportStatus(@Param('id') id: string, @User() user: any) {
    // This would typically call a report service directly
    // For now, we'll assume the client can query a general reporting endpoint
    // or we can add a method to queryService
    return (this.queryService as any).reportExportService.getReportStatus(id, user.id);
  }
}
