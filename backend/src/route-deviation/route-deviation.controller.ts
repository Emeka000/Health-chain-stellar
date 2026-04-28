import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';

import {
  AcknowledgeDeviationDto,
  CreatePlannedRouteDto,
  LocationUpdateDto,
} from './dto/route-deviation.dto';
import { RouteDeviationService } from './route-deviation.service';

@Controller('api/v1/route-deviation')
export class RouteDeviationController {
  constructor(private readonly service: RouteDeviationService) {}

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
}
