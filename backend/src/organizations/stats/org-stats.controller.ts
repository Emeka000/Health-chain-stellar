import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import { Response } from 'express';
import { OrgStatsService } from './org-stats.service';
import { exportToExcel, exportToPdf } from './export.helper';

@ApiTags('Organizations')
@ApiBearerAuth()
@Controller('api/v1/organization/stats')
export class OrgStatsController {
  constructor(private readonly statsService: OrgStatsService) {}

  @ApiOperation({ summary: 'Get :orgId' })
  @ApiResponse({ status: 200, description: 'Resource retrieved successfully' })
  @Get(':orgId')
  async getStats(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Req() req: { user: { organizationId: string } },
  ) {
    return this.statsService.getStats(orgId, req.user.organizationId);
  }

  @ApiOperation({ summary: 'Get :orgId export' })
  @ApiResponse({ status: 200, description: 'Resource retrieved successfully' })
  @Get(':orgId/export')
  async exportStats(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Query('format') format: 'excel' | 'pdf' = 'excel',
    @Req() req: { user: { organizationId: string } },
    @Res() res: Response,
  ) {
    const stats = await this.statsService.getStats(orgId, req.user.organizationId);

    if (format === 'pdf') {
      const buf = await exportToPdf(stats);
      res.set({
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="org-stats-${orgId}.pdf"`,
      });
      return res.send(buf);
    }

    const buf = await exportToExcel(stats);
    res.set({
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="org-stats-${orgId}.xlsx"`,
    });
    return res.send(buf);
  }
}
