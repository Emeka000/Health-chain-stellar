import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsDateString,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';

import { IncidentRootCause } from '../enums/incident-root-cause.enum';
import { IncidentReviewStatus } from '../enums/incident-review-status.enum';
import { IncidentSeverity } from '../enums/incident-severity.enum';

export class QueryIncidentReviewDto {
  @IsOptional()
  @IsString()
  orderId?: string;

  @IsOptional()
  @IsString()
  riderId?: string;

  @IsOptional()
  @IsString()
  hospitalId?: string;

  @IsOptional()
  @IsString()
  bloodBankId?: string;

  @IsOptional()
  @IsEnum(IncidentRootCause)
  rootCause?: IncidentRootCause;

  @IsOptional()
  @IsEnum(IncidentSeverity)
  severity?: IncidentSeverity;

  @IsOptional()
  @IsEnum(IncidentReviewStatus)
  status?: IncidentReviewStatus;

  @IsOptional()
  @IsDateString()
  startDate?: string;

  @IsOptional()
  @IsDateString()
  endDate?: string;

  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  @IsBoolean()
  affectsScoring?: boolean;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  pageSize?: number = 25;
}
