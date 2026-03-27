import {
  IsEnum,
  IsOptional,
  IsString,
  IsNumber,
  IsBoolean,
} from 'class-validator';

import { RiderStatus } from '../enums/rider-status.enum';
import { VehicleType } from '../enums/vehicle-type.enum';

export class UpdateRiderDto {
  @IsEnum(VehicleType)
  @IsOptional()
  vehicleType?: VehicleType;

  @IsString()
  @IsOptional()
  vehicleNumber?: string;

  @IsString()
  @IsOptional()
  licenseNumber?: string;

  @IsEnum(RiderStatus)
  @IsOptional()
  status?: RiderStatus;

  @IsOptional()
  @IsNumber()
  latitude?: number;

  @IsOptional()
  @IsNumber()
  longitude?: number;

  @IsOptional()
  @IsBoolean()
  isVerified?: boolean;
}
