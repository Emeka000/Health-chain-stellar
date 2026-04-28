import { Type } from 'class-transformer';
import { IsNumber, IsOptional, IsString, Min } from 'class-validator';

export class CreatePlannedRouteDto {
  @IsString()
  orderId: string;

  @IsString()
  riderId: string;

  /** Google-encoded polyline of the planned path */
  @IsString()
  polyline: string;

  @IsOptional()
  checkpoints?: Array<{
    latitude: number;
    longitude: number;
    expectedArrivalAt: string;
    label?: string;
  }>;

  @IsOptional()
  @IsNumber()
  @Min(50)
  @Type(() => Number)
  corridorRadiusM?: number;

  @IsOptional()
  @IsNumber()
  @Min(30)
  @Type(() => Number)
  maxDeviationSeconds?: number;
}

export class LocationUpdateDto {
  @IsString()
  riderId: string;

  @IsString()
  orderId: string;

  @IsNumber()
  @Type(() => Number)
  latitude: number;

  @IsNumber()
  @Type(() => Number)
  longitude: number;

  @IsOptional()
  @IsString()
  timestamp?: string;
}

export class AcknowledgeDeviationDto {
  @IsString()
  userId: string;
}
