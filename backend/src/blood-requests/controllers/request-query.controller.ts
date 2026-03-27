import { Controller, Get, Query, Res, Header } from '@nestjs/common';

import { Response } from 'express';

import { RequirePermissions } from '../../auth/decorators/require-permissions.decorator';
import { Permission } from '../../auth/enums/permission.enum';
import { QueryRequestsDto } from '../dto/query-requests.dto';
import { RequestQueryService } from '../services/request-query.service';

@Controller('blood-requests/query')
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
  @Header('Content-Type', 'text/csv')
  @Header('Content-Disposition', 'attachment; filename="blood-requests.csv"')
  async exportToCSV(@Query() queryDto: QueryRequestsDto, @Res() res: Response) {
    const csv = await this.queryService.exportToCSV(queryDto);
    res.send(csv);
  }

  @RequirePermissions(Permission.VIEW_BLOOD_REQUESTS)
  @Get('export/pdf')
  @Header('Content-Type', 'application/pdf')
  @Header('Content-Disposition', 'attachment; filename="blood-requests.pdf"')
  async exportToPDF(@Query() queryDto: QueryRequestsDto, @Res() res: Response) {
    const pdf = await this.queryService.exportToPDF(queryDto);
    res.send(pdf);
  }
}
