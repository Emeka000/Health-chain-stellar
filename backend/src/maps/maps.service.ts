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

  async getTravelTimeSeconds(
    origin: string,
    destination: string,
  ): Promise<number> {
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
      throw new Error(
        `Distance Matrix element error: ${element?.status ?? 'UNKNOWN'}`,
      );
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
      this.logger.warn(
        `Distance cache read failed for key ${cacheKey}: ${String(error)}`,
      );
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
      this.logger.warn(
        `Distance cache write failed for key ${cacheKey}: ${String(error)}`,
      );
    }
  }

  private getApiKey(): string | undefined {
    return this.configService.get<string>('GOOGLE_MAPS_API_KEY');
  }

  private async fetchWithRetry(
    url: string,
    retries = 3,
  ): Promise<Response> {
    let lastError: Error | undefined;
    for (let attempt = 0; attempt < retries; attempt++) {
      try {
        const response = await fetch(url);
        if (response.status === 429) {
          // Rate limited — back off before retry
          await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
          continue;
        }
        return response;
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        if (attempt < retries - 1) {
          await new Promise((r) => setTimeout(r, 300 * (attempt + 1)));
        }
      }
    }
    throw lastError ?? new Error('Request failed after retries');
  }

  async getDirections(
    originLat: number,
    originLng: number,
    destLat: number,
    destLng: number,
  ) {
    const apiKey = this.getApiKey();
    if (!apiKey) {
      this.logger.warn('GOOGLE_MAPS_API_KEY not set; returning empty directions');
      return {
        message: 'Directions unavailable (provider not configured)',
        data: { origin: { lat: originLat, lng: originLng }, destination: { lat: destLat, lng: destLng }, distance: 0, duration: 0, steps: [] },
      };
    }

    const url = new URL('https://maps.googleapis.com/maps/api/directions/json');
    url.searchParams.set('origin', `${originLat},${originLng}`);
    url.searchParams.set('destination', `${destLat},${destLng}`);
    url.searchParams.set('key', apiKey);

    const response = await this.fetchWithRetry(url.toString());
    if (!response.ok) throw new Error(`Directions API error: ${response.status}`);

    const body = (await response.json()) as {
      status: string;
      routes?: Array<{
        legs: Array<{
          distance: { value: number; text: string };
          duration: { value: number; text: string };
          steps: Array<{ html_instructions: string; distance: { value: number }; duration: { value: number } }>;
        }>;
      }>;
    };

    if (body.status !== 'OK') throw new Error(`Directions API status: ${body.status}`);

    const leg = body.routes![0].legs[0];
    return {
      message: 'Directions retrieved successfully',
      data: {
        origin: { lat: originLat, lng: originLng },
        destination: { lat: destLat, lng: destLng },
        distance: leg.distance.value,
        distanceText: leg.distance.text,
        duration: leg.duration.value,
        durationText: leg.duration.text,
        steps: leg.steps.map((s) => ({
          instruction: s.html_instructions,
          distanceMeters: s.distance.value,
          durationSeconds: s.duration.value,
        })),
      },
    };
  }

  async calculateDistance(
    originLat: number,
    originLng: number,
    destLat: number,
    destLng: number,
  ) {
    const cacheKey = this.buildDistanceCacheKey(
      `${originLat},${originLng}`,
      `${destLat},${destLng}`,
    );
    const cached = await this.tryGetCachedDistance(cacheKey);
    if (cached !== null) {
      return { message: 'Distance calculated successfully', data: { distance: cached / 1000, unit: 'km', cached: true } };
    }

    const apiKey = this.getApiKey();
    if (!apiKey) {
      this.logger.warn('GOOGLE_MAPS_API_KEY not set; using Haversine fallback');
      const distKm = this.haversineKm(originLat, originLng, destLat, destLng);
      return { message: 'Distance calculated successfully (Haversine fallback)', data: { distance: distKm, unit: 'km' } };
    }

    const url = new URL('https://maps.googleapis.com/maps/api/distancematrix/json');
    url.searchParams.set('origins', `${originLat},${originLng}`);
    url.searchParams.set('destinations', `${destLat},${destLng}`);
    url.searchParams.set('key', apiKey);

    const response = await this.fetchWithRetry(url.toString());
    if (!response.ok) throw new Error(`Distance Matrix API error: ${response.status}`);

    const body = (await response.json()) as {
      status: string;
      rows?: Array<{ elements?: Array<{ status: string; distance?: { value: number; text: string } }> }>;
    };

    if (body.status !== 'OK') throw new Error(`Distance Matrix status: ${body.status}`);

    const element = body.rows?.[0]?.elements?.[0];
    if (!element || element.status !== 'OK' || !element.distance) {
      throw new Error(`Distance Matrix element error: ${element?.status ?? 'UNKNOWN'}`);
    }

    await this.trySetCachedDistance(cacheKey, element.distance.value);
    return {
      message: 'Distance calculated successfully',
      data: { distance: element.distance.value / 1000, distanceText: element.distance.text, unit: 'km' },
    };
  }

  async geocodeAddress(address: string) {
    const cacheKey = `maps:geocode:${encodeURIComponent(address)}`;
    if (this.redis) {
      try {
        const cached = await this.redis.get(cacheKey);
        if (cached) return JSON.parse(cached);
      } catch { /* cache miss */ }
    }

    const apiKey = this.getApiKey();
    if (!apiKey) {
      this.logger.warn('GOOGLE_MAPS_API_KEY not set; geocoding unavailable');
      return { message: 'Geocoding unavailable (provider not configured)', data: { address, latitude: 0, longitude: 0 } };
    }

    const url = new URL('https://maps.googleapis.com/maps/api/geocode/json');
    url.searchParams.set('address', address);
    url.searchParams.set('key', apiKey);

    const response = await this.fetchWithRetry(url.toString());
    if (!response.ok) throw new Error(`Geocoding API error: ${response.status}`);

    const body = (await response.json()) as {
      status: string;
      results?: Array<{
        formatted_address: string;
        geometry: { location: { lat: number; lng: number } };
        place_id: string;
      }>;
    };

    if (body.status !== 'OK' || !body.results?.length) {
      throw new Error(`Geocoding API status: ${body.status}`);
    }

    const result = body.results[0];
    const data = {
      message: 'Address geocoded successfully',
      data: {
        address: result.formatted_address,
        latitude: result.geometry.location.lat,
        longitude: result.geometry.location.lng,
        placeId: result.place_id,
      },
    };

    if (this.redis) {
      try { await this.redis.setex(cacheKey, this.cacheTtlSeconds, JSON.stringify(data)); } catch { /* ignore */ }
    }
    return data;
  }

  async reverseGeocode(latitude: number, longitude: number) {
    const cacheKey = `maps:reverse-geocode:${latitude}:${longitude}`;
    if (this.redis) {
      try {
        const cached = await this.redis.get(cacheKey);
        if (cached) return JSON.parse(cached);
      } catch { /* cache miss */ }
    }

    const apiKey = this.getApiKey();
    if (!apiKey) {
      this.logger.warn('GOOGLE_MAPS_API_KEY not set; reverse geocoding unavailable');
      return { message: 'Reverse geocoding unavailable (provider not configured)', data: { address: 'Unknown', latitude, longitude } };
    }

    const url = new URL('https://maps.googleapis.com/maps/api/geocode/json');
    url.searchParams.set('latlng', `${latitude},${longitude}`);
    url.searchParams.set('key', apiKey);

    const response = await this.fetchWithRetry(url.toString());
    if (!response.ok) throw new Error(`Reverse Geocoding API error: ${response.status}`);

    const body = (await response.json()) as {
      status: string;
      results?: Array<{ formatted_address: string; place_id: string }>;
    };

    if (body.status !== 'OK' || !body.results?.length) {
      throw new Error(`Reverse Geocoding API status: ${body.status}`);
    }

    const data = {
      message: 'Coordinates reverse geocoded successfully',
      data: {
        address: body.results[0].formatted_address,
        placeId: body.results[0].place_id,
        latitude,
        longitude,
      },
    };

    if (this.redis) {
      try { await this.redis.setex(cacheKey, this.cacheTtlSeconds, JSON.stringify(data)); } catch { /* ignore */ }
    }
    return data;
  }

  async searchPlaces(query: string, location?: { lat: number; lng: number }) {
    const cacheKey = `maps:places-search:${encodeURIComponent(query)}:${location?.lat ?? ''}:${location?.lng ?? ''}`;
    if (this.redis) {
      try {
        const cached = await this.redis.get(cacheKey);
        if (cached) return JSON.parse(cached);
      } catch { /* cache miss */ }
    }

    const apiKey = this.getApiKey();
    if (!apiKey) {
      this.logger.warn('GOOGLE_MAPS_API_KEY not set; place search unavailable');
      return { message: 'Place search unavailable (provider not configured)', data: [] };
    }

    const url = new URL('https://maps.googleapis.com/maps/api/place/textsearch/json');
    url.searchParams.set('query', query);
    if (location) url.searchParams.set('location', `${location.lat},${location.lng}`);
    url.searchParams.set('key', apiKey);

    const response = await this.fetchWithRetry(url.toString());
    if (!response.ok) throw new Error(`Places API error: ${response.status}`);

    const body = (await response.json()) as {
      status: string;
      results?: Array<{
        place_id: string;
        name: string;
        formatted_address: string;
        geometry: { location: { lat: number; lng: number } };
        rating?: number;
        types?: string[];
      }>;
    };

    if (body.status !== 'OK' && body.status !== 'ZERO_RESULTS') {
      throw new Error(`Places API status: ${body.status}`);
    }

    const data = {
      message: 'Places retrieved successfully',
      data: (body.results ?? []).map((r) => ({
        placeId: r.place_id,
        name: r.name,
        address: r.formatted_address,
        latitude: r.geometry.location.lat,
        longitude: r.geometry.location.lng,
        rating: r.rating,
        types: r.types,
      })),
    };

    if (this.redis) {
      try { await this.redis.setex(cacheKey, this.cacheTtlSeconds, JSON.stringify(data)); } catch { /* ignore */ }
    }
    return data;
  }

  async getPlaceDetails(placeId: string) {
    const cacheKey = `maps:place-details:${encodeURIComponent(placeId)}`;
    if (this.redis) {
      try {
        const cached = await this.redis.get(cacheKey);
        if (cached) return JSON.parse(cached);
      } catch { /* cache miss */ }
    }

    const apiKey = this.getApiKey();
    if (!apiKey) {
      this.logger.warn('GOOGLE_MAPS_API_KEY not set; place details unavailable');
      return { message: 'Place details unavailable (provider not configured)', data: { placeId } };
    }

    const url = new URL('https://maps.googleapis.com/maps/api/place/details/json');
    url.searchParams.set('place_id', placeId);
    url.searchParams.set('fields', 'place_id,name,formatted_address,geometry,rating,formatted_phone_number,website,opening_hours,types');
    url.searchParams.set('key', apiKey);

    const response = await this.fetchWithRetry(url.toString());
    if (!response.ok) throw new Error(`Place Details API error: ${response.status}`);

    const body = (await response.json()) as {
      status: string;
      result?: {
        place_id: string;
        name: string;
        formatted_address: string;
        geometry: { location: { lat: number; lng: number } };
        rating?: number;
        formatted_phone_number?: string;
        website?: string;
        opening_hours?: { open_now: boolean };
        types?: string[];
      };
    };

    if (body.status !== 'OK' || !body.result) {
      throw new Error(`Place Details API status: ${body.status}`);
    }

    const r = body.result;
    const data = {
      message: 'Place details retrieved successfully',
      data: {
        placeId: r.place_id,
        name: r.name,
        address: r.formatted_address,
        latitude: r.geometry.location.lat,
        longitude: r.geometry.location.lng,
        rating: r.rating,
        phone: r.formatted_phone_number,
        website: r.website,
        openNow: r.opening_hours?.open_now,
        types: r.types,
      },
    };

    if (this.redis) {
      try { await this.redis.setex(cacheKey, this.cacheTtlSeconds, JSON.stringify(data)); } catch { /* ignore */ }
    }
    return data;
  }

  /** Haversine fallback for distance when API key is unavailable */
  private haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
    const R = 6371;
    const dLat = ((lat2 - lat1) * Math.PI) / 180;
    const dLon = ((lon2 - lon1) * Math.PI) / 180;
    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }
}
