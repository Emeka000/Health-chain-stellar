import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';

import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import { Permission } from '../auth/enums/permission.enum';

import {
  AcknowledgeDeviationDto,
  CreatePlannedRouteDto,
  LocationUpdateDto,
} from './dto/route-deviation.dto';
import { RouteDeviationService } from './route-deviation.service';
import { DeviationSeverity } from './entities/route-deviation-incident.entity';

@ApiTags('Route Deviation')
@ApiBearerAuth()
@Controller('api/v1/route-deviation')
export class RouteDeviationController {
  constructor(private readonly service: RouteDeviationService) { }

  @ApiOperation({ summary: 'Create a planned route for an order' })
  @ApiResponse({ status: 201, description: 'Planned route created' })
  @Post('planned-routes')
  @RequirePermissions(Permission.MANAGE_DISPATCH)
  createPlannedRoute(@Body() dto: CreatePlannedRouteDto) {
    return this.service.createPlannedRoute(dto);
  }

  @Get('planned-routes/:orderId')
  @RequirePermissions(Permission.VIEW_DISPATCH)
  getActivePlannedRoute(@Param('orderId') orderId: string) {
    return this.service.getActivePlannedRoute(orderId);
  }

  @Post('location-update')
  @RequirePermissions(Permission.RECORD_LOCATION)
  ingestLocation(@Body() dto: LocationUpdateDto) {
    return this.service.ingestLocationUpdate(dto);
  }

  @Get('incidents')
  @RequirePermissions(Permission.VIEW_DISPATCH)
  findOpenIncidents() {
    return this.service.findOpenIncidents();
  }

  @Get('incidents/order/:orderId')
  @RequirePermissions(Permission.VIEW_DISPATCH)
  findByOrder(@Param('orderId') orderId: string) {
    return this.service.findIncidentsByOrder(orderId);
  }

  @Patch('incidents/:id/acknowledge')
  @RequirePermissions(Permission.MANAGE_DISPATCH)
  acknowledge(@Param('id') id: string, @Body() dto: AcknowledgeDeviationDto) {
    return this.service.acknowledgeIncident(id, dto.userId);
  }

  @Patch('incidents/:id/resolve')
  @RequirePermissions(Permission.MANAGE_DISPATCH)
  resolve(@Param('id') id: string) {
    return this.service.resolveIncident(id);
  }

  @Post('incidents/:id/reclassify')
  @RequirePermissions(Permission.MANAGE_DISPATCH)
  reclassifyDeviation(
    @Param('id') id: string,
    @Body()
    context: {
      orderPriority?: 'CRITICAL' | 'URGENT' | 'STANDARD';
      hasColdChainRequirement?: boolean;
      currentTemperature?: number;
      temperatureThreshold?: number;
      trafficCondition?: 'CLEAR' | 'MODERATE' | 'HEAVY' | 'UNKNOWN';
      trafficDelayMinutes?: number;
      riderReliabilityScore?: number;
    },
  ) {
    return this.service.reclassifyDeviation(id, context);
  }

  @Post('incidents/:id/override-severity')
  @RequirePermissions(Permission.DISPATCH_OVERRIDE)
  overrideSeverity(
    @Param('id') id: string,
    @Body()
    body: {
      newSeverity: DeviationSeverity;
      operatorId: string;
      rationale: string;
    },
  ) {
    return this.service.overrideSeverity(
      id,
      body.newSeverity,
      body.operatorId,
      body.rationale,
    );
  }

  @Post('incidents/:id/validate-classification')
  @RequirePermissions(Permission.MANAGE_DISPATCH)
  validateClassification(
    @Param('id') id: string,
    @Body() body: { actualSeverity: DeviationSeverity },
  ) {
    return this.service.validateClassification(id, body.actualSeverity);
  }

  @Get('triage-statistics')
  @RequirePermissions(Permission.VIEW_DISPATCH)
  getTriageStatistics(
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    return this.service.getTriageStatistics({
      startDate: startDate ? new Date(startDate) : undefined,
      endDate: endDate ? new Date(endDate) : undefined,
    });
  }
}
