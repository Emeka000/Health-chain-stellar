import { Controller, Get, Post, Body, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';

import { RequirePermissions } from '../../auth/decorators/require-permissions.decorator';
import { Permission } from '../../auth/enums/permission.enum';
import { RouteRequestDto, MultiStopRouteDto } from '../dto/route-planning.dto';
import { RoutePlanningService } from '../services/route-planning.service';

@ApiTags('Maps')
@ApiBearerAuth()
@Controller('routes')
export class RoutePlanningController {
  constructor(private readonly routePlanningService: RoutePlanningService) {}

  @RequirePermissions(Permission.VIEW_MAPS)
  @ApiOperation({ summary: 'Post calculate' })
  @ApiResponse({ status: 201, description: 'Resource created successfully' })
  @Post('calculate')
  async calculateRoute(@Body() routeDto: RouteRequestDto) {
    return this.routePlanningService.calculateRoute(routeDto);
  }

  @RequirePermissions(Permission.VIEW_MAPS)
  @ApiOperation({ summary: 'Post multi stop' })
  @ApiResponse({ status: 201, description: 'Resource created successfully' })
  @Post('multi-stop')
  async calculateMultiStopRoute(@Body() multiStopDto: MultiStopRouteDto) {
    return this.routePlanningService.calculateMultiStopRoute(multiStopDto);
  }

  @RequirePermissions(Permission.VIEW_MAPS)
  @ApiOperation({ summary: 'Get eta' })
  @ApiResponse({ status: 200, description: 'Resource retrieved successfully' })
  @Get('eta')
  async calculateETA(
    @Query('originLat') originLat: string,
    @Query('originLng') originLng: string,
    @Query('destLat') destLat: string,
    @Query('destLng') destLng: string,
    @Query('departureTime') departureTime?: string,
  ) {
    const departure = departureTime ? new Date(departureTime) : undefined;
    return this.routePlanningService.calculateETA(
      parseFloat(originLat),
      parseFloat(originLng),
      parseFloat(destLat),
      parseFloat(destLng),
      departure,
    );
  }

  @RequirePermissions(Permission.VIEW_MAPS)
  @ApiOperation({ summary: 'Post alternatives' })
  @ApiResponse({ status: 201, description: 'Resource created successfully' })
  @Post('alternatives')
  async getAlternativeRoutes(@Body() routeDto: RouteRequestDto) {
    return this.routePlanningService.getAlternativeRoutes(routeDto);
  }

  @RequirePermissions(Permission.VIEW_MAPS)
  @ApiOperation({ summary: 'Get decode polyline' })
  @ApiResponse({ status: 200, description: 'Resource retrieved successfully' })
  @Get('decode-polyline')
  async decodePolyline(@Query('polyline') polyline: string) {
    const points = this.routePlanningService.decodePolyline(polyline);
    return {
      message: 'Polyline decoded successfully',
      data: points,
    };
  }

  @RequirePermissions(Permission.VIEW_MAPS)
  @ApiOperation({ summary: 'Get statistics' })
  @ApiResponse({ status: 200, description: 'Resource retrieved successfully' })
  @Get('statistics')
  async getRouteStatistics(@Query() routeDto: RouteRequestDto) {
    const response = await this.routePlanningService.calculateRoute(routeDto);
    const statistics = this.routePlanningService.getRouteStatistics(
      response.data.route,
    );
    return {
      message: 'Route statistics retrieved successfully',
      data: statistics,
    };
  }
}
