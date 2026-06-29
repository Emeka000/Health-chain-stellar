import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';

import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import { Permission } from '../auth/enums/permission.enum';

import { ExpirationForecastingService } from './expiration-forecasting.service';

@ApiTags('Inventory')
@ApiBearerAuth()
@Controller('inventory/expiration')
export class ExpirationForecastingController {
  constructor(private readonly service: ExpirationForecastingService) {}

  @ApiOperation({ summary: 'Get forecast' })
  @ApiResponse({ status: 200, description: 'Resource retrieved successfully' })
  @Get('forecast')
  @RequirePermissions(Permission.VIEW_INVENTORY)
  getForecast(@Query('horizonHours') horizonHours?: string) {
    return this.service.getExpirationForecast(
      horizonHours ? Number(horizonHours) : 72,
    );
  }

  @ApiOperation({ summary: 'Get rebalancing' })
  @ApiResponse({ status: 200, description: 'Resource retrieved successfully' })
  @Get('rebalancing')
  @RequirePermissions(Permission.VIEW_INVENTORY)
  getRebalancing() {
    return this.service.getRebalancingRecommendations();
  }
}
