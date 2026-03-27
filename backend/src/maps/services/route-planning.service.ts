import { Injectable, Logger, Inject } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { Redis } from 'ioredis';

import { REDIS_CLIENT } from '../../redis/redis.constants';
import {
  RouteRequestDto,
  MultiStopRouteDto,
  WaypointDto,
  RouteInfo,
  RouteStep,
  RouteResponse,
  MultiStopRouteResponse,
  ETAResponse,
} from '../dto/route-planning.dto';

@Injectable()
export class RoutePlanningService {
  private readonly logger = new Logger(RoutePlanningService.name);
  private readonly cacheTtlSeconds = 300; // 5 minutes

  constructor(
    private readonly configService: ConfigService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  /**
   * Calculate a single route with optional waypoints
   */
  async calculateRoute(routeDto: RouteRequestDto): Promise<RouteResponse> {
    const {
      originLat,
      originLng,
      destLat,
      destLng,
      waypoints,
      avoidTolls,
      avoidHighways,
      optimizeWaypoints,
      travelMode,
      provideAlternatives,
    } = routeDto;

    // Build cache key
    const cacheKey = this.buildRouteCacheKey(routeDto);
    const cached = await this.tryGetCachedRoute(cacheKey);
    if (cached) {
      return cached;
    }

    // Build Google Maps Directions API URL
    const url = new URL('https://maps.googleapis.com/maps/api/directions/json');

    const origin = `${originLat},${originLng}`;
    const destination = `${destLat},${destLng}`;
    url.searchParams.set('origin', origin);
    url.searchParams.set('destination', destination);

    // Add waypoints if provided
    if (waypoints && waypoints.length > 0) {
      const waypointStr = waypoints
        .map((wp) => `${wp.latitude},${wp.longitude}`)
        .join('|');
      url.searchParams.set('waypoints', waypointStr);
    }

    // Add options
    if (avoidTolls) {
      url.searchParams.set('avoid', 'tolls');
    }
    if (avoidHighways) {
      const existingAvoid = url.searchParams.get('avoid');
      url.searchParams.set(
        'avoid',
        existingAvoid ? `${existingAvoid}|highways` : 'highways',
      );
    }

    // Optimize waypoints if requested
    if (optimizeWaypoints && waypoints && waypoints.length > 0) {
      url.searchParams.set('optimize', 'true');
    }

    // Set travel mode
    url.searchParams.set('mode', travelMode || 'driving');

    // Request alternatives if needed
    if (provideAlternatives) {
      url.searchParams.set('alternatives', 'true');
    }

    // Add API key
    const apiKey = this.configService.get<string>('GOOGLE_MAPS_API_KEY');
    url.searchParams.set('key', apiKey);

    // Make API request
    const response = await fetch(url.toString());
    if (!response.ok) {
      throw new Error(`Directions API request failed: ${response.status}`);
    }

    const body = await response.json();

    if (body.status !== 'OK') {
      throw new Error(`Directions API error: ${body.status}`);
    }

    // Parse primary route
    const primaryRoute = body.routes[0];
    const route = this.parseRoute(primaryRoute);

    // Parse alternatives if requested
    let alternatives: RouteInfo[] | undefined;
    if (provideAlternatives && body.routes.length > 1) {
      alternatives = body.routes.slice(1).map((r: any) => this.parseRoute(r));
    }

    // Extract waypoint order if optimized
    let optimizedOrder: number[] | undefined;
    if (optimizeWaypoints && primaryRoute.waypoint_order) {
      optimizedOrder = primaryRoute.waypoint_order;
    }

    const result: RouteResponse = {
      message: 'Route calculated successfully',
      data: {
        route,
        alternatives,
        waypoints,
        optimizedOrder,
      },
    };

    // Cache the result
    await this.trySetCachedRoute(cacheKey, result);

    return result;
  }

  /**
   * Calculate multi-stop route with optional optimization
   */
  async calculateMultiStopRoute(
    multiStopDto: MultiStopRouteDto,
  ): Promise<MultiStopRouteResponse> {
    const { stops, optimizeOrder, returnToStart, travelMode } = multiStopDto;

    if (stops.length < 2) {
      throw new Error('At least 2 stops are required for multi-stop route');
    }

    // If optimization is requested, use traveling salesman algorithm
    if (optimizeOrder && stops.length > 2) {
      const optimizedStops = await this.optimizeStopOrder(stops, returnToStart);
      return this.calculateRouteForStops(optimizedStops, travelMode, true);
    }

    // Otherwise, calculate route in given order
    const allStops = returnToStart ? [...stops, stops[0]] : stops;
    return this.calculateRouteForStops(allStops, travelMode, false);
  }

  /**
   * Calculate ETA for a route
   */
  async calculateETA(
    originLat: number,
    originLng: number,
    destLat: number,
    destLng: number,
    departureTime?: Date,
  ): Promise<ETAResponse> {
    const url = new URL('https://maps.googleapis.com/maps/api/directions/json');

    const origin = `${originLat},${originLng}`;
    const destination = `${destLat},${destLng}`;
    url.searchParams.set('origin', origin);
    url.searchParams.set('destination', destination);
    url.searchParams.set('mode', 'driving');

    // Add departure time for traffic-aware ETA
    if (departureTime) {
      url.searchParams.set(
        'departure_time',
        Math.floor(departureTime.getTime() / 1000).toString(),
      );
    } else {
      url.searchParams.set('departure_time', 'now');
    }

    const apiKey = this.configService.get<string>('GOOGLE_MAPS_API_KEY');
    url.searchParams.set('key', apiKey);

    const response = await fetch(url.toString());
    if (!response.ok) {
      throw new Error(`Directions API request failed: ${response.status}`);
    }

    const body = await response.json();

    if (body.status !== 'OK') {
      throw new Error(`Directions API error: ${body.status}`);
    }

    const route = body.routes[0];
    const leg = route.legs[0];

    const durationSeconds = leg.duration.value;
    const durationInTrafficSeconds = leg.duration_in_traffic?.value;
    const distanceMeters = leg.distance.value;

    // Calculate ETA
    const now = departureTime || new Date();
    const eta = new Date(now.getTime() + durationInTrafficSeconds * 1000);

    return {
      message: 'ETA calculated successfully',
      data: {
        eta: eta.toISOString(),
        durationSeconds,
        durationInTrafficSeconds,
        distanceMeters,
      },
    };
  }

  /**
   * Get alternative routes
   */
  async getAlternativeRoutes(
    routeDto: RouteRequestDto,
  ): Promise<RouteResponse> {
    return this.calculateRoute({
      ...routeDto,
      provideAlternatives: true,
    });
  }

  /**
   * Calculate route for multiple stops
   */
  private async calculateRouteForStops(
    stops: WaypointDto[],
    travelMode: string,
    isOptimized: boolean,
  ): Promise<MultiStopRouteResponse> {
    const routes: RouteInfo[] = [];
    let totalDistanceMeters = 0;
    let totalDurationSeconds = 0;

    // Calculate route between each consecutive pair of stops
    for (let i = 0; i < stops.length - 1; i++) {
      const origin = stops[i];
      const dest = stops[i + 1];

      const routeDto: RouteRequestDto = {
        originLat: origin.latitude,
        originLng: origin.longitude,
        destLat: dest.latitude,
        destLng: dest.longitude,
        travelMode: travelMode as any,
      };

      const response = await this.calculateRoute(routeDto);
      routes.push(response.data.route);

      totalDistanceMeters += response.data.route.distanceMeters;
      totalDurationSeconds += response.data.route.durationSeconds;

      // Add dwell time at stop
      if (origin.停留时间秒) {
        totalDurationSeconds += origin.停留时间秒;
      }
    }

    return {
      message: 'Multi-stop route calculated successfully',
      data: {
        routes,
        totalDistanceMeters,
        totalDurationSeconds,
        optimizedOrder: isOptimized
          ? stops.map((_, i) => i)
          : stops.map((_, i) => i),
        stops,
      },
    };
  }

  /**
   * Optimize stop order using nearest neighbor heuristic (TSP approximation)
   */
  private async optimizeStopOrder(
    stops: WaypointDto[],
    returnToStart: boolean,
  ): Promise<WaypointDto[]> {
    if (stops.length <= 2) {
      return stops;
    }

    // Use nearest neighbor heuristic for TSP
    const unvisited = [...stops];
    const optimized: WaypointDto[] = [];
    let current = unvisited.shift()!;
    optimized.push(current);

    while (unvisited.length > 0) {
      let nearestIndex = 0;
      let nearestDistance = Infinity;

      for (let i = 0; i < unvisited.length; i++) {
        const distance = this.calculateHaversineDistance(
          current.latitude,
          current.longitude,
          unvisited[i].latitude,
          unvisited[i].longitude,
        );

        if (distance < nearestDistance) {
          nearestDistance = distance;
          nearestIndex = i;
        }
      }

      current = unvisited.splice(nearestIndex, 1)[0];
      optimized.push(current);
    }

    // If return to start is requested, add the first stop at the end
    if (returnToStart) {
      optimized.push(optimized[0]);
    }

    return optimized;
  }

  /**
   * Calculate Haversine distance between two points
   */
  private calculateHaversineDistance(
    lat1: number,
    lon1: number,
    lat2: number,
    lon2: number,
  ): number {
    const R = 6371; // Earth's radius in km
    const dLat = this.toRad(lat2 - lat1);
    const dLon = this.toRad(lon2 - lon1);
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(this.toRad(lat1)) *
        Math.cos(this.toRad(lat2)) *
        Math.sin(dLon / 2) *
        Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  }

  /**
   * Convert degrees to radians
   */
  private toRad(deg: number): number {
    return deg * (Math.PI / 180);
  }

  /**
   * Parse route from Google Maps API response
   */
  private parseRoute(route: any): RouteInfo {
    const leg = route.legs[0];

    const steps: RouteStep[] = leg.steps.map((step: any) => ({
      instruction: step.html_instructions,
      distanceMeters: step.distance.value,
      durationSeconds: step.duration.value,
      startLocation: {
        latitude: step.start_location.lat,
        longitude: step.start_location.lng,
      },
      endLocation: {
        latitude: step.end_location.lat,
        longitude: step.end_location.lng,
      },
      maneuver: step.maneuver || '',
    }));

    return {
      distanceMeters: leg.distance.value,
      durationSeconds: leg.duration.value,
      durationInTrafficSeconds: leg.duration_in_traffic?.value,
      startLocation: {
        latitude: leg.start_location.lat,
        longitude: leg.start_location.lng,
      },
      endLocation: {
        latitude: leg.end_location.lat,
        longitude: leg.end_location.lng,
      },
      steps,
      polyline: route.overview_polyline.points,
      bounds: {
        northeast: {
          latitude: route.bounds.northeast.lat,
          longitude: route.bounds.northeast.lng,
        },
        southwest: {
          latitude: route.bounds.southwest.lat,
          longitude: route.bounds.southwest.lng,
        },
      },
    };
  }

  /**
   * Build cache key for route
   */
  private buildRouteCacheKey(routeDto: RouteRequestDto): string {
    const {
      originLat,
      originLng,
      destLat,
      destLng,
      waypoints,
      avoidTolls,
      avoidHighways,
      optimizeWaypoints,
      travelMode,
    } = routeDto;

    const waypointStr =
      waypoints?.map((wp) => `${wp.latitude},${wp.longitude}`).join('|') || '';

    return `route:${originLat},${originLng}:${destLat},${destLng}:${waypointStr}:${avoidTolls}:${avoidHighways}:${optimizeWaypoints}:${travelMode}`;
  }

  /**
   * Try to get cached route
   */
  private async tryGetCachedRoute(
    cacheKey: string,
  ): Promise<RouteResponse | null> {
    try {
      const cached = await this.redis.get(cacheKey);
      return cached ? JSON.parse(cached) : null;
    } catch (error) {
      this.logger.warn(`Route cache read failed: ${String(error)}`);
      return null;
    }
  }

  /**
   * Try to set cached route
   */
  private async trySetCachedRoute(
    cacheKey: string,
    route: RouteResponse,
  ): Promise<void> {
    try {
      await this.redis.setex(
        cacheKey,
        this.cacheTtlSeconds,
        JSON.stringify(route),
      );
    } catch (error) {
      this.logger.warn(`Route cache write failed: ${String(error)}`);
    }
  }

  /**
   * Decode polyline string to coordinates
   */
  decodePolyline(
    encoded: string,
  ): Array<{ latitude: number; longitude: number }> {
    const points: Array<{ latitude: number; longitude: number }> = [];
    let index = 0;
    let lat = 0;
    let lng = 0;

    while (index < encoded.length) {
      let b: number;
      let shift = 0;
      let result = 0;

      do {
        b = encoded.charCodeAt(index++) - 63;
        result |= (b & 0x1f) << shift;
        shift += 5;
      } while (b >= 0x20);

      const dlat = result & 1 ? ~(result >> 1) : result >> 1;
      lat += dlat;

      shift = 0;
      result = 0;

      do {
        b = encoded.charCodeAt(index++) - 63;
        result |= (b & 0x1f) << shift;
        shift += 5;
      } while (b >= 0x20);

      const dlng = result & 1 ? ~(result >> 1) : result >> 1;
      lng += dlng;

      points.push({
        latitude: lat * 1e-5,
        longitude: lng * 1e-5,
      });
    }

    return points;
  }

  /**
   * Get route statistics
   */
  getRouteStatistics(route: RouteInfo): {
    totalDistanceKm: number;
    totalDurationMinutes: number;
    averageSpeedKmh: number;
    stepCount: number;
  } {
    const totalDistanceKm = route.distanceMeters / 1000;
    const totalDurationMinutes = route.durationSeconds / 60;
    const averageSpeedKmh =
      totalDurationMinutes > 0
        ? (totalDistanceKm / totalDurationMinutes) * 60
        : 0;

    return {
      totalDistanceKm: Math.round(totalDistanceKm * 100) / 100,
      totalDurationMinutes: Math.round(totalDurationMinutes * 100) / 100,
      averageSpeedKmh: Math.round(averageSpeedKmh * 100) / 100,
      stepCount: route.steps.length,
    };
  }
}
