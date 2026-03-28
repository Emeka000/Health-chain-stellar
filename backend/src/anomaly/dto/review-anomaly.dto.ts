import { IsEnum, IsOptional, IsString } from 'class-validator';

import { AnomalyStatus } from '../enums/anomaly-type.enum';

export class ReviewAnomalyDto {
  @IsEnum(AnomalyStatus)
  status: AnomalyStatus;

  @IsOptional()
  @IsString()
  reviewNotes?: string;
}
