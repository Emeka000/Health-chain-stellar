import { Controller, Get, Post, Body, Query } from '@nestjs/common';
import { MapsService } from './maps.service';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import { Permission } from '../auth/enums/permission.enum';

@Controller('maps')
export class MapsController {
  constructor(private readonly mapsService: MapsService) {}

  @RequirePermissions(Permission.VIEW_MAPS)
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
  @Post('geocode')
  geocodeAddress(@Body('address') address: string) {
    return this.mapsService.geocodeAddress(address);
  }

  @RequirePermissions(Permission.VIEW_MAPS)
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
  @Get('place-details')
  getPlaceDetails(@Query('placeId') placeId: string) {
    return this.mapsService.getPlaceDetails(placeId);
  }
}
