import {
  IsDateString,
  IsEnum,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
} from 'class-validator';

import { OverrideReason } from '../enums/override-reason.enum';

export class IntakeWindowCheckDto {
  @IsUUID()
  hospitalId: string;

  @IsDateString()
  projectedDeliveryAt: string;

  @IsOptional()
  @IsNumber()
  unitsRequested?: number;

  @IsOptional()
  @IsUUID()
  orderId?: string;

  @IsOptional()
  @IsUUID()
  bloodRequestId?: string;
}

export class RequestEmergencyOverrideDto {
  @IsUUID()
  hospitalId: string;

  @IsEnum(OverrideReason)
  reason: OverrideReason;

  @IsOptional()
  @IsString()
  reasonNotes?: string;

  @IsOptional()
  @IsUUID()
  orderId?: string;

  @IsOptional()
  @IsUUID()
  bloodRequestId?: string;

  @IsOptional()
  @IsDateString()
  projectedDeliveryAt?: string;
}

export interface IntakeWindowCheckResult {
  hospitalId: string;
  projectedDeliveryAt: Date;
  canReceive: boolean;
  constraintViolations: ConstraintViolation[];
  storageAvailable: boolean;
  availableStorageUnits: number;
  withinReceivingWindow: boolean;
  withinBlackoutPeriod: boolean;
  requiresOverride: boolean;
}

export interface ConstraintViolation {
  type: 'receiving_window' | 'blackout_period' | 'storage_capacity';
  message: string;
  detail?: Record<string, unknown>;
}
