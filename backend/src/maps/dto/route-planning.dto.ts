import { Type } from 'class-transformer';
import {
  IsNumber,
  IsArray,
  IsOptional,
  IsBoolean,
  IsEnum,
  Min,
  Max,
} from 'class-validator';

export class WaypointDto {
  @IsNumber()
  @Type(() => Number)
  latitude: number;

  @IsNumber()
  @Type(() => Number)
  longitude: number;

  @IsOptional()
  name?: string;

  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  停留时间秒?: number; // Dwell time in seconds
}

export class RouteRequestDto {
  @IsNumber()
  @Type(() => Number)
  originLat: number;

  @IsNumber()
  @Type(() => Number)
  originLng: number;

  @IsNumber()
  @Type(() => Number)
  destLat: number;

  @IsNumber()
  @Type(() => Number)
  destLng: number;

  @IsArray()
  @IsOptional()
  waypoints?: WaypointDto[];

  @IsBoolean()
  @IsOptional()
  @Type(() => Boolean)
  avoidTolls?: boolean = false;

  @IsBoolean()
  @IsOptional()
  @Type(() => Boolean)
  avoidHighways?: boolean = false;

  @IsBoolean()
  @IsOptional()
  @Type(() => Boolean)
  optimizeWaypoints?: boolean = false;

  @IsEnum(['driving', 'walking', 'bicycling', 'transit'])
  @IsOptional()
  travelMode?: 'driving' | 'walking' | 'bicycling' | 'transit' = 'driving';

  @IsBoolean()
  @IsOptional()
  @Type(() => Boolean)
  provideAlternatives?: boolean = false;
}

export class MultiStopRouteDto {
  @IsArray()
  @Type(() => WaypointDto)
  stops: WaypointDto[];

  @IsBoolean()
  @IsOptional()
  @Type(() => Boolean)
  optimizeOrder?: boolean = true;

  @IsBoolean()
  @IsOptional()
  @Type(() => Boolean)
  returnToStart?: boolean = false;

  @IsEnum(['driving', 'walking', 'bicycling', 'transit'])
  @IsOptional()
  travelMode?: 'driving' | 'walking' | 'bicycling' | 'transit' = 'driving';
}

export interface RouteStep {
  instruction: string;
  distanceMeters: number;
  durationSeconds: number;
  startLocation: {
    latitude: number;
    longitude: number;
  };
  endLocation: {
    latitude: number;
    longitude: number;
  };
  maneuver: string;
}

export interface RouteInfo {
  distanceMeters: number;
  durationSeconds: number;
  durationInTrafficSeconds?: number;
  startLocation: {
    latitude: number;
    longitude: number;
  };
  endLocation: {
    latitude: number;
    longitude: number;
  };
  steps: RouteStep[];
  polyline: string;
  bounds: {
    northeast: { latitude: number; longitude: number };
    southwest: { latitude: number; longitude: number };
  };
}

export interface RouteResponse {
  message: string;
  data: {
    route: RouteInfo;
    alternatives?: RouteInfo[];
    waypoints?: WaypointDto[];
    optimizedOrder?: number[];
  };
}

export interface MultiStopRouteResponse {
  message: string;
  data: {
    routes: RouteInfo[];
    totalDistanceMeters: number;
    totalDurationSeconds: number;
    optimizedOrder: number[];
    stops: WaypointDto[];
  };
}

export interface ETAResponse {
  message: string;
  data: {
    eta: string; // ISO 8601 timestamp
    durationSeconds: number;
    durationInTrafficSeconds?: number;
    distanceMeters: number;
  };
}
