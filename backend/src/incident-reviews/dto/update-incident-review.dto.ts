import { IsEnum, IsOptional, IsString, IsUUID } from 'class-validator';

import { IncidentRootCause } from '../enums/incident-root-cause.enum';
import { IncidentReviewStatus } from '../enums/incident-review-status.enum';
import { IncidentSeverity } from '../enums/incident-severity.enum';

export class UpdateIncidentReviewDto {
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
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  correctiveAction?: string;

  @IsOptional()
  @IsString()
  resolutionNotes?: string;

  @IsOptional()
  @IsUUID()
  reviewedByUserId?: string;

  @IsOptional()
  metadata?: Record<string, unknown>;
}
