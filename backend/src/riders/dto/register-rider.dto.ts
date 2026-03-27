import {
  IsEnum,
  IsNotEmpty,
  IsString,
  IsOptional,
  IsNumber,
  IsUrl,
} from 'class-validator';

import { VehicleType } from '../enums/vehicle-type.enum';

export class RegisterRiderDto {
  @IsEnum(VehicleType)
  @IsNotEmpty()
  vehicleType: VehicleType;

  @IsString()
  @IsNotEmpty()
  vehicleNumber: string;

  @IsString()
  @IsNotEmpty()
  licenseNumber: string;

  @IsUrl()
  @IsNotEmpty()
  identityDocumentUrl: string;

  @IsUrl()
  @IsNotEmpty()
  vehicleDocumentUrl: string;

  @IsOptional()
  @IsNumber()
  latitude?: number;

  @IsOptional()
  @IsNumber()
  longitude?: number;
}
