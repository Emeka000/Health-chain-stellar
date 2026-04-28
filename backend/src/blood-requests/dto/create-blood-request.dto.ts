import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsDateString,
  IsEnum,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';

import { UrgencyLevel } from '../enums/urgency-level.enum';

import { CreateRequestItemDto } from './create-request-item.dto';
import { RequestUrgency } from '../entities/blood-request.entity';

export class CreateBloodRequestDto {
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  hospitalId: string;

  /** ISO 8601 datetime; must be strictly in the future at creation time. */
  @IsDateString()
  requiredBy: string;

  @IsOptional()
  @IsEnum(UrgencyLevel)
  urgencyLevel?: UrgencyLevel;

  @ValidateNested({ each: true })
  @Type(() => CreateRequestItemDto)
  @ArrayMinSize(1)
  items: CreateRequestItemDto[];

  @IsEnum(RequestUrgency)
  @IsOptional()
  urgency?: RequestUrgency;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  deliveryAddress?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  deliveryContactName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  deliveryContactPhone?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  deliveryInstructions?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;
}
