import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';

import {
  AcknowledgeDeviationDto,
  CreatePlannedRouteDto,
  LocationUpdateDto,
} from './dto/route-deviation.dto';
import { RouteDeviationService } from './route-deviation.service';
import { DeviationSeverity } from './entities/route-deviation-incident.entity';

@Controller('api/v1/route-deviation')
export class RouteDeviationController {
  constructor(private readonly service: RouteDeviationService) { }

  @Post('planned-routes')
  createPlannedRoute(@Body() dto: CreatePlannedRouteDto) {
    return this.service.createPlannedRoute(dto);
  }

  @Get('planned-routes/:orderId')
  getActivePlannedRoute(@Param('orderId') orderId: string) {
    return this.service.getActivePlannedRoute(orderId);
  }

  @Post('location-update')
  ingestLocation(@Body() dto: LocationUpdateDto) {
    return this.service.ingestLocationUpdate(dto);
  }

  @Get('incidents')
  findOpenIncidents() {
    return this.service.findOpenIncidents();
  }

  @Get('incidents/order/:orderId')
  findByOrder(@Param('orderId') orderId: string) {
    return this.service.findIncidentsByOrder(orderId);
  }

  @Patch('incidents/:id/acknowledge')
  acknowledge(@Param('id') id: string, @Body() dto: AcknowledgeDeviationDto) {
    return this.service.acknowledgeIncident(id, dto.userId);
  }

  @Patch('incidents/:id/resolve')
  resolve(@Param('id') id: string) {
    return this.service.resolveIncident(id);
  }

  @Post('incidents/:id/reclassify')
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
  validateClassification(
    @Param('id') id: string,
    @Body() body: { actualSeverity: DeviationSeverity },
  ) {
    return this.service.validateClassification(id, body.actualSeverity);
  }

  @Get('triage-statistics')
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
