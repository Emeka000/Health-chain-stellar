import {
  Controller,
  Get,
  Post,
  Param,
  Query,
  Res,
  HttpStatus,
  UseGuards,
  ValidationPipe,
  ParseBoolPipe,
  DefaultValuePipe,
} from '@nestjs/common';
import { Response } from 'express';

import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import { Permission } from '../auth/enums/permission.enum';

import { ReportingService } from './reporting.service';
import { ReportViewRefreshService, MaterializedViewName } from './report-view-refresh.service';
import { ReportingQueryDto, ReportSummaryQueryDto } from './dto/reporting-query.dto';

@Controller('reporting')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class ReportingController {
  constructor(
    private readonly reportingService: ReportingService,
    private readonly refreshService: ReportViewRefreshService,
  ) {}

  /**
   * Multi-domain search with pagination.
   * Supports page/pageSize (preferred) or legacy limit/offset.
   */
  @Get('search')
  @RequirePermissions(Permission.READ_ANALYTICS)
  async search(
    @Query(new ValidationPipe({ transform: true, whitelist: true }))
    filters: ReportingQueryDto,
  ) {
    return this.reportingService.search(filters);
  }

  /**
   * High-level summary metrics.
   * Served from materialized views when fresh; falls back to live queries.
   * Staleness metadata is always included in the response.
   */
  @Get('summary')
  @RequirePermissions(Permission.READ_ANALYTICS)
  async getSummary(
    @Query(new ValidationPipe({ transform: true, whitelist: true }))
    filters: ReportSummaryQueryDto,
  ) {
    return this.reportingService.getSummary(filters, filters.forceLive);
  }

  /**
   * Pre-aggregated daily order summary from materialized view.
   * Supports optional date range and pagination.
   */
  @Get('orders/daily-summary')
  @RequirePermissions(Permission.READ_ANALYTICS)
  async getOrderDailySummary(
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('page', new DefaultValuePipe(1)) page?: number,
    @Query('pageSize', new DefaultValuePipe(50)) pageSize?: number,
  ) {
    return this.reportingService.getOrderDailySummary(startDate, endDate, page, pageSize);
  }

  /**
   * Blood unit inventory snapshot from materialized view.
   */
  @Get('units/inventory')
  @RequirePermissions(Permission.READ_ANALYTICS)
  async getBloodUnitInventory(
    @Query('bloodType') bloodType?: string,
    @Query('status') status?: string,
  ) {
    return this.reportingService.getBloodUnitInventory(bloodType, status);
  }

  /**
   * Returns freshness metadata for all materialized views.
   * Consumers use this to decide whether to request a refresh.
   */
  @Get('views/freshness')
  @RequirePermissions(Permission.READ_ANALYTICS)
  async getViewFreshness() {
    return this.reportingService.getViewFreshness();
  }

  /**
   * Trigger a manual refresh of a specific materialized view.
   * Requires ADMIN_ACCESS permission.
   */
  @Post('views/:viewName/refresh')
  @RequirePermissions(Permission.ADMIN_ACCESS)
  async refreshView(@Param('viewName') viewName: string) {
    return this.reportingService.triggerViewRefresh(viewName as MaterializedViewName);
  }

  /**
   * Trigger refresh of all materialized views.
   * Requires ADMIN_ACCESS permission.
   */
  @Post('views/refresh-all')
  @RequirePermissions(Permission.ADMIN_ACCESS)
  async refreshAllViews() {
    return this.reportingService.triggerAllViewRefresh();
  }

  /**
   * Excel export endpoint.
   * Capped at 10 000 rows per domain.
   */
  @Get('export')
  @RequirePermissions(Permission.READ_ANALYTICS)
  async export(
    @Query(new ValidationPipe({ transform: true, whitelist: true }))
    filters: ReportingQueryDto,
    @Res() res: Response,
  ) {
    const buffer = await this.reportingService.exportToExcel(filters);

    res.set({
      'Content-Type':
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': 'attachment; filename=report.xlsx',
      'Content-Length': buffer.length,
    });

    res.status(HttpStatus.OK).send(buffer);
  }
}
