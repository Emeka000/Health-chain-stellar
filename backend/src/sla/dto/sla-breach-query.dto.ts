import { IsEnum, IsOptional, IsString, IsDateString } from 'class-validator';
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
}
