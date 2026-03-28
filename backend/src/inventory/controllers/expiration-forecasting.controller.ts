import { Controller, Get, Query } from '@nestjs/common';

import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import { Permission } from '../auth/enums/permission.enum';

import { ExpirationForecastingService } from './expiration-forecasting.service';

@Controller('inventory/expiration')
export class ExpirationForecastingController {
  constructor(private readonly service: ExpirationForecastingService) {}

  @Get('forecast')
  @RequirePermissions(Permission.VIEW_INVENTORY)
  getForecast(@Query('horizonHours') horizonHours?: string) {
    return this.service.getExpirationForecast(
      horizonHours ? Number(horizonHours) : 72,
    );
  }

  @Get('rebalancing')
  @RequirePermissions(Permission.VIEW_INVENTORY)
  getRebalancing() {
    return this.service.getRebalancingRecommendations();
  }
}
