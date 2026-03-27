import { Type } from 'class-transformer';
import {
  IsNumber,
  IsOptional,
  IsEnum,
  IsBoolean,
  Min,
  Max,
} from 'class-validator';

import { RiderStatus } from '../enums/rider-status.enum';
import { VehicleType } from '../enums/vehicle-type.enum';

export class RiderSearchDto {
  @IsNumber()
  @Type(() => Number)
  latitude: number;

  @IsNumber()
  @Type(() => Number)
  longitude: number;

  @IsNumber()
  @Min(0.1)
  @Max(100)
  @IsOptional()
  @Type(() => Number)
  radiusKm?: number = 10;

  @IsEnum(VehicleType)
  @IsOptional()
  vehicleType?: VehicleType;

  @IsNumber()
  @Min(0)
  @Max(5)
  @IsOptional()
  @Type(() => Number)
  minRating?: number;

  @IsNumber()
  @Min(0)
  @Max(100)
  @IsOptional()
  @Type(() => Number)
  minCompletionRate?: number;

  @IsBoolean()
  @IsOptional()
  @Type(() => Boolean)
  availableOnly?: boolean = true;

  @IsNumber()
  @Min(1)
  @Max(100)
  @IsOptional()
  @Type(() => Number)
  limit?: number = 20;

  @IsNumber()
  @Min(0)
  @IsOptional()
  @Type(() => Number)
  offset?: number = 0;
}

export class RiderAssignmentDto {
  @IsNumber()
  @Type(() => Number)
  latitude: number;

  @IsNumber()
  @Type(() => Number)
  longitude: number;

  @IsEnum(VehicleType)
  @IsOptional()
  vehicleType?: VehicleType;

  @IsNumber()
  @Min(1)
  @Max(10)
  @IsOptional()
  @Type(() => Number)
  maxCandidates?: number = 5;
}

export interface RiderSearchResult {
  id: string;
  userId: string;
  vehicleType: VehicleType;
  status: RiderStatus;
  latitude: number | null;
  longitude: number | null;
  rating: number;
  completedDeliveries: number;
  cancelledDeliveries: number;
  failedDeliveries: number;
  isVerified: boolean;
  distanceKm: number | null;
  completionRate: number;
}

export interface RiderAssignmentResult {
  riderId: string;
  score: AssignmentScore;
  distanceKm: number;
  travelTimeSeconds: number;
}

export interface AssignmentScore {
  riderId: string;
  distanceScore: number;
  ratingScore: number;
  completionRateScore: number;
  vehicleTypeScore: number;
  totalScore: number;
  distanceKm: number;
  travelTimeSeconds: number;
  rating: number;
  completionRate: number;
  vehicleType: VehicleType;
}

export interface RiderSearchResponse {
  message: string;
  data: RiderSearchResult[];
  total: number;
  limit: number;
  offset: number;
}

export interface RiderAssignmentResponse {
  message: string;
  data: {
    candidates: RiderAssignmentResult[];
    selectedRider: RiderAssignmentResult | null;
  };
}
