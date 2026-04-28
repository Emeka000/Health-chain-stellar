import { Controller, Get, Query } from '@nestjs/common';

import { RequirePermissions } from '../../auth/decorators/require-permissions.decorator';
import { Permission } from '../../auth/enums/permission.enum';
import { InventoryAnalyticsService } from '../inventory-analytics.service';

@Controller('inventory/analytics')
export class InventoryAnalyticsController {
  constructor(private readonly analyticsService: InventoryAnalyticsService) {}

  @RequirePermissions(Permission.VIEW_INVENTORY)
  @Get('snapshot')
  getSnapshot() {
    return this.analyticsService.getSnapshot();
  }

  @RequirePermissions(Permission.VIEW_INVENTORY)
  @Get('turnover')
  getTurnoverRates(@Query('periodDays') periodDays = '30') {
    return this.analyticsService.getTurnoverRates(parseInt(periodDays, 10));
  }

  @RequirePermissions(Permission.VIEW_INVENTORY)
  @Get('wastage')
  getWastage(@Query('periodDays') periodDays = '30') {
    return this.analyticsService.getWastageTracking(parseInt(periodDays, 10));
  }

  @RequirePermissions(Permission.VIEW_INVENTORY)
  @Get('expiration')
  getExpirationAnalytics() {
    return this.analyticsService.getExpirationAnalytics();
  }

  @RequirePermissions(Permission.VIEW_INVENTORY)
  @Get('type-distribution')
  getTypeDistribution() {
    return this.analyticsService.getTypeDistribution();
  }

  @RequirePermissions(Permission.VIEW_INVENTORY)
  @Get('shortage-predictions')
  getShortagePredictions(@Query('periodDays') periodDays = '7') {
    return this.analyticsService.getShortagePredictions(
      parseInt(periodDays, 10),
    );
  }

  @RequirePermissions(Permission.VIEW_INVENTORY)
  @Get('trends')
  getTrends(@Query('days') days = '14') {
    return this.analyticsService.getTrendAnalysis(parseInt(days, 10));
  }
}
