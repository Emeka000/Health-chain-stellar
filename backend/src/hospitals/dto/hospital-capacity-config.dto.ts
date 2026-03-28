import {
  IsArray,
  IsBoolean,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

import {
  BlackoutPeriod,
  ReceivingWindowSlot,
} from '../entities/hospital-capacity-config.entity';

export class ReceivingWindowSlotDto implements ReceivingWindowSlot {
  @IsInt()
  @Min(0)
  @Max(6)
  dayOfWeek: number;

  @IsString()
  @IsNotEmpty()
  openTime: string;

  @IsString()
  @IsNotEmpty()
  closeTime: string;
}

export class BlackoutPeriodDto implements BlackoutPeriod {
  @IsString()
  @IsNotEmpty()
  label: string;

  @IsString()
  @IsNotEmpty()
  startIso: string;

  @IsString()
  @IsNotEmpty()
  endIso: string;
}

export class UpsertCapacityConfigDto {
  @IsInt()
  @Min(0)
  coldStorageCapacityUnits: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  currentStorageUnits?: number;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ReceivingWindowSlotDto)
  receivingWindows?: ReceivingWindowSlotDto[] | null;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => BlackoutPeriodDto)
  blackoutPeriods?: BlackoutPeriodDto[] | null;

  @IsOptional()
  @IsBoolean()
  allowEmergencyOverride?: boolean;

  @IsOptional()
  @IsInt()
  @Min(0)
  intakeBufferMinutes?: number;

  @IsOptional()
  @IsBoolean()
  isEnforced?: boolean;
}
