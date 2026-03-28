import {
  IsBoolean,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
} from 'class-validator';

import { IncidentRootCause } from '../enums/incident-root-cause.enum';
import { IncidentSeverity } from '../enums/incident-severity.enum';

export class CreateIncidentReviewDto {
  @IsUUID()
  orderId: string;

  @IsOptional()
  @IsUUID()
  riderId?: string;

  @IsOptional()
  @IsString()
  hospitalId?: string;

  @IsOptional()
  @IsString()
  bloodBankId?: string;

  @IsEnum(IncidentRootCause)
  rootCause: IncidentRootCause;

  @IsEnum(IncidentSeverity)
  @IsOptional()
  severity?: IncidentSeverity;

  @IsString()
  @IsNotEmpty()
  description: string;

  @IsOptional()
  @IsString()
  correctiveAction?: string;

  @IsOptional()
  @IsBoolean()
  affectsScoring?: boolean;

  @IsOptional()
  metadata?: Record<string, unknown>;
}
