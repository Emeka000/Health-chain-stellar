import { IsEnum, IsOptional, IsString } from 'class-validator';

import {
  ReadinessEntityType,
  ReadinessItemKey,
  ReadinessItemStatus,
} from '../enums/readiness.enum';

export class CreateChecklistDto {
  @IsEnum(ReadinessEntityType)
  entityType: ReadinessEntityType;

  @IsString()
  entityId: string;
}

export class UpdateReadinessItemDto {
  @IsEnum(ReadinessItemStatus)
  status: ReadinessItemStatus;

  @IsOptional()
  @IsString()
  evidenceUrl?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}

export class SignOffDto {
  @IsOptional()
  @IsString()
  reviewerNotes?: string;
}

export class QueryReadinessDto {
  @IsOptional()
  @IsEnum(ReadinessEntityType)
  entityType?: ReadinessEntityType;

  @IsOptional()
  @IsEnum(ReadinessItemKey)
  overdueItemKey?: ReadinessItemKey;
}
