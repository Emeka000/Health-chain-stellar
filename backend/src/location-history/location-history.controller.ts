import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
} from '@nestjs/common';

import { Request } from 'express';

import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import { Permission } from '../auth/enums/permission.enum';

import {
  BatchSaveLocationsDto,
  LocationQueryDto,
  RouteQueryDto,
  SaveLocationDto,
} from './dto/location-history.dto';
import { LocationHistoryService } from './location-history.service';

@Controller('location-history')
export class LocationHistoryController {
  constructor(
    private readonly locationHistoryService: LocationHistoryService,
  ) {}

  /**
   * POST /location-history/riders/:riderId
   * Save a single location fix for a rider.
   */
  @RequirePermissions(Permission.RECORD_LOCATION)
  @Post('riders/:riderId')
  @HttpCode(HttpStatus.CREATED)
  saveLocation(
    @Param('riderId', ParseUUIDPipe) riderId: string,
    @Body() dto: SaveLocationDto,
  ) {
    return this.locationHistoryService.saveLocation(riderId, dto);
  }

  /**
   * POST /location-history/riders/:riderId/batch
   * Save up to 500 location fixes in one request.
   */
  @RequirePermissions(Permission.RECORD_LOCATION)
  @Post('riders/:riderId/batch')
  @HttpCode(HttpStatus.CREATED)
  batchSaveLocations(
    @Param('riderId', ParseUUIDPipe) riderId: string,
    @Body() dto: BatchSaveLocationsDto,
  ) {
    return this.locationHistoryService.batchSaveLocations(riderId, dto);
  }

  /**
   * GET /location-history/riders/:riderId
   * Query all location history for a rider (most recent first).
   */
  @RequirePermissions(Permission.VIEW_LOCATION_HISTORY)
  @Get('riders/:riderId')
  getLocationsByRider(
    @Param('riderId', ParseUUIDPipe) riderId: string,
    @Query() query: LocationQueryDto,
  ) {
    return this.locationHistoryService.getLocationsByRider(riderId, query);
  }

  /**
   * GET /location-history/deliveries/:orderId
   * Get all raw location points for a delivery, chronological.
   */
  @RequirePermissions(Permission.VIEW_LOCATION_HISTORY)
  @Get('deliveries/:orderId')
  getLocationsByDelivery(
    @Param('orderId', ParseUUIDPipe) orderId: string,
    @Query() query: LocationQueryDto,
  ) {
    return this.locationHistoryService.getLocationsByDelivery(orderId, query);
  }

  /**
   * GET /location-history/deliveries/:orderId/route
   * Reconstructed and Douglas-Peucker compressed route for a delivery.
   */
  @RequirePermissions(Permission.VIEW_LOCATION_HISTORY)
  @Get('deliveries/:orderId/route')
  reconstructRoute(
    @Param('orderId', ParseUUIDPipe) orderId: string,
    @Query() query: RouteQueryDto,
  ) {
    return this.locationHistoryService.reconstructRoute(orderId, query);
  }

  /**
   * GET /location-history/deliveries/:orderId/playback
   * Ordered points with derived speed and bearing for route playback.
   */
  @RequirePermissions(Permission.VIEW_LOCATION_HISTORY)
  @Get('deliveries/:orderId/playback')
  getPlaybackData(
    @Param('orderId', ParseUUIDPipe) orderId: string,
    @Query() query: LocationQueryDto,
  ) {
    return this.locationHistoryService.getPlaybackData(orderId, query);
  }

  /**
   * GET /location-history/deliveries/:orderId/visualization
   * GeoJSON LineString feature for map rendering.
   */
  @RequirePermissions(Permission.VIEW_LOCATION_HISTORY)
  @Get('deliveries/:orderId/visualization')
  getVisualizationData(
    @Param('orderId', ParseUUIDPipe) orderId: string,
    @Query() query: RouteQueryDto,
  ) {
    return this.locationHistoryService.getVisualizationData(orderId, query);
  }
}
