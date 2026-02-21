import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Redis } from 'ioredis';
import { REDIS_CLIENT } from '../redis/redis.constants';

@Injectable()
export class MapsService {
  private readonly logger = new Logger(MapsService.name);
  private readonly cacheTtlSeconds = 300;

  constructor(
    private readonly configService: ConfigService,
    @Optional() @Inject(REDIS_CLIENT) private readonly redis?: Redis,
  ) {}

  private buildDistanceCacheKey(origin: string, destination: string): string {
    return `maps:distance-matrix:${encodeURIComponent(origin)}:${encodeURIComponent(destination)}`;
  }

  async getTravelTimeSeconds(origin: string, destination: string): Promise<number> {
    const cacheKey = this.buildDistanceCacheKey(origin, destination);
    const cached = await this.tryGetCachedDistance(cacheKey);
    if (cached !== null) {
      return cached;
    }

    const apiKey = this.configService.get<string>('GOOGLE_MAPS_API_KEY');
    if (!apiKey) {
      this.logger.warn(
        'GOOGLE_MAPS_API_KEY not set. Falling back to high travel time score.',
      );
      return Number.MAX_SAFE_INTEGER;
    }

    const url = new URL(
      'https://maps.googleapis.com/maps/api/distancematrix/json',
    );
    url.searchParams.set('origins', origin);
    url.searchParams.set('destinations', destination);
    url.searchParams.set('key', apiKey);

    const response = await fetch(url.toString());
    if (!response.ok) {
      throw new Error(`Distance Matrix API request failed: ${response.status}`);
    }

    const body = (await response.json()) as {
      status: string;
      rows?: Array<{
        elements?: Array<{ status: string; duration?: { value: number } }>;
      }>;
    };

    if (body.status !== 'OK') {
      throw new Error(`Distance Matrix API error: ${body.status}`);
    }

    const element = body.rows?.[0]?.elements?.[0];
    if (
      !element ||
      element.status !== 'OK' ||
      element.duration?.value === undefined
    ) {
      throw new Error(`Distance Matrix element error: ${element?.status ?? 'UNKNOWN'}`);
    }

    const travelTimeSeconds = element.duration.value;
    await this.trySetCachedDistance(cacheKey, travelTimeSeconds);
    return travelTimeSeconds;
  }

  private async tryGetCachedDistance(cacheKey: string): Promise<number | null> {
    if (!this.redis) {
      return null;
    }
    try {
      const cached = await this.redis.get(cacheKey);
      return cached ? Number(cached) : null;
    } catch (error) {
      this.logger.warn(`Distance cache read failed for key ${cacheKey}: ${String(error)}`);
      return null;
    }
  }

  private async trySetCachedDistance(
    cacheKey: string,
    travelTimeSeconds: number,
  ): Promise<void> {
    if (!this.redis) {
      return;
    }
    try {
      await this.redis.setex(
        cacheKey,
        this.cacheTtlSeconds,
        String(travelTimeSeconds),
      );
    } catch (error) {
      this.logger.warn(`Distance cache write failed for key ${cacheKey}: ${String(error)}`);
    }
  }

  async getDirections(
    originLat: number,
    originLng: number,
    destLat: number,
    destLng: number,
  ) {
    // TODO: Implement get directions logic using Google Maps API or similar
    return {
      message: 'Directions retrieved successfully',
      data: {
        origin: { lat: originLat, lng: originLng },
        destination: { lat: destLat, lng: destLng },
        distance: 0,
        duration: 0,
        steps: [],
      },
    };
  }

  async calculateDistance(
    originLat: number,
    originLng: number,
    destLat: number,
    destLng: number,
  ) {
    // TODO: Implement calculate distance logic
    return {
      message: 'Distance calculated successfully',
      data: {
        distance: 0,
        unit: 'km',
      },
    };
  }

  async geocodeAddress(address: string) {
    // TODO: Implement geocode address logic
    return {
      message: 'Address geocoded successfully',
      data: {
        address,
        latitude: 0,
        longitude: 0,
      },
    };
  }

  async reverseGeocode(latitude: number, longitude: number) {
    // TODO: Implement reverse geocode logic
    return {
      message: 'Coordinates reverse geocoded successfully',
      data: {
        address: 'Unknown Address',
        latitude,
        longitude,
      },
    };
  }

  async searchPlaces(query: string, location?: { lat: number; lng: number }) {
    // TODO: Implement search places logic
    return {
      message: 'Places retrieved successfully',
      data: [],
    };
  }

  async getPlaceDetails(placeId: string) {
    // TODO: Implement get place details logic
    return {
      message: 'Place details retrieved successfully',
      data: { placeId },
    };
  }
}
