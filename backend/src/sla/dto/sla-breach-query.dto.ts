import { IsEnum, IsOptional, IsString, IsDateString, IsInt, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { SlaStage } from '../enums/sla-stage.enum';

export class SlaBreachQueryDto {
  @IsOptional()
  @IsString()
  hospitalId?: string;

  @IsOptional()
  @IsString()
  bloodBankId?: string;

  @IsOptional()
  @IsString()
  riderId?: string;

  @IsOptional()
  @IsString()
  urgencyTier?: string;

  @IsOptional()
  @IsEnum(SlaStage)
  stage?: SlaStage;

  @IsOptional()
  @IsDateString()
  startDate?: string;

  @IsOptional()
  @IsDateString()
  endDate?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  pageSize?: number;
}

export class SlaBreachResponseDto {
  data: any[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}
