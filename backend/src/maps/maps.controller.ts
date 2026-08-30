import { Controller, Get, Post, Body, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';

import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import { Permission } from '../auth/enums/permission.enum';

import { MapsService } from './maps.service';

@ApiTags('Maps')
@ApiBearerAuth()
@Controller('maps')
export class MapsController {
  constructor(private readonly mapsService: MapsService) {}

  @RequirePermissions(Permission.VIEW_MAPS)
  @ApiOperation({ summary: 'Get directions' })
  @ApiResponse({ status: 200, description: 'Resource retrieved successfully' })
  @Get('directions')
  getDirections(
    @Query('originLat') originLat: string,
    @Query('originLng') originLng: string,
    @Query('destLat') destLat: string,
    @Query('destLng') destLng: string,
  ) {
    return this.mapsService.getDirections(
      parseFloat(originLat),
      parseFloat(originLng),
      parseFloat(destLat),
      parseFloat(destLng),
    );
  }

  @RequirePermissions(Permission.VIEW_MAPS)
  @ApiOperation({ summary: 'Get distance' })
  @ApiResponse({ status: 200, description: 'Resource retrieved successfully' })
  @Get('distance')
  calculateDistance(
    @Query('originLat') originLat: string,
    @Query('originLng') originLng: string,
    @Query('destLat') destLat: string,
    @Query('destLng') destLng: string,
  ) {
    return this.mapsService.calculateDistance(
      parseFloat(originLat),
      parseFloat(originLng),
      parseFloat(destLat),
      parseFloat(destLng),
    );
  }

  @RequirePermissions(Permission.VIEW_MAPS)
  @ApiOperation({ summary: 'Post geocode' })
  @ApiResponse({ status: 201, description: 'Resource created successfully' })
  @Post('geocode')
  geocodeAddress(@Body('address') address: string) {
    return this.mapsService.geocodeAddress(address);
  }

  @RequirePermissions(Permission.VIEW_MAPS)
  @ApiOperation({ summary: 'Get reverse geocode' })
  @ApiResponse({ status: 200, description: 'Resource retrieved successfully' })
  @Get('reverse-geocode')
  reverseGeocode(
    @Query('latitude') latitude: string,
    @Query('longitude') longitude: string,
  ) {
    return this.mapsService.reverseGeocode(
      parseFloat(latitude),
      parseFloat(longitude),
    );
  }

  @RequirePermissions(Permission.VIEW_MAPS)
  @ApiOperation({ summary: 'Get search' })
  @ApiResponse({ status: 200, description: 'Resource retrieved successfully' })
  @Get('search')
  searchPlaces(
    @Query('query') query: string,
    @Query('lat') lat?: string,
    @Query('lng') lng?: string,
  ) {
    const location =
      lat && lng ? { lat: parseFloat(lat), lng: parseFloat(lng) } : undefined;
    return this.mapsService.searchPlaces(query, location);
  }

  @RequirePermissions(Permission.VIEW_MAPS)
  @ApiOperation({ summary: 'Get place details' })
  @ApiResponse({ status: 200, description: 'Resource retrieved successfully' })
  @Get('place-details')
  getPlaceDetails(@Query('placeId') placeId: string) {
    return this.mapsService.getPlaceDetails(placeId);
  }
}
