import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';

import { RequirePermissions } from '../../auth/decorators/require-permissions.decorator';
import { Permission } from '../../auth/enums/permission.enum';
import { InventoryAnalyticsService } from '../inventory-analytics.service';

@ApiTags('Inventory')
@ApiBearerAuth()
@Controller('inventory/analytics')
export class InventoryAnalyticsController {
  constructor(private readonly analyticsService: InventoryAnalyticsService) {}

  @RequirePermissions(Permission.VIEW_INVENTORY)
  @ApiOperation({ summary: 'Get snapshot' })
  @ApiResponse({ status: 200, description: 'Resource retrieved successfully' })
  @Get('snapshot')
  getSnapshot() {
    return this.analyticsService.getSnapshot();
  }

  @RequirePermissions(Permission.VIEW_INVENTORY)
  @ApiOperation({ summary: 'Get turnover' })
  @ApiResponse({ status: 200, description: 'Resource retrieved successfully' })
  @Get('turnover')
  getTurnoverRates(@Query('periodDays') periodDays = '30') {
    return this.analyticsService.getTurnoverRates(parseInt(periodDays, 10));
  }

  @RequirePermissions(Permission.VIEW_INVENTORY)
  @ApiOperation({ summary: 'Get wastage' })
  @ApiResponse({ status: 200, description: 'Resource retrieved successfully' })
  @Get('wastage')
  getWastage(@Query('periodDays') periodDays = '30') {
    return this.analyticsService.getWastageTracking(parseInt(periodDays, 10));
  }

  @RequirePermissions(Permission.VIEW_INVENTORY)
  @ApiOperation({ summary: 'Get expiration' })
  @ApiResponse({ status: 200, description: 'Resource retrieved successfully' })
  @Get('expiration')
  getExpirationAnalytics() {
    return this.analyticsService.getExpirationAnalytics();
  }

  @RequirePermissions(Permission.VIEW_INVENTORY)
  @ApiOperation({ summary: 'Get type distribution' })
  @ApiResponse({ status: 200, description: 'Resource retrieved successfully' })
  @Get('type-distribution')
  getTypeDistribution() {
    return this.analyticsService.getTypeDistribution();
  }

  @RequirePermissions(Permission.VIEW_INVENTORY)
  @ApiOperation({ summary: 'Get shortage predictions' })
  @ApiResponse({ status: 200, description: 'Resource retrieved successfully' })
  @Get('shortage-predictions')
  getShortagePredictions(@Query('periodDays') periodDays = '7') {
    return this.analyticsService.getShortagePredictions(
      parseInt(periodDays, 10),
    );
  }

  @RequirePermissions(Permission.VIEW_INVENTORY)
  @ApiOperation({ summary: 'Get trends' })
  @ApiResponse({ status: 200, description: 'Resource retrieved successfully' })
  @Get('trends')
  getTrends(@Query('days') days = '14') {
    return this.analyticsService.getTrendAnalysis(parseInt(days, 10));
  }
}
