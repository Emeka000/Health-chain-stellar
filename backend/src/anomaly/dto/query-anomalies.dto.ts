import { IsEnum, IsOptional, IsInt, Min, Max } from 'class-validator';
import { Type } from 'class-transformer';

import {
  AnomalyType,
  AnomalySeverity,
  AnomalyStatus,
} from '../enums/anomaly-type.enum';

export class QueryAnomaliesDto {
  @IsOptional()
  @IsEnum(AnomalyType)
  type?: AnomalyType;

  @IsOptional()
  @IsEnum(AnomalySeverity)
  severity?: AnomalySeverity;

  @IsOptional()
  @IsEnum(AnomalyStatus)
  status?: AnomalyStatus;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number = 25;
}
